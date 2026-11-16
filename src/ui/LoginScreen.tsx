import React, { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput, useWindowSize } from 'ink'
import encodeQR from 'qr'
import type { SentCode, TelegramClient, User } from '@mtcute/node'
import { describeError } from '../core/errors.js'
import {
  requestLoginCode,
  resendLoginCode,
  signInWithQr,
  submitLoginCode,
  submitPassword,
} from '../telegram/auth.js'
import { InputBox } from './InputBox.js'
import { Logo } from './Logo.js'
import { Spinner } from './Spinner.js'
import type { Theme } from './theme.js'

export interface LoginScreenProps {
  tg: TelegramClient
  theme: Theme
  onSuccess: (user: User) => void
}

type QrState = {
  url: string
  expires: Date
  scanned: boolean
}

type PhoneStep = 'phone' | 'code' | 'password'

export function LoginScreen({ tg, theme, onSuccess }: LoginScreenProps): React.JSX.Element {
  const { columns } = useWindowSize()
  const [mode, setMode] = useState<'qr' | 'phone'>('qr')
  const [attempt, setAttempt] = useState(0)
  const [qr, setQr] = useState<QrState | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const [passwordMode, setPasswordMode] = useState<'none' | 'qr' | 'phone'>('none')
  const [password, setPassword] = useState('')
  const [passwordCursor, setPasswordCursor] = useState(0)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const [phone, setPhone] = useState('')
  const [phoneCursor, setPhoneCursor] = useState(0)
  const [code, setCode] = useState('')
  const [codeCursor, setCodeCursor] = useState(0)
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('phone')
  const [sent, setSent] = useState<SentCode | null>(null)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const deferred = useRef<((value: string) => void) | null>(null)
  const success = useRef(onSuccess)
  success.current = onSuccess

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (mode !== 'qr') return

    let cancelled = false
    const controller = new AbortController()
    setQr(null)
    setQrError(null)
    setPasswordMode('none')

    void (async () => {
      try {
        const user = await signInWithQr(tg, {
          onUrl: (url, expires) => {
            if (cancelled) return
            setQr({ url, expires, scanned: false })
            setQrError(null)
          },
          onScanned: () => {
            if (cancelled) return
            setQr((current) => (current ? { ...current, scanned: true } : current))
          },
          getPassword: () => {
            return new Promise<string>((resolve) => {
              if (cancelled) return
              deferred.current = resolve
              setPasswordMode('qr')
              setPasswordError(null)
              setPassword('')
              setPasswordCursor(0)
            })
          },
          onInvalidPassword: () => {
            setPasswordError('wrong password — try again')
          },
          signal: controller.signal,
        })

        if (cancelled) return
        success.current(user)
      } catch (error) {
        if (cancelled || controller.signal.aborted) return
        setQrError(describeError(error))
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [mode, attempt, tg])

  useInput(
    (input, key) => {
      if (mode !== 'qr' || passwordMode === 'qr' || key.ctrl) return

      if (input === 'p') {
        setMode('phone')
        setPhoneStep('phone')
        setPhoneError(null)
      } else if (input === 'r') {
        setAttempt((value) => value + 1)
      }
    },
    { isActive: mode === 'qr' && passwordMode !== 'qr' },
  )

  const finish = (user: User): void => {
    success.current(user)
  }

  const submitQrPassword = (): void => {
    const value = password
    if (!value) return

    setPassword('')
    setPasswordCursor(0)
    setPasswordMode('none')
    const resolve = deferred.current
    deferred.current = null
    resolve?.(value)
  }

  const submitPhone = async (): Promise<void> => {
    const value = phone.trim()
    if (!value) return

    setBusy(true)
    setPhoneError(null)

    try {
      const step = await requestLoginCode(tg, value)
      if (step.kind === 'authorized') {
        finish(step.user)
        return
      }

      setSent(step.code)
      setCode('')
      setCodeCursor(0)
      setPhoneStep('code')
    } catch (error) {
      setPhoneError(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (): Promise<void> => {
    if (!sent) return

    const value = code.trim()
    if (!value) return

    setBusy(true)
    setPhoneError(null)

    try {
      const step = await submitLoginCode(tg, phone.trim(), sent, value)
      if (step.kind === 'authorized') {
        finish(step.user)
        return
      }

      setPassword('')
      setPasswordCursor(0)
      setPasswordError(null)
      setPasswordMode('phone')
      setPhoneStep('password')
    } catch (error) {
      setPhoneError(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  const submitPhonePassword = async (): Promise<void> => {
    const value = password
    if (!value) return

    setBusy(true)
    setPasswordError(null)

    try {
      finish(await submitPassword(tg, value))
    } catch (error) {
      setPasswordError(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  const resend = async (): Promise<void> => {
    if (!sent || !phone.trim()) return

    setBusy(true)
    setPhoneError(null)

    try {
      setSent(await resendLoginCode(tg, phone.trim(), sent))
      setCode('')
      setCodeCursor(0)
    } catch (error) {
      setPhoneError(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  const header = <Logo theme={theme} compact tagline="sign in" />

  if (mode === 'qr' && passwordMode === 'qr') {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        {header}
        <Box marginTop={1} flexDirection="column">
          <Text bold>two-step verification</Text>
          <Text dimColor>This account is protected by a password.</Text>
        </Box>
        <Box marginTop={1}>
          <InputBox
            value={password}
            cursor={passwordCursor}
            onChange={(value, cursor) => {
              setPassword(value)
              setPasswordCursor(cursor)
            }}
            onSubmit={submitQrPassword}
            placeholder="two-step password"
            mask
            accent={theme.accent}
            border={theme.accent}
            multiline={false}
          />
        </Box>
        <Box marginTop={1}>
          {passwordError ? (
            <Text color={theme.error}>✕ {passwordError}</Text>
          ) : (
            <Text dimColor>enter continue · ctrl+c quit</Text>
          )}
        </Box>
      </Box>
    )
  }

  if (mode === 'qr') {
    const seconds = qr ? Math.max(0, Math.ceil((qr.expires.getTime() - now) / 1000)) : 0

    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        {header}
        <Box marginTop={1} flexDirection="column">
          <Text bold>Link this terminal as a device</Text>
          <Text dimColor>Scan the code with Telegram on your phone.</Text>
        </Box>

        <Box marginY={1}>
          {qr ? <QrCode url={qr.url} columns={columns} theme={theme} /> : (
            <Spinner label="requesting login token…" color={theme.accent} />
          )}
        </Box>

        <Box flexDirection="column">
          <Text>Telegram → Settings → Devices → Link Desktop Device</Text>
          <Text dimColor>
            {qr
              ? qr.scanned
                ? '✓ scanned — confirm the login in your Telegram app'
                : `expires in ${seconds}s · the code refreshes automatically`
              : 'waiting for Telegram…'}
          </Text>
          {qrError && <Text color={theme.error}>✕ {qrError} · press r to retry</Text>}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>p phone code login · r new code · ctrl+c quit</Text>
        </Box>
      </Box>
    )
  }

  const field =
    phoneStep === 'phone'
      ? {
          label: 'phone number',
          hint: 'international format, e.g. +1 555 000 1234',
          value: phone,
          cursor: phoneCursor,
          placeholder: '+1 555 000 1234',
          mask: false,
          onChange: (value: string, cursor: number) => {
            setPhone(value)
            setPhoneCursor(cursor)
          },
          onSubmit: () => void submitPhone(),
        }
      : phoneStep === 'code'
        ? {
            label: 'login code',
            hint: 'sent to your Telegram app · ctrl+r to resend',
            value: code,
            cursor: codeCursor,
            placeholder: '12345',
            mask: false,
            onChange: (value: string, cursor: number) => {
              setCode(value)
              setCodeCursor(cursor)
            },
            onSubmit: () => void submitCode(),
          }
        : {
            label: 'two-step password',
            hint: 'your account has two-step verification enabled',
            value: password,
            cursor: passwordCursor,
            placeholder: 'password',
            mask: true,
            onChange: (value: string, cursor: number) => {
              setPassword(value)
              setPasswordCursor(cursor)
            },
            onSubmit: () => void submitPhonePassword(),
          }

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      {header}
      <Box marginTop={1} flexDirection="column">
        <Text bold>{field.label}</Text>
        <Text dimColor>{field.hint}</Text>
      </Box>

      <Box marginTop={1}>
        <InputBox
          value={field.value}
          cursor={field.cursor}
          onChange={field.onChange}
          onSubmit={field.onSubmit}
          placeholder={field.placeholder}
          mask={field.mask}
          accent={theme.accent}
          border={theme.accent}
          multiline={false}
          disabled={busy}
          onSpecialKey={(key, input) => {
            if (phoneStep === 'code' && key.ctrl && input === 'r') {
              void resend()
              return true
            }
            if (key.escape) {
              if (phoneStep === 'code') {
                setPhoneStep('phone')
                setPhoneError(null)
              } else if (phoneStep === 'phone') {
                setMode('qr')
                setAttempt((value) => value + 1)
              }
              return true
            }
            return false
          }}
        />
      </Box>

      <Box marginTop={1} flexDirection="column">
        {busy ? (
          <Spinner label="talking to Telegram…" color={theme.accent} />
        ) : phoneError || passwordError ? (
          <Text color={theme.error}>✕ {phoneError ?? passwordError}</Text>
        ) : (
          <Text dimColor>
            enter continue
            {phoneStep === 'code' ? ' · ctrl+r resend' : ''}
            {phoneStep !== 'password' ? ' · esc back' : ''} · ctrl+c quit
          </Text>
        )}
      </Box>
    </Box>
  )
}


function QrCode({
  url,
  columns,
  theme,
}: {
  url: string
  columns: number
  theme: Theme
}): React.JSX.Element {
  const text = encodeQR(url, 'ascii', { border: 2 })
  const width = Math.max(...text.split('\n').map((line) => line.length))

  if (width > columns - 2) {
    return (
      <Text color={theme.warn}>
        the QR code needs {width} columns — widen the terminal to scan it
      </Text>
    )
  }

  return <Text>{text}</Text>
}
