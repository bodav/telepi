import { renderToString } from 'ink'
import type { FeedEntry } from '../chat/feed.js'
import { FeedLine } from './FeedLine.js'
import type { Theme } from './theme.js'

const cache = new WeakMap<FeedEntry, Map<string, number>>()

/** Rows a feed entry occupies once committed to scrollback at `columns` wide. */
export function entryRows(
  entry: FeedEntry,
  theme: Theme,
  columns: number,
  showIds: boolean,
): number {
  if (!Number.isFinite(columns) || columns <= 0) return 1

  const key = `${columns}:${showIds ? 1 : 0}`
  let sizes = cache.get(entry)
  if (!sizes) {
    sizes = new Map()
    cache.set(entry, sizes)
  }

  const cached = sizes.get(key)
  if (cached !== undefined) return cached

  const text = renderToString(
    <FeedLine entry={entry} theme={theme} columns={columns} showIds={showIds} />,
    { columns },
  )
  const rows = text === '' ? 0 : text.split('\n').length
  sizes.set(key, rows)
  return rows
}

/**
 * Height of the live frame when it has to reach the bottom of the viewport.
 * One row is reserved because Ink writes a trailing newline after a frame.
 */
export function frameMinHeight(rows: number, staticRows: number): number {
  if (!Number.isFinite(rows) || rows <= 1) return 0
  return Math.max(0, rows - 1 - Math.min(Math.max(0, staticRows), rows - 1))
}
