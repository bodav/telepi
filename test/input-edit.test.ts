import { describe, expect, it } from 'vitest'
import { graphemes } from '../src/core/text.js'
import {
  lineEnd,
  lineStart,
  moveVertical,
  spliceChars,
  wordEnd,
  wordStart,
} from '../src/ui/input-edit.js'

const chars = (text: string): string[] => graphemes(text)

describe('lineStart and lineEnd', () => {
  const text = chars('first\nsecond\nthird')

  it('finds the start of the current line', () => {
    expect(lineStart(text, 0)).toBe(0)
    expect(lineStart(text, 8)).toBe(6)
    expect(lineStart(text, 15)).toBe(13)
  })

  it('finds the end of the current line', () => {
    expect(lineEnd(text, 0)).toBe(5)
    expect(lineEnd(text, 6)).toBe(12)
    expect(lineEnd(text, 13)).toBe(18)
  })

  it('treats a position on the newline as the end of that line', () => {
    expect(lineEnd(text, 5)).toBe(5)
    expect(lineStart(text, 6)).toBe(6)
  })
})

describe('moveVertical', () => {
  const text = chars('ab\nlonger\nxy')

  it('keeps the column across lines', () => {
    expect(moveVertical(text, 1, 1)).toBe(4) // 'b' -> 'o' at column 1
    expect(moveVertical(text, 4, 1)).toBe(11) // 'o' -> 'y' at column 1
  })

  it('clamps to the shorter destination line', () => {
    expect(moveVertical(text, 9, 1)).toBe(12) // end of 'longer' -> end of 'xy'
  })

  it('does nothing at the edges', () => {
    expect(moveVertical(text, 1, -1)).toBe(1)
    expect(moveVertical(text, 11, 1)).toBe(11)
  })
})

describe('word movement', () => {
  const text = chars('hello world  again')

  it('moves to the start of the previous word', () => {
    expect(wordStart(text, 17)).toBe(13)
    expect(wordStart(text, 12)).toBe(6)
    expect(wordStart(text, 6)).toBe(0)
  })

  it('moves to the end of the next word', () => {
    expect(wordEnd(text, 0)).toBe(5)
    expect(wordEnd(text, 5)).toBe(11)
    expect(wordEnd(text, 11)).toBe(18)
  })
})

describe('spliceChars', () => {
  it('replaces a range and returns the new cursor', () => {
    const text = chars('hello world')
    expect(spliceChars(text, 5, 11, 'there')).toEqual({ value: 'hellothere', cursor: 10 })
  })

  it('inserts without deleting', () => {
    const text = chars('ac')
    expect(spliceChars(text, 1, 1, 'b')).toEqual({ value: 'abc', cursor: 2 })
  })

  it('counts inserted text by grapheme', () => {
    const text = chars('ac')
    expect(spliceChars(text, 1, 1, '👩‍💻').cursor).toBe(2)
  })
})
