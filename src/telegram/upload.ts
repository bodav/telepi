import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import {
  InputMedia,
  type InputMediaDocument,
  type InputMediaPhoto,
  type InputMediaVideo,
} from '@mtcute/node'

export type AttachmentKind = 'photo' | 'video' | 'document'
export type AttachmentMedia = InputMediaPhoto | InputMediaVideo | InputMediaDocument

const PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'])

/** Media type Telegram should use for a local file, based on its extension. */
export function attachmentKind(filename: string): AttachmentKind {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase() ?? ''
  if (PHOTO_EXTENSIONS.has(ext)) return 'photo'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return 'document'
}

export interface AttachmentArgs {
  path: string
  caption: string
}

/**
 * Split `/attach` arguments into a path and an optional caption.
 *
 * The path may be quoted (`"my file.pdf"`) or have escaped spaces
 * (`my\ file.pdf`); anything after it becomes the caption.
 */
export function parseAttachmentArgs(args: string): AttachmentArgs | null {
  const text = args.trim()
  if (!text) return null

  const quote = text[0]
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1)
    if (end === -1) return null

    const target = text.slice(1, end)
    if (!target) return null

    return { path: target, caption: text.slice(end + 1).trim() }
  }

  const match = /^((?:\\.|\S)+)(?:\s+([\s\S]*))?$/.exec(text)
  if (!match) return null

  return {
    path: match[1]!.replace(/\\(.)/g, '$1'),
    caption: (match[2] ?? '').trim(),
  }
}

/** Resolve a user-supplied path, expanding `~` and a `file:` prefix. */
export function expandAttachmentPath(target: string): string {
  let value = target.trim()
  if (value.startsWith('file:')) value = value.slice(5)

  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homedir(), value.slice(2))
  }

  return resolve(value)
}

export interface ResolvedAttachment {
  path: string
  name: string
  size: number
  kind: AttachmentKind
}

/** Validate a local file and work out how Telegram should render it. */
export async function resolveAttachment(target: string): Promise<ResolvedAttachment> {
  const path = expandAttachmentPath(target)

  let info
  try {
    info = await stat(path)
  } catch {
    throw new Error(`no such file: ${target}`)
  }

  if (!info.isFile()) throw new Error(`${target} is not a regular file`)

  return {
    path,
    name: basename(path),
    size: info.size,
    kind: attachmentKind(path),
  }
}

/** Build the mtcute media object for an attachment. */
export function attachmentMedia(file: ResolvedAttachment): AttachmentMedia {
  const location = `file:${file.path}`

  switch (file.kind) {
    case 'photo':
      return InputMedia.photo(location)
    case 'video':
      return InputMedia.video(location)
    default:
      return InputMedia.document(location)
  }
}
