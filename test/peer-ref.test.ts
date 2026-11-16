import { describe, expect, it } from 'vitest'
import { parsePeerRef } from '../src/core/peer-ref.js'

describe('parsePeerRef', () => {
  it('passes usernames and marked ids through', () => {
    expect(parsePeerRef('@durov')).toEqual({ kind: 'peer', ref: 'durov' })
    expect(parsePeerRef('durov')).toEqual({ kind: 'peer', ref: 'durov' })
    expect(parsePeerRef('12345')).toEqual({ kind: 'peer', ref: 12345 })
    expect(parsePeerRef('-1001234567890')).toEqual({ kind: 'peer', ref: -1001234567890 })
    expect(parsePeerRef('   ')).toEqual({ kind: 'empty' })
  })

  it('keeps the message id from a t.me link', () => {
    expect(parsePeerRef('https://t.me/durov/123')).toEqual({
      kind: 'peer',
      ref: 'durov',
      messageId: 123,
    })
    expect(parsePeerRef('t.me/durov')).toEqual({ kind: 'peer', ref: 'durov' })
    expect(parsePeerRef('https://t.me/durov/123?single')).toEqual({
      kind: 'peer',
      ref: 'durov',
      messageId: 123,
    })
  })

  it('turns channel post links into marked ids', () => {
    // t.me/c addresses the channel by its internal id.
    expect(parsePeerRef('https://t.me/c/1234567890/55')).toEqual({
      kind: 'peer',
      ref: -1001234567890,
      messageId: 55,
    })
    expect(parsePeerRef('https://t.me/c/1234567890')).toEqual({
      kind: 'peer',
      ref: -1001234567890,
    })
  })

  it('reads the web preview form', () => {
    expect(parsePeerRef('https://t.me/s/durov/42')).toEqual({
      kind: 'peer',
      ref: 'durov',
      messageId: 42,
    })
  })

  it('recognises invite hashes instead of treating them as usernames', () => {
    expect(parsePeerRef('https://t.me/+AbCdEf123')).toEqual({
      kind: 'invite',
      hash: 'AbCdEf123',
    })
    expect(parsePeerRef('t.me/joinchat/AbCdEf123')).toEqual({
      kind: 'invite',
      hash: 'AbCdEf123',
    })
  })

  it('understands tg:// deep links', () => {
    expect(parsePeerRef('tg://resolve?domain=durov&post=7')).toEqual({
      kind: 'peer',
      ref: 'durov',
      messageId: 7,
    })
    expect(parsePeerRef('tg://user?id=99')).toEqual({ kind: 'peer', ref: 99 })
    expect(parsePeerRef('tg://openmessage?chat_id=-100123&message_id=4')).toEqual({
      kind: 'peer',
      ref: -100123,
      messageId: 4,
    })
    expect(parsePeerRef('tg://join?invite=xyz')).toEqual({ kind: 'invite', hash: 'xyz' })
  })
})
