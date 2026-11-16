import type { ChatInfo, SearchHit } from '../telegram/chats.js'
import type { ChatEventView } from '../telegram/message.js'
import { GROUP_WINDOW_MS } from '../core/constants.js'
import { dayKey, formatDayDivider } from '../core/time.js'

export type Tone = 'info' | 'ok' | 'error' | 'warn'

export type FeedEntry =
  | { kind: 'banner'; id: number; chat: ChatInfo; unread: number }
  | { kind: 'day'; id: number; label: string }
  | { kind: 'message'; id: number; view: ChatEventView }
  | { kind: 'system'; id: number; text: string; tone: Tone }
  | { kind: 'rule'; id: number; label?: string }
  | { kind: 'search'; id: number; query: string; all: boolean; hits: SearchHit[] }

export interface FeedCursor {
  nextId: number
  day?: string
  sender?: number | null
  date?: number
}

/**
 * Append one message/service view to the feed cursor, inserting day dividers and
 * deciding whether the sender header can be collapsed into the previous message.
 */
export function buildViewEntries(cursor: FeedCursor, view: ChatEventView): FeedEntry[] {
  const entries: FeedEntry[] = []
  const key = dayKey(view.date)

  if (cursor.day !== key) {
    entries.push({
      kind: 'day',
      id: ++cursor.nextId,
      label: formatDayDivider(view.date),
    })
    cursor.day = key
    cursor.sender = undefined
    cursor.date = undefined
  }

  let showHeader = true

  if (view.kind === 'message') {
    const previous = cursor.date
    if (
      cursor.sender === view.senderId &&
      previous !== undefined &&
      view.date.getTime() - previous < GROUP_WINDOW_MS &&
      !view.reply
    ) {
      showHeader = false
    }

    cursor.sender = view.senderId
    cursor.date = view.date.getTime()
  } else {
    cursor.sender = undefined
    cursor.date = view.date.getTime()
  }

  view.showHeader = showHeader
  entries.push({ kind: 'message', id: ++cursor.nextId, view })

  return entries
}

export function nextId(cursor: FeedCursor): number {
  return ++cursor.nextId
}

export function systemEntry(cursor: FeedCursor, text: string, tone: Tone = 'info'): FeedEntry {
  return { kind: 'system', id: nextId(cursor), text, tone }
}

export function ruleEntry(cursor: FeedCursor, label?: string): FeedEntry {
  return { kind: 'rule', id: nextId(cursor), label }
}
