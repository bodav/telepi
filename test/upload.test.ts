import { mkdtemp, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  attachmentKind,
  attachmentMedia,
  expandAttachmentPath,
  parseAttachmentArgs,
  resolveAttachment,
} from '../src/telegram/upload.js'

describe('parseAttachmentArgs', () => {
  it('splits a plain path and caption', () => {
    expect(parseAttachmentArgs('/tmp/photo.jpg hello there')).toEqual({
      path: '/tmp/photo.jpg',
      caption: 'hello there',
    })
  })

  it('returns a path without caption', () => {
    expect(parseAttachmentArgs('/tmp/photo.jpg')).toEqual({
      path: '/tmp/photo.jpg',
      caption: '',
    })
  })

  it('keeps quoted paths together', () => {
    expect(parseAttachmentArgs('"/tmp/my file.pdf" look at this')).toEqual({
      path: '/tmp/my file.pdf',
      caption: 'look at this',
    })
  })

  it('single-quotes work too', () => {
    expect(parseAttachmentArgs("'/tmp/my file.pdf'")).toEqual({
      path: '/tmp/my file.pdf',
      caption: '',
    })
  })

  it('unescapes spaces in a bare path', () => {
    expect(parseAttachmentArgs('/tmp/my\\ file.pdf caption')).toEqual({
      path: '/tmp/my file.pdf',
      caption: 'caption',
    })
  })

  it('rejects empty or unterminated input', () => {
    expect(parseAttachmentArgs('')).toBeNull()
    expect(parseAttachmentArgs('   ')).toBeNull()
    expect(parseAttachmentArgs('"/tmp/unterminated')).toBeNull()
  })
})

describe('expandAttachmentPath', () => {
  it('resolves relative paths from the working directory', () => {
    expect(expandAttachmentPath('photo.jpg')).toBe(join(process.cwd(), 'photo.jpg'))
  })

  it('expands a home directory prefix', () => {
    expect(expandAttachmentPath('~/Pictures/a.png')).toBe(join(homedir(), 'Pictures/a.png'))
  })

  it('strips a file: prefix', () => {
    expect(expandAttachmentPath('file:/tmp/a.txt')).toBe('/tmp/a.txt')
  })
})

describe('attachmentKind', () => {
  it('detects photos and videos by extension', () => {
    expect(attachmentKind('a.JPG')).toBe('photo')
    expect(attachmentKind('a.png')).toBe('photo')
    expect(attachmentKind('clip.MOV')).toBe('video')
    expect(attachmentKind('archive.zip')).toBe('document')
    expect(attachmentKind('README')).toBe('document')
  })
})

describe('resolveAttachment', () => {
  it('stats a real file and picks its media type', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'telepi-upload-'))
    const path = join(dir, 'note.txt')
    await writeFile(path, 'hello')

    const file = await resolveAttachment(path)
    expect(file).toMatchObject({ path, name: 'note.txt', size: 5, kind: 'document' })
  })

  it('rejects missing files and directories', async () => {
    await expect(resolveAttachment('/definitely/missing/telepi.txt')).rejects.toThrow('no such file')

    const dir = await mkdtemp(join(tmpdir(), 'telepi-upload-'))
    await expect(resolveAttachment(dir)).rejects.toThrow('not a regular file')
  })
})

describe('attachmentMedia', () => {
  it('builds the matching input media', () => {
    const base = { path: '/tmp/a', name: 'a', size: 1 }

    expect(attachmentMedia({ ...base, kind: 'photo' }).type).toBe('photo')
    expect(attachmentMedia({ ...base, kind: 'video' }).type).toBe('video')
    expect(attachmentMedia({ ...base, kind: 'document' }).type).toBe('document')
  })
})
