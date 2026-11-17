import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { configDir } from './config.js'

/** How many sent lines are kept for up-arrow recall. */
export const HISTORY_LIMIT = 200

export const ChatStateSchema = z.object({
  /** Unsent text per chat id, so quitting never loses a draft. */
  drafts: z.record(z.string(), z.string()).default({}),
  /** Recently sent lines, newest last. */
  history: z.array(z.string()).default([]),
})
export type ChatState = z.infer<typeof ChatStateSchema>

export function stateFile(): string {
  return join(configDir(), 'state.json')
}

export function emptyState(): ChatState {
  return { drafts: {}, history: [] }
}

export async function loadState(): Promise<ChatState> {
  try {
    const raw = await readFile(stateFile(), 'utf8')
    const parsed = ChatStateSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return emptyState()

    return {
      drafts: parsed.data.drafts,
      history: parsed.data.history.slice(-HISTORY_LIMIT),
    }
  } catch {
    return emptyState()
  }
}

let tmpCounter = 0

function tmpFile(): string {
  tmpCounter += 1
  return join(dirname(stateFile()), `.state-${process.pid}-${tmpCounter}.tmp`)
}

export async function saveState(state: ChatState): Promise<void> {
  const path = stateFile()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })

  const tmp = tmpFile()
  await writeFile(tmp, `${JSON.stringify(normalize(state), null, 2)}\n`, { mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, path)
}

/** Serialize saves so overlapping debounced writes cannot interleave. */
let saveQueue: Promise<void> = Promise.resolve()

export function queueStateSave(state: ChatState): Promise<void> {
  saveQueue = saveQueue.then(() => saveState(state)).catch(() => {})
  return saveQueue
}

function normalize(state: ChatState): ChatState {
  return {
    drafts: { ...state.drafts },
    history: state.history.slice(-HISTORY_LIMIT),
  }
}

/**
 * The state most recently shown in the UI. Kept in a module-level variable so
 * the process exit handler can write it synchronously, even on Ctrl+C where
 * React's async cleanup might not get a chance to finish.
 */
let pending: ChatState = emptyState()

/**
 * Whether anything has been remembered yet. Without this, an early exit (for
 * example a crash during startup) would flush an empty state over a good file.
 */
let known = false

export function rememberDraft(chatId: number | null, text: string): void {
  if (chatId === null) return
  known = true
  const key = String(chatId)
  if (text) pending.drafts[key] = text
  else delete pending.drafts[key]
}

export function rememberHistory(history: readonly string[]): void {
  known = true
  pending.history = history.slice(-HISTORY_LIMIT)
}

/** Replace the remembered state, e.g. after loading it from disk. */
export function rememberState(state: ChatState): void {
  known = true
  pending = normalize(state)
}

/** A copy of the remembered state. */
export function pendingState(): ChatState {
  return normalize(pending)
}

/** Write the remembered state synchronously. Safe from an exit handler. */
export function flushStateSync(): void {
  if (!known) return

  try {
    const path = stateFile()
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })

    const tmp = join(dirname(path), `.state-${process.pid}.tmp`)
    writeFileSync(tmp, `${JSON.stringify(pendingState(), null, 2)}\n`, { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, path)
  } catch {
    // An exit handler cannot report errors; the next run simply starts clean.
  }
}

/** Flush the remembered state when the process exits. */
export function installStateExitHandler(): void {
  process.once('exit', flushStateSync)
}
