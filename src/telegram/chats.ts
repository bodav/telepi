import type { InputPeerLike, Message, Peer, TelegramClient } from '@mtcute/node'
import type { ChatEventView, MessageView } from '../telegram/message.js'
import { toMessageView } from '../telegram/message.js'
import { DIALOG_LIMIT, INITIAL_HISTORY, OLDER_HISTORY, SEARCH_PAGE } from '../core/constants.js'

export interface ChatInfo {
  peer: Peer
  id: number
  title: string
  username: string | null
  kind: string
  isBot: boolean
  isGroup: boolean
}

export interface ChatListItem {
  id: number
  title: string
  username: string | null
  kind: string
  unread: number
  muted: boolean
  lastMessage: string
  date: Date | null
}

export interface MessagePair {
  raw: Message
  view: ChatEventView
}

export function chatInfo(peer: Peer): ChatInfo {
  return {
    peer,
    id: peer.id,
    title: peer.displayName || `chat ${peer.id}`,
    username: peer.username,
    kind: peer.type,
    isBot: peer.type === 'user' && peer.isBot,
    isGroup: peer.type === 'chat' && peer.isGroup,
  }
}

export async function listDialogs(tg: TelegramClient, limit = DIALOG_LIMIT): Promise<ChatListItem[]> {
  const items: ChatListItem[] = []

  for await (const dialog of tg.iterDialogs({ limit, chunkSize: 100 })) {
    const last = dialog.lastMessage
    items.push({
      id: dialog.peer.id,
      title: dialog.peer.displayName || `chat ${dialog.peer.id}`,
      username: dialog.peer.username,
      kind: dialog.peer.type,
      unread: dialog.unreadCount,
      muted: dialog.isMuted === true,
      lastMessage: last ? (last.text || '').replace(/\s+/g, ' ').slice(0, 140) : '',
      date: last?.date ?? null,
    })
  }

  return items
}

export interface LoadedHistory {
  items: MessagePair[]
  older?: { id: number; date: number }
}

function toPairs(messages: Message[], meId: number): MessagePair[] {
  const pairs: MessagePair[] = []

  for (const raw of messages) {
    const view = toMessageView(raw, meId)
    if (view) pairs.push({ raw, view })
  }

  return pairs
}

export async function loadRecentMessages(
  tg: TelegramClient,
  meId: number,
  peer: InputPeerLike,
  limit = INITIAL_HISTORY,
): Promise<LoadedHistory> {
  const history = await tg.getHistory(peer, { limit })
  const messages = [...history].reverse()

  return { items: toPairs(messages, meId), older: history.next }
}

export async function loadOlderMessages(
  tg: TelegramClient,
  meId: number,
  peer: InputPeerLike,
  older: { id: number; date: number },
): Promise<LoadedHistory> {
  const history = await tg.getHistory(peer, { limit: OLDER_HISTORY, offset: older })
  const messages = [...history].reverse()

  return { items: toPairs(messages, meId), older: history.next }
}

export interface SearchHit {
  chatId: number
  chatTitle: string
  message: MessageView
}

/** Where the next page of a search starts. Opaque to callers. */
type ChatSearchOffset = NonNullable<
  Awaited<ReturnType<TelegramClient['searchMessages']>>['next']
>
type GlobalSearchOffset = NonNullable<
  Awaited<ReturnType<TelegramClient['searchGlobal']>>['next']
>

export type SearchCursor =
  | { kind: 'chat'; offset: ChatSearchOffset }
  | { kind: 'global'; offset: GlobalSearchOffset }

export interface SearchPage {
  hits: SearchHit[]
  next?: SearchCursor
}

export async function searchInChat(
  tg: TelegramClient,
  meId: number,
  peer: InputPeerLike,
  chatTitle: string,
  query: string,
  options: { limit?: number; cursor?: SearchCursor } = {},
): Promise<SearchPage> {
  const limit = options.limit ?? SEARCH_PAGE
  const offset =
    options.cursor && options.cursor.kind === 'chat' ? options.cursor.offset : undefined

  const result = await tg.searchMessages({ chatId: peer, query, limit, offset })

  const hits = result
    .map((message) => {
      const view = toMessageView(message, meId)
      if (!view || view.kind !== 'message') return null
      return { chatId: message.chat.id, chatTitle, message: view }
    })
    .filter((hit): hit is SearchHit => hit !== null)

  return { hits, next: result.next === undefined ? undefined : { kind: 'chat', offset: result.next } }
}

export async function searchGlobal(
  tg: TelegramClient,
  meId: number,
  query: string,
  options: { limit?: number; cursor?: SearchCursor } = {},
): Promise<SearchPage> {
  const limit = options.limit ?? SEARCH_PAGE
  const offset =
    options.cursor && options.cursor.kind === 'global' ? options.cursor.offset : undefined

  const result = await tg.searchGlobal({ query, limit, offset })

  const hits = result
    .map((message) => {
      const view = toMessageView(message, meId)
      if (!view || view.kind !== 'message') return null
      return {
        chatId: message.chat.id,
        chatTitle: message.chat.displayName || `chat ${message.chat.id}`,
        message: view,
      }
    })
    .filter((hit): hit is SearchHit => hit !== null)

  return {
    hits,
    next: result.next === undefined ? undefined : { kind: 'global', offset: result.next },
  }
}

export async function unreadChats(tg: TelegramClient): Promise<ChatListItem[]> {
  const dialogs = await listDialogs(tg)
  return dialogs.filter((dialog) => dialog.unread > 0)
}

/** Resolve the title of a peer without failing on stale ids. */
export async function resolveTitle(tg: TelegramClient, peer: InputPeerLike): Promise<string> {
  try {
    const found = await tg.getPeer(peer)
    return found.displayName || String(found.id)
  } catch {
    return String(peer)
  }
}
