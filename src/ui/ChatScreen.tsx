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
import { TYPING_MS, TOAST_MS } from '../core/constants.js'
import { describeError } from '../core/errors.js'
import { desktopNotify, ringBell } from '../core/notify.js'
import { displayWidth, graphemes, rankByFuzzy, truncate } from '../core/text.js'
import { formatBytes, formatClock } from '../core/time.js'
import type { ChatEventView, MessageView } from '../telegram/message.js'
import { toMessageView, mediaFilename } from '../telegram/message.js'
import type { ChatInfo, ChatListItem, MessagePair, SearchHit } from '../telegram/chats.js'
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
import { InputBox } from './InputBox.js'
import { Logo } from './Logo.js'
import { Overlay, type OverlayState } from './Overlay.js'
import { Spinner } from './Spinner.js'
import type { Theme } from './theme.js'
import { toneColor } from './theme.js'

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

function normalizeRef(input: string): string | number {
  let ref = input.trim()
  ref = ref.replace(/^https?:\/\/(?:t|telegram)\.me\//i, '')
  ref = ref.replace(/^tg:\/\/resolve\?domain=/i, '')
  ref = ref.replace(/^tg:\/\/user\?id=/i, '')
  ref = ref.replace(/^@/, '')
  ref = ref.replace(/[?#].*$/, '')
  ref = ref.replace(/\/+$/, '')
  ref = ref.split('/')[0] ?? ref

  if (/^-?\d+$/.test(ref)) return Number(ref)
  return ref
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
  const [now, setNow] = useState(() => Date.now())

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
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const pushEntries = useCallback((entries: FeedEntry[]) => {
    if (entries.length === 0) return
    setFeed((previous) => [...previous, ...entries])
  }, [])

  const replaceFeed = useCallback((entries: FeedEntry[]) => {
    setFeed(entries)
    setFeedEpoch((value) => value + 1)
  }, [])

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

  const messageById = useCallback(
    (id: number): MessageView | null => messageIndex.current.get(id) ?? null,
    [],
  )


  const openChat = useCallback(
    async (ref: string) => {
      const target = normalizeRef(ref)
      if (target === '') return

      const token = ++loadToken.current
      setBusy('opening chat…')
      setOverlay(null)

      try {
        const peer = await tg.getPeer(target)
        const info = chatInfo(peer)
        const history = await loadRecentMessages(tg, me.id, peer.id)

        if (token !== loadToken.current) return

        chatRef.current = info
        setChat(info)
        applyBotCommands([])
        setReply(null)
        setTyping(null)
        setInput('')
        setCursor(0)
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
      } catch (error) {
        system(describeError(error), 'error')
      } finally {
        if (token === loadToken.current) setBusy(null)
      }
    },
    [applyBotCommands, enrichReply, markRead, me.id, replaceFeed, saveConfig, setReply, system, tg],
  )

  const closeChat = useCallback(() => {
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
    (query: string, all: boolean, hits: SearchHit[]) => {
      pushEntries([{ kind: 'search', id: nextId(cursorRef.current), query, all, hits }])
    },
    [pushEntries],
  )

  const search = useCallback(
    async (query: string, all: boolean): Promise<SearchHit[]> => {
      if (all) return searchGlobal(tg, me.id, query)

      const current = chatRef.current
      if (!current) return []
      return searchInChat(tg, me.id, current.id, current.title, query)
    },
    [me.id, tg],
  )

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
      })

      void (async () => {
        try {
          const items = await listDialogs(tg)
          chatListRef.current = items
          for (const item of items) peerNames.current.set(item.id, item.title)
          setOverlay((current) =>
            current && current.kind === 'chats'
              ? {
                  ...current,
                  items: rankByFuzzy(items, current.query, (item) => `${item.title} ${item.username ?? ''}`),
                  loading: false,
                }
              : current,
          )
        } catch (error) {
          system(describeError(error), 'error')
          setOverlay((current) =>
            current && current.kind === 'chats' ? { ...current, loading: false } : current,
          )
        }
      })()
    },
    [system, tg],
  )

  const download = useCallback(
    async (id: number, target?: string): Promise<string> => {
      const current = chatRef.current
      const raw = rawIndex.current.get(id)

      if (!raw) throw new Error(`message #${id} is not in the loaded window`)
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
          caption: caption ? parseMarkdown(caption) : undefined,
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

  const edit = useCallback(
    async (id: number, text: string): Promise<void> => {
      const current = chatRef.current
      if (!current) throw new Error('no chat is open')

      const updated = await tg.editMessage({
        chatId: current.id,
        message: id,
        text: parseMarkdown(text),
      })

      const view = toMessageView(updated, me.id)
      if (view?.kind === 'message') {
        messageIndex.current.set(view.id, view)
        rawIndex.current.set(view.id, updated)
      }
    },
    [me.id, tg],
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
    async (text: string) => {
      const current = chatRef.current
      if (!current) {
        notifyToast('open a chat first — /chats', 'warn')
        return
      }

      setBusy('sending…')

      try {
        void tg.sendTyping(current.id).catch(() => {})

        const replyId = replyRef.current?.id
        const sent = await tg.sendText(
          current.id,
          parseMarkdown(text),
          replyId ? { replyTo: replyId } : undefined,
        )

        setReply(null)
        const pair = mergePair(sent, me.id)
        if (pair) {
          seen.current.add(pair.view.key)
          pushPair(pair)
        }
        setSentHistory((history) => [...history.slice(-199), text])
      } catch (error) {
        system(describeError(error), 'error')
        notifyToast(describeError(error), 'error')
      } finally {
        setBusy(null)
      }
    },
    [me.id, notifyToast, pushPair, setReply, system, tg],
  )

  const runCommand = useCallback(
    async (raw: string) => {
      const resolved = resolveInput(raw, commands)

      if (resolved.kind === 'warn') {
        system(resolved.message, 'warn')
        return
      }

      if (resolved.kind === 'send') {
        await sendMessage(resolved.text)
        return
      }

      const { command, args } = resolved

      const ctx: CommandContext = {
        tg,
        me,
        chat: chatRef.current,
        replyTo: replyRef.current,
        notifications: notificationsRef.current,
        theme: theme.name,
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
        messageById,
        search,
        showSearch,
        copy: copyToClipboard,
        download,
        sendFile,
        edit,
        remove,
        setNotify: (value) => {
          setNotifications(value)
          notificationsRef.current = value
        },
        setTheme: (value) => {
          void saveConfig({ theme: value as ThemeName })
        },
        saveConfig,
        reloadBotCommands,
        clear: () => {
          onClearScreen()
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
      } catch (error) {
        system(describeError(error), 'error')
      }
    },
    [
      closeChat,
      download,
      edit,
      lastMessage,
      loadOlder,
      me,
      messageById,
      onClearScreen,
      onLogout,
      onQuit,
      openChat,
      openOverlay,
      remove,
      reloadBotCommands,
      replaceFeed,
      saveConfig,
      search,
      sendFile,
      sendMessage,
      setReply,
      showSearch,
      system,
      tg,
      theme.name,
    ],
  )

  const submit = useCallback(
    (value: string) => {
      const text = value.trim()
      if (!text) return

      setInput('')
      setCursor(0)
      void runCommand(text)
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

    if (overlay.kind === 'help') {
      const item = overlay.items[overlay.index]
      if (!item) return
      const next = `${item.insert}${item.takesArgs ? ' ' : ''}`
      setOverlay(null)
      setInput(next)
      setCursor(graphemes(next).length)
    }
  }, [openChat, overlay])

  const onSpecialKey = useCallback(
    (key: Key, _input: string): boolean => {
      if (overlay && overlay.kind !== 'history') {
        if (key.escape) {
          setOverlay(null)
          return true
        }

        if (key.upArrow || key.downArrow) {
          setOverlay((current) => {
            if (!current || current.kind === 'history' || current.items.length === 0) return current
            const delta = key.upArrow ? -1 : 1
            const next = (current.index + delta + current.items.length) % current.items.length
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
      const maxStart = Math.max(0, current.items.length - current.visible)
      return { ...current, index: Math.max(0, Math.min(maxStart, current.index + delta)) }
    })
  }, [])

  useInput(
    (inputChar, key) => {
      if (key.ctrl && inputChar === 'l') {
        onClearScreen()
        return
      }

      if (!overlay || overlay.kind !== 'history') return

      if (key.escape) {
        setOverlay(null)
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
        setOverlay({
          ...overlay,
          index: Math.max(0, overlay.items.length - overlay.visible),
        })
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
      const text = message.text || 'new message'
      notifyToast(`${title}: ${truncate(text, 70)}`, 'info')

      const mode = notificationsRef.current
      if (mode === 'bell') ringBell()
      else if (mode === 'macos') desktopNotify(title, text)
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

  // Seed unread counts and names.
  useEffect(() => {
    void listDialogs(tg)
      .then((items) => {
        chatListRef.current = items
        const counts: Record<number, number> = {}
        for (const item of items) {
          peerNames.current.set(item.id, item.title)
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
  const overlayInput = overlay && overlay.kind !== 'history' ? overlay : null
  const showHistoryOverlay = overlay?.kind === 'history'

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
      ? '↑↓ scroll · PgUp/PgDn · esc close'
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
        {(entry) => <FeedLine key={entry.id} entry={entry} theme={theme} columns={columns} />}
      </Static>

      <Box flexDirection="column">
        {overlay && <Overlay overlay={overlay} theme={theme} columns={columns} rows={rows} />}

        {!overlay && (
          <>
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

        {!showHistoryOverlay && (
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
