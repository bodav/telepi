import React from 'react'
import { Box, Text } from 'ink'
import type { ChatListItem } from '../telegram/chats.js'
import type { ChatEventView } from '../telegram/message.js'
import type { PaletteItem } from '../commands/types.js'
import { formatClock } from '../core/time.js'
import { padEndWidth, truncate } from '../core/text.js'
import type { Theme } from './theme.js'
import { MessageRow } from './MessageRow.js'

export type OverlayState =
  | { kind: 'chats'; query: string; index: number; items: ChatListItem[]; loading: boolean }
  | { kind: 'help'; query: string; index: number; items: PaletteItem[] }
  | { kind: 'history'; items: ChatEventView[]; index: number; hasMore: boolean; visible: number }

export interface OverlayProps {
  overlay: OverlayState
  theme: Theme
  columns: number
  rows: number
}

function frame(children: React.ReactNode, theme: Theme): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginTop={1}
    >
      {children}
    </Box>
  )
}

function dialogTime(date: Date | null): string {
  if (!date) return ''
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (sameDay) return formatClock(date)
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function ChatsOverlay({
  overlay,
  theme,
  columns,
  rows,
}: {
  overlay: Extract<OverlayState, { kind: 'chats' }>
  theme: Theme
  columns: number
  rows: number
}): React.JSX.Element {
  const titleWidth = Math.min(28, Math.max(14, Math.floor(columns * 0.35)))
  const timeWidth = 7
  const previewWidth = Math.max(10, columns - titleWidth - timeWidth - 12)

  const visibleLimit = Math.max(3, rows - 12)
  const start = Math.max(
    0,
    Math.min(
      overlay.index - Math.floor(visibleLimit / 2),
      Math.max(0, overlay.items.length - visibleLimit),
    ),
  )
  const visibleItems = overlay.items.slice(start, start + visibleLimit)
  const hiddenAbove = start
  const hiddenBelow = Math.max(0, overlay.items.length - start - visibleItems.length)

  return frame(
    <>
      <Text>
        <Text bold color={theme.accent}>
          chats
        </Text>
        <Text dimColor>
          {truncate(
            `${overlay.loading ? ' · loading…' : ` · ${overlay.items.length}`}${
              overlay.query ? ` · filter “${overlay.query}”` : ''
            }`,
            columns - 10,
          )}
        </Text>
      </Text>

      {overlay.items.length === 0 && <Text dimColor>{overlay.loading ? 'fetching dialogs' : 'no chats matched'}</Text>}

      {hiddenAbove > 0 && <Text dimColor>↑ {hiddenAbove} more</Text>}

      {visibleItems.map((item, offset) => {
        const index = start + offset
        const selected = index === overlay.index
        return (
          <Box key={`${item.id}:${index}`}>
            <Text color={selected ? theme.accent : undefined}>{selected ? '❯ ' : '  '}</Text>
            <Text dimColor>{item.muted ? 'm ' : item.unread > 0 ? `${String(item.unread).padStart(2)} ` : '   '}</Text>
            <Text bold={selected}>{padEndWidth(item.title, titleWidth)}</Text>
            <Text dimColor> {padEndWidth(item.lastMessage, previewWidth)}</Text>
            <Text dimColor> {dialogTime(item.date).padStart(timeWidth)}</Text>
          </Box>
        )
      })}

      {hiddenBelow > 0 && <Text dimColor>↓ {hiddenBelow} more</Text>}
      <Text dimColor>{truncate('enter open · ↑↓ move · esc close', columns - 4)}</Text>
    </>,
    theme,
  )
}

function HelpOverlay({
  overlay,
  theme,
  columns,
  rows,
}: {
  overlay: Extract<OverlayState, { kind: 'help' }>
  theme: Theme
  columns: number
  rows: number
}): React.JSX.Element {
  const items = overlay.items
  const index = Math.min(overlay.index, Math.max(0, items.length - 1))
  const nameWidth = Math.min(30, Math.max(16, Math.floor(columns * 0.36)))
  const botCount = items.filter((item) => item.source === 'bot').length

  const visibleLimit = Math.max(3, rows - 12)
  const start = Math.max(
    0,
    Math.min(index - Math.floor(visibleLimit / 2), Math.max(0, items.length - visibleLimit)),
  )
  const visibleItems = items.slice(start, start + visibleLimit)
  const hiddenAbove = start
  const hiddenBelow = Math.max(0, items.length - start - visibleItems.length)

  return frame(
    <>
      <Text>
        <Text bold color={theme.accent}>
          commands
        </Text>
        <Text dimColor>
          {truncate(
            ` · ${items.length}${botCount > 0 ? ` · ${botCount} from bots` : ''}${
              overlay.query ? ` · filter “${overlay.query}”` : ''
            }`,
            columns - 13,
          )}
        </Text>
      </Text>

      {hiddenAbove > 0 && <Text dimColor>↑ {hiddenAbove} more</Text>}

      {visibleItems.map((item, offset) => {
        const i = start + offset
        const selected = i === index
        const description =
          item.source === 'bot'
            ? `${item.description}${item.botName ? ` · @${item.botName}` : ' · bot'}`
            : item.description
        return (
          <Box key={item.key}>
            <Text color={selected ? theme.accent : undefined}>{selected ? '❯ ' : '  '}</Text>
            <Text bold={selected}>{padEndWidth(item.label, nameWidth)}</Text>
            <Text dimColor> {truncate(description, Math.max(12, columns - nameWidth - 8))}</Text>
          </Box>
        )
      })}

      {items.length === 0 && <Text dimColor>no command matched</Text>}
      {hiddenBelow > 0 && <Text dimColor>↓ {hiddenBelow} more</Text>}
      <Text dimColor>
        {truncate('enter fill input · ↑↓ move · esc close', columns - 4)}
      </Text>
    </>,
    theme,
  )
}

function HistoryOverlay({
  overlay,
  theme,
  columns,
}: {
  overlay: Extract<OverlayState, { kind: 'history' }>
  theme: Theme
  columns: number
}): React.JSX.Element {
  const start = Math.max(0, Math.min(overlay.index, Math.max(0, overlay.items.length - 1)))
  const slice = overlay.items.slice(start, start + overlay.visible)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1} marginTop={1}>
      <Text>
        <Text bold color={theme.accent}>
          older messages
        </Text>
        <Text dimColor>
          {truncate(
            ` · ${overlay.items.length} loaded${
              overlay.hasMore ? ' · more available' : ' · start of chat'
            }`,
            columns - 18,
          )}
        </Text>
      </Text>

      {start > 0 && <Text dimColor>↑ {start} more above</Text>}

      {slice.map((view) => (
        <MessageRow key={view.key} view={view} theme={theme} compact />
      ))}

      {start + slice.length < overlay.items.length && (
        <Text dimColor>↓ {overlay.items.length - start - slice.length} more below</Text>
      )}

      <Text dimColor>
        {truncate('↑↓ line · PgUp/PgDn page · esc close · /older for another page', columns - 4)}
      </Text>
    </Box>
  )
}

export function Overlay({ overlay, theme, columns, rows }: OverlayProps): React.JSX.Element {
  switch (overlay.kind) {
    case 'chats':
      return <ChatsOverlay overlay={overlay} theme={theme} columns={columns} rows={rows} />
    case 'help':
      return <HelpOverlay overlay={overlay} theme={theme} columns={columns} rows={rows} />
    case 'history':
      return <HistoryOverlay overlay={overlay} theme={theme} columns={columns} />
    default:
      return <Text />
  }
}
