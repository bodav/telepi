import React from 'react'
import { Box, Text } from 'ink'
import type { PaletteItem } from '../commands/types.js'
import { padEndWidth, truncate } from '../core/text.js'
import type { Theme } from './theme.js'

export interface CommandMenuProps {
  items: readonly PaletteItem[]
  index: number
  theme: Theme
  columns: number
}

export function CommandMenu({
  items,
  index,
  theme,
  columns,
}: CommandMenuProps): React.JSX.Element | null {
  if (items.length === 0) return null

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginTop={1}
    >
      {items.map((item, i) => {
        const selected = i === index
        const nameWidth = Math.min(36, Math.max(16, Math.floor(columns * 0.4)))
        const description =
          item.source === 'bot'
            ? `${item.description}${item.botName ? ` · @${item.botName}` : ' · bot'}`
            : item.description

        return (
          <Box key={item.key}>
            <Text color={selected ? theme.accent : undefined}>{selected ? '❯ ' : '  '}</Text>
            <Text bold={selected}>{padEndWidth(item.label, nameWidth)}</Text>
            <Text dimColor>{truncate(description, Math.max(10, columns - nameWidth - 6))}</Text>
          </Box>
        )
      })}
      <Text dimColor>{truncate('tab complete · enter run/send · esc dismiss', columns - 4)}</Text>
    </Box>
  )
}
