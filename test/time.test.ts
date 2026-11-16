import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatClock,
  formatCount,
  formatDayDivider,
  formatDuration,
  formatRelative,
} from '../src/core/time.js'

describe('formatClock', () => {
  it('pads hours and minutes', () => {
    expect(formatClock(new Date(2026, 10, 16, 9, 5))).toBe('09:05')
    expect(formatClock(new Date(2026, 10, 16, 23, 59))).toBe('23:59')
  })
})

describe('formatDayDivider', () => {
  const now = new Date(2026, 10, 16, 12, 0)

  it('labels today and yesterday', () => {
    expect(formatDayDivider(new Date(2026, 10, 16, 1, 0), now)).toBe('Today')
    expect(formatDayDivider(new Date(2026, 10, 15, 23, 0), now)).toBe('Yesterday')
  })

  it('uses a short date for older messages', () => {
    const label = formatDayDivider(new Date(2026, 10, 1, 12, 0), now)
    expect(label).not.toBe('Today')
    expect(label).not.toBe('Yesterday')
    expect(label).toContain('1')
    expect(label).not.toContain('2026')
  })
})

describe('formatDuration', () => {
  it('renders mm:ss and h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3661)).toBe('1:01:01')
  })
})

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
  })
})

describe('formatRelative', () => {
  const now = Date.UTC(2026, 10, 16, 12, 0, 0)

  it('describes recent deltas', () => {
    expect(formatRelative(new Date(now - 2_000), now)).toBe('just now')
    expect(formatRelative(new Date(now - 5 * 60_000), now)).toBe('5m ago')
    expect(formatRelative(new Date(now - 3 * 3_600_000), now)).toBe('3h ago')
  })
})

describe('formatCount', () => {
  it('abbreviates', () => {
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1500)).toBe('1.5K')
  })
})
