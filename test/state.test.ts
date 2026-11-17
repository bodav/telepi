import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HISTORY_LIMIT,
  emptyState,
  flushStateSync,
  loadState,
  pendingState,
  rememberDraft,
  rememberHistory,
  rememberState,
  saveState,
  stateFile,
} from '../src/core/state.js'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'telepi-state-test-'))
  process.env.TELEPI_CONFIG_DIR = dir
  rememberState(emptyState())
})

afterEach(async () => {
  delete process.env.TELEPI_CONFIG_DIR
  await rm(dir, { recursive: true, force: true })
})

describe('state', () => {
  it('returns empty state when the file does not exist', async () => {
    expect(await loadState()).toEqual({ drafts: {}, history: [] })
  })

  it('round-trips through disk with 0600 permissions', async () => {
    await saveState({ drafts: { '42': 'hello' }, history: ['one', 'two'] })

    expect(await loadState()).toEqual({ drafts: { '42': 'hello' }, history: ['one', 'two'] })

    const file = await stat(stateFile())
    expect(file.mode & 0o777).toBe(0o600)
  })

  it('truncates history to the limit on save and load', async () => {
    const history = Array.from({ length: HISTORY_LIMIT + 20 }, (_, index) => `line ${index}`)
    await saveState({ drafts: {}, history })

    const loaded = await loadState()
    expect(loaded.history).toHaveLength(HISTORY_LIMIT)
    expect(loaded.history.at(-1)).toBe(`line ${HISTORY_LIMIT + 19}`)
  })

  it('falls back to empty state on invalid json', async () => {
    await saveState(emptyState())
    await writeFile(stateFile(), '{ nope', 'utf8')

    expect(await loadState()).toEqual({ drafts: {}, history: [] })
  })

  it('remembers drafts and history for the exit handler', () => {
    rememberDraft(7, 'draft text')
    rememberDraft(8, '')
    rememberHistory(['a', 'b'])

    expect(pendingState()).toEqual({ drafts: { '7': 'draft text' }, history: ['a', 'b'] })

    rememberDraft(7, '')
    expect(pendingState().drafts).toEqual({})
  })

  it('flushes the remembered state synchronously', async () => {
    rememberDraft(9, 'unsent')
    rememberHistory(['sent'])
    flushStateSync()

    expect(await loadState()).toEqual({ drafts: { '9': 'unsent' }, history: ['sent'] })
  })

  it('writes readable json', async () => {
    await saveState({ drafts: { '1': 'x' }, history: [] })
    const raw = await readFile(stateFile(), 'utf8')
    expect(raw).toContain('"1": "x"')
  })
})
