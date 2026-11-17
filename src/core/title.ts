/** OSC 0 sets both the icon name and the window title. */
const OSC_TITLE = '\x1b]0;'
const BEL = '\x07'

/** The escape sequence that sets the terminal window title. */
export function titleSequence(title: string): string {
  const clean = title.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim()
  return `${OSC_TITLE}${clean}${BEL}`
}

/**
 * Set the terminal window title. Does nothing when the stream is not a TTY,
 * so piping output never emits escape sequences.
 */
export function setTerminalTitle(
  title: string,
  stream: NodeJS.WriteStream = process.stdout,
): void {
  if (!stream.isTTY) return

  try {
    stream.write(titleSequence(title))
  } catch {
    // A closed or broken stream must never crash the app.
  }
}

/**
 * Install a title for the lifetime of the app. Returns a function that clears
 * the title, letting the shell's own prompt take over again.
 */
export function installTerminalTitle(
  title: string,
  stream: NodeJS.WriteStream = process.stdout,
): () => void {
  setTerminalTitle(title, stream)
  return () => setTerminalTitle('', stream)
}
