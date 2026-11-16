import { describe, expect, it } from 'vitest'
import { openCommand } from '../src/core/open.js'

describe('openCommand', () => {
  it('uses the macOS opener', () => {
    expect(openCommand('/tmp/a.txt', 'darwin')).toEqual({
      command: 'open',
      args: ['/tmp/a.txt'],
    })
  })

  it('uses xdg-open on Linux', () => {
    expect(openCommand('/tmp/a.txt', 'linux')).toEqual({
      command: 'xdg-open',
      args: ['/tmp/a.txt'],
    })
  })

  it('uses start on Windows', () => {
    expect(openCommand('C:\\tmp\\a.txt', 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'C:\\tmp\\a.txt'],
    })
  })
})
