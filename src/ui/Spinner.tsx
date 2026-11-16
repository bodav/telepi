import React, { useEffect, useState } from 'react'
import { Text } from 'ink'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export interface SpinnerProps {
  label?: string
  color?: string
}

export function Spinner({ label, color }: SpinnerProps): React.JSX.Element {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => (value + 1) % FRAMES.length), 90)
    return () => clearInterval(timer)
  }, [])

  return (
    <Text color={color}>
      {FRAMES[frame]}
      {label ? ` ${label}` : ''}
    </Text>
  )
}
