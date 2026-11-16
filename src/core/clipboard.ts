import { spawn } from 'node:child_process'

interface Candidate {
  command: string
  args: string[]
}

function candidates(): Candidate[] {
  if (process.platform === 'darwin') return [{ command: 'pbcopy', args: [] }]
  if (process.platform === 'win32') return [{ command: 'clip', args: [] }]

  return [
    { command: 'wl-copy', args: [] },
    { command: 'xclip', args: ['-selection', 'clipboard'] },
    { command: 'xsel', args: ['--clipboard', '--input'] },
  ]
}

function run(candidate: Candidate, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(candidate.command, candidate.args, {
        stdio: ['pipe', 'ignore', 'ignore'],
      })

      child.on('error', () => resolve(false))
      child.on('close', (code) => resolve(code === 0))
      child.stdin.on('error', () => resolve(false))
      child.stdin.end(text)
    } catch {
      resolve(false)
    }
  })
}

/** Copy text to the system clipboard, best effort. */
export async function copyToClipboard(text: string): Promise<boolean> {
  for (const candidate of candidates()) {
    if (await run(candidate, text)) return true
  }
  return false
}
