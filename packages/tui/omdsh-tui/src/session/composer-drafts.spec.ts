import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { InputEditor } from '../input/editor.ts'
import { fileMarker } from '../input/composer-files.ts'
import { imageMarker } from '../input/image-paste.ts'
import { ComposerDraftStore, type ComposerDraft } from './composer-drafts.ts'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function fixture(): ComposerDraftStore {
  const directory = mkdtempSync(join(tmpdir(), 'omdsh-drafts-'))
  directories.push(directory)
  return new ComposerDraftStore(directory)
}
function draft(text = '你好 🐳'): ComposerDraft {
  return { editor: { text, cursor: text.length, pastes: [] }, images: [], files: { entries: [], next: 0 }, literal: false }
}

describe('ComposerDraftStore', () => {
  it('round-trips folded paste ownership, file references, image bytes and literal input', () => {
    const store = fixture()
    const editor = new InputEditor()
    const source = '/clear\n' + '你好 🐳\n'.repeat(20)
    editor.paste(source)
    const image = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' as const, name: '截图.png', width: 1, height: 1 }
    const file = { attachmentId: AttachmentId('durable-ref'), name: 'file 中文.txt', bytes: 12 }
    const marker = fileMarker(file, 3)
    editor.handle({ type: 'text', value: ' ' + imageMarker(0, image) + ' ' + marker })
    editor.setCursor(0)
    const original: ComposerDraft = { editor: editor.snapshot(), images: [image], files: { entries: [{ file, marker }], next: 3 }, literal: true }
    store.save('session-a', original)
    const recovered = new ComposerDraftStore(dirname(dirname(store.path('session-a')))).load('session-a')!
    expect(recovered).toEqual(original)
    const restored = new InputEditor()
    restored.restore(recovered.editor)
    expect(restored.expandedText).toBe(source + ' ' + imageMarker(0, image) + ' ' + marker)
    restored.setCursor(restored.text.length)
    restored.paste('second\n'.repeat(20))
    expect(restored.text).toContain('[Pasted #2:')
    expect(readFileSync(store.path('session-a'), 'utf8')).not.toContain('"data"')
    if (process.platform !== 'win32') {
      expect(statSync(store.path('session-a')).mode & 0o777).toBe(0o600)
      expect(statSync(dirname(store.path('session-a'))).mode & 0o777).toBe(0o700)
    }
  })

  it('isolates sessions and clears an empty draft including its blobs', () => {
    const store = fixture()
    store.save('a', draft('one')); store.save('b', draft('two'))
    expect(store.load('a')?.editor.text).toBe('one')
    store.save('a', draft(''))
    expect(store.load('a')).toBeUndefined()
    expect(existsSync(dirname(store.path('a')))).toBe(false)
    expect(store.load('b')?.editor.text).toBe('two')
  })

  it('hashes opaque identifiers and rejects records for a different session', () => {
    const store = fixture()
    store.save('../outside', draft())
    expect(dirname(store.path('../outside')).split(/[\\/]/u).at(-1)).toMatch(/^[a-f0-9]{64}$/u)
    const path = store.path('../outside')
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    raw.session = 'another'
    writeFileSync(path, JSON.stringify(raw))
    expect(() => store.load('../outside')).toThrow('invalid')
  })

  it.each(['cursor', 'paste', 'file', 'json'])('rejects invalid %s without removing the recovery file', kind => {
    const store = fixture()
    store.save('a', draft())
    const path = store.path('a')
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (kind === 'cursor') raw.editor.cursor = 999
    if (kind === 'paste') raw.editor.pastes = [{ start: 0, end: 1, content: 'secret' }]
    if (kind === 'file') raw.files = { entries: [{ marker: '', file: { name: 'f', attachmentId: 'id', bytes: 1 } }], next: 0 }
    const contents = kind === 'json' ? '{broken' : JSON.stringify(raw)
    writeFileSync(path, contents)
    expect(() => store.load('a')).toThrow('invalid')
    expect(readFileSync(path, 'utf8')).toBe(contents)
  })

  it('rejects missing or damaged image blobs', () => {
    const store = fixture()
    const image = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' as const }
    const value = draft(imageMarker(0, image))
    value.images = [image]
    store.save('a', value)
    const blob = readdirSync(dirname(store.path('a'))).find(name => name.endsWith('.image'))!
    const path = join(dirname(store.path('a')), blob)
    writeFileSync(path, new Uint8Array([7]))
    expect(() => store.load('a')).toThrow('incomplete')
    rmSync(path)
    expect(() => store.load('a')).toThrow()
  })
})
