import stringWidth from 'string-width'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Split a string into user-perceived characters (grapheme clusters). */
export function graphemes(text: string): string[] {
  const out: string[] = []
  for (const part of segmenter.segment(text)) out.push(part.segment)
  return out
}

export function displayWidth(text: string): number {
  return stringWidth(text)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Truncate a single line to a visual width, appending an ellipsis. */
export function truncate(text: string, width: number, ellipsis = '…'): string {
  if (width <= 0) return ''
  const single = text.replace(/\s*\n\s*/g, ' ')
  if (stringWidth(single) <= width) return single

  const ellipsisWidth = stringWidth(ellipsis)
  const budget = Math.max(0, width - ellipsisWidth)
  let out = ''
  let used = 0

  for (const char of graphemes(single)) {
    const w = stringWidth(char)
    if (used + w > budget) break
    out += char
    used += w
  }

  return out + ellipsis
}

/** Pad a single line to a visual width using spaces. */
export function padEndWidth(text: string, width: number): string {
  const clipped = truncate(text, width)
  const missing = width - stringWidth(clipped)
  return missing > 0 ? clipped + ' '.repeat(missing) : clipped
}

/** One line, hard-wrapped to a visual width. */
export function wrapLines(text: string, width: number): string[] {
  if (width <= 0) return ['']
  const lines: string[] = []

  for (const logical of text.split('\n')) {
    if (logical === '') {
      lines.push('')
      continue
    }

    let current = ''
    let used = 0

    for (const char of graphemes(logical)) {
      const w = stringWidth(char)
      if (used + w > width && current !== '') {
        lines.push(current)
        current = ''
        used = 0
      }
      current += char
      used += w
    }

    lines.push(current)
  }

  return lines
}

/**
 * Subsequence fuzzy match. Returns a score (higher is better), or null when the
 * query does not match. Empty query matches everything with score 0.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase()
  if (q === '') return 0

  const t = target.toLowerCase()
  let score = 0
  let cursor = 0
  let streak = 0

  for (const char of q) {
    if (char === ' ') continue
    const found = t.indexOf(char, cursor)
    if (found === -1) return null

    const atWordStart = found === 0 || /[\s\-_/.]/.test(t[found - 1] ?? '')
    score += 1
    if (found === cursor) score += 2
    if (atWordStart) score += 3
    if (streak > 0) score += streak

    streak = found === cursor ? streak + 1 : 0
    cursor = found + char.length
  }

  // Prefer shorter targets when scores are close.
  return score - t.length * 0.01
}

export function rankByFuzzy<T>(
  items: readonly T[],
  query: string,
  key: (item: T) => string,
): T[] {
  if (query.trim() === '') return [...items]

  const scored: Array<{ item: T; score: number }> = []
  for (const item of items) {
    const score = fuzzyScore(query, key(item))
    if (score !== null) scored.push({ item, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.item)
}
