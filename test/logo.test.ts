import { describe, expect, it } from 'vitest'
import { LOGO_LINES, LOGO_WIDTH } from '../src/core/logo.js'

describe('pixel logo', () => {
  it('renders five rows of equal width', () => {
    expect(LOGO_LINES).toHaveLength(5)
    expect(LOGO_WIDTH).toBeGreaterThan(0)

    for (const line of LOGO_LINES) {
      expect(line).toHaveLength(LOGO_WIDTH)
    }
  })

  it('uses only full blocks and spaces', () => {
    for (const line of LOGO_LINES) {
      expect(line).toMatch(/^[█ ]+$/)
    }
  })
})
