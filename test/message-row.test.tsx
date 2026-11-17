import { renderToString } from 'ink'
import { describe, expect, it } from 'vitest'
import type { MessageView } from '../src/telegram/message.js'
import { MessageRow } from '../src/ui/MessageRow.js'
import { createTheme } from '../src/ui/theme.js'

const theme = createTheme('mono')

const message: MessageView = {
  kind: 'message',
  key: '1:1',
  id: 1,
  chatId: 1,
  senderId: 42,
  senderName: 'you',
  fromMe: true,
  date: new Date('2026-01-01T10:02:00Z'),
  edited: false,
  text: 'hello there',
  entities: [],
  media: [],
  views: null,
  showHeader: true,
}

function render(view: MessageView, compact = false): string {
  return renderToString(<MessageRow view={view} theme={theme} compact={compact} />, { columns: 40 })
}

describe('MessageRow author marker', () => {
  it('uses a heavy left bar for your own messages', () => {
    expect(render(message)).toContain('┃')
  })

  it('uses a thin left bar for messages from other people', () => {
    const other = { ...message, fromMe: false, senderId: 7, senderName: 'Durov' }
    expect(render(other)).toContain('│')
  })

  it('omits the marker in compact mode', () => {
    const output = render(message, true)
    expect(output).not.toContain('┃')
    expect(output).not.toContain('│')
  })
})
