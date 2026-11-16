import type { SentCode, TelegramClient, User } from '@mtcute/node'
import { SentCode as SentCodeClass } from '@mtcute/node'
import { isAuthError, isRpcError, describeError } from '../core/errors.js'

export type SessionCheck =
  | { state: 'authorized'; user: User }
  | { state: 'unauthorized' }
  | { state: 'error'; message: string }

export async function checkSession(tg: TelegramClient): Promise<SessionCheck> {
  try {
    return { state: 'authorized', user: await tg.getMe() }
  } catch (error) {
    if (isAuthError(error)) return { state: 'unauthorized' }
    return { state: 'error', message: describeError(error) }
  }
}

export interface QrHandlers {
  onUrl: (url: string, expires: Date) => void
  onScanned: () => void
  getPassword: () => Promise<string>
  onInvalidPassword: () => void | Promise<void>
  signal: AbortSignal
}

/** Run Telegram's QR login flow (link a desktop device). */
export async function signInWithQr(tg: TelegramClient, handlers: QrHandlers): Promise<User> {
  const user = await tg.signInQr({
    onUrlUpdated: handlers.onUrl,
    onQrScanned: handlers.onScanned,
    password: handlers.getPassword,
    invalidPasswordCallback: handlers.onInvalidPassword,
    abortSignal: handlers.signal,
  })

  await tg.startUpdatesLoop()
  return user
}

export interface SentLoginCode {
  kind: 'code'
  phone: string
  code: SentCode
}

export type LoginStep = SentLoginCode | { kind: 'authorized'; user: User }

/** Ask Telegram for a login code. */
export async function requestLoginCode(tg: TelegramClient, phone: string): Promise<LoginStep> {
  const result = await tg.sendCode({ phone })

  if (result instanceof SentCodeClass) {
    return { kind: 'code', phone, code: result }
  }

  await tg.startUpdatesLoop()
  return { kind: 'authorized', user: result }
}

export type SignInStep = { kind: 'authorized'; user: User } | { kind: 'password' }

/** Finish phone login with the received code. */
export async function submitLoginCode(
  tg: TelegramClient,
  phone: string,
  code: SentCode,
  phoneCode: string,
): Promise<SignInStep> {
  try {
    const user = await tg.signIn({
      phone,
      phoneCodeHash: code.phoneCodeHash,
      phoneCode,
    })
    await tg.startUpdatesLoop()
    return { kind: 'authorized', user }
  } catch (error) {
    if (isRpcError(error, 'SESSION_PASSWORD_NEEDED')) return { kind: 'password' }
    throw error
  }
}

export async function submitPassword(tg: TelegramClient, password: string): Promise<User> {
  const user = await tg.checkPassword(password)
  await tg.startUpdatesLoop()
  return user
}

export async function resendLoginCode(
  tg: TelegramClient,
  phone: string,
  code: SentCode,
): Promise<SentCode> {
  return tg.resendCode({ phone, phoneCodeHash: code.phoneCodeHash })
}

export async function logout(tg: TelegramClient): Promise<void> {
  await tg.stopUpdatesLoop().catch(() => {})
  await tg.logOut().catch(() => {})
}

export function sessionUsername(user: User): string {
  return user.username ? `@${user.username}` : String(user.id)
}

export function sessionTitle(user: User): string {
  return user.displayName || 'Telegram user'
}
