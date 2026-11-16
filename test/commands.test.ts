import { describe, expect, it } from 'vitest'
import { commands } from '../src/commands/index.js'
import { findCommand, rankPalette, suggestItems, usage } from '../src/commands/types.js'
import { resolveInput } from '../src/commands/resolve.js'
import type { BotCommand } from '../src/telegram/bot-commands.js'

const bots: BotCommand[] = [
  { command: 'start', description: 'begin', botId: 1, botUsername: 'some_bot', scope: 'private' },
  { command: 'help', description: 'bot help', botId: 1, botUsername: 'some_bot', scope: 'private' },
]

describe('command registry', () => {
  it('has unique names and aliases', () => {
    const seen = new Set<string>()

    for (const command of commands) {
      expect(seen.has(command.name)).toBe(false)
      seen.add(command.name)

      for (const alias of command.aliases ?? []) {
        expect(seen.has(alias)).toBe(false)
        seen.add(alias)
      }
    }
  })

  it('has a description for every command', () => {
    for (const command of commands) {
      expect(command.description.length).toBeGreaterThan(4)
    }
  })

  it('finds commands by name and alias', () => {
    expect(findCommand(commands, 'open')?.name).toBe('open')
    expect(findCommand(commands, 'ls')?.name).toBe('chats')
    expect(findCommand(commands, 'nope')).toBeUndefined()
  })

  it('formats usage', () => {
    const open = findCommand(commands, 'open')!
    expect(usage(open)).toBe('/open <@user|id|link>')
    expect(usage(open, ':')).toBe(':open <@user|id|link>')
  })
})

describe('suggestItems', () => {
  it('returns nothing for plain text', () => {
    expect(suggestItems({ local: commands, input: 'hello' })).toEqual([])
  })

  it('suggests everything for a bare slash', () => {
    expect(suggestItems({ local: commands, input: '/' }).length).toBeGreaterThan(4)
  })

  it('ranks exact prefixes first', () => {
    const suggestions = suggestItems({ local: commands, input: '/ch' })
    expect(suggestions[0]?.insert).toBe('/chats')

    const chats = suggestions.findIndex((item) => item.insert === '/chats')
    const search = suggestions.findIndex((item) => item.insert === '/search')
    if (search !== -1) expect(chats).toBeLessThan(search)
  })

  it('stops suggesting once arguments are being typed', () => {
    expect(suggestItems({ local: commands, input: '/open durov' })).toEqual([])
  })

  it('finds commands through aliases', () => {
    const suggestions = suggestItems({ local: commands, input: '/who' })
    expect(suggestions[0]?.insert).toBe('/me')
  })

  it('offers bot commands with a usable prefix', () => {
    const suggestions = suggestItems({ local: commands, bots, input: '/' })
    expect(suggestions.find((item) => item.insert === '/start')?.source).toBe('bot')
    // /help is shadowed by telepi, so the bot copy needs the literal escape.
    expect(suggestions.find((item) => item.insert === '//help')?.source).toBe('bot')
    expect(suggestions.find((item) => item.insert === '/help')?.source).toBe('local')
  })

  it('keeps an exactly-typed telepi command first', () => {
    expect(suggestItems({ local: commands, bots, input: '/help' })[0]?.insert).toBe('/help')
    expect(suggestItems({ local: commands, bots, input: '/ls' })[0]?.insert).toBe('/chats')
  })

  it('addresses group bots by username', () => {
    const groupBots = bots.map((bot) => ({ ...bot, scope: 'group' as const }))
    const suggestions = suggestItems({ local: commands, bots: groupBots, input: '/st' })
    expect(suggestions[0]?.insert).toBe('/start@some_bot')
  })

  it('uses the colon namespace for telepi-only completion', () => {
    const suggestions = suggestItems({ local: commands, bots, input: ':he' })
    expect(suggestions[0]?.insert).toBe(':help')
    expect(suggestions.some((item) => item.source === 'bot')).toBe(false)
  })

  it('does not hijack emoticons', () => {
    expect(suggestItems({ local: commands, input: ':D' })).toEqual([])
    expect(suggestItems({ local: commands, input: ':p' })).toEqual([])
  })

  it('offers nothing for the literal escape', () => {
    expect(suggestItems({ local: commands, input: '//help' })).toEqual([])
  })
})

describe('rankPalette', () => {
  it('keeps telepi commands on the slash prefix in help', () => {
    const items = rankPalette(commands, bots, 'help', { limit: 100 })
    expect(items.find((item) => item.source === 'local')?.insert).toBe('/help')
  })

  it('can still find a command by its description', () => {
    const items = rankPalette(commands, [], 'clipboard', { limit: 100 })
    expect(items.some((item) => item.insert === '/copy')).toBe(true)
  })
})

describe('resolveInput', () => {
  it('sends the literal escape with one slash removed', () => {
    expect(resolveInput('//help', commands)).toEqual({ kind: 'send', text: '/help' })
  })

  it('runs telepi commands from the colon namespace', () => {
    const resolved = resolveInput(':help', commands)
    expect(resolved.kind).toBe('local')
    if (resolved.kind === 'local') expect(resolved.command.name).toBe('help')
  })

  it('never sends an unknown colon command', () => {
    expect(resolveInput(':nope', commands)).toEqual({
      kind: 'warn',
      message: 'unknown telepi command :nope — try :help',
    })
  })

  it('leaves emoticons alone', () => {
    expect(resolveInput(':D nice', commands)).toEqual({ kind: 'send', text: ':D nice' })
    expect(resolveInput(':ok', commands)).toEqual({ kind: 'send', text: ':ok' })
  })

  it('runs telepi commands first for slash input', () => {
    const resolved = resolveInput('/ls', commands)
    expect(resolved.kind).toBe('local')
    if (resolved.kind === 'local') expect(resolved.command.name).toBe('chats')
  })

  it('forwards slash commands telepi does not own', () => {
    expect(resolveInput('/start', commands)).toEqual({ kind: 'send', text: '/start' })
  })

  it('always forwards explicit bot mentions', () => {
    expect(resolveInput('/help@some_bot', commands)).toEqual({
      kind: 'send',
      text: '/help@some_bot',
    })
  })

  it('warns about malformed slash input', () => {
    expect(resolveInput('/home/user', commands)).toEqual({
      kind: 'warn',
      message: 'not a command — try /help or :help',
    })
  })

  it('passes plain text through', () => {
    expect(resolveInput('hello there', commands)).toEqual({ kind: 'send', text: 'hello there' })
  })

  it('keeps indentation in the message body', () => {
    expect(resolveInput('    indented', commands)).toEqual({ kind: 'send', text: '    indented' })
    expect(resolveInput('code\n  one\n  two  ', commands)).toEqual({
      kind: 'send',
      text: 'code\n  one\n  two',
    })
  })

  it('still detects prefixes after leading whitespace', () => {
    expect(resolveInput('  /ls', commands).kind).toBe('local')
    expect(resolveInput('  //literal', commands)).toEqual({ kind: 'send', text: '/literal' })
  })
})
