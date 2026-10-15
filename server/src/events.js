import { EventEmitter } from 'node:events'

/** Global event bus: prober, runner and scheduler publish; WebSocket fans out. */
export const bus = new EventEmitter()
bus.setMaxListeners(0)

export function emit(type, payload) {
  bus.emit('event', { type, payload, at: new Date().toISOString() })
}
