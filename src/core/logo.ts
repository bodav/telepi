const GLYPHS: Record<string, readonly string[]> = {
  T: ['xxx', '.x.', '.x.', '.x.', '.x.'],
  E: ['xxx', 'x..', 'xxx', 'x..', 'xxx'],
  L: ['x..', 'x..', 'x..', 'x..', 'xxx'],
  P: ['xx.', 'x.x', 'xx.', 'x..', 'x..'],
  I: ['xxx', '.x.', '.x.', '.x.', 'xxx'],
}

const WORD = 'TELEPI'

/**
 * A chunky pixel wordmark, rendered with full blocks doubled horizontally so
 * each pixel looks square in a terminal cell.
 */
function buildLogo(): string[] {
  const rows = Array.from({ length: 5 }, () => '')

  for (const [index, letter] of [...WORD].entries()) {
    const glyph = GLYPHS[letter]
    if (!glyph) throw new Error(`no pixel glyph for ${letter}`)

    for (const [row, pattern] of glyph.entries()) {
      const pixels = pattern.replace(/x/g, '██').replace(/\./g, '  ')
      rows[row] = `${rows[row] ?? ''}${index === 0 ? '' : ' '}${pixels}`
    }
  }

  return rows
}

export const LOGO_LINES: readonly string[] = buildLogo()
export const LOGO_WIDTH = LOGO_LINES[0]?.length ?? 0
