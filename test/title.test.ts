import { describe, expect, it } from 'vitest'
import { installTerminalTitle, setTerminalTitle, titleSequence } from '../src/core/title.js'

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

describe('titleSequence', () => {
  it('wraps the title in an OSC 0 sequence', () => {
    expect(titleSequence('telepi')).toBe('\x1b]0;telepi\x07')
  })

  it('strips control characters and newlines', () => {
    expect(titleSequence('a\nb\x00c')).toBe('\x1b]0;a b c\x07')
  })

  it('trims surrounding whitespace', () => {
    expect(titleSequence('  hi  ')).toBe('\x1b]0;hi\x07')
  })
})

describe('setTerminalTitle', () => {
  it('writes the sequence to a TTY', () => {
    const { stream, writes } = fakeStream(true)
    setTerminalTitle('hello', stream)
    expect(writes).toEqual(['\x1b]0;hello\x07'])
  })

  it('does nothing when the stream is not a TTY', () => {
    const { stream, writes } = fakeStream(false)
    setTerminalTitle('hello', stream)
    expect(writes).toEqual([])
  })

  it('never throws when the stream write fails', () => {
    const stream = {
      isTTY: true,
      write: () => {
        throw new Error('closed')
      },
    } as unknown as NodeJS.WriteStream
    expect(() => setTerminalTitle('hello', stream)).not.toThrow()
  })
})

describe('installTerminalTitle', () => {
  it('sets the title and clears it on restore', () => {
    const { stream, writes } = fakeStream(true)
    const restore = installTerminalTitle('telepi 1.0', stream)
    expect(writes).toEqual(['\x1b]0;telepi 1.0\x07'])

    restore()
    expect(writes).toEqual(['\x1b]0;telepi 1.0\x07', '\x1b]0;\x07'])
  })
})
