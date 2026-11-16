import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'

export const NotificationsSchema = z.enum(['off', 'bell', 'macos'])
export type Notifications = z.infer<typeof NotificationsSchema>

export const ThemeSchema = z.enum(['auto', 'dark', 'light', 'mono'])
export type ThemeName = z.infer<typeof ThemeSchema>

export const ConfigSchema = z.object({
  apiId: z.number().int().positive().optional(),
  apiHash: z.string().min(1).optional(),
  lastChat: z.string().min(1).optional(),
  notifications: NotificationsSchema.default('bell'),
  theme: ThemeSchema.default('auto'),
})
export type Config = z.infer<typeof ConfigSchema>

export interface LoadedConfig {
  config: Config
  path: string
  warning?: string
}

export function configDir(): string {
  if (process.env.TELEPI_CONFIG_DIR) return process.env.TELEPI_CONFIG_DIR
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'telepi')
}

export function configFile(): string {
  return join(configDir(), 'config.json')
}

export function sessionPath(): string {
  return join(configDir(), 'session', 'account')
}

export function downloadsDir(): string {
  return join(configDir(), 'downloads')
}

export async function ensureDirs(): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 })
  await mkdir(dirname(sessionPath()), { recursive: true, mode: 0o700 })
  await mkdir(downloadsDir(), { recursive: true, mode: 0o700 })
}

export async function loadConfig(): Promise<LoadedConfig> {
  const path = configFile()

  try {
    const raw = await readFile(path, 'utf8')
    const json: unknown = JSON.parse(raw)
    const parsed = ConfigSchema.safeParse(json)

    if (!parsed.success) {
      return {
        config: ConfigSchema.parse({}),
        path,
        warning: `config is invalid (${parsed.error.issues[0]?.message ?? 'unknown error'}); using defaults`,
      }
    }

    return { config: parsed.data, path }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { config: ConfigSchema.parse({}), path }

    return {
      config: ConfigSchema.parse({}),
      path,
      warning: `could not read config: ${(err as Error).message}`,
    }
  }
}

export async function saveConfig(config: Config): Promise<void> {
  const path = configFile()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })

  const tmp = join(dirname(path), `.config-${process.pid}.tmp`)
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, path)
}

export interface Credentials {
  apiId: number
  apiHash: string
}

/** Credentials from the environment, if they are fully provided. */
export function credentialsFromEnv(): Credentials | null {
  const rawId = process.env.TELEPI_API_ID || process.env.API_ID
  const apiHash = process.env.TELEPI_API_HASH || process.env.API_HASH

  if (!rawId || !apiHash) return null

  const apiId = Number(rawId)
  if (!Number.isInteger(apiId) || apiId <= 0) return null

  return { apiId, apiHash }
}

export function credentialsFromConfig(config: Config): Credentials | null {
  if (!config.apiId || !config.apiHash) return null
  return { apiId: config.apiId, apiHash: config.apiHash }
}
