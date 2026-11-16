import { spawn } from 'node:child_process'

/** Terminal bell. */
export function ringBell(): void {
  try {
    process.stdout.write('\x07')
  } catch {
    // ignored
  }
}

function appleScriptString(value: string): string {
  const clean = value.replace(/\s*\n\s*/g, ' ').replace(/["\\]/g, '\\$&')
  return `"${clean.slice(0, 300)}"`
}

/** macOS desktop notification, best effort and non-blocking. */
export function desktopNotify(title: string, body: string): void {
  if (process.platform !== 'darwin') return

  const script = `display notification ${appleScriptString(body)} with title ${appleScriptString(title)}`

  try {
    const child = spawn('osascript', ['-e', script], {
      stdio: 'ignore',
      detached: true,
    })
    child.on('error', () => {})
    child.unref()
  } catch {
    // ignored
  }
}
