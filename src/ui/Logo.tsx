import React from 'react'
import { Box, Text, useWindowSize } from 'ink'
import { VERSION } from '../core/constants.js'
import { LOGO_LINES, LOGO_WIDTH } from '../core/logo.js'
import type { Theme } from './theme.js'

export interface LogoProps {
  theme: Theme
  /** Available terminal columns; defaults to the measured window width. */
  columns?: number
  tagline?: string
  version?: boolean
  /** Force the one-line wordmark, e.g. on dense screens. */
  compact?: boolean
}

/**
 * Pixel wordmark shown on the splash, credentials and empty states.
 * Falls back to a plain one-line wordmark when the terminal is too narrow.
 */
export function Logo({
  theme,
  columns,
  tagline = 'Telegram in your terminal',
  version = false,
  compact = false,
}: LogoProps): React.JSX.Element {
  const { columns: measured } = useWindowSize()
  const width = columns ?? measured
  const suffix = version ? ` · v${VERSION}` : ''

  if (compact || width < LOGO_WIDTH + 4) {
    return (
      <Box>
        <Text bold color={theme.accent}>
          telepi
        </Text>
        <Text dimColor>
          {' · '}
          {tagline}
          {suffix}
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {LOGO_LINES.map((line, index) => (
        <Text key={index} color={theme.accent}>
          {line}
        </Text>
      ))}
      <Text dimColor>
        {'  '}
        {tagline}
        {suffix}
      </Text>
    </Box>
  )
}
