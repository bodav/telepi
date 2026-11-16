import { describe, expect, it } from 'vitest'
import { splitEntities } from '../src/core/rich-text.js'
import { parseCommand, splitArgs } from '../src/core/command.js'

describe('splitEntities', () => {
  it('returns the plain text without entities', () => {
    expect(splitEntities('hello')).toEqual([{ text: 'hello', style: {} }])
  })

  it('splits at entity boundaries', () => {
    const segments = splitEntities('hi bold!', [
      { kind: 'bold', offset: 3, length: 4 },
    ])

    expect(segments).toEqual([
      { text: 'hi ', style: {} },
      { text: 'bold', style: { bold: true } },
      { text: '!', style: {} },
    ])
  })

  it('merges overlapping entities', () => {
    const segments = splitEntities('abcdef', [
      { kind: 'bold', offset: 1, length: 4 },
      { kind: 'italic', offset: 2, length: 3 },
    ])

    expect(segments).toEqual([
      { text: 'a', style: {} },
      { text: 'b', style: { bold: true } },
      { text: 'cde', style: { bold: true, italic: true } },
      { text: 'f', style: {} },
    ])
  })

  it('marks links and code', () => {
    const segments = splitEntities('see docs', [
      { kind: 'text_link', offset: 0, length: 3, url: 'https://example.com' },
      { kind: 'code', offset: 4, length: 4 },
    ])

    expect(segments[0]?.style).toEqual({ accent: 'link', underline: true })
    expect(segments[1]?.text).toBe(' ')
    expect(segments[2]?.style).toEqual({ code: true })
  })

  it('clamps out-of-range entities', () => {
    const segments = splitEntities('abc', [{ kind: 'bold', offset: 2, length: 50 }])
    expect(segments.map((segment) => segment.text).join('')).toBe('abc')
    expect(segments.at(-1)?.style).toEqual({ bold: true })
  })

  it('handles astral characters with UTF-16 offsets', () => {
    const text = '👋hello'
    const segments = splitEntities(text, [{ kind: 'bold', offset: 2, length: 5 }])
    expect(segments).toEqual([
      { text: '👋', style: {} },
      { text: 'hello', style: { bold: true } },
    ])
  })
})

describe('parseCommand', () => {
  it('parses name and args', () => {
    expect(parseCommand('/open @durov')).toEqual({
      name: 'open',
      args: '@durov',
      raw: '/open @durov',
    })
  })

  it('rejects plain text', () => {
    expect(parseCommand('hello')).toBeNull()
  })

  it('keeps argument spacing', () => {
    expect(parseCommand('/edit 12 hello  world')?.args).toBe('12 hello  world')
  })
})

describe('splitArgs', () => {
  it('keeps quoted arguments together', () => {
    expect(splitArgs('a "b c" \'d e\' f')).toEqual(['a', 'b c', 'd e', 'f'])
  })
})
