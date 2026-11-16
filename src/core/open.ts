import { spawn } from 'node:child_process'

/** The platform opener and its arguments for a local path. */
export function openCommand(path: string, platform: NodeJS.Platform = process.platform): {
  command: string
  args: string[]
} {
  if (platform === 'darwin') return { command: 'open', args: [path] }
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', path] }
  return { command: 'xdg-open', args: [path] }
}

/** Open a file with the operating system's default application. */
export function openPath(path: string): Promise<void> {
  const { command, args } = openCommand(path)

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' })

    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}`))
    })
  })
}
