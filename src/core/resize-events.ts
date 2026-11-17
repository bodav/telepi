import { EventEmitter } from 'node:events'

/** Fired after the resize workaround has reset the viewport. */
export const resizeEvents = new EventEmitter()

export function onResizeReset(listener: () => void): () => void {
  resizeEvents.on('reset', listener)
  return () => resizeEvents.off('reset', listener)
}
