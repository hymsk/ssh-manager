import { WebSocketServer } from 'ws'
import { bus } from './events.js'
import { getDb } from './db.js'
import { connect } from './ssh/connect.js'

/**
 * Two kinds of clients share one WebSocket endpoint:
 *  - event subscribers: receive { type: 'event', ... } frames
 *  - terminal sessions: receive { type: 'term_open' } then stream data
 */
export function attachWebSocket(server, { key }) {
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws) => {
    ws.isAlive = true
    ws.subscriptions = new Set()
    ws.term = null

    ws.on('pong', () => {
      ws.isAlive = true
    })

    ws.on('message', async (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      try {
        await handleMessage(ws, msg, key)
      } catch (err) {
        send(ws, { type: 'error', message: err.message })
      }
    })

    ws.on('close', () => {
      closeTerm(ws)
    })

    send(ws, { type: 'hello', ts: new Date().toISOString() })
  })

  // Heartbeat to drop dead terminal/event sockets.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
      try {
        ws.ping()
      } catch {
        /* ignore */
      }
    }
  }, 30000)

  const onEvent = (evt) => {
    // Keep the envelope type as "event" and nest the actual event so the
    // frontend can route it unambiguously.
    const frame = JSON.stringify({ type: 'event', evt })
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(frame)
    }
  }
  bus.on('event', onEvent)

  wss.on('close', () => {
    clearInterval(heartbeat)
    bus.off('event', onEvent)
  })

  return wss
}

async function handleMessage(ws, msg, key) {
  switch (msg.type) {
    case 'ping':
      return send(ws, { type: 'pong', ts: Date.now() })

    case 'term_open':
      return openTerm(ws, msg, key)

    case 'term_data':
      if (ws.term?.stream) ws.term.stream.write(msg.data)
      return

    case 'term_resize':
      if (ws.term?.stream) {
        try {
          ws.term.stream.setWindow(msg.rows || 24, msg.cols || 80, 0, 0)
        } catch {
          /* ignore */
        }
      }
      return

    case 'term_close':
      return closeTerm(ws)

    default:
      return
  }
}

async function openTerm(ws, msg, key) {
  closeTerm(ws)
  const db = getDb()
  const row = db.prepare('SELECT * FROM hosts WHERE id = ?').get(msg.hostId)
  if (!row) return send(ws, { type: 'term_error', message: '主机不存在' })

  send(ws, { type: 'term_status', status: 'connecting' })

  let client = null
  try {
    const res = await connect(row, key)
    client = res.client
    send(ws, { type: 'term_status', status: 'connected' })

    const cols = clamp(msg.cols, 20, 500, 80)
    const rows = clamp(msg.rows, 5, 200, 24)

    client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
      if (err) {
        send(ws, { type: 'term_error', message: err.message })
        client.end()
        return
      }
      ws.term = { client, stream }

      stream.on('data', (chunk) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'term_data', data: chunk.toString('utf8') }))
        }
      })
      stream.stderr.on('data', (chunk) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'term_data', data: chunk.toString('utf8') }))
        }
      })
      stream.on('close', () => {
        send(ws, { type: 'term_status', status: 'closed' })
        closeTerm(ws)
      })

      const shell = row.auth_type === 'agent' ? 'echo "使用 ssh-agent 认证"' : null
      if (shell) stream.write(`${shell}\n`)
    })
  } catch (err) {
    send(ws, { type: 'term_error', message: err.message })
    try {
      client?.end()
    } catch {
      /* ignore */
    }
  }
}

function closeTerm(ws) {
  if (!ws.term) return
  try {
    ws.term.stream?.end()
    ws.term.stream?.close()
  } catch {
    /* ignore */
  }
  try {
    ws.term.client?.end()
  } catch {
    /* ignore */
  }
  ws.term = null
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

function clamp(n, min, max, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(v)))
}
