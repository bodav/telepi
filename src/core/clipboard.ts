import { spawn } from 'node:child_process'

interface Candidate {
  command: string
  args: string[]
}

/** Native clipboard tools, tried before the terminal escape sequence. */
function candidates(): Candidate[] {
  if (process.platform === 'darwin') return [{ command: 'pbcopy', args: [] }]
  if (process.platform === 'win32') return [{ command: 'clip', args: [] }]

  return [
    { command: 'wl-copy', args: [] },
    { command: 'xclip', args: ['-selection', 'clipboard'] },
    { command: 'xsel', args: ['--clipboard', '--input'] },
  ]
}

/** Native clipboard tools can hang without a display; never block `/copy`. */
const CLIPBOARD_TIMEOUT_MS = 2000

function run(candidate: Candidate, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(candidate.command, candidate.args, {
        stdio: ['pipe', 'ignore', 'ignore'],
      })

      const timer = setTimeout(() => {
        child.kill()
        resolve(false)
      }, CLIPBOARD_TIMEOUT_MS)

      const finish = (ok: boolean): void => {
        clearTimeout(timer)
        resolve(ok)
      }

      child.on('error', () => finish(false))
      child.on('close', (code) => finish(code === 0))
      child.stdin.on('error', () => finish(false))
      child.stdin.end(text)
    } catch {
      resolve(false)
    }
  })
}

/** Terminals start dropping OSC 52 payloads above roughly this size. */
const OSC52_LIMIT = 100_000

/**
 * The OSC 52 sequence that asks the terminal to put `text` on the clipboard.
 * Inside tmux the sequence must be wrapped in a passthrough escape.
 */
export function osc52Sequence(text: string, env: NodeJS.ProcessEnv = process.env): string {
  const payload = Buffer.from(text, 'utf8').toString('base64')
  const sequence = `\x1b]52;c;${payload}\x07`
  if (!env.TMUX) return sequence

  // tmux passthrough: ESC inside the wrapped sequence must be doubled.
  return `\x1bPtmux;${sequence.replace(/\x1b/g, '\x1b\x1b')}\x1b\\`
}

/**
 * Copy via OSC 52, which works over SSH and in containers where no native
 * clipboard tool exists. Returns false when the stream is not a terminal or the
 * payload is too large for most terminal emulators.
 */
export function writeOsc52(
  text: string,
  stream: NodeJS.WriteStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!stream.isTTY) return false

  const payload = Buffer.from(text, 'utf8').toString('base64')
  if (payload.length > OSC52_LIMIT) return false

  try {
    stream.write(osc52Sequence(text, env))
    return true
  } catch {
    return false
  }
}

/**
 * Copy text to the system clipboard, best effort. Tries the platform's native
 * tool first and falls back to OSC 52. Set `TELEPI_CLIPBOARD=osc52` to skip the
 * native tools and always use the terminal sequence.
 */
export async function copyToClipboard(
  text: string,
  options: { stream?: NodeJS.WriteStream; env?: NodeJS.ProcessEnv } = {},
): Promise<boolean> {
  const env = options.env ?? process.env

  if (env.TELEPI_CLIPBOARD !== 'osc52') {
    for (const candidate of candidates()) {
      if (await run(candidate, text)) return true
    }
  }

  return writeOsc52(text, options.stream ?? process.stdout, env)
}
