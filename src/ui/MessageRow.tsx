import React from 'react'
import { Box, Text } from 'ink'
import type { ChatEventView } from '../telegram/message.js'
import { formatClock, formatCount } from '../core/time.js'
import { truncate } from '../core/text.js'
import type { Theme } from './theme.js'
import { peerColor } from './theme.js'
import { RichText } from './RichText.js'

export interface MessageRowProps {
  view: ChatEventView
  theme: Theme
  compact?: boolean
}

export function MessageRow({ view, theme, compact = false }: MessageRowProps): React.JSX.Element {
  if (view.kind === 'service') {
    return (
      <Box marginTop={view.showHeader ? 1 : 0} paddingLeft={2}>
        <Text dimColor italic>
          {view.text}
        </Text>
      </Box>
    )
  }

  const color = view.fromMe ? theme.me : peerColor(theme, view.senderId)
  const footer: string[] = []
  if (view.edited) footer.push('edited')
  if (view.views !== null) footer.push(`${formatCount(view.views)} views`)

  return (
    <Box flexDirection="column" marginTop={view.showHeader ? 1 : 0}>
      {view.showHeader && (
        <Box paddingLeft={1}>
          <Text dimColor>{formatClock(view.date)} </Text>
          <Text bold color={color}>
            {view.senderName}
          </Text>
          {view.forwardedFrom && <Text dimColor> › {view.forwardedFrom}</Text>}
        </Box>
      )}

      {view.reply && (
        <Box paddingLeft={2}>
          <Text color={theme.subtle}>│ </Text>
          <Text dimColor>
            {view.reply.author ? `${view.reply.author}: ` : ''}
            {view.reply.snippet || (view.reply.id ? `#${view.reply.id}` : '')}
          </Text>
        </Box>
      )}

      {view.text !== '' && (
        <Box paddingLeft={2}>
          {compact ? (
            <Text>{truncate(view.text, 200)}</Text>
          ) : (
            <RichText text={view.text} entities={view.entities} theme={theme} />
          )}
        </Box>
      )}

      {(compact ? view.media.slice(0, 1) : view.media).map((line, index) => (
        <Box key={index} paddingLeft={2}>
          <Text color={theme.subtle}>{line}</Text>
        </Box>
      ))}

      {footer.length > 0 && (
        <Box paddingLeft={2}>
          <Text dimColor>{footer.join(' · ')}</Text>
        </Box>
      )}
    </Box>
  )
}
