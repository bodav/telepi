import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema, configFile, loadConfig, saveConfig } from '../src/core/config.js'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'telepi-test-'))
  process.env.TELEPI_CONFIG_DIR = dir
})

afterEach(async () => {
  delete process.env.TELEPI_CONFIG_DIR
  await rm(dir, { recursive: true, force: true })
})

describe('config', () => {
  it('applies defaults', () => {
    const parsed = ConfigSchema.parse({})
    expect(parsed.notifications).toBe('bell')
    expect(parsed.theme).toBe('auto')
  })

  it('returns defaults when the file does not exist', async () => {
    const loaded = await loadConfig()
    expect(loaded.config.theme).toBe('auto')
    expect(loaded.warning).toBeUndefined()
  })

  it('round-trips through disk with 0600 permissions', async () => {
    const config = ConfigSchema.parse({ apiId: 12345, apiHash: 'abc', lastChat: '-100' })
    await saveConfig(config)

    const loaded = await loadConfig()
    expect(loaded.config).toEqual(config)

    const file = await stat(configFile())
    expect(file.mode & 0o777).toBe(0o600)
  })

  it('warns about invalid json', async () => {
    await saveConfig(ConfigSchema.parse({}))
    const { writeFile } = await import('node:fs/promises')
    await writeFile(configFile(), '{ nope', 'utf8')

    const loaded = await loadConfig()
    expect(loaded.warning).toBeDefined()
    expect(loaded.config.theme).toBe('auto')
  })

  it('writes readable json', async () => {
    await saveConfig(ConfigSchema.parse({ apiId: 7, apiHash: 'hash' }))
    const raw = await readFile(configFile(), 'utf8')
    expect(raw).toContain('"apiId": 7')
  })
})
