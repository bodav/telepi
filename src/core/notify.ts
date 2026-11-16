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

function powershellString(value: string): string {
  return `'${value.replace(/\s*\n\s*/g, ' ').replace(/'/g, "''").slice(0, 300)}'`
}

interface Notifier {
  command: string
  args: (title: string, body: string) => string[]
}

/** The platform's notification command, or null where there is none. */
function notifier(platform: NodeJS.Platform): Notifier | null {
  switch (platform) {
    case 'darwin':
      return {
        command: 'osascript',
        args: (title, body) => [
          '-e',
          `display notification ${appleScriptString(body)} with title ${appleScriptString(title)}`,
        ],
      }

    case 'linux':
      return {
        command: 'notify-send',
        args: (title, body) => ['--app-name=telepi', title, body.slice(0, 300)],
      }

    case 'win32':
      return {
        command: 'powershell',
        args: (title, body) => [
          '-NoProfile',
          '-Command',
          `[reflection.assembly]::LoadWithPartialName('System.Windows.Forms') > $null;` +
            `$n = New-Object System.Windows.Forms.NotifyIcon;` +
            `$n.Icon = [System.Drawing.SystemIcons]::Information;` +
            `$n.Visible = $true;` +
            `$n.ShowBalloonTip(5000, ${powershellString(title)}, ${powershellString(body)}, 'Info')`,
        ],
      }

    default:
      return null
  }
}

/** Whether desktop notifications can work on this platform at all. */
export function canDesktopNotify(platform: NodeJS.Platform = process.platform): boolean {
  return notifier(platform) !== null
}

/**
 * Desktop notification, best effort and non-blocking.
 *
 * Returns false when the platform has no notifier (or spawning failed), so the
 * caller can tell the user instead of silently doing nothing.
 */
export function desktopNotify(title: string, body: string): boolean {
  const candidate = notifier(process.platform)
  if (!candidate) return false

  try {
    const child = spawn(candidate.command, candidate.args(title, body), {
      stdio: 'ignore',
      detached: true,
    })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}
