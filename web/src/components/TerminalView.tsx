import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { Host } from '../types'
import { ws } from '../lib/ws'
import { StatusDot } from './StatusDot'

interface Props {
  host: Host
  onClose: () => void
}

export function TerminalView({ host, onClose }: Props) {
  const holderRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!holderRef.current) return
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
      fontSize: 13,
      theme: {
        background: '#08090c',
        foreground: '#d6dee8',
        cursor: '#4c8dff',
        selectionBackground: '#2f5ea8',
      },
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(holderRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const off = ws.onTerminal((msg) => {
      switch (msg.type) {
        case 'term_status':
          setStatus(msg.status as typeof status)
          if (msg.status === 'connected') term.write('\r\n[已连接]\r\n')
          break
        case 'term_data':
          term.write(msg.data as string)
          break
        case 'term_error':
          setError(msg.message as string)
          setStatus('error')
          term.write(`\r\n\x1b[31m[错误] ${msg.message}\x1b[0m\r\n`)
          break
      }
    })

    ws.send({ type: 'term_open', hostId: host.id, cols: term.cols, rows: term.rows })

    const onData = term.onData((data) => {
      ws.send({ type: 'term_data', data })
    })
    const onResize = term.onResize(({ cols, rows }) => {
      ws.send({ type: 'term_resize', cols, rows })
    })

    const doFit = () => {
      try {
        fit.fit()
        ws.send({ type: 'term_resize', cols: term.cols, rows: term.rows })
      } catch {
        /* ignore */
      }
    }
    const ro = new ResizeObserver(() => doFit())
    ro.observe(holderRef.current)

    term.focus()

    return () => {
      off()
      onData.dispose()
      onResize.dispose()
      ro.disconnect()
      ws.send({ type: 'term_close' })
      term.dispose()
      termRef.current = null
    }
  }, [host.id])

  function reconnect() {
    setError(null)
    setStatus('connecting')
    termRef.current?.reset()
    ws.send({ type: 'term_open', hostId: host.id, cols: termRef.current?.cols || 80, rows: termRef.current?.rows || 24 })
  }

  return (
    <div className="term-wrap">
      <div className="term-bar">
        <StatusDot status={status === 'connected' ? 'online' : status === 'connecting' ? 'connecting' : 'offline'} kind="host" />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
          {host.username}@{host.host}:{host.port}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn sm ghost" onClick={reconnect}>
          重连
        </button>
        <button className="btn sm ghost" onClick={() => termRef.current?.clear()}>
          清屏
        </button>
        <button className="btn sm ghost" onClick={onClose}>
          关闭
        </button>
      </div>
      {error && <div className="err" style={{ margin: '8px 12px 0' }}>{error}</div>}
      <div className="term-holder" ref={holderRef} />
    </div>
  )
}
