import stringWidth from 'string-width'

const CSI = '\x1b['
const ERASE_LINE = `${CSI}2K`
const CURSOR_UP_ONE = `${CSI}1A`

export interface ReflowStream extends NodeJS.EventEmitter {
  columns?: number
  rows?: number
  write(chunk: unknown, ...rest: unknown[]): boolean
}

/** How many terminal rows a frame occupies when reflowed to `columns` wide. */
export function measureFrame(chunk: string, columns: number): { lines: number; rows: number } {
  const lines = chunk.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()

  let rows = 0
  for (const line of lines) {
    rows += Math.max(1, Math.ceil(stringWidth(line) / columns))
  }

  return { lines: lines.length, rows }
}

/**
 * How many rows Ink's leading `eraseLines(n)` prefix will move the cursor up.
 * Equals n - 1, because the final erase line sits at the frame's top row.
 */
export function expectedUp(chunk: string): number {
  let index = 0
  let up = 0

  while (chunk.startsWith(ERASE_LINE, index)) {
    index += ERASE_LINE.length
    if (!chunk.startsWith(CURSOR_UP_ONE, index)) break
    index += CURSOR_UP_ONE.length
    up += 1
  }

  return up
}

/** The terminal width from the TTY itself, ahead of Node's cached `columns`. */
function liveColumns(stdout: ReflowStream): number | undefined {
  const handle = (stdout as { _handle?: { getWindowSize?: (out: number[]) => number } })._handle
  if (!handle || typeof handle.getWindowSize !== 'function') return undefined

  const size = [0, 0]
  const columns = size[0]
  return handle.getWindowSize(size) === 0 && columns !== undefined && columns > 0
    ? columns
    : undefined
}

export interface ResizeReflowFixOptions {
  /** Quiet time after the last resize event before the viewport is reset. */
  settleMs?: number
  /** Forget Ink's previously drawn frame before the viewport is reset. */
  clear?: () => void
  /** Repaint the app after the old frame is scrolled into history. */
  rerender?: () => void
}

/**
 * Work around Ink's stale line count after a terminal reflow.
 *
 * When the terminal narrows, already-rendered lines wrap onto more rows, but Ink
 * erases only the number of rows it originally wrote. The leftover top of the
 * old frame stays on screen and stacks up on every resize. This wrapper holds
 * writes during a resize. Once the drag settles it erases the frame that is
 * actually on screen, forwards any conversation committed meanwhile, scrolls
 * the visible viewport into scrollback, and asks the app to repaint one clean
 * frame at the bottom.
 *
 * Call before `render()` so the first frame and the resize listener are seen.
 */
export function installResizeReflowFix(
  stdout: ReflowStream,
  { settleMs = 300, clear, rerender }: ResizeReflowFixOptions = {},
): () => void {
  const originalWrite = stdout.write
  const hadOwnWrite = Object.prototype.hasOwnProperty.call(stdout, 'write')
  const forward = (chunk: unknown, rest: unknown[]): void => {
    originalWrite.call(stdout, chunk, ...rest)
  }

  let lastFrame: string | undefined
  let frameOnScreen = false
  let resizing = false
  let held: Array<[unknown, unknown[]]> = []
  let settleTimer: ReturnType<typeof setTimeout> | undefined

  const reconcile = (chunk: string): void => {
    if (!frameOnScreen || lastFrame === undefined) return

    const columns = liveColumns(stdout) ?? stdout.columns
    if (!columns) return

    const { rows } = measureFrame(lastFrame, columns)
    const expected = expectedUp(chunk)
    if (rows === expected) return

    // Move to the frame's real top, erase it, then step down to where Ink's
    // own erase prefix expects to start.
    forward(`${CSI}${rows}A${CSI}J${'\n'.repeat(expected)}`, [])
    frameOnScreen = false
  }

  const emit = (chunk: unknown, rest: unknown[]): void => {
    if (typeof chunk !== 'string') {
      forward(chunk, rest)
      return
    }

    const erases = chunk.startsWith(ERASE_LINE)
    if (erases) reconcile(chunk)

    forward(chunk, rest)

    if (chunk.endsWith('\n')) {
      lastFrame = chunk
      frameOnScreen = true
    } else if (erases) {
      frameOnScreen = false
    }
  }

  const settle = (): void => {
    settleTimer = undefined
    resizing = false

    const chunks = held
    held = []

    const columns = liveColumns(stdout) ?? stdout.columns

    // Erase the reflowed frame first, so it cannot leave fragments behind.
    if (frameOnScreen && lastFrame !== undefined && columns) {
      const { rows } = measureFrame(lastFrame, columns)
      forward(`${CSI}${rows}A${CSI}J`, [])
      frameOnScreen = false
    }

    // Keep any conversation committed during the drag; drop live frames and
    // erase-only chunks that belong to the old, no-longer-visible frame.
    for (const [chunk, rest] of chunks) {
      if (typeof chunk !== 'string') {
        forward(chunk, rest)
        continue
      }

      const text: string = chunk
      const live = text.startsWith(ERASE_LINE) && text.endsWith('\n')
      const eraseOnly = text.startsWith(ERASE_LINE) && !text.endsWith('\n')
      if (live || eraseOnly) continue

      forward(chunk, rest)
    }

    // Scroll the settled conversation into the terminal's scrollback, leaving
    // a clean viewport for the new frame. This is more reliable than trying to
    // track every intermediate reflow during a drag.
    clear?.()
    const rows = stdout.rows ?? 24
    forward('\r\n'.repeat(rows), [])

    lastFrame = undefined
    frameOnScreen = false
    rerender?.()
  }

  const beginResizing = (): void => {
    resizing = true
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(settle, settleMs)
  }

  stdout.write = function (this: unknown, chunk: unknown, ...rest: unknown[]): boolean {
    if (!resizing) {
      const live = liveColumns(stdout)
      if (live !== undefined && stdout.columns !== undefined && live !== stdout.columns) {
        beginResizing()
      }
    }

    if (resizing) {
      held.push([chunk, rest])
      return true
    }

    emit(chunk, rest)
    return true
  }

  // Registered before Ink's own resize listener (which is added when render()
  // constructs the instance), so Ink's repaint is held too.
  const onResize = (): void => beginResizing()
  stdout.prependListener('resize', onResize)

  return () => {
    stdout.off('resize', onResize)
    if (settleTimer) clearTimeout(settleTimer)
    resizing = false

    for (const [chunk, rest] of held) forward(chunk, rest)
    held = []

    if (hadOwnWrite) {
      stdout.write = originalWrite
    } else {
      delete (stdout as { write?: unknown }).write
    }
  }
}
