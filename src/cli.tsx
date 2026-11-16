import type { TelegramClient } from '@mtcute/node'
import { LOGO_LINES } from './core/logo.js'

interface Args {
  chat?: string
  login: boolean
  logout: boolean
  verbose: boolean
  noColor: boolean
  help: boolean
  version: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    login: false,
    logout: false,
    verbose: false,
    noColor: false,
    help: false,
    version: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!

    if (arg === '--chat' || arg === '-c') {
      args.chat = argv[++i]
    } else if (arg.startsWith('--chat=')) {
      args.chat = arg.slice('--chat='.length)
    } else if (arg === '--login') {
      args.login = true
    } else if (arg === '--logout') {
      args.logout = true
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true
    } else if (arg === '--no-color') {
      args.noColor = true
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg === '--version' || arg === '-V') {
      args.version = true
    }
  }

  return args
}

const HELP = `${LOGO_LINES.join('\n')}

telepi — a Telegram client for the terminal

Usage
  telepi                    open the last chat (or the chat picker)
  telepi --chat <peer>      open a specific chat
  telepi --login            sign in again from scratch
  telepi --logout           sign out and show the login screen

Options
  -c, --chat <peer>         @username, marked id, t.me link or phone
      --login               force a fresh QR/phone login
      --logout              log out before starting
  -v, --verbose             include stack traces in fatal errors
      --no-color            disable colours
  -V, --version             print version
  -h, --help                print this help

Environment
  API_ID / API_HASH             Telegram API credentials (my.telegram.org/apps)
  TELEPI_API_ID / TELEPI_API_HASH
  TELEPI_CONFIG_DIR             override the config directory

Inside the app, type /help for commands.
`.trimStart()

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    process.stdout.write(HELP)
    return
  }

  if (args.version) {
    process.stdout.write('telepi 0.1.0\n')
    return
  }

  if (!process.stdout.isTTY) {
    process.stderr.write('telepi needs an interactive terminal (TTY)\n')
    process.exitCode = 1
    return
  }

  if (args.noColor) process.env.NO_COLOR = '1'

  const { render } = await import('ink')
  const { App } = await import('./ui/App.js')

  const runtime: { client: TelegramClient | null } = { client: null }
  let instance: ReturnType<typeof render> | undefined

  instance = render(
    <App
      initialChat={args.chat}
      action={args.login ? 'login' : args.logout ? 'logout' : undefined}
      onClient={(tg) => {
        runtime.client = tg
      }}
      onClearScreen={() => {
        instance?.clear()
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H')
      }}
    />,
    { exitOnCtrlC: true },
  )

  try {
    await instance.waitUntilExit()
  } finally {
    if (runtime.client) await runtime.client.destroy().catch(() => {})
  }
}

main().catch((error: unknown) => {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v')
  const message = verbose && error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`telepi: ${message}\n`)
  process.exitCode = 1
})
