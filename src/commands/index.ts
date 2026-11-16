import { truncate } from '../core/text.js'
import { unreadChats } from '../telegram/chats.js'
import { parseAttachmentArgs } from '../telegram/upload.js'
import type { Command, CommandContext } from './types.js'

function parseIds(args: string): number[] | null {
  const parts = args.split(/[\s,]+/).filter(Boolean)
  if (parts.length === 0) return null

  const parsed = parts.map((part) => Number(part))
  if (parsed.some((value) => !Number.isInteger(value) || value <= 0)) return null

  return parsed
}

function needChat(ctx: CommandContext): boolean {
  if (ctx.chat) return true
  ctx.system('no chat is open — use /chats to pick one', 'warn')
  return false
}

function targetMessage(ctx: CommandContext, args: string): CommandContext['replyTo'] {
  const trimmed = args.trim().split(/\s+/)[0]

  if (!trimmed) return ctx.lastMessage()

  const id = Number(trimmed)
  if (!Number.isInteger(id) || id <= 0) return null

  return ctx.messageById(id)
}

export const commands: readonly Command[] = [
  {
    name: 'help',
    aliases: ['?'],
    description: "show telepi and this chat's bot commands, filterable",
    group: 'app',
    run: (ctx) => ctx.openOverlay('help'),
  },
  {
    name: 'chats',
    aliases: ['chatlist', 'ls'],
    args: '[filter]',
    description: 'pick a chat from your dialog list',
    group: 'chat',
    run: (ctx, args) => {
      ctx.openOverlay('chats', args)
    },
  },
  {
    name: 'open',
    aliases: ['go'],
    args: '<@user|id|link>',
    description: 'open a chat by username, id or link',
    group: 'chat',
    run: async (ctx, args) => {
      if (!args) {
        ctx.system('usage: /open <@username|id|t.me/link>', 'warn')
        return
      }
      await ctx.openChat(args)
    },
  },
  {
    name: 'bot',
    aliases: ['bothelp'],
    args: '[command] [args]',
    description: "list this chat's bot commands, or run one with /bot <command>",
    group: 'chat',
    run: async (ctx, args) => {
      const chat = ctx.chat
      if (!chat) {
        ctx.system('no chat is open — use /chats to pick one', 'warn')
        return
      }

      const forward = args.trim()
      if (forward) {
        const match = /^\/?([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(forward)
        if (!match) {
          ctx.system('usage: /bot <command> [args]', 'warn')
          return
        }

        await ctx.sendBotCommand(match[1]!, match[2])
        return
      }

      const label = chat.username ? `@${chat.username}` : chat.title

      const commands =
        ctx.botCommands.length === 0 && (chat.isBot || chat.isGroup)
          ? await ctx.reloadBotCommands()
          : ctx.botCommands

      if (commands.length === 0) {
        ctx.system(
          chat.isBot
            ? `${label} publishes no commands — try /start`
            : `no bot commands in ${label}`,
          'info',
        )
        return
      }

      const localNames = new Set(
        ctx.commands.flatMap((command) => [command.name, ...(command.aliases ?? [])]),
      )

      const lines = commands.map((bot) => {
        const form = chat.isBot
          ? localNames.has(bot.command)
            ? `//${bot.command}`
            : `/${bot.command}`
          : bot.botUsername
            ? `/${bot.command}@${bot.botUsername}`
            : `/${bot.command}`

        return `${form} — ${bot.description || 'no description'}`
      })

      ctx.system(
        `${commands.length} bot command${commands.length === 1 ? '' : 's'} in ${label}\n${lines.join('\n')}`,
        'info',
      )
    },
  },
  {
    name: 'close',
    description: 'close the current chat',
    group: 'chat',
    run: (ctx) => ctx.closeChat(),
  },
  {
    name: 'older',
    description: 'load older messages into a scrollable pager',
    group: 'chat',
    run: async (ctx) => {
      if (!needChat(ctx)) return
      await ctx.loadOlder()
    },
  },
  {
    name: 'search',
    args: '[all] <query>',
    description: 'search this chat, or all chats with “all”',
    group: 'messages',
    run: async (ctx, args) => {
      const all = /^all\s+/i.test(args)
      const query = all ? args.replace(/^all\s+/i, '').trim() : args.trim()

      if (!query) {
        ctx.system('usage: /search [all] <query>', 'warn')
        return
      }
      if (!all && !needChat(ctx)) return

      const hits = await ctx.search(query, all)
      ctx.showSearch(query, all, hits)
    },
  },
  {
    name: 'reply',
    args: '[id]',
    description: 'reply to a message (defaults to the last one)',
    group: 'messages',
    run: (ctx, args) => {
      if (!needChat(ctx)) return

      const view = targetMessage(ctx, args)
      if (!view) {
        ctx.system('no such message in this chat', 'error')
        return
      }

      ctx.setReply(view)
      const preview = truncate(view.text || view.media.join(' '), 70)
      ctx.system(`replying to #${view.id}${preview ? ` · ${preview}` : ''}`, 'ok')
    },
  },
  {
    name: 'edit',
    args: '<id> <text>',
    description: 'edit one of your messages',
    group: 'messages',
    run: async (ctx, args) => {
      if (!needChat(ctx)) return

      const match = /^(\d+)\s+([\s\S]+)$/.exec(args.trim())
      if (!match) {
        ctx.system('usage: /edit <id> <new text>', 'warn')
        return
      }

      await ctx.edit(Number(match[1]), match[2]!)
      ctx.system(`edited #${match[1]}`, 'ok')
    },
  },
  {
    name: 'delete',
    aliases: ['del', 'rm'],
    args: '<id...>',
    description: 'delete messages by id',
    group: 'messages',
    run: async (ctx, args) => {
      if (!needChat(ctx)) return

      const parsed = parseIds(args)
      if (!parsed) {
        ctx.system('usage: /delete <id> [id...]', 'warn')
        return
      }

      await ctx.remove(parsed)
      ctx.system(`deleted ${parsed.map((id) => `#${id}`).join(', ')}`, 'ok')
    },
  },
  {
    name: 'copy',
    args: '[id]',
    description: 'copy a message to the clipboard',
    group: 'messages',
    run: async (ctx, args) => {
      if (!needChat(ctx)) return

      const view = targetMessage(ctx, args)
      if (!view) {
        ctx.system('no such message in this chat', 'error')
        return
      }

      const text = [view.text, ...view.media].filter(Boolean).join('\n')
      if (!text) {
        ctx.system('that message has nothing to copy', 'warn')
        return
      }

      const ok = await ctx.copy(text)
      ctx.system(ok ? `copied #${view.id}` : 'could not reach the clipboard', ok ? 'ok' : 'error')
    },
  },
  {
    name: 'save',
    aliases: ['download'],
    args: '[id|last] [path]',
    description: 'save an attachment (defaults to the latest one)',
    group: 'messages',
    run: async (ctx, args) => {
      if (!needChat(ctx)) return

      const text = args.trim()
      let id: number
      let path: string | undefined

      if (text === '' || /^last(?:\s|$)/i.test(text)) {
        const last = ctx.lastMediaMessage()
        if (!last) {
          ctx.system('no attachments in the loaded feed', 'warn')
          return
        }

        id = last.id
        path = text.replace(/^last\b/i, '').trim() || undefined
      } else {
        const match = /^(\d+)(?:\s+([\s\S]*))?$/.exec(text)
        if (!match) {
          ctx.system('usage: /save [id|last] [path]', 'warn')
          return
        }

        id = Number(match[1])
        path = match[2]
      }

      const saved = await ctx.download(id, path)
      ctx.system(`saved to ${saved}`, 'ok')
    },
  },
  {
    name: 'view',
    aliases: ['preview', 'reveal'],
    args: '[id|last]',
    description: 'save an attachment and open it',
    group: 'messages',
    run: async (ctx, args) => {
      if (!needChat(ctx)) return

      const text = args.trim()
      let id: number

      if (text === '' || /^last$/i.test(text)) {
        const last = ctx.lastMediaMessage()
        if (!last) {
          ctx.system('no attachments in the loaded feed', 'warn')
          return
        }
        id = last.id
      } else if (/^\d+$/.test(text)) {
        id = Number(text)
      } else {
        ctx.system('usage: /view [id|last]', 'warn')
        return
      }

      const file = await ctx.view(id)
      ctx.system(`opened ${file}`, 'ok')
    },
  },
  {
    name: 'jump',
    aliases: ['goto', 'show'],
    args: '<id>',
    description: 'load a message and its context into the feed',
    group: 'messages',
    run: async (ctx, args) => {
      if (!needChat(ctx)) return

      const id = Number(args.trim())
      if (!Number.isInteger(id) || id <= 0) {
        ctx.system('usage: /jump <id>', 'warn')
        return
      }

      await ctx.jump(id)
    },
  },
  {
    name: 'attach',
    aliases: ['file', 'upload'],
    args: '<path> [caption]',
    description: 'send a photo, video or file from disk',
    group: 'messages',
    run: async (ctx, args) => {
      if (!needChat(ctx)) return

      const parsed = parseAttachmentArgs(args)
      if (!parsed) {
        ctx.system('usage: /attach <path> [caption]', 'warn')
        return
      }

      await ctx.sendFile(parsed.path, parsed.caption)
    },
  },
  {
    name: 'login',
    description: 'show the signed-in account and how to switch',
    group: 'account',
    run: (ctx) => {
      const me = ctx.me
      ctx.system(
        `signed in as ${me.displayName}${me.username ? ` (@${me.username})` : ''}\n` +
          'use /logout to switch accounts, or restart with telepi --login',
        'info',
      )
    },
  },
  {
    name: 'unread',
    description: 'list chats with unread messages',
    group: 'messages',
    run: async (ctx) => {
      const chats = await unreadChats(ctx.tg)

      if (chats.length === 0) {
        ctx.system('no unread messages — inbox zero', 'ok')
        return
      }

      const lines = chats.map((chat) => {
        const last = chat.lastMessage
        return `${String(chat.unread).padStart(3)} · ${chat.title}${last ? ` — ${truncate(last, 60)}` : ''}`
      })

      ctx.system(
        `${chats.length} unread chat${chats.length === 1 ? '' : 's'}\n${lines.join('\n')}`,
        'info',
      )
    },
  },
  {
    name: 'me',
    aliases: ['whoami'],
    description: 'show account details',
    group: 'account',
    run: (ctx) => {
      const me = ctx.me
      const lines = [
        `${me.displayName}${me.username ? ` · @${me.username}` : ''}`,
        `id ${me.id}${me.phoneNumber ? ` · ${me.phoneNumber}` : ''}`,
      ]
      ctx.system(lines.join('\n'), 'info')
    },
  },
  {
    name: 'notify',
    args: '[off|bell|macos]',
    description: 'notification mode for other chats',
    group: 'app',
    run: async (ctx, args) => {
      const mode = args.trim().toLowerCase()
      if (!mode) {
        ctx.system(`notifications: ${ctx.notifications} — use /notify off|bell|macos`, 'info')
        return
      }

      if (mode !== 'off' && mode !== 'bell' && mode !== 'macos') {
        ctx.system('usage: /notify off|bell|macos', 'warn')
        return
      }

      ctx.setNotify(mode)
      await ctx.saveConfig({ notifications: mode })
      ctx.system(`notifications set to ${mode}`, 'ok')
    },
  },
  {
    name: 'theme',
    args: '[auto|dark|light|mono]',
    description: 'change colours',
    group: 'app',
    run: async (ctx, args) => {
      const mode = args.trim().toLowerCase()
      if (!mode) {
        ctx.system(`theme: ${ctx.theme} — use /theme auto|dark|light|mono`, 'info')
        return
      }

      if (mode !== 'auto' && mode !== 'dark' && mode !== 'light' && mode !== 'mono') {
        ctx.system('usage: /theme auto|dark|light|mono', 'warn')
        return
      }

      ctx.setTheme(mode)
      await ctx.saveConfig({ theme: mode })
      ctx.system(`theme set to ${mode}`, 'ok')
    },
  },
  {
    name: 'ids',
    args: '[on|off]',
    description: 'show message ids in the feed',
    group: 'app',
    run: async (ctx, args) => {
      const mode = args.trim().toLowerCase()

      let next = !ctx.showIds
      if (mode === 'on') next = true
      else if (mode === 'off') next = false
      else if (mode !== '') {
        ctx.system('usage: /ids [on|off]', 'warn')
        return
      }

      await ctx.setShowIds(next)
      ctx.system(`message ids ${next ? 'shown for new messages' : 'hidden'}`, 'ok')
    },
  },
  {
    name: 'clear',
    description: 'clear the screen and message feed',
    group: 'app',
    run: (ctx) => ctx.clear(),
  },
  {
    name: 'logout',
    description: 'sign out (asks twice)',
    group: 'account',
    run: async (ctx) => {
      await ctx.logout()
    },
  },
  {
    name: 'quit',
    aliases: ['exit', 'q'],
    description: 'leave telepi',
    group: 'app',
    run: (ctx) => ctx.quit(),
  },
]
