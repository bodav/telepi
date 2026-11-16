import type { Message, MessageMedia, Peer, PeerSender } from '@mtcute/node'
import type { EntityLike } from '../core/rich-text.js'
import { formatBytes, formatDuration } from '../core/time.js'
import { truncate } from '../core/text.js'

export interface ReplyView {
  id: number | null
  author?: string
  snippet: string
}

export interface MessageView {
  kind: 'message'
  key: string
  id: number
  chatId: number
  senderId: number | null
  senderName: string
  fromMe: boolean
  date: Date
  edited: boolean
  text: string
  entities: readonly EntityLike[]
  media: string[]
  reply?: ReplyView
  forwardedFrom?: string
  views: number | null
  showHeader: boolean
}

export interface ServiceView {
  kind: 'service'
  key: string
  id: number
  chatId: number
  date: Date
  text: string
  showHeader: boolean
}

export type ChatEventView = MessageView | ServiceView

export function messageKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`
}

export function senderLabel(sender: PeerSender | null | undefined): string {
  if (!sender) return 'someone'
  if (sender.type === 'anonymous') return sender.displayName
  return sender.displayName || `peer ${sender.id}`
}

export function senderId(sender: Peer | null | undefined): number | null {
  return sender ? sender.id : null
}

const MEDIA_LABEL_FALLBACK = 'attachment'

function mediaSize(media: MessageMedia): string {
  const size = (media as { fileSize?: number } | null)?.fileSize
  return typeof size === 'number' && size > 0 ? formatBytes(size) : ''
}

/** One or more dim lines describing a media attachment. */
export function describeMedia(media: MessageMedia): string[] {
  if (!media) return []

  const size = mediaSize(media)

  switch (media.type) {
    case 'photo':
      return [`[photo ${media.width}×${media.height}${size ? ` · ${size}` : ''}]`]

    case 'video': {
      const duration = media.duration ? ` · ${formatDuration(media.duration)}` : ''
      return [`[video ${media.width}×${media.height}${duration}${size ? ` · ${size}` : ''}]`]
    }

    case 'voice':
      return [`[voice ${formatDuration(media.duration)}]`]

    case 'audio': {
      const title = media.title || media.fileName || 'audio'
      const performer = media.performer ? ` — ${media.performer}` : ''
      return [`[audio ${title}${performer} · ${formatDuration(media.duration)}]`]
    }

    case 'sticker':
      return [`[sticker${media.emoji ? ` ${media.emoji}` : ''}]`]

    case 'document':
      return [`[file ${media.fileName || 'unnamed'}${size ? ` · ${size}` : ''}]`]

    case 'webpage': {
      const page = media.preview
      const lines = [`[link ${page.siteName || page.displayUrl}]`]
      if (page.title) lines.push(page.title)
      if (page.description) lines.push(truncate(page.description, 200))
      return lines
    }

    case 'poll':
      return [`[poll “${truncate(media.question, 120)}”]`]

    case 'contact':
      return [`[contact ${media.firstName} ${media.lastName} · ${media.phoneNumber}]`]

    case 'location':
      return [`[location ${media.latitude.toFixed(3)}, ${media.longitude.toFixed(3)}]`]

    case 'live_location':
      return ['[live location]']

    case 'venue':
      return [`[venue ${media.title}]`]

    case 'dice':
      return [`[dice ${media.emoji}]`]

    case 'game':
      return ['[game]']

    case 'story':
      return ['[story]']

    case 'paid':
      return ['[paid media]']

    case 'todo':
      return ['[to-do list]']

    case 'widget':
      return ['[widget]']

    default: {
      const type = (media as { type?: string }).type
      return [`[${type || MEDIA_LABEL_FALLBACK}]`]
    }
  }
}

function serviceText(msg: Message): string {
  const action = msg.action
  const who = msg.isOutgoing ? 'you' : senderLabel(msg.sender)

  if (!action) return `${who} sent a service message`

  const a = action as unknown as Record<string, unknown>

  switch (action.type) {
    case 'user_joined_link':
    case 'user_joined_approved':
    case 'user_joined_community':
    case 'contact_joined':
      return `${who} joined`
    case 'user_left':
      return `${who} left`
    case 'user_removed':
      return `${who} was removed`
    case 'users_added':
      return `${who} added members`
    case 'title_changed':
      return typeof a.newTitle === 'string' ? `title changed to “${a.newTitle}”` : 'title changed'
    case 'photo_changed':
      return 'chat photo changed'
    case 'photo_deleted':
      return 'chat photo removed'
    case 'message_pinned':
      return `${who} pinned a message`
    case 'history_cleared':
      return `${who} cleared the chat history`
    case 'group_call_started':
      return 'group call started'
    case 'group_call_ended':
      return 'group call ended'
    case 'group_call_scheduled':
      return 'group call scheduled'
    case 'screenshot_taken':
      return `${who} took a screenshot`
    case 'topic_created':
      return typeof a.title === 'string' ? `topic “${a.title}” created` : 'topic created'
    case 'topic_edited':
      return 'topic updated'
    case 'ttl_changed':
      return 'auto-delete timer changed'
    case 'call':
      return 'call'
    case 'payment_received':
      return 'payment received'
    case 'payment_sent':
      return 'payment sent'
    case 'custom':
      return `${who} sent a service message`
    default:
      return `${who}: ${String(action.type).replace(/_/g, ' ')}`
  }
}

function replyView(msg: Message): ReplyView | undefined {
  const reply = msg.replyToMessage
  if (!reply) return undefined

  const sender = reply.sender
  const author = sender ? senderLabel(sender) : undefined
  const snippet = truncate(reply.quoteText || describeMedia(reply.media).join(' '), 90)

  return {
    id: reply.id,
    author,
    snippet,
  }
}

function forwardedFrom(msg: Message): string | undefined {
  const forward = msg.forward
  if (!forward) return undefined
  return senderLabel(forward.sender)
}

/**
 * Convert a Telegram message into the stable view model used by the UI.
 * Returns null for messages that have nothing worth showing.
 */
export function toMessageView(msg: Message, meId: number, showHeader = true): ChatEventView | null {
  const chatId = msg.chat.id
  const key = messageKey(chatId, msg.id)

  if (msg.isService) {
    return {
      kind: 'service',
      key,
      id: msg.id,
      chatId,
      date: msg.date,
      text: serviceText(msg),
      showHeader,
    }
  }

  const media = describeMedia(msg.media)
  const text = msg.text ?? ''
  if (text === '' && media.length === 0) return null

  const sender = msg.sender
  const fromMe = senderId(sender) === meId

  return {
    kind: 'message',
    key,
    id: msg.id,
    chatId,
    senderId: senderId(sender),
    senderName: fromMe ? 'you' : senderLabel(sender),
    fromMe,
    date: msg.date,
    edited: msg.editDate !== null,
    text,
    entities: msg.entities,
    media,
    reply: replyView(msg),
    forwardedFrom: forwardedFrom(msg),
    views: msg.views,
    showHeader,
  }
}

/** Filename suggestion for `/save`. */
export function mediaFilename(msg: Message, chatTitle: string): string {
  const media = msg.media
  const slug = chatTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'telegram'

  let name = ''
  let ext = ''

  if (media?.type === 'document' || media?.type === 'audio' || media?.type === 'video') {
    name = media.fileName ?? ''
  }

  if (media?.type === 'photo') ext = 'jpg'
  else if (media?.type === 'video') ext = 'mp4'
  else if (media?.type === 'voice') ext = 'ogg'
  else if (media?.type === 'audio') ext = 'mp3'
  else if (media?.type === 'sticker') ext = 'webp'

  const base = name ? name.replace(/[\\/:*?"<>|]/g, '_') : `${slug}-${msg.id}${ext ? `.${ext}` : ''}`
  return base
}
