import React from 'react'
import { Box, Text } from 'ink'
import type { FeedEntry } from '../chat/feed.js'
import { formatClock } from '../core/time.js'
import { truncate } from '../core/text.js'
import type { Theme } from './theme.js'
import { peerColor, toneColor } from './theme.js'
import { MessageRow } from './MessageRow.js'

export interface FeedLineProps {
  entry: FeedEntry
  theme: Theme
  columns: number
  showIds?: boolean
}

const TONE_SYMBOL: Record<string, string> = {
  info: '·',
  ok: '✓',
  warn: '!',
  error: '✕',
}

export function FeedLine({ entry, theme, columns, showIds = false }: FeedLineProps): React.JSX.Element {
  switch (entry.kind) {
    case 'message':
      return <MessageRow view={entry.view} theme={theme} showIds={showIds} />

    case 'day':
      return (
        <Box marginTop={1} paddingLeft={1}>
          <Text color={theme.subtle}>{`── ${entry.label} ──`}</Text>
        </Box>
      )

    case 'rule':
      return (
        <Box marginTop={1} paddingLeft={1}>
          <Text color={theme.subtle}>{entry.label ? `── ${entry.label} ──` : '─'.repeat(Math.min(columns - 2, 60))}</Text>
        </Box>
      )

    case 'system': {
      const color = toneColor(theme, entry.tone)
      return (
        <Box marginTop={1} paddingLeft={1}>
          <Text color={color}>
            {TONE_SYMBOL[entry.tone] ?? '·'} {entry.text}
          </Text>
        </Box>
      )
    }

    case 'banner':
      return (
        <Box flexDirection="column" marginTop={1} marginBottom={1} paddingLeft={1}>
          <Box>
            <Text bold color={theme.accent}>
              {entry.chat.title}
            </Text>
            <Text dimColor>
              {entry.chat.username ? ` · @${entry.chat.username}` : ''} · {entry.chat.kind}
              {entry.unread > 0 ? ` · ${entry.unread} unread` : ''}
            </Text>
          </Box>
          <Text dimColor>type a message below · /help lists commands</Text>
        </Box>
      )

    case 'search': {
      const width = Math.max(24, columns - 26)
      return (
        <Box flexDirection="column" marginTop={1} paddingLeft={1}>
          <Text>
            <Text bold color={theme.accent}>
              {entry.all ? 'Global search' : 'Search'}
            </Text>
            <Text dimColor>
              {' '}
              “{entry.query}” · {entry.hits.length} result{entry.hits.length === 1 ? '' : 's'}
            </Text>
          </Text>

          {entry.hits.map((hit) => (
            <Box key={`${hit.chatId}:${hit.message.id}`}>
              <Text dimColor>{formatClock(hit.message.date)} </Text>
              <Text color={peerColor(theme, hit.message.senderId)}>
                {truncate(hit.chatTitle, 18)}{' '}
              </Text>
              <Text>{truncate(hit.message.text || hit.message.media.join(' '), width)}</Text>
              <Text dimColor> #{hit.message.id}</Text>
            </Box>
          ))}

          {entry.hits.length === 0 && <Text dimColor>nothing matched</Text>}
          {entry.hits.length > 0 && (
            <Text dimColor>
              {entry.all
                ? 'open that chat, then /jump #id · /copy #id · /save #id'
                : 'use /jump #id to open a result · /copy #id · /save #id'}
            </Text>
          )}
        </Box>
      )
    }

    default:
      return <Text />
  }
}
