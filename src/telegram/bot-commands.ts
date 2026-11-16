import type { TelegramClient } from '@mtcute/node'
import type { ChatInfo } from './chats.js'

/** One command published by a bot, with enough context to address it. */
export interface BotCommand {
  command: string
  description: string
  botId: number
  botUsername: string | null
  /** Private chats address commands bare; groups need `/cmd@username`. */
  scope: 'private' | 'group'
}

const TTL_MS = 5 * 60_000

const cache = new Map<number, { at: number; commands: BotCommand[] }>()
const inflight = new Map<number, Promise<BotCommand[]>>()

/**
 * Commands the current chat's bot(s) advertise.
 *
 * Private bot chats expose them on the user full info; groups list their bots
 * on the full chat info. Results are cached briefly and fail soft, since the
 * bot menu is a convenience and must never block opening a chat.
 */
export async function loadBotCommands(
  tg: TelegramClient,
  chat: ChatInfo,
  refresh = false,
): Promise<BotCommand[]> {
  if (!chat.isBot && !chat.isGroup) return []

  const cached = cache.get(chat.id)
  if (!refresh && cached && Date.now() - cached.at < TTL_MS) return cached.commands

  const pending = inflight.get(chat.id)
  if (pending) return pending

  const promise = fetchBotCommands(tg, chat)
    .then((commands) => {
      cache.set(chat.id, { at: Date.now(), commands })
      return commands
    })
    .catch(() => cached?.commands ?? [])
    .finally(() => {
      inflight.delete(chat.id)
    })

  inflight.set(chat.id, promise)
  return promise
}

async function fetchBotCommands(tg: TelegramClient, chat: ChatInfo): Promise<BotCommand[]> {
  if (chat.isBot) {
    const full = await tg.getFullUser(chat.id)
    const info = full.full.botInfo
    if (!info || info._ !== 'botInfo') return []

    return fromRaw(info.commands ?? [], chat.id, chat.username, 'private')
  }

  const full = await tg.getFullChat(chat.id)
  const out: BotCommand[] = []

  for (const info of full.botInfo) {
    const peer = full.peers.users.get(info.id)
    const username = peer && peer._ === 'user' ? (peer.username ?? null) : null

    out.push(...fromRaw(info.commands, info.id, username, 'group'))
  }

  return out
}

function fromRaw(
  commands: readonly { _: string; command?: string; description?: string }[],
  botId: number,
  botUsername: string | null,
  scope: 'private' | 'group',
): BotCommand[] {
  const out: BotCommand[] = []

  for (const command of commands) {
    if (command._ !== 'botCommand' || !command.command) continue
    out.push({
      command: command.command,
      description: command.description ?? '',
      botId,
      botUsername,
      scope,
    })
  }

  return out
}
