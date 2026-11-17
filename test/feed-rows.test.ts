import { describe, expect, it } from 'vitest'
import type { FeedEntry } from '../src/chat/feed.js'
import { entryRows, frameMinHeight } from '../src/ui/feed-rows.js'
import { createTheme } from '../src/ui/theme.js'

const theme = createTheme('mono')

function system(id: number, text: string): FeedEntry {
  return { kind: 'system', id, text, tone: 'info' }
}

describe('entryRows', () => {
  it('counts the leading margin and the text line', () => {
    const entry: FeedEntry = { kind: 'rule', id: 1, label: 'Today' }
    expect(entryRows(entry, theme, 80, false)).toBe(2)
  })

  it('grows when the entry wraps at a narrow width', () => {
    const entry = system(2, 'a '.repeat(30))
    const wide = entryRows(entry, theme, 200, false)
    const narrow = entryRows(entry, theme, 20, false)
    expect(narrow).toBeGreaterThan(wide)
  })

  it('caches measurements per width', () => {
    const entry = system(3, 'x '.repeat(20))
    const first = entryRows(entry, theme, 20, false)
    expect(entryRows(entry, theme, 20, false)).toBe(first)
    expect(entryRows(entry, theme, 120, false)).toBeLessThan(first)
  })

  it('falls back to one row for an invalid width', () => {
    expect(entryRows(system(4, 'hi'), theme, 0, false)).toBe(1)
  })
})

describe('frameMinHeight', () => {
  it('fills the viewport below the committed rows', () => {
    expect(frameMinHeight(24, 0)).toBe(23)
    expect(frameMinHeight(24, 10)).toBe(13)
  })

  it('leaves a trailing row so Ink does not scroll the frame', () => {
    expect(frameMinHeight(24, 23)).toBe(0)
    expect(frameMinHeight(24, 100)).toBe(0)
  })

  it('never goes negative on tiny terminals', () => {
    expect(frameMinHeight(0, 10)).toBe(0)
    expect(frameMinHeight(1, 0)).toBe(0)
  })
})
