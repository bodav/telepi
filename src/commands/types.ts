import type { TelegramClient, User } from '@mtcute/node'
import type { Config, Notifications, ThemeName } from '../core/config.js'
import type { SearchCursor, SearchPage, ChatInfo } from '../telegram/chats.js'
import type { BotCommand } from '../telegram/bot-commands.js'
import type { MessageView } from '../telegram/message.js'
import type { Tone } from '../chat/feed.js'
import { fuzzyScore } from '../core/text.js'

export type OverlayKind = 'chats' | 'help'

export interface CommandContext {
  tg: TelegramClient
  me: User
  chat: ChatInfo | null
  replyTo: MessageView | null
  notifications: Notifications
  theme: ThemeName
  showIds: boolean
  downloadsDir: string
  commands: readonly Command[]
  botCommands: readonly BotCommand[]

  system(text: string, tone?: Tone): void
  openChat(ref: string): Promise<void>
  closeChat(): void
  loadOlder(): Promise<void>
  openOverlay(kind: OverlayKind, query?: string): void
  setReply(view: MessageView | null): void
  lastMessage(): MessageView | null
  lastMediaMessage(): MessageView | null
  messageById(id: number): MessageView | null
  jump(id: number): Promise<void>

  search(query: string, all: boolean, cursor?: SearchCursor): Promise<SearchPage>
  showSearch(query: string, all: boolean, page: SearchPage): void

  copy(text: string): Promise<boolean>
  download(id: number, path?: string): Promise<string>
  view(id: number): Promise<string>
  sendFile(path: string, caption?: string): Promise<void>
  sendBotCommand(command: string, args?: string): Promise<void>
  edit(id: number, text: string): Promise<void>
  remove(ids: number[]): Promise<void>

  /** Whether outgoing text is parsed as markdown. */
  markdown: boolean
  setMarkdown(value: boolean): Promise<void>

  setNotify(value: Notifications): void
  setTheme(value: ThemeName): void
  setShowIds(value: boolean): Promise<void>
  saveConfig(patch: Partial<Config>): Promise<void>
  reloadBotCommands(): Promise<readonly BotCommand[]>

  clear(): void
  quit(): void
  logout(): Promise<void>
}

export type CommandGroup = 'chat' | 'messages' | 'account' | 'app'

export interface Command {
  name: string
  aliases?: readonly string[]
  args?: string
  description: string
  group: CommandGroup
  run: (ctx: CommandContext, args: string, raw: string) => Promise<void> | void
}

export function findCommand(commands: readonly Command[], name: string): Command | undefined {
  const needle = name.toLowerCase()
  return commands.find(
    (command) => command.name === needle || command.aliases?.includes(needle) === true,
  )
}

/** One row in the command palette: either a telepi command or a bot command. */
export interface PaletteItem {
  /** Stable identity for React keys. */
  key: string
  /** Text shown in the menu, including the exact prefix. */
  label: string
  /** Text inserted into the input when completed. */
  insert: string
  description: string
  source: 'local' | 'bot'
  /** Bot username, when the command belongs to a bot. */
  botName?: string
  /** Whether completing the command should leave room for arguments. */
  takesArgs: boolean
}

export interface PaletteOptions {
  limit?: number
  localPrefix?: '/' | ':'
}

/**
 * Build and rank palette rows from telepi's commands and the current chat's
 * bot commands.
 *
 * Bot commands insert the exact text that will address them: `/cmd@bot` in
 * groups, `//cmd` when a telepi command would shadow it, and `/cmd` otherwise.
 */
export function rankPalette(
  local: readonly Command[],
  bots: readonly BotCommand[],
  query: string,
  options: PaletteOptions = {},
): PaletteItem[] {
  const { limit = 8, localPrefix = '/' } = options

  const localNames = new Set<string>()
  for (const command of local) {
    localNames.add(command.name)
    for (const alias of command.aliases ?? []) localNames.add(alias)
  }

  const scored: Array<{ item: PaletteItem; score: number; order: number }> = []
  const preferBots = query.trim() === '' && bots.length > 0
  const needle = query.trim().toLowerCase()

  for (const command of local) {
    const haystack = `${command.name} ${command.aliases?.join(' ') ?? ''}`.trim()
    const matched = scoreCommand(query, haystack, command.description)
    if (matched === null) continue
    let score = matched
    // Prefer telepi for an exact or prefix name match, so /help keeps opening
    // telepi's help even when the bot publishes the same command.
    if (command.name === needle || command.aliases?.includes(needle) === true) score += 10
    else if (command.name.startsWith(needle) && needle !== '') score += 5

    const name = `${localPrefix}${command.name}`
    scored.push({
      item: {
        key: `local:${command.name}`,
        label: `${name}${command.args ? ` ${command.args}` : ''}`,
        insert: name,
        description: command.description,
        source: 'local',
        takesArgs: Boolean(command.args),
      },
      score,
      order: 0,
    })
  }

  for (const bot of bots) {
    const matched = scoreCommand(query, bot.command, bot.description)
    if (matched === null) continue
    const score = matched

    const insert =
      bot.scope === 'group' && bot.botUsername
        ? `/${bot.command}@${bot.botUsername}`
        : localNames.has(bot.command)
          ? `//${bot.command}`
          : `/${bot.command}`

    scored.push({
      item: {
        key: `bot:${bot.botId}:${bot.command}`,
        label: insert,
        insert,
        description: bot.description,
        source: 'bot',
        botName: bot.botUsername ?? undefined,
        takesArgs: false,
      },
      score,
      order: 1,
    })
  }

  scored.sort((a, b) => {
    // A bare slash in a bot chat is about the bot's menu, so show it first and
    // make the commands discoverable instead of buried under telepi's list.
    if (preferBots && a.order !== b.order) return b.order - a.order
    return b.score - a.score || a.order - b.order
  })
  return scored.slice(0, limit).map((entry) => entry.item)
}

/** Match a query against a command's name, falling back to its description. */
function scoreCommand(query: string, names: string, description: string): number | null {
  const direct = fuzzyScore(query, names)
  if (direct !== null) return direct

  const described = fuzzyScore(query, description)
  return described === null ? null : described * 0.5
}

/**
 * Palette rows for the partially-typed input.
 *
 * `/` searches telepi and the current chat's bots; `:` searches telepi only;
 * `//` means "send literally" and offers no suggestions.
 */
export function suggestItems(options: {
  local: readonly Command[]
  bots?: readonly BotCommand[]
  input: string
  limit?: number
}): PaletteItem[] {
  const { local, bots = [], input, limit = 8 } = options

  const trimmed = input.trim()
  if (trimmed.startsWith('//')) return []
  if (!trimmed.startsWith('/') && !trimmed.startsWith(':')) return []
  if (/\s/.test(trimmed)) return []

  // A bare colon lists telepi commands, but `:D`-style emoticons should just
  // be typed instead of triggering completion.
  if (trimmed.startsWith(':') && trimmed.length === 2) return []

  const localPrefix = trimmed.startsWith(':') ? ':' : '/'
  const query = trimmed.slice(1)

  return rankPalette(local, localPrefix === ':' ? [] : bots, query, { limit, localPrefix })
}

export function usage(command: Command, prefix = '/'): string {
  return `${prefix}${command.name}${command.args ? ` ${command.args}` : ''}`
}
