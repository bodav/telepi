import { parseCommand } from '../core/command.js'
import type { Command } from './types.js'
import { findCommand } from './types.js'

export type ResolvedInput =
  | { kind: 'local'; command: Command; args: string }
  | { kind: 'send'; text: string }
  | { kind: 'warn'; message: string }

/**
 * Decide what a submitted line means.
 *
 * - `//text` always sends `text` verbatim, keeping the leading slash.
 * - `:name` always runs a telepi command (and never reaches the chat); short
 *   names such as `:D` are left alone so emoticons still send.
 * - `/name` runs a telepi command when one matches, and is forwarded to
 *   Telegram otherwise — so bot commands keep working.
 * - `/name@bot` always goes to Telegram, since that form is Telegram's.
 */
export function resolveInput(input: string, local: readonly Command[]): ResolvedInput {
  const text = input.trim()
  if (!text) return { kind: 'send', text: '' }

  if (text.startsWith('//')) return { kind: 'send', text: text.slice(1) }

  if (text.startsWith(':')) {
    const parsed = parseCommand(text, ':')
    if (!parsed) return { kind: 'send', text }

    const command = findCommand(local, parsed.name)
    if (command) return { kind: 'local', command, args: parsed.args }

    // Keep short emoticons like :D or :p as ordinary messages.
    if (parsed.name.length < 3) return { kind: 'send', text }

    return { kind: 'warn', message: `unknown telepi command :${parsed.name} — try :help` }
  }

  if (text.startsWith('/')) {
    if (/^\/\S+@/.test(text)) return { kind: 'send', text }

    const parsed = parseCommand(text)
    if (!parsed) return { kind: 'warn', message: 'not a command — try /help or :help' }

    const command = findCommand(local, parsed.name)
    if (command) return { kind: 'local', command, args: parsed.args }

    return { kind: 'send', text }
  }

  return { kind: 'send', text }
}
