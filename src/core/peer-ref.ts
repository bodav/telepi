/**
 * Parsing of chat references typed by the user: `@username`, marked ids,
 * t.me links (including `/c/<id>/<msg>` channel links) and `tg://` deep links.
 *
 * Kept pure so the tricky cases (channel links, invite hashes, post ids) are
 * unit-testable without a Telegram client.
 */

export type PeerRef =
  | { kind: 'peer'; ref: string | number; messageId?: number }
  | { kind: 'invite'; hash: string }
  | { kind: 'empty' }

const LINK_PREFIX = /^https?:\/\/(?:www\.)?(?:t|telegram)\.me\//i
const BARE_PREFIX = /^(?:t|telegram)\.me\//i

function positive(value: string | number | null | undefined): number | undefined {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : undefined
}

function peer(ref: string | number, messageId?: number): PeerRef {
  return messageId === undefined ? { kind: 'peer', ref } : { kind: 'peer', ref, messageId }
}

/** `tg://resolve?domain=x&post=1`, `tg://user?id=1`, `tg://openmessage?…`. */
function parseTgLink(raw: string): PeerRef | null {
  if (!/^tg:/i.test(raw)) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  const action = url.hostname.toLowerCase()
  const params = url.searchParams

  switch (action) {
    case 'resolve': {
      const domain = params.get('domain')
      if (!domain) return { kind: 'empty' }
      return peer(domain.replace(/^@/, ''), positive(params.get('post')))
    }

    case 'user': {
      const id = positive(params.get('id'))
      return id === undefined ? { kind: 'empty' } : peer(id)
    }

    case 'openmessage': {
      const chatId = Number(params.get('chat_id'))
      if (!Number.isInteger(chatId) || chatId === 0) return { kind: 'empty' }
      return peer(chatId, positive(params.get('message_id')))
    }

    case 'join':
      return { kind: 'invite', hash: params.get('invite') ?? '' }

    default:
      return null
  }
}

/**
 * Turn user input into something `getPeer` understands.
 *
 * `https://t.me/c/1234567890/55` addresses a channel by its *internal* id, so
 * it has to become the marked form `-1001234567890`; the trailing `/55` is the
 * message to jump to, not part of the chat reference.
 */
export function parsePeerRef(input: string): PeerRef {
  const raw = input.trim()
  if (!raw) return { kind: 'empty' }

  const deepLink = parseTgLink(raw)
  if (deepLink) return deepLink

  const isLink = LINK_PREFIX.test(raw) || BARE_PREFIX.test(raw)
  let ref = isLink ? raw.replace(LINK_PREFIX, '').replace(BARE_PREFIX, '') : raw
  ref = ref.replace(/[?#].*$/, '').replace(/\/+$/, '')

  // Invite links carry an unguessable hash instead of a username or id.
  const invite = /^(?:\+|joinchat\/)(.+)$/i.exec(ref)
  if (invite) return { kind: 'invite', hash: invite[1] ?? '' }

  if (isLink) {
    const [head, ...rest] = ref.split('/').filter(Boolean)
    if (!head) return { kind: 'empty' }

    // The web preview of a channel: t.me/s/<username>
    if (head.toLowerCase() === 's' && rest[0]) {
      return peer(rest[0].replace(/^@/, ''), positive(rest[1]))
    }

    // t.me/c/<internal-id>/<message-id> — a private channel post.
    if (head.toLowerCase() === 'c' && rest[0]) {
      const internal = rest[0].replace(/^\D/g, '')
      if (!/^\d+$/.test(internal)) return { kind: 'empty' }
      return peer(Number(`-100${internal}`), positive(rest[1]))
    }

    return peer(head.replace(/^@/, ''), positive(rest[0]))
  }

  ref = ref.replace(/^@/, '')
  if (!ref) return { kind: 'empty' }
  if (/^-?\d+$/.test(ref)) return peer(Number(ref))

  return peer(ref)
}
