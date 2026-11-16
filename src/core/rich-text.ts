/**
 * Splitting styled text into renderable segments.
 *
 * This module is intentionally independent of React and Telegram so it can be
 * unit-tested with plain objects.
 */

export interface EntityLike {
  readonly kind: string
  readonly offset: number
  readonly length: number
  readonly url?: string
  readonly language?: string
  readonly userId?: number
}

export type AccentKind = 'link' | 'mention' | 'hashtag' | 'cashtag' | 'email' | 'phone' | 'command' | 'user'

export interface RichStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  spoiler?: boolean
  code?: boolean
  pre?: boolean
  quote?: boolean
  accent?: AccentKind
}

export interface RichSegment {
  text: string
  style: RichStyle
}

function merge(entities: readonly EntityLike[]): RichStyle {
  const style: RichStyle = {}

  for (const entity of entities) {
    switch (entity.kind) {
      case 'bold':
        style.bold = true
        break
      case 'italic':
        style.italic = true
        break
      case 'underline':
        style.underline = true
        break
      case 'strikethrough':
        style.strike = true
        break
      case 'spoiler':
        style.spoiler = true
        break
      case 'code':
        style.code = true
        break
      case 'pre':
        style.code = true
        style.pre = true
        break
      case 'blockquote':
        style.quote = true
        break
      case 'url':
        style.accent = 'link'
        style.underline = true
        break
      case 'text_link':
        style.accent = 'link'
        style.underline = true
        break
      case 'mention':
        style.accent = 'mention'
        break
      case 'text_mention':
        style.accent = 'user'
        break
      case 'hashtag':
        style.accent = 'hashtag'
        break
      case 'cashtag':
        style.accent = 'cashtag'
        break
      case 'email':
        style.accent = 'email'
        break
      case 'phone_number':
        style.accent = 'phone'
        break
      case 'bot_command':
        style.accent = 'command'
        break
      default:
        break
    }
  }

  return style
}

/**
 * Split text by Telegram entity offsets (UTF-16, which is what JS strings use).
 * Overlapping entities are merged into combined styles.
 */
export function splitEntities(
  text: string,
  entities: readonly EntityLike[] = [],
): RichSegment[] {
  if (text === '') return []
  if (entities.length === 0) return [{ text, style: {} }]

  const bounds = new Set<number>([0, text.length])

  for (const entity of entities) {
    const start = Math.max(0, Math.min(text.length, entity.offset))
    const end = Math.max(start, Math.min(text.length, entity.offset + entity.length))
    bounds.add(start)
    bounds.add(end)
  }

  const points = [...bounds].sort((a, b) => a - b)
  const segments: RichSegment[] = []

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!
    const end = points[i + 1]!
    if (end <= start) continue

    const slice = text.slice(start, end)
    const active = entities.filter((entity) => {
      const entityStart = Math.max(0, Math.min(text.length, entity.offset))
      const entityEnd = Math.max(entityStart, Math.min(text.length, entity.offset + entity.length))
      return entityStart <= start && entityEnd >= end
    })

    segments.push({ text: slice, style: merge(active) })
  }

  return segments
}
