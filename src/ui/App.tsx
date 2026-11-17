import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, useApp } from 'ink'
import type { TelegramClient, User } from '@mtcute/node'
import type { Config } from '../core/config.js'
import {
  credentialsFromConfig,
  credentialsFromEnv,
  loadConfig,
  saveConfig as persistConfig,
} from '../core/config.js'
import { describeError } from '../core/errors.js'
import { onResizeReset } from '../core/resize-events.js'
import { checkSession, logout } from '../telegram/auth.js'
import { createTelegramClient } from '../telegram/client.js'
import { ChatScreen } from './ChatScreen.js'
import { CredentialsScreen } from './CredentialsScreen.js'
import { LoginScreen } from './LoginScreen.js'
import { Logo } from './Logo.js'
import { Spinner } from './Spinner.js'
import { createTheme } from './theme.js'

export interface AppProps {
  initialChat?: string
  action?: 'login' | 'logout'
  onClient?: (client: TelegramClient | null) => void
  onClearScreen: () => void
}

type Phase = 'boot' | 'creds' | 'login' | 'chat' | 'fatal'

export function App({ initialChat, action, onClient, onClearScreen }: AppProps): React.JSX.Element {
  const { exit } = useApp()
  const [phase, setPhase] = useState<Phase>('boot')
  const [config, setConfig] = useState<Config | null>(null)
  const [warning, setWarning] = useState<string | undefined>(undefined)
  const [client, setClient] = useState<TelegramClient | null>(null)
  const [me, setMe] = useState<User | null>(null)
  const [fatal, setFatal] = useState<string>('')
  const [bootLabel, setBootLabel] = useState('starting…')
  const [, setResizeEpoch] = useState(0)

  const configRef = useRef<Config | null>(null)
  const clientRef = useRef<TelegramClient | null>(null)

  const patchConfig = useCallback(async (patch: Partial<Config>): Promise<void> => {
    const base = configRef.current
    if (!base) return

    const next = { ...base, ...patch }
    configRef.current = next
    setConfig(next)
    await persistConfig(next)
  }, [])

  const keepClient = useCallback(
    (tg: TelegramClient | null) => {
      clientRef.current = tg
      setClient(tg)
      onClient?.(tg)
    },
    [onClient],
  )

  const bootstrap = useCallback(
    async (credentials: { apiId: number; apiHash: string }): Promise<void> => {
      setBootLabel('connecting to Telegram…')
      setPhase('boot')
      setFatal('')

      try {
        const tg = await createTelegramClient(credentials)
        keepClient(tg)

        if (action === 'login' || action === 'logout') {
          await logout(tg)
        }

        const session = await checkSession(tg)

        if (session.state === 'error') {
          setFatal(session.message)
          setPhase('fatal')
          return
        }

        if (session.state === 'authorized' && action !== 'login' && action !== 'logout') {
          setMe(session.user)
          await tg.startUpdatesLoop()
          setPhase('chat')
          return
        }

        setPhase('login')
      } catch (error) {
        setFatal(describeError(error))
        setPhase('fatal')
      }
    },
    [action, keepClient],
  )

  useEffect(() => {
    return onResizeReset(() => setResizeEpoch((value) => value + 1))
  }, [])

  useEffect(() => {
    void (async () => {
      const loaded = await loadConfig()
      configRef.current = loaded.config
      setConfig(loaded.config)
      setWarning(loaded.warning)

      const credentials = credentialsFromEnv() ?? credentialsFromConfig(loaded.config)

      if (!credentials) {
        setPhase('creds')
        return
      }

      await bootstrap(credentials)
    })()
  }, [bootstrap])

  const handleCredentials = async (apiId: number, apiHash: string): Promise<void> => {
    await patchConfig({ apiId, apiHash })
    await bootstrap({ apiId, apiHash })
  }

  const handleLogin = (user: User): void => {
    setMe(user)
    setPhase('chat')
  }

  const handleLogout = async (): Promise<void> => {
    const tg = clientRef.current
    if (!tg) return

    await logout(tg)
    setMe(null)
    setPhase('login')
  }

  const handleQuit = async (): Promise<void> => {
    const tg = clientRef.current
    if (tg) await tg.destroy().catch(() => {})
    keepClient(null)
    exit()
  }

  const theme = createTheme(config?.theme ?? 'auto')

  if (phase === 'fatal') {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color="red">
          something went wrong
        </Text>
        <Box marginTop={1}>
          <Text>{fatal}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>ctrl+c to quit</Text>
        </Box>
      </Box>
    )
  }

  if (phase === 'boot' || !config) {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Logo theme={theme} version />
        <Box marginTop={1}>
          <Spinner label={bootLabel} color={theme.accent} />
        </Box>
      </Box>
    )
  }

  if (phase === 'creds') {
    return (
      <CredentialsScreen
        theme={theme}
        warning={warning}
        initialApiId={config.apiId}
        initialApiHash={config.apiHash}
        onSubmit={handleCredentials}
      />
    )
  }

  if (phase === 'login' && client) {
    return <LoginScreen tg={client} theme={theme} onSuccess={handleLogin} />
  }

  if (phase === 'chat' && client && me) {
    return (
      <ChatScreen
        tg={client}
        me={me}
        theme={theme}
        config={config}
        saveConfig={patchConfig}
        initialChat={initialChat}
        onLogout={handleLogout}
        onQuit={handleQuit}
        onClearScreen={onClearScreen}
      />
    )
  }

  return (
    <Box paddingX={1} marginTop={1}>
      <Spinner label="starting…" color={theme.accent} />
    </Box>
  )
}
