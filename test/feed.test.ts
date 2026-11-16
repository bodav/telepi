import { describe, expect, it } from 'vitest'
import { buildViewEntries, type FeedCursor } from '../src/chat/feed.js'
import type { ChatEventView, MessageView } from '../src/telegram/message.js'

function message(overrides: Partial<MessageView> = {}): MessageView {
  return {
    kind: 'message',
    key: '1:1',
    id: 1,
    chatId: 1,
    senderId: 42,
    senderName: 'Durov',
    fromMe: false,
    date: new Date(2026, 10, 16, 12, 0),
    edited: false,
    text: 'hello',
    entities: [],
    media: [],
    views: null,
    showHeader: true,
    ...overrides,
  }
}

function cursor(): FeedCursor {
  return { nextId: 0 }
}

describe('buildViewEntries', () => {
  it('inserts a day divider before the first message', () => {
    const entries = buildViewEntries(cursor(), message())
    expect(entries.map((entry) => entry.kind)).toEqual(['day', 'message'])
  })

  it('does not repeat the divider on the same day', () => {
    const state = cursor()
    buildViewEntries(state, message())
    const entries = buildViewEntries(
      state,
      message({ id: 2, key: '1:2', date: new Date(2026, 10, 16, 12, 10) }),
    )

    expect(entries.map((entry) => entry.kind)).toEqual(['message'])
  })

  it('adds a divider when the day changes', () => {
    const state = cursor()
    buildViewEntries(state, message())
    const entries = buildViewEntries(
      state,
      message({ id: 2, key: '1:2', date: new Date(2026, 10, 17, 8, 0) }),
    )

    expect(entries[0]?.kind).toBe('day')
  })

  it('collapses headers for the same sender within five minutes', () => {
    const state = cursor()
    buildViewEntries(state, message())
    const [entry] = buildViewEntries(
      state,
      message({ id: 2, key: '1:2', date: new Date(2026, 10, 16, 12, 4) }),
    )

    expect(entry?.kind).toBe('message')
    if (entry?.kind === 'message' && entry.view.kind === 'message') {
      expect(entry.view.showHeader).toBe(false)
    }
  })

  it('keeps the header when the sender changes or time passes', () => {
    const state = cursor()
    buildViewEntries(state, message())

    const other = buildViewEntries(
      state,
      message({ id: 2, key: '1:2', senderId: 7, date: new Date(2026, 10, 16, 12, 2) }),
    )
    const later = buildViewEntries(
      state,
      message({ id: 3, key: '1:3', senderId: 7, date: new Date(2026, 10, 16, 12, 30) }),
    )

    for (const [entry] of [other, later]) {
      if (entry?.kind === 'message' && entry.view.kind === 'message') {
        expect(entry.view.showHeader).toBe(true)
      }
    }
  })

  it('never collapses a reply', () => {
    const state = cursor()
    buildViewEntries(state, message())
    const [entry] = buildViewEntries(
      state,
      message({
        id: 2,
        key: '1:2',
        date: new Date(2026, 10, 16, 12, 4),
        reply: { id: 1, snippet: 'hello' },
      }),
    )

    if (entry?.kind === 'message' && entry.view.kind === 'message') {
      expect(entry.view.showHeader).toBe(true)
    }
  })

  it('handles service messages without a sender', () => {
    const state = cursor()
    const service: ChatEventView = {
      kind: 'service',
      key: '1:9',
      id: 9,
      chatId: 1,
      date: new Date(2026, 10, 16, 12, 0),
      text: 'Durov joined',
      showHeader: true,
    }

    expect(buildViewEntries(state, service).map((entry) => entry.kind)).toEqual([
      'day',
      'message',
    ])
  })
})
