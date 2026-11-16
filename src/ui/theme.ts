import type { ThemeName } from '../core/config.js'

export type Color = string | undefined

export interface Theme {
  name: ThemeName
  mono: boolean
  accent: Color
  me: Color
  other: Color
  dim: Color
  subtle: Color
  border: Color
  error: Color
  ok: Color
  warn: Color
  link: Color
  code: Color
  palette: Color[]
}

const DARK_PALETTE = [
  'cyan',
  'magenta',
  'green',
  'yellow',
  'blue',
  'cyanBright',
  'magentaBright',
  'blueBright',
]

const LIGHT_PALETTE = ['blue', 'magenta', 'green', 'red', 'yellow', 'blueBright', 'cyan', 'magentaBright']

function detectLight(): boolean {
  const colorFgBg = process.env.COLORFGBG
  if (!colorFgBg) return false
  const background = Number(colorFgBg.split(';').pop())
  return Number.isFinite(background) && (background === 7 || background >= 9)
}

export function resolveThemeName(name: ThemeName): ThemeName {
  if (name !== 'auto') return name
  return detectLight() ? 'light' : 'dark'
}

export function createTheme(name: ThemeName): Theme {
  const resolved = resolveThemeName(name)

  if (resolved === 'mono' || process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb') {
    return {
      name: resolved,
      mono: true,
      accent: undefined,
      me: undefined,
      other: undefined,
      dim: undefined,
      subtle: undefined,
      border: undefined,
      error: undefined,
      ok: undefined,
      warn: undefined,
      link: undefined,
      code: undefined,
      palette: [undefined, undefined, undefined, undefined],
    }
  }

  const light = resolved === 'light'

  return {
    name: resolved,
    mono: false,
    accent: light ? 'blue' : 'cyanBright',
    me: light ? 'magenta' : 'magentaBright',
    other: light ? 'blue' : 'green',
    dim: light ? 'gray' : undefined,
    subtle: light ? 'gray' : undefined,
    border: light ? 'gray' : 'gray',
    error: 'red',
    ok: light ? 'green' : 'greenBright',
    warn: 'yellow',
    link: 'blue',
    code: 'yellow',
    palette: light ? LIGHT_PALETTE : DARK_PALETTE,
  }
}

export function peerColor(theme: Theme, id: number | null): Color {
  if (id === null) return theme.other
  const index = Math.abs(id) % theme.palette.length
  return theme.palette[index]
}

export function toneColor(theme: Theme, tone: 'info' | 'ok' | 'error' | 'warn'): Color {
  switch (tone) {
    case 'ok':
      return theme.ok
    case 'error':
      return theme.error
    case 'warn':
      return theme.warn
    default:
      return theme.dim
  }
}
