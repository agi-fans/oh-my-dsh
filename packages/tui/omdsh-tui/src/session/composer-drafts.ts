/** Private composer recovery files, separate from Harness logs and attachment storage. */

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { EditorSnapshot } from '../input/editor.ts'
import { fileMarker, type ComposerFiles } from '../input/composer-files.ts'
import { imageMarker } from '../input/image-paste.ts'
import type { TuiInputImage } from '../definition.ts'
import { readJsonFile, writeJsonAtomic } from './json-file.ts'

export interface ComposerDraft {
  editor: EditorSnapshot
  images: readonly TuiInputImage[]
  files: ReturnType<ComposerFiles['snapshot']>
  literal: boolean
}

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function editorSnapshot(value: unknown): EditorSnapshot | undefined {
  if (!object(value) || typeof value.text !== 'string' || !integer(value.cursor) || value.cursor > value.text.length || !Array.isArray(value.pastes)) return undefined
  const pastes: EditorSnapshot['pastes'] = []
  let end = 0
  for (const atom of value.pastes) {
    if (!object(atom) || !integer(atom.start) || !integer(atom.end) || atom.start < end || atom.end <= atom.start || atom.end > value.text.length
      || typeof atom.content !== 'string' || !/^\[Pasted #\d+: \d+ (?:lines|chars)\]$/u.test(value.text.slice(atom.start, atom.end))) return undefined
    pastes.push({ start: atom.start, end: atom.end, content: atom.content }); end = atom.end
  }
  return { text: value.text, cursor: value.cursor, pastes }
}

function fileSnapshot(value: unknown, text: string): ComposerDraft['files'] | undefined {
  if (!object(value) || !integer(value.next) || !Array.isArray(value.entries)) return undefined
  const entries: ComposerDraft['files']['entries'] = []
  for (const item of value.entries) {
    if (!object(item) || typeof item.marker !== 'string' || !object(item.file) || typeof item.file.attachmentId !== 'string'
      || typeof item.file.name !== 'string' || !integer(item.file.bytes) || !text.includes(item.marker)) return undefined
    const file = { attachmentId: item.file.attachmentId, name: item.file.name, bytes: item.file.bytes } as FileAttachmentRef
    const ordinal = Number(/^\[File:(\d+) /u.exec(item.marker)?.[1])
    if (!integer(ordinal) || ordinal === 0 || ordinal > value.next || item.marker !== fileMarker(file, ordinal)) return undefined
    entries.push({ marker: item.marker, file })
  }
  return { next: value.next, entries }
}

export class ComposerDraftStore {
  readonly #imageHashes = new WeakMap<Uint8Array, string>()
  constructor(private readonly root: string) {}

  /** Hash opaque session identifiers so they cannot select arbitrary filesystem paths. */
  path(id: string): string { return join(this.root, digest(id), 'draft.json') }
  #directory(id: string): string { return join(this.root, digest(id)) }

  load(id: string): ComposerDraft | undefined {
    const path = this.path(id)
    if (!existsSync(path)) return undefined
    const raw = readJsonFile(path)
    if (!object(raw) || raw.version !== 1 || raw.session !== id || typeof raw.literal !== 'boolean' || !Array.isArray(raw.images)) throw new Error('Saved composer draft is invalid.')
    const editor = editorSnapshot(raw.editor)
    const files = editor === undefined ? undefined : fileSnapshot(raw.files, editor.text)
    if (editor === undefined || files === undefined) throw new Error('Saved composer draft is invalid.')
    const images: TuiInputImage[] = []
    for (const record of raw.images) {
      if (!object(record) || typeof record.blob !== 'string' || !/^[a-f0-9]{64}$/u.test(record.blob) || typeof record.mediaType !== 'string' || !imageTypes.has(record.mediaType)
        || record.name !== undefined && typeof record.name !== 'string' || record.width !== undefined && (!integer(record.width) || record.width === 0)
        || record.height !== undefined && (!integer(record.height) || record.height === 0)) throw new Error('Saved composer image is invalid.')
      const data = new Uint8Array(readFileSync(join(this.#directory(id), record.blob + '.image')))
      if (digest(data) !== record.blob) throw new Error('Saved composer image is incomplete.')
      this.#imageHashes.set(data, record.blob)
      images.push({ data, mediaType: record.mediaType as TuiInputImage['mediaType'],
        ...(record.name === undefined ? {} : { name: record.name as string }),
        ...(record.width === undefined ? {} : { width: record.width as number }), ...(record.height === undefined ? {} : { height: record.height as number }) })
    }
    if (images.some((image, at) => !editor.text.includes(imageMarker(at, image)))) throw new Error('Saved composer image marker is missing.')
    return { editor, files, images, literal: raw.literal }
  }

  save(id: string, draft: ComposerDraft): void {
    if (draft.editor.text === '' && draft.images.length === 0 && draft.files.entries.length === 0) { this.clear(id); return }
    const directory = this.#directory(id)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const images = draft.images.map(({ data, ...metadata }) => {
      const blob = this.#imageHashes.get(data) ?? digest(data)
      this.#imageHashes.set(data, blob)
      const path = join(directory, blob + '.image')
      if (!existsSync(path)) {
        const temp = `${path}.${process.pid}.${Date.now()}.tmp`
        writeFileSync(temp, data, { mode: 0o600 }); chmodSync(temp, 0o600); renameSync(temp, path)
      }
      return { ...metadata, blob }
    })
    writeJsonAtomic(this.path(id), { version: 1, session: id, editor: draft.editor, images, files: draft.files, literal: draft.literal })
  }

  clear(id: string): void { rmSync(this.#directory(id), { recursive: true, force: true }) }
}
