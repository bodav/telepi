/**
 * Cursor math for the terminal input.
 *
 * All functions work on grapheme arrays so movement can never split an emoji
 * or a combining sequence. Positions are indexes into that array, not the
 * source string.
 */

import { graphemes } from '../core/text.js'

/** Start of the logical line containing `position`. */
export function lineStart(chars: readonly string[], position: number): number {
  for (let index = position - 1; index >= 0; index--) {
    if (chars[index] === '\n') return index + 1
  }
  return 0
}

/** End of the logical line containing `position` (the newline index or the end). */
export function lineEnd(chars: readonly string[], position: number): number {
  for (let index = position; index < chars.length; index++) {
    if (chars[index] === '\n') return index
  }
  return chars.length
}

/**
 * Move `delta` logical lines while keeping the cursor column, clamped to the
 * destination line. Returns `position` when there is no line to move to.
 */
export function moveVertical(chars: readonly string[], position: number, delta: -1 | 1): number {
  const start = lineStart(chars, position)
  const column = position - start

  if (delta < 0) {
    if (start === 0) return position
    const previousEnd = start - 1
    const previousStart = lineStart(chars, previousEnd)
    return Math.min(previousStart + column, previousEnd)
  }

  const end = lineEnd(chars, position)
  if (end >= chars.length) return position

  const nextStart = end + 1
  const nextEnd = lineEnd(chars, nextStart)
  return Math.min(nextStart + column, nextEnd)
}

/** Start of the word before `position`, skipping leading whitespace. */
export function wordStart(chars: readonly string[], position: number): number {
  let index = position
  while (index > 0 && /\s/.test(chars[index - 1]!)) index--
  while (index > 0 && !/\s/.test(chars[index - 1]!)) index--
  return index
}

/** End of the word after `position`, skipping leading whitespace. */
export function wordEnd(chars: readonly string[], position: number): number {
  let index = position
  while (index < chars.length && /\s/.test(chars[index]!)) index++
  while (index < chars.length && !/\s/.test(chars[index]!)) index++
  return index
}

/** Replace a character range, returning the new text and cursor. */
export function spliceChars(
  chars: readonly string[],
  from: number,
  to: number,
  insert = '',
): { value: string; cursor: number } {
  const value = [...chars.slice(0, from), insert, ...chars.slice(to)].join('')
  return { value, cursor: from + graphemes(insert).length }
}
