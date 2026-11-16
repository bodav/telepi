import React, { useMemo, useRef } from 'react'
import { Box, Text, useInput, type Key } from 'ink'
import { graphemes } from '../core/text.js'

export interface InputBoxProps {
  value: string
  cursor: number
  onChange: (value: string, cursor: number) => void
  onSubmit: (value: string) => void
  placeholder?: string
  prompt?: string
  accent?: string
  border?: string
  multiline?: boolean
  mask?: boolean
  history?: readonly string[]
  onSpecialKey?: (key: Key, input: string) => boolean
  disabled?: boolean
  focused?: boolean
}

/**
 * Terminal input with grapheme-aware cursor movement, multiline editing
 * (backslash+enter or alt+enter) and shell-style history recall.
 */
export function InputBox({
  value,
  cursor,
  onChange,
  onSubmit,
  placeholder,
  prompt = '❯',
  accent,
  border,
  multiline = true,
  mask = false,
  history = [],
  onSpecialKey,
  disabled = false,
  focused = true,
}: InputBoxProps): React.JSX.Element {
  const historyIndex = useRef<number | null>(null)
  const draft = useRef('')

  const values = useMemo(() => graphemes(value), [value])
  const chars = useMemo(
    () => (mask ? values.map(() => '•') : values),
    [values, mask],
  )

  const max = values.length
  const position = Math.max(0, Math.min(cursor, max))

  const setValue = (next: string, nextCursor: number): void => {
    historyIndex.current = null
    onChange(next, Math.max(0, Math.min(nextCursor, graphemes(next).length)))
  }

  const insert = (text: string): void => {
    const before = values.slice(0, position).join('')
    const after = values.slice(position).join('')
    const insertText = text.replace(/\r\n?/g, '\n')
    setValue(before + insertText + after, position + graphemes(insertText).length)
  }

  const backspace = (): void => {
    if (position === 0) return
    const before = values.slice(0, position - 1).join('')
    const after = values.slice(position).join('')
    setValue(before + after, position - 1)
  }

  const del = (): void => {
    if (position >= max) return
    const before = values.slice(0, position).join('')
    const after = values.slice(position + 1).join('')
    setValue(before + after, position)
  }

  const recall = (direction: -1 | 1): void => {
    if (history.length === 0) return

    if (historyIndex.current === null) {
      if (direction === 1) return
      draft.current = value
      historyIndex.current = history.length - 1
    } else {
      const next = historyIndex.current + direction

      if (next < 0) {
        historyIndex.current = 0
      } else if (next >= history.length) {
        historyIndex.current = null
        onChange(draft.current, graphemes(draft.current).length)
        return
      } else {
        historyIndex.current = next
      }
    }

    const text = history[historyIndex.current] ?? ''
    onChange(text, graphemes(text).length)
  }

  useInput(
    (input, key) => {
      if (disabled) return
      if (onSpecialKey?.(key, input)) return

      if (key.leftArrow) {
        onChange(value, Math.max(0, position - 1))
        return
      }

      if (key.rightArrow) {
        onChange(value, Math.min(max, position + 1))
        return
      }

      if (key.home) {
        onChange(value, 0)
        return
      }

      if (key.end) {
        onChange(value, max)
        return
      }

      if (key.upArrow || key.downArrow) {
        if (multiline && value.includes('\n')) return
        recall(key.upArrow ? -1 : 1)
        return
      }

      if (key.pageUp || key.pageDown) return

      if (key.return) {
        const continuation = multiline && (key.meta || key.shift)
        const backslash = multiline && position > 0 && chars[position - 1] === '\\'

        if (backslash) {
          const before = values.slice(0, position - 1).join('')
          const after = values.slice(position).join('')
          setValue(`${before}\n${after}`, position)
          return
        }

        if (continuation) {
          insert('\n')
          return
        }

        onSubmit(value)
        return
      }

      if (key.tab) {
        insert('  ')
        return
      }

      if (key.backspace || key.delete) {
        if (key.backspace) backspace()
        else del()
        return
      }

      if (key.ctrl) {
        // Readline-style editing: escape no longer throws the draft away, so
        // these are the way to clear or chop a line.
        if (input === 'u') {
          onChange('', 0)
          return
        }
        if (input === 'k') {
          onChange(values.slice(0, position).join(''), position)
          return
        }
        if (input === 'w') {
          const before = values.slice(0, position)
          let cut = before.length
          while (cut > 0 && /\s/.test(before[cut - 1]!)) cut--
          while (cut > 0 && !/\s/.test(before[cut - 1]!)) cut--
          const next = [...before.slice(0, cut), ...values.slice(position)].join('')
          onChange(next, cut)
          return
        }
        if (input === 'a') {
          onChange(value, 0)
          return
        }
        if (input === 'e') {
          onChange(value, max)
          return
        }
        return
      }

      if (input) {
        // Ignore terminal control sequences that are not text.
        const cleaned = input.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
        if (cleaned) insert(cleaned)
      }
    },
    { isActive: !disabled },
  )

  const before = chars.slice(0, position).join('')
  const current = chars[position]
  const after = chars.slice(position + 1).join('')
  const showPlaceholder = value === '' && Boolean(placeholder)

  return (
    <Box
      borderStyle="round"
      borderColor={border}
      paddingX={1}
      width="100%"
      flexDirection="column"
    >
      <Text wrap="wrap">
        <Text color={accent}>{prompt} </Text>
        <Text>{before}</Text>
        <Text inverse>{current && current !== '\n' ? current : ' '}</Text>
        {current === '\n' ? '\n' : null}
        <Text>{after}</Text>
        {showPlaceholder && <Text dimColor>{placeholder}</Text>}
      </Text>
      {!focused && <Text dimColor>(paused)</Text>}
    </Box>
  )
}
