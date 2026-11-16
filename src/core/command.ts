export interface ParsedCommand {
  name: string
  args: string
  raw: string
}

/** Parse `/cmd rest of the line` without touching the arguments. */
export function parseCommand(input: string, prefix = '/'): ParsedCommand | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith(prefix)) return null

  const body = trimmed.slice(prefix.length)
  const match = /^([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(body)
  if (!match) return null

  return {
    name: match[1]!.toLowerCase(),
    args: (match[2] ?? '').trim(),
    raw: trimmed,
  }
}

/** Split arguments on whitespace, keeping quoted runs together. */
export function splitArgs(input: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null

  while ((match = re.exec(input)) !== null) {
    out.push(match[1] ?? match[2] ?? match[3] ?? '')
  }

  return out
}
