import { MtArgumentError, MtTimeoutError, tl } from '@mtcute/node'

const { RpcError } = tl

const AUTH_ERRORS = new Set([
  'AUTH_KEY_UNREGISTERED',
  'AUTH_KEY_INVALID',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'USER_DEACTIVATED',
  'USER_DEACTIVATED_BAN',
])

export function isAuthError(error: unknown): boolean {
  if (!RpcError.is(error)) return false
  return AUTH_ERRORS.has(String(error.text))
}

export function isRpcError(error: unknown, text: string): boolean {
  return RpcError.is(error) && String(error.text) === text
}

export function rpcText(error: unknown): string | null {
  return RpcError.is(error) ? String(error.text) : null
}

/** Turn an arbitrary error into a short, human-friendly sentence. */
export function describeError(error: unknown): string {
  if (RpcError.is(error)) {
    const text = String(error.text)

    if (text.startsWith('FLOOD_WAIT_')) {
      const seconds = Number(text.slice('FLOOD_WAIT_'.length))
      if (Number.isFinite(seconds) && seconds > 0) {
        return `rate limited by Telegram — retry in ${seconds}s`
      }
      return 'rate limited by Telegram'
    }

    if (text.startsWith('FLOOD_PREMIUM_WAIT_')) {
      return 'rate limited by Telegram (premium wait)'
    }

    switch (text) {
      case 'AUTH_KEY_UNREGISTERED':
      case 'SESSION_REVOKED':
      case 'SESSION_EXPIRED':
        return 'session expired — run /logout and sign in again'
      case 'API_ID_INVALID':
        return 'api_id/api_hash are not valid — create your own at my.telegram.org/apps'
      case 'API_ID_PUBLISHED_FLOOD':
        return 'this api_id is rate-limited by Telegram — use your own credentials'
      case 'PHONE_NUMBER_INVALID':
      case 'PHONE_NUMBER_BANNED':
        return 'that phone number is not valid for Telegram'
      case 'AUTH_RESTART':
        return 'Telegram asked to restart the login — request a new code'
      case 'AUTH_KEY_DUPLICATED':
        return 'this session is already in use elsewhere — start a new login'
      case 'PHONE_CODE_INVALID':
        return 'that code is not valid'
      case 'PHONE_CODE_EXPIRED':
        return 'that code expired — request a new one'
      case 'PASSWORD_HASH_INVALID':
        return 'wrong two-step password'
      case 'PEER_ID_INVALID':
        return 'chat not found'
      case 'USERNAME_NOT_OCCUPIED':
      case 'USERNAME_INVALID':
        return 'no such username'
      case 'MESSAGE_ID_INVALID':
        return 'no such message in this chat'
      case 'CHAT_WRITE_FORBIDDEN':
        return 'you cannot write in this chat'
      case 'CHANNEL_PRIVATE':
        return 'this channel is private'
      case 'MESSAGE_TOO_LONG':
        return 'message is too long'
      case 'MEDIA_CAPTION_TOO_LONG':
        return 'caption is too long (Telegram allows 1024 characters)'
      case 'QUERY_ID_INVALID':
        return 'search query expired'
      default:
        break
    }

    return text.toLowerCase().replace(/_/g, ' ')
  }

  if (error instanceof MtTimeoutError) {
    return 'Telegram did not respond in time — check your connection'
  }

  if (error instanceof MtArgumentError) {
    return error.message
  }

  if (error instanceof AggregateError) {
    const first = error.errors[0]
    if (first) return describeError(first)
  }

  if (error instanceof Error) {
    const message = error.message || error.name
    if (/ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket/i.test(message)) {
      return 'network error — check your connection'
    }
    return message
  }

  return String(error)
}
