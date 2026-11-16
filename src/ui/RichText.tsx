import React from 'react'
import { Text } from 'ink'
import type { EntityLike } from '../core/rich-text.js'
import { splitEntities } from '../core/rich-text.js'
import type { Theme } from './theme.js'

export interface RichTextProps {
  text: string
  entities?: readonly EntityLike[]
  theme: Theme
}

/** Render Telegram message text with its formatting entities. */
export function RichText({ text, entities, theme }: RichTextProps): React.JSX.Element {
  const segments = splitEntities(text, entities)

  return (
    <Text wrap="wrap">
      {segments.map((segment, index) => {
        const style = segment.style
        const accent =
          style.accent === 'link'
            ? theme.link
            : style.accent
              ? theme.accent
              : undefined

        return (
          <Text
            key={index}
            bold={style.bold}
            italic={style.italic}
            underline={style.underline}
            strikethrough={style.strike}
            dimColor={style.spoiler || style.quote}
            color={style.code ? theme.code : accent}
          >
            {segment.text}
          </Text>
        )
      })}
    </Text>
  )
}
