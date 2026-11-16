import { describe, expect, it } from 'vitest'
import { graphemes, fuzzyScore, padEndWidth, rankByFuzzy, truncate, wrapLines } from '../src/core/text.js'

describe('graphemes', () => {
  it('keeps emoji and combining marks together', () => {
    const text = 'a👨‍👩‍👧‍👦e\u0301🇫🇷'
    expect(graphemes(text)).toEqual(['a', '👨‍👩‍👧‍👦', 'e\u0301', '🇫🇷'])
  })
})

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('accounts for wide characters', () => {
    expect(truncate('你好世界', 5)).toBe('你好…')
  })

  it('collapses newlines', () => {
    expect(truncate('hello\n\nworld', 20)).toBe('hello world')
  })
})

describe('padEndWidth', () => {
  it('pads to visual width', () => {
    expect(padEndWidth('你好', 6)).toBe('你好  ')
    expect(padEndWidth('abcdef', 3)).toBe('ab…')
  })
})

describe('wrapLines', () => {
  it('wraps on visual width', () => {
    expect(wrapLines('abcdef', 3)).toEqual(['abc', 'def'])
    expect(wrapLines('你好', 2)).toEqual(['你', '好'])
  })

  it('keeps explicit newlines', () => {
    expect(wrapLines('a\nb', 10)).toEqual(['a', 'b'])
  })
})

describe('fuzzyScore', () => {
  it('matches subsequences', () => {
    expect(fuzzyScore('cht', 'chats')).not.toBeNull()
    expect(fuzzyScore('xyz', 'chats')).toBeNull()
  })

  it('prefers prefix matches', () => {
    const prefix = fuzzyScore('ch', 'chats')
    const loose = fuzzyScore('ch', 'archive something')
    expect(prefix).not.toBeNull()
    expect(loose).not.toBeNull()
    expect(prefix!).toBeGreaterThan(loose!)
  })

  it('ranks and filters', () => {
    const items = ['open', 'close', 'search', 'older']
    expect(rankByFuzzy(items, 'ol', (item) => item)[0]).toBe('older')
  })
})
