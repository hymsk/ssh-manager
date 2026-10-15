import { getDb, nowIso, clean } from '../db.js'
import { connect, classifyError } from './connect.js'
import { emit } from '../events.js'

const DEFAULT_INTERVAL = Number(process.env.PROBE_INTERVAL_MS || 30000)
const OFFLINE_AFTER = Number(process.env.OFFLINE_AFTER_FAILURES || 2)

let timer = null
let running = false
let key = null
let lastSweepAt = null

export function getProbeConfig() {
  return {
    intervalMs: DEFAULT_INTERVAL,
    offlineAfterFailures: OFFLINE_AFTER,
    connectTimeoutMs: Number(process.env.PROBE_CONNECT_TIMEOUT_MS || 5000),
    lastSweepAt,
  }
}

export function startProber(masterKey) {
  key = masterKey
  // Probe immediately on startup, then every interval.
  setTimeout(() => safeSweep('startup'), 1500)
  timer = setInterval(() => safeSweep('interval'), DEFAULT_INTERVAL)
  return getProbeConfig()
}

export function stopProber() {
  if (timer) clearInterval(timer)
  timer = null
}

async function safeSweep(reason) {
  if (running) return
  running = true
  try {
    await sweep(reason)
  } finally {
    running = false
    lastSweepAt = nowIso()
  }
}

async function sweep() {
  const db = getDb()
  const hosts = db.prepare('SELECT * FROM hosts').all()
  // Limit concurrency so a large host list does not exhaust sockets.
  await mapLimit(hosts, 8, (row) => probeOne(row))
}

export async function probeOne(row, { event = true } = {}) {
  const db = getDb()
  const started = Date.now()
  const prevStatus = row.status

  // Mark transient state so the UI can render "connecting".
  setStatus(row.id, 'connecting', { keepCounters: true })

  let client = null
  try {
    const res = await connect(row, key)
    client = res.client
    const latency = Date.now() - started
    client.end()

    const fingerprint = res.fingerprint
    // If the stored fingerprint differs, treat as a hard security error.
    if (row.host_fingerprint && fingerprint && row.host_fingerprint !== fingerprint) {
      updateHost(row.id, {
        status: 'error',
        latency_ms: latency,
        last_error: '主机指纹已变化，可能存在中间人风险',
        last_checked_at: nowIso(),
        last_online_at: nowIso(),
        consecutive_failures: 0,
      })
    } else {
      updateHost(row.id, {
        status: 'online',
        latency_ms: latency,
        last_error: null,
        last_checked_at: nowIso(),
        last_online_at: nowIso(),
        consecutive_failures: 0,
        host_fingerprint: row.host_fingerprint || fingerprint,
      })
    }
    if (event) emitStatus(row.id, 'online', latency)
    return true
  } catch (err) {
    const { status, message } = classifyError(err)
    const failures = (row.consecutive_failures || 0) + 1

    let nextStatus
    if (status === 'auth_failed' || status === 'error') {
      // Credential / security issues are definitive, no debounce.
      nextStatus = status
    } else {
      // Debounce transient network failures.
      nextStatus = failures >= OFFLINE_AFTER ? status : 'unstable'
    }

    updateHost(row.id, {
      status: nextStatus,
      latency_ms: null,
      last_error: message,
      last_checked_at: nowIso(),
      consecutive_failures: failures,
    })
    if (event) emitStatus(row.id, nextStatus, null, message)
    return false
  } finally {
    try {
      client?.end()
    } catch {
      /* ignore */
    }
    if (prevStatus !== undefined) {
      /* status history could be recorded here in the future */
    }
  }
}

function updateHost(id, patch) {
  const db = getDb()
  const cols = Object.keys(patch)
  const sql = `UPDATE hosts SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  db.prepare(sql).run(...clean([...cols.map((c) => patch[c]), nowIso(), id]))
}

function setStatus(id, status, { keepCounters = false } = {}) {
  const db = getDb()
  if (keepCounters) {
    db.prepare('UPDATE hosts SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id)
  }
}

function emitStatus(hostId, status, latencyMs, error) {
  const db = getDb()
  const host = db
    .prepare('SELECT id, name, status, latency_ms, last_error, last_checked_at, consecutive_failures FROM hosts WHERE id = ?')
    .get(hostId)
  emit('host_status', { hostId, status, latencyMs, error, host })
}

/** Probe a single host by id, used by the "retry" button. */
export async function probeById(id) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM hosts WHERE id = ?').get(id)
  if (!row) return null
  await probeOne(row)
  return db.prepare('SELECT * FROM hosts WHERE id = ?').get(id)
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) || 0 }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}
