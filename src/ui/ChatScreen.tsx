import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Static, Text, useInput, useWindowSize, type Key } from 'ink'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { md } from '@mtcute/markdown-parser'
import { FileLocation, type InputText, type Message, type TelegramClient, type User } from '@mtcute/node'
import { commands } from '../commands/index.js'
import { findCommand, rankPalette, suggestItems, type CommandContext } from '../commands/types.js'
import { resolveInput } from '../commands/resolve.js'
import type { FeedCursor, FeedEntry, Tone } from '../chat/feed.js'
import { buildViewEntries, nextId, ruleEntry, systemEntry } from '../chat/feed.js'
import { copyToClipboard } from '../core/clipboard.js'
import type { Config, Notifications, ThemeName } from '../core/config.js'
import { downloadsDir } from '../core/config.js'
import { TYPING_MS, TOAST_MS, DIALOG_LIMIT, DIALOG_PAGE } from '../core/constants.js'
import { describeError } from '../core/errors.js'
import { desktopNotify, ringBell } from '../core/notify.js'
import { openPath } from '../core/open.js'
import { onResizeReset } from '../core/resize-events.js'
import { parsePeerRef } from '../core/peer-ref.js'
import { loadState, pendingState, rememberState, saveState, type ChatState } from '../core/state.js'
import { displayWidth, graphemes, rankByFuzzy, truncate } from '../core/text.js'
import { formatBytes, formatClock } from '../core/time.js'
import type { ChatEventView, MessageView } from '../telegram/message.js'
import { toMessageView, mediaFilename } from '../telegram/message.js'
import type { ChatInfo, ChatListItem, MessagePair, SearchCursor, SearchPage } from '../telegram/chats.js'
import {
  chatInfo,
  listDialogs,
  loadOlderMessages,
  loadRecentMessages,
  searchGlobal,
  searchInChat,
} from '../telegram/chats.js'
import type { BotCommand } from '../telegram/bot-commands.js'
import { loadBotCommands } from '../telegram/bot-commands.js'
import { attachmentMedia, resolveAttachment } from '../telegram/upload.js'
import { CommandMenu } from './CommandMenu.js'
import { FeedLine } from './FeedLine.js'
import { entryRows, frameMinHeight } from './feed-rows.js'
import { InputBox } from './InputBox.js'
import { Logo } from './Logo.js'
import { Overlay, type OverlayState } from './Overlay.js'
import { Spinner } from './Spinner.js'
import type { Theme } from './theme.js'
import { toneColor } from './theme.js'
import { useTerminalTitle } from './use-terminal-title.js'

type ConnectionState = 'offline' | 'connecting' | 'updating' | 'connected'

export interface ChatScreenProps {
  tg: TelegramClient
  me: User
  theme: Theme
  config: Config
  saveConfig: (patch: Partial<Config>) => Promise<void>
  initialChat?: string
  onLogout: () => Promise<void>
  onQuit: () => Promise<void> | void
  onClearScreen: () => void
}

interface Toast {
  id: number
  text: string
  tone: Tone
}

function parseMarkdown(text: string): InputText {
  try {
    return md(text)
  } catch {
    return text
  }
}

function mergePair(raw: Message, meId: number): MessagePair | null {
  const view = toMessageView(raw, meId)
  if (!view) return null
  return { raw, view }
}

export function ChatScreen({
  tg,
  me,
  theme,
  config,
  saveConfig,
  initialChat,
  onLogout,
  onQuit,
  onClearScreen,
}: ChatScreenProps): React.JSX.Element {
  const { columns, rows } = useWindowSize()

  const [chat, setChat] = useState<ChatInfo | null>(null)
  const [botCommands, setBotCommands] = useState<readonly BotCommand[]>([])
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [feedEpoch, setFeedEpoch] = useState(0)
  const [replay, setReplay] = useState<FeedEntry[]>([])
  const [input, setInput] = useState('')
  const [cursor, setCursor] = useState(0)
  const [filterCursor, setFilterCursor] = useState(0)
  const [reply, setReplyState] = useState<MessageView | null>(null)
  const [overlay, setOverlay] = useState<OverlayState | null>(null)
  const [suggestIndex, setSuggestIndex] = useState(0)
  const [toast, setToast] = useState<Toast | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [typing, setTyping] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>(() =>
    (tg as unknown as { isConnected?: boolean }).isConnected ? 'connected' : 'connecting',
  )
  const [unread, setUnread] = useState<Record<number, number>>({})
  const [sentHistory, setSentHistory] = useState<string[]>([])
  const [notifications, setNotifications] = useState<Notifications>(config.notifications)
  const [showIds, setShowIdsState] = useState(config.showIds)
  const [now, setNow] = useState(() => Date.now())
  const [, setViewportEpoch] = useState(0)

  const themeRef = useRef(theme)
  themeRef.current = theme
  const inputRef = useRef('')
  inputRef.current = input
  /** Rows of `<Static>` output written since the last viewport reset. */
  const committedRowsRef = useRef(0)

  const chatRef = useRef<ChatInfo | null>(null)
  const botCommandsRef = useRef<readonly BotCommand[]>([])
  const unreadRef = useRef<Record<number, number>>({})
  const replyRef = useRef<MessageView | null>(null)
  const cursorRef = useRef<FeedCursor>({ nextId: 0 })
  const olderRef = useRef<{ id: number; date: number } | undefined>(undefined)
  const messageIndex = useRef(new Map<number, MessageView>())
  const rawIndex = useRef(new Map<number, Message>())
  const seen = useRef(new Set<string>())
  const chatListRef = useRef<ChatListItem[]>([])
  const peerNames = useRef(new Map<number, string>())
  const notificationsRef = useRef<Notifications>(config.notifications)
  const toastId = useRef(0)
  const loadToken = useRef(0)
  const typingTimer = useRef<NodeJS.Timeout | null>(null)
  const logoutArmed = useRef(0)
  const booted = useRef(false)
  const locallyRead = useRef(new Set<number>())
  const feedRef = useRef<FeedEntry[]>([])
  /** Unsent text per chat, so switching chats never eats a half-written message. */
  const drafts = useRef(new Map<number, string>())
  const markdownRef = useRef(config.markdown)
  /** Muted dialogs: no bell and no desktop notification for those chats. */
  const muted = useRef(new Map<number, boolean>())
  const dialogLimit = useRef(DIALOG_LIMIT)
  const overlayRef = useRef<OverlayState | null>(null)
  const sentHistoryRef = useRef<string[]>([])
  const saveTimer = useRef<NodeJS.Timeout | null>(null)
  /** True once the previous session's state has been read from disk. */
  const stateLoaded = useRef(false)

  /** Snapshot the drafts and history into a plain object. */
  const snapshotState = useCallback((): ChatState => {
    const current = chatRef.current
    if (current) {
      if (inputRef.current) drafts.current.set(current.id, inputRef.current)
      else drafts.current.delete(current.id)
    }

    const saved: Record<string, string> = {}
    for (const [id, text] of drafts.current) {
      if (text) saved[String(id)] = text
    }

    return { drafts: saved, history: sentHistoryRef.current }
  }, [])

  /** Snapshot the drafts and history, then write them to disk. */
  const flushState = useCallback((): Promise<void> => {
    const state = snapshotState()
    rememberState(state)
    // Never overwrite the saved file with an empty snapshot before the load
    // finished, or a quick quit would wipe the previous session's drafts.
    if (!stateLoaded.current) return Promise.resolve()
    return saveState(state).catch(() => {})
  }, [snapshotState])

  /** Debounced save: typing writes at most once a second. */
  const scheduleStateSave = useCallback((): void => {
    if (saveTimer.current) return
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void flushState()
    }, 1000)
  }, [flushState])

  // Restore drafts and sent history from the previous session.
  useEffect(() => {
    let cancelled = false

    void loadState().then((state) => {
      if (cancelled) return

      for (const [id, text] of Object.entries(state.drafts)) {
        const chatId = Number(id)
        if (Number.isInteger(chatId) && text && !drafts.current.has(chatId)) {
          drafts.current.set(chatId, text)
        }
      }

      // Do not clobber history typed before the read finished.
      if (sentHistoryRef.current.length === 0) {
        sentHistoryRef.current = state.history
        setSentHistory(state.history)
      }

      // Seed the exit handler so a quick quit cannot wipe the saved state.
      // Keep anything typed while the read was in flight.
      const early = pendingState()
      rememberState({
        drafts: { ...state.drafts, ...early.drafts },
        history: state.history,
      })

      // The loaded state is now in memory, so debounced saves may overwrite it.
      stateLoaded.current = true

      // The boot effect may already have opened a chat before the read finished.
      const current = chatRef.current
      if (current && !inputRef.current) {
        const draft = drafts.current.get(current.id)
        if (draft) {
          setInput(draft)
          setCursor(graphemes(draft).length)
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    sentHistoryRef.current = sentHistory
  }, [sentHistory])

  // Keep the exit handler's snapshot fresh and debounce writes to disk.
  useEffect(() => {
    if (!stateLoaded.current) return
    rememberState(snapshotState())
    scheduleStateSave()
  }, [input, sentHistory, scheduleStateSave, snapshotState])

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      void flushState()
    }
  }, [flushState])

  useEffect(() => {
    overlayRef.current = overlay
  }, [overlay])

  useEffect(() => {
    markdownRef.current = config.markdown
  }, [config.markdown])

  useEffect(() => {
    notificationsRef.current = notifications
  }, [notifications])

  useEffect(() => {
    unreadRef.current = unread
  }, [unread])

  useEffect(() => {
    setNotifications(config.notifications)
    notificationsRef.current = config.notifications
  }, [config.notifications])

  useEffect(() => {
    setShowIdsState(config.showIds)
  }, [config.showIds])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  // Ink draws the live frame directly under the last committed line. Count the
  // rows the feed is about to write to the terminal so the frame can reserve the
  // remaining viewport rows and stay pinned to the bottom. Measuring happens in
  // the event handlers that change the feed, before React commits: the height
  // has to be known when Ink writes the frame, or a fresh chat would scroll its
  // own history away.
  const measureCommittedRows = useCallback(
    (entries: readonly FeedEntry[]) => {
      const cap = Math.max(0, rows - 1)
      const current = Math.min(committedRowsRef.current, cap)
      let added = 0

      if (current < cap) {
        // Only the newest entries can be visible below the viewport top.
        for (let index = entries.length - 1; index >= 0 && current + added < cap; index--) {
          const entry = entries[index]
          if (entry) added += entryRows(entry, themeRef.current, columns, showIds)
        }
      }

      committedRowsRef.current = Math.min(cap, current + added)
    },
    [columns, rows, showIds],
  )

  const pushEntries = useCallback(
    (entries: FeedEntry[]) => {
      if (entries.length === 0) return
      measureCommittedRows(entries)
      setReplay([])
      setFeed((previous) => [...previous, ...entries])
    },
    [measureCommittedRows],
  )

  const replaceFeed = useCallback(
    (entries: FeedEntry[]) => {
      measureCommittedRows(entries)
      setReplay([])
      setFeed(entries)
      setFeedEpoch((value) => value + 1)
    },
    [measureCommittedRows],
  )

  useEffect(() => {
    feedRef.current = feed
  }, [feed])

  const resetViewport = useCallback(() => {
    committedRowsRef.current = 0
    setViewportEpoch((value) => value + 1)
  }, [])

  const clearScreen = useCallback(() => {
    resetViewport()
    onClearScreen()
  }, [onClearScreen, resetViewport])

  useEffect(() => {
    return onResizeReset(() => {
      // The workaround scrolled the viewport into scrollback and will repaint a
      // fresh frame, so the space below it is empty again.
      resetViewport()

      const current = feedRef.current
      if (current.length === 0) return

      const keep = Math.max(4, Math.min(24, Math.ceil(rows / 2)))
      setReplay(current.slice(-keep))
    })
  }, [resetViewport, rows])

  const enrichReply = useCallback((view: ChatEventView): void => {
    if (view.kind !== 'message' || !view.reply || view.reply.snippet) return
    if (view.reply.id === null) return

    const target = messageIndex.current.get(view.reply.id)
    if (!target) return

    view.reply.author ??= target.senderName
    view.reply.snippet = truncate(target.text || target.media.join(' '), 90)
  }, [])

  const lastReadAt = useRef(new Map<number, number>())
  const markRead = useCallback(
    (chatId: number, force = false) => {
      const now = Date.now()
      const previous = lastReadAt.current.get(chatId) ?? 0
      if (!force && now - previous < 1500) return
      lastReadAt.current.set(chatId, now)
      void tg.readHistory(chatId).catch(() => {})
    },
    [tg],
  )

  const pushPair = useCallback(
    (pair: MessagePair) => {
      enrichReply(pair.view)

      if (pair.view.kind === 'message') {
        messageIndex.current.set(pair.view.id, pair.view)
        rawIndex.current.set(pair.view.id, pair.raw)
        if (pair.view.senderId !== null) {
          peerNames.current.set(pair.view.senderId, pair.view.senderName)
        }
      }
      pushEntries(buildViewEntries(cursorRef.current, pair.view))
    },
    [enrichReply, pushEntries],
  )

  const system = useCallback(
    (text: string, tone: Tone = 'info') => {
      pushEntries([systemEntry(cursorRef.current, text, tone)])
    },
    [pushEntries],
  )

  const notifyToast = useCallback((text: string, tone: Tone = 'info') => {
    toastId.current += 1
    setToast({ id: toastId.current, text, tone })
  }, [])

  const setReply = useCallback((view: MessageView | null) => {
    replyRef.current = view
    setReplyState(view)
  }, [])

  const setShowIds = useCallback(
    async (value: boolean): Promise<void> => {
      setShowIdsState(value)
      await saveConfig({ showIds: value })
    },
    [saveConfig],
  )

  const applyBotCommands = useCallback((list: readonly BotCommand[]) => {
    botCommandsRef.current = list
    setBotCommands(list)
  }, [])

  const reloadBotCommands = useCallback(async (): Promise<readonly BotCommand[]> => {
    const current = chatRef.current
    if (!current) return []

    const list = await loadBotCommands(tg, current, true)
    if (chatRef.current?.id === current.id) applyBotCommands(list)
    return list
  }, [applyBotCommands, tg])

  const lastMessage = useCallback((): MessageView | null => {
    let latest: MessageView | null = null
    for (const view of messageIndex.current.values()) {
      if (!latest || view.date.getTime() >= latest.date.getTime()) latest = view
    }
    return latest
  }, [])

  const lastMediaMessage = useCallback((): MessageView | null => {
    let latest: MessageView | null = null
    for (const view of messageIndex.current.values()) {
      if (view.media.length === 0) continue
      if (!latest || view.date.getTime() >= latest.date.getTime()) latest = view
    }
    return latest
  }, [])

  const messageById = useCallback(
    (id: number): MessageView | null => messageIndex.current.get(id) ?? null,
    [],
  )


  const jump = useCallback(
    async (id: number): Promise<void> => {
      const current = chatRef.current
      if (!current) throw new Error('no chat is open')

      setBusy(`jumping to #${id}…`)
      setOverlay(null)

      try {
        const [target] = await tg.getMessages(current.id, [id])
        if (!target) throw new Error(`message #${id} is not in this chat`)

        const page = await tg.getHistory(current.id, {
          offset: { id, date: Math.floor(target.date.getTime() / 1000) },
          addOffset: -10,
          limit: 21,
        })

        const messages = [...page].reverse()
        if (!messages.some((message) => message.id === id)) messages.push(target)
        messages.sort((a, b) => a.id - b.id)

        const pairs = messages
          .map((message) => mergePair(message, me.id))
          .filter((pair): pair is MessagePair => pair !== null)

        if (pairs.length === 0) throw new Error(`message #${id} has nothing to show`)

        olderRef.current = page.next
        messageIndex.current.clear()
        rawIndex.current.clear()
        seen.current.clear()
        cursorRef.current = { nextId: cursorRef.current.nextId }

        const entries: FeedEntry[] = [ruleEntry(cursorRef.current, `jumped to #${id}`)]

        for (const pair of pairs) {
          enrichReply(pair.view)

          if (pair.view.kind === 'message') {
            messageIndex.current.set(pair.view.id, pair.view)
            rawIndex.current.set(pair.view.id, pair.raw)
            if (pair.view.senderId !== null) {
              peerNames.current.set(pair.view.senderId, pair.view.senderName)
            }
          }

          seen.current.add(pair.view.key)
          entries.push(...buildViewEntries(cursorRef.current, pair.view))
        }

        replaceFeed(entries)
        markRead(current.id, true)
      } finally {
        setBusy(null)
      }
    },
    [enrichReply, markRead, me.id, replaceFeed, tg],
  )

  const openChat = useCallback(
    async (ref: string) => {
      const parsed = parsePeerRef(ref)
      if (parsed.kind === 'empty') return

      if (parsed.kind === 'invite') {
        system('invite links are not supported yet — use /open @username or an id', 'warn')
        return
      }

      const token = ++loadToken.current
      setBusy('opening chat…')
      setOverlay(null)

      try {
        const peer = await tg.getPeer(parsed.ref)
        const info = chatInfo(peer)
        const history = await loadRecentMessages(tg, me.id, peer.id)

        if (token !== loadToken.current) return

        // Remember what was being typed, and restore this chat's own draft.
        const previous = chatRef.current
        if (previous) {
          if (inputRef.current) drafts.current.set(previous.id, inputRef.current)
          else drafts.current.delete(previous.id)
        }

        chatRef.current = info
        setChat(info)
        applyBotCommands([])
        setReply(null)
        setTyping(null)

        const draft = drafts.current.get(info.id) ?? ''
        setInput(draft)
        setCursor(graphemes(draft).length)
        messageIndex.current.clear()
        rawIndex.current.clear()
        seen.current.clear()
        olderRef.current = history.older
        cursorRef.current = { nextId: cursorRef.current.nextId }

        locallyRead.current.add(info.id)

        const unreadCount = Math.min(unreadRef.current[info.id] ?? 0, history.items.length)
        const unreadAt = history.items.length - unreadCount

        const entries: FeedEntry[] = [
          {
            kind: 'banner',
            id: nextId(cursorRef.current),
            chat: info,
            unread: unreadCount,
          },
        ]

        for (const [index, pair] of history.items.entries()) {
          if (unreadCount > 0 && index === unreadAt) {
            entries.push(ruleEntry(cursorRef.current, `${unreadCount} unread`))
          }
          enrichReply(pair.view)
          if (pair.view.kind === 'message') {
            messageIndex.current.set(pair.view.id, pair.view)
            rawIndex.current.set(pair.view.id, pair.raw)
            if (pair.view.senderId !== null) {
              peerNames.current.set(pair.view.senderId, pair.view.senderName)
            }
          }
          entries.push(...buildViewEntries(cursorRef.current, pair.view))
        }

        replaceFeed(entries)
        setUnread((previous) => ({ ...previous, [info.id]: 0 }))
        markRead(info.id, true)
        void saveConfig({ lastChat: String(info.id) }).catch(() => {})

        void loadBotCommands(tg, info).then((list) => {
          if (chatRef.current?.id !== info.id) return
          applyBotCommands(list)
        })

        // A t.me/<chat>/<id> link also says which message to look at.
        if (parsed.messageId !== undefined) await jump(parsed.messageId)
      } catch (error) {
        system(describeError(error), 'error')
      } finally {
        if (token === loadToken.current) setBusy(null)
      }
    },
    [
      applyBotCommands,
      enrichReply,
      jump,
      markRead,
      me.id,
      replaceFeed,
      saveConfig,
      setReply,
      system,
      tg,
    ],
  )

  const closeChat = useCallback(() => {
    const current = chatRef.current
    if (current && inputRef.current) drafts.current.set(current.id, inputRef.current)
    else if (current) drafts.current.delete(current.id)

    chatRef.current = null
    setChat(null)
    applyBotCommands([])
    setReply(null)
    setOverlay(null)
    messageIndex.current.clear()
    rawIndex.current.clear()
    olderRef.current = undefined
    cursorRef.current = { nextId: cursorRef.current.nextId }
    replaceFeed([
      systemEntry(cursorRef.current, 'chat closed — use /chats to pick another', 'info'),
    ])
  }, [applyBotCommands, replaceFeed, setReply])

  const loadOlder = useCallback(async () => {
    const current = chatRef.current
    if (!current) {
      system('no chat is open', 'warn')
      return
    }

    if (!olderRef.current) {
      system('you are at the start of this chat', 'info')
      return
    }

    setBusy('loading older messages…')

    try {
      const page = await loadOlderMessages(tg, me.id, current.id, olderRef.current)
      olderRef.current = page.older

      if (page.items.length === 0) {
        system('you are at the start of this chat', 'info')
        return
      }

      const items = page.items.map((pair) => pair.view)
      const visible = Math.max(2, Math.min(5, Math.floor((rows - 14) / 4)))

      // Make the page addressable: reply, copy, save and /jump all resolve
      // message ids through these indexes.
      for (const pair of page.items) {
        if (pair.view.kind !== 'message') continue
        messageIndex.current.set(pair.view.id, pair.view)
        rawIndex.current.set(pair.view.id, pair.raw)
        if (pair.view.senderId !== null) {
          peerNames.current.set(pair.view.senderId, pair.view.senderName)
        }
      }

      setOverlay({
        kind: 'history',
        items,
        index: Math.max(0, items.length - visible),
        hasMore: Boolean(page.older),
        visible,
      })
    } catch (error) {
      system(describeError(error), 'error')
    } finally {
      setBusy(null)
    }
  }, [me.id, rows, system, tg])

  const showSearch = useCallback(
    (query: string, all: boolean, page: SearchPage) => {
      pushEntries([
        { kind: 'search', id: nextId(cursorRef.current), query, all, hits: page.hits },
      ])

      if (page.hits.length > 0) {
        setOverlay({ kind: 'search', query, all, hits: page.hits, index: 0, next: page.next })
      }
    },
    [pushEntries],
  )

  const search = useCallback(
    async (query: string, all: boolean, cursor?: SearchCursor): Promise<SearchPage> => {
      if (all) return searchGlobal(tg, me.id, query, { cursor })

      const current = chatRef.current
      if (!current) return { hits: [] }
      return searchInChat(tg, me.id, current.id, current.title, query, { cursor })
    },
    [me.id, tg],
  )

  /** Fetch the next page of the open search overlay. */
  const loadMoreSearch = useCallback(async () => {
    const current = overlayRef.current
    if (!current || current.kind !== 'search') return
    if (!current.next || current.loading) return

    setOverlay((value) =>
      value && value.kind === 'search' ? { ...value, loading: true } : value,
    )

    try {
      const page = await search(current.query, current.all, current.next)

      setOverlay((value) => {
        if (!value || value.kind !== 'search') return value
        if (value.query !== current.query) return value

        const seen = new Set(value.hits.map((hit) => `${hit.chatId}:${hit.message.id}`))
        const fresh = page.hits.filter((hit) => !seen.has(`${hit.chatId}:${hit.message.id}`))

        return {
          ...value,
          hits: [...value.hits, ...fresh],
          next: page.next,
          loading: false,
        }
      })
    } catch (error) {
      system(describeError(error), 'error')
      setOverlay((value) =>
        value && value.kind === 'search' ? { ...value, loading: false } : value,
      )
    }
  }, [search, system])

  const loadDialogs = useCallback(
    async (limit = dialogLimit.current): Promise<void> => {
      try {
        const items = await listDialogs(tg, limit)
        chatListRef.current = items

        for (const item of items) {
          peerNames.current.set(item.id, item.title)
          muted.current.set(item.id, item.muted)
        }

        setOverlay((current) =>
          current && current.kind === 'chats'
            ? {
                ...current,
                items: rankByFuzzy(items, current.query, (item) => `${item.title} ${item.username ?? ''}`),
                loading: false,
                hasMore: items.length >= limit,
              }
            : current,
        )
      } catch (error) {
        system(describeError(error), 'error')
        setOverlay((current) =>
          current && current.kind === 'chats' ? { ...current, loading: false } : current,
        )
      }
    },
    [system, tg],
  )

  /** Extend the picker window when the chat you want is past the first page. */
  const loadMoreDialogs = useCallback(() => {
    dialogLimit.current += DIALOG_PAGE
    void loadDialogs(dialogLimit.current)
  }, [loadDialogs])

  const openOverlay = useCallback(
    (kind: 'chats' | 'help', initialQuery = '') => {
      setFilterCursor(graphemes(initialQuery).length)

      if (kind === 'help') {
        setOverlay({
          kind: 'help',
          query: initialQuery,
          index: 0,
          items: rankPalette(commands, botCommandsRef.current, initialQuery, { limit: 200 }),
        })
        return
      }

      setOverlay({
        kind: 'chats',
        query: initialQuery,
        index: 0,
        items: rankByFuzzy(
          chatListRef.current,
          initialQuery,
          (item) => `${item.title} ${item.username ?? ''}`,
        ),
        loading: true,
        hasMore: chatListRef.current.length >= dialogLimit.current,
      })

      void loadDialogs()
    },
    [loadDialogs, system, tg],
  )

  const prepare = useCallback(
    (text: string): InputText => (markdownRef.current ? parseMarkdown(text) : text),
    [],
  )

  const download = useCallback(
    async (id: number, target?: string): Promise<string> => {
      const current = chatRef.current
      if (!current) throw new Error('no chat is open')

      let raw = rawIndex.current.get(id)

      if (!raw) {
        const [fetched] = await tg.getMessages(current.id, [id])
        if (fetched) {
          raw = fetched
          rawIndex.current.set(fetched.id, fetched)
        }
      }

      if (!raw) throw new Error(`message #${id} is not in this chat`)
      if (!raw.media) throw new Error(`message #${id} has no media`)
      if (!(raw.media instanceof FileLocation)) {
        throw new Error(`message #${id} cannot be downloaded as a file`)
      }

      const fallback = join(
        downloadsDir(),
        mediaFilename(raw, current?.title ?? 'telegram'),
      )

      let filename: string
      const rawTarget = target?.trim()
      const wanted = rawTarget?.startsWith('~/')
        ? join(homedir(), rawTarget.slice(2))
        : rawTarget

      if (!wanted) {
        filename = fallback
      } else if (wanted.endsWith('/') || wanted.endsWith('\\')) {
        filename = join(resolve(wanted), mediaFilename(raw, current?.title ?? 'telegram'))
      } else {
        filename = resolve(wanted)
      }

      await mkdir(dirname(filename), { recursive: true })
      await tg.downloadToFile(filename, raw.media)
      return filename
    },
    [tg],
  )

  const view = useCallback(
    async (id: number): Promise<string> => {
      const filename = await download(id)

      try {
        await openPath(filename)
      } catch {
        throw new Error(`saved to ${filename}, but could not open it`)
      }

      return filename
    },
    [download],
  )

  const sendFile = useCallback(
    async (target: string, caption?: string): Promise<void> => {
      const current = chatRef.current
      if (!current) throw new Error('no chat is open')

      const file = await resolveAttachment(target)
      const typing =
        file.kind === 'photo'
          ? 'upload_photo'
          : file.kind === 'video'
            ? 'upload_video'
            : 'upload_document'

      setBusy(`sending ${file.name} (${formatBytes(file.size)})…`)

      let lastPercent = -1

      try {
        void tg.sendTyping(current.id, typing).catch(() => {})

        const replyId = replyRef.current?.id
        const sent = await tg.sendMedia(current.id, attachmentMedia(file), {
          caption: caption ? prepare(caption) : undefined,
          replyTo: replyId ?? undefined,
          progressCallback: (uploaded, total) => {
            if (!Number.isFinite(total) || total <= 0) return

            const percent = Math.min(100, Math.floor((uploaded / total) * 100))
            if (percent < 100 && percent < lastPercent + 5) return

            lastPercent = percent
            setBusy(`uploading ${file.name}… ${percent}%`)
          },
        })

        setReply(null)

        const pair = mergePair(sent, me.id)
        if (pair) {
          seen.current.add(pair.view.key)
          pushPair(pair)
        }
      } finally {
        setBusy(null)
      }
    },
    [me.id, pushPair, setReply, tg],
  )

  const sendBotCommand = useCallback(
    async (command: string, args?: string): Promise<void> => {
      const current = chatRef.current
      if (!current) throw new Error('no chat is open')

      const name = command.replace(/^\/+/, '')
      const suffix = args?.trim() ? ` ${args.trim()}` : ''
      let text = `/${name}${suffix}`

      if (current.isGroup) {
        const bot = botCommandsRef.current.find(
          (entry) => entry.command === name && entry.botUsername,
        )
        if (bot?.botUsername) text = `/${name}@${bot.botUsername}${suffix}`
      }

      setBusy(`sending /${name}…`)

      try {
        void tg.sendTyping(current.id).catch(() => {})

        const replyId = replyRef.current?.id
        const sent = await tg.sendText(
          current.id,
          text,
          replyId ? { replyTo: replyId } : undefined,
        )

        setReply(null)

        const pair = mergePair(sent, me.id)
        if (pair) {
          seen.current.add(pair.view.key)
          pushPair(pair)
        }
        setSentHistory((history) => [...history.slice(-199), text])
      } finally {
        setBusy(null)
      }
    },
    [me.id, pushPair, setReply, tg],
  )

  const edit = useCallback(
    async (id: number, text: string): Promise<void> => {
      const current = chatRef.current
      if (!current) throw new Error('no chat is open')

      const updated = await tg.editMessage({
        chatId: current.id,
        message: id,
        text: prepare(text),
      })

      const view = toMessageView(updated, me.id)
      if (view?.kind === 'message') {
        messageIndex.current.set(view.id, view)
        rawIndex.current.set(view.id, updated)
      }
    },
    [me.id, prepare, tg],
  )

  const remove = useCallback(
    async (ids: number[]): Promise<void> => {
      const current = chatRef.current
      if (!current) throw new Error('no chat is open')

      await tg.deleteMessagesById(current.id, ids)
      for (const id of ids) {
        messageIndex.current.delete(id)
        rawIndex.current.delete(id)
      }
    },
    [tg],
  )

  const sendMessage = useCallback(
    async (text: string): Promise<boolean> => {
      const current = chatRef.current
      if (!current) {
        notifyToast('open a chat first — /chats', 'warn')
        return false
      }

      setBusy('sending…')

      try {
        void tg.sendTyping(current.id).catch(() => {})

        const replyId = replyRef.current?.id
        const sent = await tg.sendText(
          current.id,
          prepare(text),
          replyId ? { replyTo: replyId } : undefined,
        )

        setReply(null)
        const pair = mergePair(sent, me.id)
        if (pair) {
          seen.current.add(pair.view.key)
          pushPair(pair)
        }
        setSentHistory((history) => [...history.slice(-199), text])
        return true
      } catch (error) {
        const message = describeError(error)
        system(`${message} — your message is still in the input box`, 'error')
        notifyToast(message, 'error')
        return false
      } finally {
        setBusy(null)
      }
    },
    [me.id, notifyToast, prepare, pushPair, setReply, system, tg],
  )

  const runCommand = useCallback(
    async (raw: string): Promise<boolean> => {
      const resolved = resolveInput(raw, commands)

      if (resolved.kind === 'warn') {
        system(resolved.message, 'warn')
        return false
      }

      if (resolved.kind === 'send') return sendMessage(resolved.text)

      const { command, args } = resolved

      const ctx: CommandContext = {
        tg,
        me,
        chat: chatRef.current,
        replyTo: replyRef.current,
        notifications: notificationsRef.current,
        theme: theme.name,
        showIds,
        downloadsDir: downloadsDir(),
        commands,
        botCommands: botCommandsRef.current,
        system,
        openChat,
        closeChat,
        loadOlder,
        openOverlay,
        setReply,
        lastMessage,
        lastMediaMessage,
        messageById,
        jump,
        search,
        showSearch,
        copy: copyToClipboard,
        download,
        view,
        sendFile,
        sendBotCommand,
        edit,
        remove,
        setNotify: (value) => {
          setNotifications(value)
          notificationsRef.current = value
        },
        setTheme: (value) => {
          void saveConfig({ theme: value as ThemeName })
        },
        setShowIds,
        markdown: markdownRef.current,
        setMarkdown: async (value: boolean) => {
          markdownRef.current = value
          await saveConfig({ markdown: value })
        },
        saveConfig,
        reloadBotCommands,
        clear: () => {
          clearScreen()
          cursorRef.current = { nextId: cursorRef.current.nextId }
          const current = chatRef.current
          replaceFeed(
            current
              ? [
                  {
                    kind: 'banner',
                    id: nextId(cursorRef.current),
                    chat: current,
                    unread: 0,
                  },
                ]
              : [],
          )
        },
        quit: () => {
          void onQuit()
        },
        logout: async () => {
          const armedAt = logoutArmed.current
          if (Date.now() - armedAt > 10_000) {
            logoutArmed.current = Date.now()
            system('run /logout again within 10 seconds to sign out', 'warn')
            return
          }
          logoutArmed.current = 0
          await onLogout()
        },
      }

      try {
        await command.run(ctx, args, raw)
        return true
      } catch (error) {
        system(describeError(error), 'error')
        return false
      }
    },
    [
      closeChat,
      clearScreen,
      download,
      edit,
      jump,
      lastMediaMessage,
      lastMessage,
      loadOlder,
      me,
      messageById,
      onLogout,
      onQuit,
      openChat,
      openOverlay,
      remove,
      reloadBotCommands,
      replaceFeed,
      saveConfig,
      search,
      sendBotCommand,
      sendFile,
      sendMessage,
      setReply,
      setShowIds,
      showIds,
      showSearch,
      system,
      tg,
      theme.name,
    ],
  )

  const submit = useCallback(
    (value: string) => {
      const text = value.replace(/\s+$/, '')
      if (!text.trim()) return

      // The input is only cleared once the line is handled, so a failed send
      // leaves the text where the user can retry it.
      void runCommand(text).then((handled) => {
        if (!handled) return
        if (inputRef.current !== value) return
        setInput('')
        setCursor(0)
      })
    },
    [runCommand],
  )

  const suggestions = useMemo(() => {
    if (overlay) return []
    return suggestItems({ local: commands, bots: botCommands, input })
  }, [botCommands, input, overlay])

  useEffect(() => {
    setSuggestIndex(0)
  }, [input])

  const applySuggestion = useCallback(
    (executeIfExact: boolean) => {
      const item = suggestions[suggestIndex] ?? suggestions[0]
      if (!item) return

      const trimmed = input.trim()

      // Enter on a complete telepi command always runs it, even if a bot row
      // happens to be at the top of the menu.
      if (
        executeIfExact &&
        (trimmed.startsWith('/') || trimmed.startsWith(':')) &&
        !trimmed.startsWith('//') &&
        findCommand(commands, trimmed.replace(/^[/:]/, ''))
      ) {
        submit(input)
        return
      }

      const exact = trimmed === item.insert || trimmed.startsWith(`${item.insert} `)

      if (exact) {
        if (executeIfExact) submit(input)
        return
      }

      const next = `${item.insert}${item.takesArgs ? ' ' : ''}`
      setInput(next)
      setCursor(graphemes(next).length)
    },
    [input, submit, suggestIndex, suggestions],
  )

  const selectOverlay = useCallback(() => {
    if (!overlay) return

    if (overlay.kind === 'chats') {
      const item = overlay.items[overlay.index]
      if (!item) return
      setOverlay(null)
      void openChat(String(item.id))
      return
    }

    if (overlay.kind === 'search') {
      const hit = overlay.hits[overlay.index]
      if (!hit) return

      setOverlay(null)

      void (async () => {
        if (hit.chatId !== chatRef.current?.id) {
          await openChat(String(hit.chatId))
        }
        await jump(hit.message.id)
      })().catch((error) => system(describeError(error), 'error'))
      return
    }

    if (overlay.kind === 'history') {
      const view = overlay.items[overlay.index]
      if (!view) return
      setOverlay(null)
      void jump(view.id).catch((error) => system(describeError(error), 'error'))
      return
    }

    if (overlay.kind === 'help') {
      const item = overlay.items[overlay.index]
      if (!item) return
      const next = `${item.insert}${item.takesArgs ? ' ' : ''}`
      setOverlay(null)
      setInput(next)
      setCursor(graphemes(next).length)
    }
  }, [jump, openChat, overlay, system])

  const onSpecialKey = useCallback(
    (key: Key, _input: string): boolean => {
      if (overlay && overlay.kind !== 'history') {
        if (key.escape) {
          setOverlay(null)
          return true
        }

        if (key.upArrow || key.downArrow) {
          setOverlay((current) => {
            if (!current || current.kind === 'history') return current

            const count = current.kind === 'search' ? current.hits.length : current.items.length
            if (count === 0) return current

            const delta = key.upArrow ? -1 : 1
            const next = (current.index + delta + count) % count
            return { ...current, index: next }
          })
          return true
        }

        if (key.return || key.tab) {
          selectOverlay()
          return true
        }

        return false
      }

      if (!overlay && suggestions.length > 0) {
        if (key.upArrow) {
          setSuggestIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
          return true
        }
        if (key.downArrow) {
          setSuggestIndex((index) => (index + 1) % suggestions.length)
          return true
        }
        if (key.tab) {
          applySuggestion(false)
          return true
        }
        if (key.return) {
          applySuggestion(true)
          return true
        }
      }

      if (key.escape && replyRef.current) {
        setReply(null)
        return true
      }

      return false
    },
    [applySuggestion, overlay, selectOverlay, setReply, suggestions.length],
  )

  const onOverlayChange = useCallback((value: string, nextCursor: number) => {
    setFilterCursor(nextCursor)
    setOverlay((current) => {
      if (!current || current.kind === 'history') return current

      if (current.kind === 'chats') {
        return {
          ...current,
          query: value,
          index: 0,
          items: rankByFuzzy(chatListRef.current, value, (item) => `${item.title} ${item.username ?? ''}`),
        }
      }

      return {
        ...current,
        query: value,
        index: 0,
        items: rankPalette(commands, botCommandsRef.current, value, { limit: 200 }),
      }
    })
  }, [])

  const scrollHistory = useCallback((delta: number) => {
    setOverlay((current) => {
      if (!current || current.kind !== 'history') return current
      const max = Math.max(0, current.items.length - 1)
      return { ...current, index: Math.max(0, Math.min(max, current.index + delta)) }
    })
  }, [])

  useInput(
    (inputChar, key) => {
      if (key.ctrl && inputChar === 'l') {
        clearScreen()
        return
      }

      if (!overlay) return

      if (overlay.kind === 'search') {
        if (key.escape) {
          setOverlay(null)
        } else if (key.upArrow || key.downArrow) {
          const delta = key.upArrow ? -1 : 1
          setOverlay((current) => {
            if (!current || current.kind !== 'search' || current.hits.length === 0) return current
            const next = (current.index + delta + current.hits.length) % current.hits.length
            return { ...current, index: next }
          })
        } else if (key.ctrl && inputChar === 'n') {
          void loadMoreSearch()
        } else if (key.return) {
          selectOverlay()
        }
        return
      }

      if (overlay.kind === 'chats' && key.ctrl && inputChar === 'n') {
        loadMoreDialogs()
        return
      }

      if (overlay.kind !== 'history') return

      if (key.escape) {
        setOverlay(null)
      } else if (key.return) {
        selectOverlay()
      } else if (key.upArrow) {
        scrollHistory(-1)
      } else if (key.downArrow) {
        scrollHistory(1)
      } else if (key.pageUp) {
        scrollHistory(-overlay.visible)
      } else if (key.pageDown) {
        scrollHistory(overlay.visible)
      } else if (key.home) {
        setOverlay({ ...overlay, index: 0 })
      } else if (key.end) {
        setOverlay({ ...overlay, index: Math.max(0, overlay.items.length - 1) })
      }
    },
    { isActive: true },
  )

  // Live updates -----------------------------------------------------------
  useEffect(() => {
    const onNewMessage = (message: Message): void => {
      const current = chatRef.current
      const chatId = message.chat.id

      if (current && chatId === current.id) {
        const pair = mergePair(message, me.id)
        if (!pair) return
        if (seen.current.has(pair.view.key)) return
        seen.current.add(pair.view.key)
        pushPair(pair)
        setTyping(null)
        markRead(current.id)
        return
      }

      setUnread((previous) => ({
        ...previous,
        [chatId]: (previous[chatId] ?? 0) + (message.isOutgoing ? 0 : 1),
      }))

      if (message.isOutgoing) return

      const title = message.chat.displayName || String(chatId)
      const view = mergePair(message, me.id)?.view
      const messageView = view?.kind === 'message' ? view : null
      const body = truncate(
        messageView?.text || messageView?.media.join(' ') || 'new message',
        80,
      )

      notifyToast(`${title}: ${body}`, 'info')

      // Muted chats stay silent; the in-app toast above is the only signal.
      if (muted.current.get(chatId) === true) return

      const mode = notificationsRef.current
      if (mode === 'bell') ringBell()
      else if (mode === 'desktop' || mode === 'macos') {
        const who = messageView && !messageView.fromMe ? messageView.senderName : null
        desktopNotify(who ? `${title} · ${who}` : title, body)
      }
    }

    const onEdit = (message: Message): void => {
      if (message.chat.id !== chatRef.current?.id) return
      const view = toMessageView(message, me.id)
      if (!view || view.kind !== 'message') return

      messageIndex.current.set(view.id, view)
      rawIndex.current.set(view.id, message)
      system(
        `✎ ${view.senderName} edited #${view.id}: ${truncate(view.text || view.media.join(' '), 110)}`,
        'info',
      )
    }

    const onDelete = (update: { messageIds: number[]; channelId: number | null }): void => {
      const current = chatRef.current
      if (!current) return
      if (update.channelId !== null && update.channelId !== current.id) return

      const removed = update.messageIds.filter((id) => messageIndex.current.has(id))
      if (removed.length === 0) return

      for (const id of removed) {
        messageIndex.current.delete(id)
        rawIndex.current.delete(id)
      }

      system(`✕ ${removed.map((id) => `#${id}`).join(', ')} deleted`, 'info')
    }

    const onTyping = (update: {
      chatId: number
      userId: number
      status: string
    }): void => {
      if (update.chatId !== chatRef.current?.id) return

      if (update.status === 'cancel') {
        setTyping(null)
        return
      }

      const name = peerNames.current.get(update.userId) ?? 'someone'
      const action = typingLabel(update.status)
      setTyping(`${name} ${action}`)

      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => setTyping(null), TYPING_MS)
    }

    const onConnection = (state: ConnectionState): void => setConnection(state)

    tg.onNewMessage.add(onNewMessage)
    tg.onEditMessage.add(onEdit)
    tg.onDeleteMessage.add(onDelete)
    tg.onUserTyping.add(onTyping)
    tg.onConnectionState.add(onConnection)

    return () => {
      tg.onNewMessage.remove(onNewMessage)
      tg.onEditMessage.remove(onEdit)
      tg.onDeleteMessage.remove(onDelete)
      tg.onUserTyping.remove(onTyping)
      tg.onConnectionState.remove(onConnection)
      if (typingTimer.current) clearTimeout(typingTimer.current)
    }
  }, [markRead, me.id, notifyToast, pushPair, setTyping, system, tg])

  // Seed unread counts, names and mute flags.
  useEffect(() => {
    void listDialogs(tg)
      .then((items) => {
        chatListRef.current = items
        const counts: Record<number, number> = {}
        for (const item of items) {
          peerNames.current.set(item.id, item.title)
          muted.current.set(item.id, item.muted)
          if (item.unread > 0 && !locallyRead.current.has(item.id)) counts[item.id] = item.unread
        }
        setUnread(counts)
      })
      .catch(() => {})
  }, [tg])

  // Open the last chat on boot, or show the picker.
  useEffect(() => {
    if (booted.current) return
    booted.current = true

    const target = initialChat || config.lastChat

    if (target) {
      void openChat(target)
    } else {
      openOverlay('chats')
    }
  }, [config.lastChat, initialChat, openChat, openOverlay])

  const unreadTotal = Object.values(unread).reduce((sum, value) => sum + value, 0)

  // Show the current chat and unread count in the terminal window title, so a
  // background terminal still tells you what is going on.
  const windowTitle = truncate(
    chat
      ? `telepi · ${chat.title}${unreadTotal > 0 ? ` · ${unreadTotal} unread` : ''}`
      : unreadTotal > 0
        ? `telepi · ${unreadTotal} unread`
        : 'telepi',
    60,
  )
  useTerminalTitle(windowTitle)

  const overlayInput =
    overlay && (overlay.kind === 'chats' || overlay.kind === 'help') ? overlay : null
  const showHistoryOverlay = overlay?.kind === 'history'
  const showSearchOverlay = overlay?.kind === 'search'
  const hideInput = showHistoryOverlay || showSearchOverlay
  const committedRows = Math.min(committedRowsRef.current, Math.max(0, rows - 1))
  const minHeight = frameMinHeight(rows, committedRows)

  const rightStatus = [
    reply && !overlay ? 'reply on' : null,
    unreadTotal > 0 ? `${unreadTotal} unread` : null,
    chat ? 'telepi' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const leftStatusMax = Math.max(
    8,
    columns - 2 - (rightStatus ? displayWidth(rightStatus) + 2 : 0),
  )
  const statusSuffix = `${chat?.username ? ` · @${chat.username}` : ''}${
    unreadTotal > 0 ? ` · ${unreadTotal} unread` : ''
  }`
  const statusTitle = chat
    ? truncate(chat.title, Math.max(6, leftStatusMax - displayWidth(statusSuffix)))
    : ''
  const statusSuffixText = truncate(
    statusSuffix,
    Math.max(0, leftStatusMax - displayWidth(statusTitle)),
  )

  const statusRightMax = Math.max(
    8,
    columns - 2 - displayWidth(chat ? statusTitle + statusSuffixText : 'no chat open') - 2,
  )
  const statusRight = truncate(
    `${connection}${chat && connection === 'connected' ? ` · ${formatClock(new Date(now))}` : ''}`,
    statusRightMax,
  )

  const hintText = overlayInput
    ? 'enter select · ↑↓ move · esc close'
    : showHistoryOverlay
      ? '↑↓ scroll · PgUp/PgDn · enter jump · esc close'
      : showSearchOverlay
        ? 'enter jump · ↑↓ move · ctrl+n more · esc close'
        : botCommands.length > 0
          ? columns < 68
            ? `/ bot (${botCommands.length}) · : telepi`
            : `enter send · / bot commands (${botCommands.length}) · : telepi · ↑ history`
          : columns < 68
            ? 'enter send · ↑ history · /help'
            : 'enter send · \\⏎ newline · ↑ history · /help'
  const hintLeft = truncate(hintText, columns - 2)
  const hintRight = truncate(
    rightStatus,
    Math.max(0, columns - 2 - displayWidth(hintLeft) - 2),
  )

  return (
    <Box flexDirection="column">
      <Static key={feedEpoch} items={feed}>
        {(entry) => (
          <FeedLine key={entry.id} entry={entry} theme={theme} columns={columns} showIds={showIds} />
        )}
      </Static>

      <Box flexDirection="column" minHeight={minHeight || undefined} justifyContent="flex-end">
        {overlay && (
          <Overlay
            overlay={overlay}
            theme={theme}
            columns={columns}
            rows={rows}
            showIds={showIds}
          />
        )}

        {/* Outside the `!overlay` branch: progress and errors must stay visible
            while a picker or a pager is open. */}
        {busy && (
          <Box paddingLeft={1} marginTop={1}>
            <Spinner label={busy} color={theme.accent} />
          </Box>
        )}

        {toast && (
          <Box paddingLeft={1} marginTop={1}>
            <Text color={toneColor(theme, toast.tone)}>
              {truncate(toast.text, columns - 3)}
            </Text>
          </Box>
        )}

        {!overlay && (
          <>
            {replay.length > 0 && (
              <Box flexDirection="column">
                {replay.map((entry) => (
                  <FeedLine
                    key={`replay-${entry.id}`}
                    entry={entry}
                    theme={theme}
                    columns={columns}
                    showIds={showIds}
                  />
                ))}
              </Box>
            )}

            {!chat && feed.length === 0 && (
              <Box flexDirection="column" marginTop={1} paddingLeft={1}>
                <Logo theme={theme} columns={columns} version />
                <Box marginTop={1}>
                  <Text dimColor>
                    {truncate('no chat open · /chats to pick one · /help for commands', columns - 3)}
                  </Text>
                </Box>
              </Box>
            )}

            {typing && (
              <Box paddingLeft={1} marginTop={1}>
                <Text dimColor italic>
                  ▍{truncate(typing, columns - 3)}
                </Text>
              </Box>
            )}

            {reply && (
              <Box paddingLeft={1} marginTop={1}>
                <Text dimColor>
                  {truncate(
                    `↩ replying to #${reply.id}${reply.text ? ` · ${reply.text}` : ''} · esc clears`,
                    columns - 3,
                  )}
                </Text>
              </Box>
            )}

            <CommandMenu
              items={suggestions}
              index={Math.min(suggestIndex, Math.max(0, suggestions.length - 1))}
              theme={theme}
              columns={columns}
            />

            <Box paddingX={1} marginTop={1} justifyContent="space-between">
              <Text dimColor>
                {chat ? (
                  <>
                    <Text color={theme.accent}>{statusTitle}</Text>
                    {statusSuffixText}
                  </>
                ) : (
                  'no chat open'
                )}
              </Text>
              <Text dimColor>{statusRight}</Text>
            </Box>
          </>
        )}

        {!hideInput && (
          <InputBox
            value={overlayInput ? overlayInput.query : input}
            cursor={overlayInput ? filterCursor : cursor}
            onChange={
              overlayInput
                ? onOverlayChange
                : (value, nextCursor) => {
                    setInput(value)
                    setCursor(nextCursor)
                  }
            }
            onSubmit={overlayInput ? () => selectOverlay() : submit}
            placeholder={
              overlayInput?.kind === 'chats'
                ? 'filter chats…'
                : overlayInput?.kind === 'help'
                  ? 'filter commands…'
                  : chat
                    ? `message ${chat.title}…`
                    : '/chats to pick a chat'
            }
            prompt={overlayInput ? '⌕' : '❯'}
            accent={theme.accent}
            border={theme.border}
            history={sentHistory}
            onSpecialKey={onSpecialKey}
          />
        )}

        <Box paddingX={1} justifyContent="space-between">
          <Text dimColor>{hintLeft}</Text>
          <Text dimColor>{hintRight}</Text>
        </Box>
      </Box>
    </Box>
  )
}

function typingLabel(status: string): string {
  switch (status) {
    case 'typing':
      return 'is typing…'
    case 'upload_photo':
      return 'is sending a photo…'
    case 'upload_video':
      return 'is sending a video…'
    case 'upload_document':
      return 'is sending a file…'
    case 'upload_voice':
      return 'is sending a voice message…'
    case 'record_voice':
      return 'is recording a voice message…'
    case 'record_video':
    case 'record_round':
      return 'is recording a video…'
    case 'upload_round':
      return 'is sending a video message…'
    case 'geo':
      return 'is sharing a location…'
    case 'contact':
      return 'is sharing a contact…'
    case 'sticker':
      return 'is choosing a sticker…'
    case 'game':
      return 'is playing a game…'
    default:
      return 'is active…'
  }
}
