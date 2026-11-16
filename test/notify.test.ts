import { describe, expect, it } from 'vitest'
import { canDesktopNotify } from '../src/core/notify.js'

describe('desktop notifications', () => {
  it('has a notifier on the three desktop platforms', () => {
    expect(canDesktopNotify('linux')).toBe(true)
    expect(canDesktopNotify('darwin')).toBe(true)
    expect(canDesktopNotify('win32')).toBe(true)
  })

  it('reports honestly where there is none', () => {
    expect(canDesktopNotify('freebsd')).toBe(false)
    expect(canDesktopNotify('aix')).toBe(false)
  })
})
