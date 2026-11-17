import { useEffect } from 'react'
import { setTerminalTitle } from '../core/title.js'

/**
 * Keep the terminal window title in sync with `title` while mounted. On
 * unmount the title is cleared so the shell's own prompt takes over again.
 */
export function useTerminalTitle(title: string, fallback = 'telepi'): void {
  useEffect(() => {
    setTerminalTitle(title)
  }, [title])

  // Restore the fallback only when the component goes away, not on every
  // title change, so the title never flickers back while the app runs.
  useEffect(() => {
    return () => setTerminalTitle(fallback)
  }, [fallback])
}
