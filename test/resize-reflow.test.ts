import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectedUp, installResizeReflowFix, measureFrame } from '../src/core/resize-reflow.js'

class MockStream extends EventEmitter {
  columns = 40
  rows = 30
  chunks: string[] = []

  write(chunk: unknown): boolean {
    this.chunks.push(String(chunk))
    return true
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('measureFrame', () => {
  it('counts rows after wrapping at the terminal width', () => {
    expect(measureFrame('aaa\nbbbb\n', 2)).toEqual({ lines: 2, rows: 4 })
  })

  it('treats blank lines as one row', () => {
    expect(measureFrame('\n\n', 80)).toEqual({ lines: 2, rows: 2 })
  })

  it('ignores ANSI styling when measuring', () => {
    const frame = '\x1b[36mhello\x1b[39m\n'
    expect(measureFrame(frame, 4)).toEqual({ lines: 1, rows: 2 })
  })
})

describe('expectedUp', () => {
  const erase = '\x1b[2K'
  const up = '\x1b[1A'
  const left = '\x1b[G'

  it('counts cursor moves in an eraseLines prefix', () => {
    expect(expectedUp(`${erase}${up}${erase}${up}${erase}${left}text`)).toBe(2)
    expect(expectedUp(`${erase}${left}text`)).toBe(0)
  })

  it('is zero for chunks without an erase prefix', () => {
    expect(expectedUp('plain text')).toBe(0)
    expect(expectedUp('')).toBe(0)
  })
})

describe('installResizeReflowFix', () => {
  const erase = '\x1b[2K'
  const up = '\x1b[1A'
  const left = '\x1b[G'

  it('holds frames while resizing and resets the viewport', () => {
    vi.useFakeTimers()

    const stream = new MockStream()
    const rerender = vi.fn()
    const uninstall = installResizeReflowFix(stream, { settleMs: 100, rerender })

    // One 40-column line; at 20 columns it reflows to two rows.
    const frame = `${erase}${left}${'x'.repeat(40)}\n`
    stream.write(frame)

    stream.columns = 20
    stream.emit('resize')

    const next = `${erase}${up}${erase}${left}short\n`
    stream.write(next)

    expect(stream.chunks.at(-1)).toBe(frame)

    vi.advanceTimersByTime(200)

    expect(stream.chunks).toContain('\x1b[2A\x1b[J')
    expect(stream.chunks).toContain('\r\n'.repeat(30))
    expect(stream.chunks).not.toContain('short\n')
    expect(rerender).toHaveBeenCalledOnce()

    uninstall()
  })
})
