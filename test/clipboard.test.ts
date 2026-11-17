import { describe, expect, it } from 'vitest'
import { copyToClipboard, osc52Sequence, writeOsc52 } from '../src/core/clipboard.js'

function fakeStream(isTTY: boolean): { stream: NodeJS.WriteStream; writes: string[] } {
  const writes: string[] = []
  const stream = {
    isTTY,
    write: (chunk: string) => {
      writes.push(chunk)
      return true
    },
  } as unknown as NodeJS.WriteStream
  return { stream, writes }
}

const payload = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

describe('osc52Sequence', () => {
  it('encodes the text as base64', () => {
    expect(osc52Sequence('hello', {})).toBe(`\x1b]52;c;${payload('hello')}\x07`)
  })

  it('wraps the sequence in a tmux passthrough', () => {
    const sequence = osc52Sequence('hi', { TMUX: '/tmp/tmux' })
    expect(sequence.startsWith('\x1bPtmux;')).toBe(true)
    expect(sequence.endsWith('\x1b\\')).toBe(true)
    // The inner escape must be doubled for tmux.
    expect(sequence).toContain('\x1b\x1b]52;c;')
  })
})

describe('writeOsc52', () => {
  it('writes the sequence to a TTY', () => {
    const { stream, writes } = fakeStream(true)
    expect(writeOsc52('hello', stream, {})).toBe(true)
    expect(writes).toEqual([`\x1b]52;c;${payload('hello')}\x07`])
  })

  it('refuses when the stream is not a TTY', () => {
    const { stream, writes } = fakeStream(false)
    expect(writeOsc52('hello', stream, {})).toBe(false)
    expect(writes).toEqual([])
  })

  it('refuses payloads that are too large for terminals', () => {
    const { stream, writes } = fakeStream(true)
    expect(writeOsc52('x'.repeat(100_000), stream, {})).toBe(false)
    expect(writes).toEqual([])
  })

  it('never throws when the stream write fails', () => {
    const stream = {
      isTTY: true,
      write: () => {
        throw new Error('closed')
      },
    } as unknown as NodeJS.WriteStream
    expect(writeOsc52('hello', stream, {})).toBe(false)
  })
})

describe('copyToClipboard', () => {
  it('uses OSC 52 when TELEPI_CLIPBOARD asks for it', async () => {
    const { stream, writes } = fakeStream(true)
    const ok = await copyToClipboard('copied', {
      stream,
      env: { TELEPI_CLIPBOARD: 'osc52' },
    })

    expect(ok).toBe(true)
    expect(writes).toEqual([`\x1b]52;c;${payload('copied')}\x07`])
  })

  it('returns false when no method is available', async () => {
    const { stream, writes } = fakeStream(false)
    const ok = await copyToClipboard('copied', {
      stream,
      env: { TELEPI_CLIPBOARD: 'osc52' },
    })

    expect(ok).toBe(false)
    expect(writes).toEqual([])
  })
})
