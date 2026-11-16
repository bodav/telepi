import React, { useState } from 'react'
import { Box, Text } from 'ink'
import { SITE_APPS } from '../core/constants.js'
import { InputBox } from './InputBox.js'
import { Logo } from './Logo.js'
import { Spinner } from './Spinner.js'
import type { Theme } from './theme.js'

export interface CredentialsScreenProps {
  theme: Theme
  warning?: string
  initialApiId?: number
  initialApiHash?: string
  onSubmit: (apiId: number, apiHash: string) => Promise<void>
}

export function CredentialsScreen({
  theme,
  warning,
  initialApiId,
  initialApiHash,
  onSubmit,
}: CredentialsScreenProps): React.JSX.Element {
  const [apiId, setApiId] = useState(initialApiId ? String(initialApiId) : '')
  const [apiIdCursor, setApiIdCursor] = useState(initialApiId ? String(initialApiId).length : 0)
  const [apiHash, setApiHash] = useState(initialApiHash ?? '')
  const [apiHashCursor, setApiHashCursor] = useState(initialApiHash?.length ?? 0)
  const [focus, setFocus] = useState<'id' | 'hash'>('id')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const id = Number(apiId.trim())
    const hash = apiHash.trim()

    if (!Number.isInteger(id) || id <= 0) {
      setError('api_id must be a positive number')
      setFocus('id')
      return
    }

    if (hash.length < 16) {
      setError('api_hash looks too short')
      setFocus('hash')
      return
    }

    setError(null)
    setBusy(true)

    try {
      await onSubmit(id, hash)
    } catch (err) {
      setError((err as Error).message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Logo theme={theme} version />

      <Box marginTop={1} flexDirection="column">
        <Text bold>Connect an API application</Text>
        <Text dimColor>
          telepi needs an api_id and api_hash from {SITE_APPS}
        </Text>
        <Text dimColor>Create an app there (any name works), then paste both values.</Text>
      </Box>

      {warning && (
        <Box marginTop={1}>
          <Text color={theme.warn}>! {warning}</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text color={focus === 'id' ? theme.accent : theme.dim}>
          {focus === 'id' ? '❯' : ' '} api_id
        </Text>
        <InputBox
          value={apiId}
          cursor={apiIdCursor}
          onChange={(value, cursor) => {
            setApiId(value.replace(/[^0-9]/g, ''))
            setApiIdCursor(cursor)
          }}
          onSubmit={() => setFocus('hash')}
          placeholder="12345678"
          prompt="  "
          accent={theme.accent}
          border={focus === 'id' ? theme.accent : theme.border}
          multiline={false}
          disabled={focus !== 'id' || busy}
          onSpecialKey={(key) => {
            if (key.tab) {
              setFocus('hash')
              return true
            }
            if (key.return) {
              setFocus('hash')
              return true
            }
            return false
          }}
        />
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={focus === 'hash' ? theme.accent : theme.dim}>
          {focus === 'hash' ? '❯' : ' '} api_hash
        </Text>
        <InputBox
          value={apiHash}
          cursor={apiHashCursor}
          onChange={(value, cursor) => {
            setApiHash(value)
            setApiHashCursor(cursor)
          }}
          onSubmit={() => void submit()}
          placeholder="0123456789abcdef0123456789abcdef"
          prompt="  "
          accent={theme.accent}
          border={focus === 'hash' ? theme.accent : theme.border}
          multiline={false}
          disabled={focus !== 'hash' || busy}
          onSpecialKey={(key) => {
            if (key.tab) {
              setFocus('id')
              return true
            }
            if (key.escape) {
              setFocus('id')
              return true
            }
            return false
          }}
        />
      </Box>

      <Box marginTop={1} flexDirection="column">
        {busy ? (
          <Spinner label="connecting…" color={theme.accent} />
        ) : error ? (
          <Text color={theme.error}>✕ {error}</Text>
        ) : (
          <Text dimColor>enter save & connect · tab switch field · ctrl+c quit</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          credentials are stored in your telepi config with 0600 permissions; env vars
          {' '}
          API_ID / API_HASH take precedence
        </Text>
      </Box>
    </Box>
  )
}
