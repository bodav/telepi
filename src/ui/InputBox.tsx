import React, { useMemo, useRef } from 'react'
import { Box, Text, useInput, usePaste, type Key } from 'ink'
import { graphemes } from '../core/text.js'
import { lineEnd, lineStart, moveVertical, spliceChars, wordEnd, wordStart } from './input-edit.js'

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
 * (backslash+enter or alt+enter), safe paste and shell-style history recall.
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
    const insertText = text.replace(/\r\n?/g, '\n')
    const next = spliceChars(values, position, position, insertText)
    setValue(next.value, next.cursor)
  }

  const erase = (from: number, to: number): void => {
    const next = spliceChars(values, from, to)
    setValue(next.value, next.cursor)
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

      const word = key.ctrl || key.meta

      if (key.leftArrow) {
        onChange(value, word ? wordStart(values, position) : Math.max(0, position - 1))
        return
      }

      if (key.rightArrow) {
        onChange(value, word ? wordEnd(values, position) : Math.min(max, position + 1))
        return
      }

      if (key.home) {
        onChange(value, lineStart(values, position))
        return
      }

      if (key.end) {
        onChange(value, lineEnd(values, position))
        return
      }

      if (key.upArrow || key.downArrow) {
        if (multiline && value.includes('\n')) {
          const next = moveVertical(values, position, key.upArrow ? -1 : 1)
          if (next !== position) {
            onChange(value, next)
            return
          }
          // At the first or last line there is nowhere to move, so fall through
          // to history recall.
        }
        recall(key.upArrow ? -1 : 1)
        return
      }

      if (key.pageUp || key.pageDown) return

      if (key.return) {
        const continuation = multiline && (key.meta || key.shift)
        const backslash = multiline && position > 0 && values[position - 1] === '\\'

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

      if (key.backspace) {
        if (word) {
          erase(wordStart(values, position), position)
        } else {
          erase(Math.max(0, position - 1), position)
        }
        return
      }

      if (key.delete) {
        if (word) {
          erase(position, wordEnd(values, position))
        } else {
          erase(position, Math.min(max, position + 1))
        }
        return
      }

      if (key.ctrl) {
        // Readline-style editing: escape no longer throws the draft away, so
        // these are the way to clear or chop a line.
        if (input === 'u') {
          erase(lineStart(values, position), position)
          return
        }
        if (input === 'k') {
          erase(position, lineEnd(values, position))
          return
        }
        if (input === 'w') {
          erase(wordStart(values, position), position)
          return
        }
        if (input === 'a') {
          onChange(value, lineStart(values, position))
          return
        }
        if (input === 'e') {
          onChange(value, lineEnd(values, position))
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

  // Bracketed paste keeps a multi-line paste as one atomic edit instead of
  // feeding its newlines to the key handler, which would submit the message.
  usePaste(
    (text) => {
      if (disabled) return
      const cleaned = text.replace(/\r\n?/g, '\n')
      if (cleaned) insert(cleaned)
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
