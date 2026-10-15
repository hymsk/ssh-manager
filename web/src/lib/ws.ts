import type { Host, Run, RunResult } from '../types'

export interface RunHostEvent {
  runId: string
  result: RunResult
  counts: Pick<Run, 'status' | 'success_count' | 'failed_count' | 'skipped_count' | 'total_hosts'>
}

export interface ServerEvent {
  type: string
  at: string
  payload: unknown
}

type EventHandler = (evt: ServerEvent) => void
type TermHandler = (msg: Record<string, unknown>) => void

/**
 * Single WebSocket connection serving both global events and terminal streams.
 * Reconnects automatically with backoff.
 */
export class WsClient {
  private ws: WebSocket | null = null
  private eventHandlers = new Set<EventHandler>()
  private termHandlers = new Set<TermHandler>()
  private reconnectAttempts = 0
  private closedByUser = false
  private readonly url: string

  constructor() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const base = import.meta.env.VITE_WS_BASE || `${proto}://${location.host}/ws`
    this.url = base
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    this.closedByUser = false
    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
    }
    this.ws.onmessage = (ev) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.type === 'event') {
        const evt = msg.evt as unknown as ServerEvent
        for (const h of this.eventHandlers) h(evt)
      } else {
        for (const h of this.termHandlers) h(msg)
      }
    }
    this.ws.onclose = () => {
      if (this.closedByUser) return
      this.reconnectAttempts += 1
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000)
      setTimeout(() => this.connect(), delay)
    }
    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  send(payload: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
      return true
    }
    return false
  }

  onEvent(handler: EventHandler) {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  onTerminal(handler: TermHandler) {
    this.termHandlers.add(handler)
    return () => this.termHandlers.delete(handler)
  }

  close() {
    this.closedByUser = true
    this.ws?.close()
  }
}

export const ws = new WsClient()

export type { Host }
