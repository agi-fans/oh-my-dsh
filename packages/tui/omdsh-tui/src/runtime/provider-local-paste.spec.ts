import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { LocalTui } from './provider-local.ts'
import { stripAnsi } from '../chrome/width.ts'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createSubmissionMessage } from '../session/session-controller.ts'
import { applyEvent, initialTranscript, replayEvents } from '../views/event-views.ts'
import * as externalEditor from '../input/external-editor.ts'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const data = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zk5sAAAAASUVORK5CYII=', 'base64'))
const image = (name = 'probe.png') => ({ data, mediaType: 'image/png' as const, name })
class Terminal {
  captured = ''
  input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {} })
  output = { isTTY: true, write: (text: string) => { this.captured += text } }
  width() { return 80 }
  height() { return 24 }
  press(text: string) { this.input.write(text) }
}
const fixture = (paths: ConstructorParameters<typeof LocalTui>[5] = {}) => {
  const term = new Terminal()
  const tui = new LocalTui(term, 'm', false, 'dark', async () => {}, {
    readClipboard: async () => '', readClipboardImage: async () => null, readClipboardFiles: async () => [],
    ...paths,
  })
  tui.applyStoredPrefs({ theme: 'dark', colors: false, pasteProtection: false })
  return { term, tui }
}
it('retains folded Unicode source and normalizes bracketed CRLF', async () => {
  const { term, tui } = fixture()
  const source = Array.from({ length: 14 }, (_, index) => `\t行 ${index} 🐳é`).join('\r\n')
  try {
    const pending = tui.readInput()
    term.press('\x1b[200~' + source + '\x1b[201~')
    await tick()
    term.press('\r')
    const sent = await pending
    expect(sent?.text).toBe(source.replaceAll('\r\n', '\n'))
    expect(stripAnsi(term.captured)).toContain('[Pasted #1: 14 lines]')
  } finally { tui.dispose() }
})
it('normalizes clipboard CRLF before editing and sending', async () => {
  const { term, tui } = fixture({ readClipboard: async () => 'one\r\ntwo\r\n' })
  try {
    const pending = tui.readInput()
    term.press('\x16')
    await tick()
    term.press('\r')
    const sent = await pending
    expect(sent?.text).toBe('one\ntwo\n')
  } finally { tui.dispose() }
})
it('reports a missing image path without taking an unrelated clipboard bitmap', async () => {
  let validated = 0
  const { term, tui } = fixture({ readImagePath: async () => null, readClipboardImage: async () => image('rejected.png') })
  tui.setImageValidator(async () => { validated++; throw new Error('image rejected by admission') })
  try {
    const pending = tui.readInput()
    term.press('\x1b[200~/tmp/missing.png\x1b[201~')
    await tick()
    term.press('safe text\r')
    const sent = await pending
    expect(validated).toBe(0)
    expect(sent?.images).toEqual([])
    expect(stripAnsi(term.captured)).toContain('Could not read image /tmp/missing.png')
  } finally { tui.dispose() }
})
it('cancels an image read when the active session changes', async () => {
  let resolveImage: ((value: ReturnType<typeof image>) => void) | undefined
  const { term, tui } = fixture({ readClipboardImage: () => new Promise(resolve => { resolveImage = resolve }) })
  try {
    tui.setSession({ id: 'original', recent: [] })
    const pending = tui.readInput()
    term.press('\x16')
    tui.setSession({ id: 'different', recent: [] })
    resolveImage!(image('original-session.png'))
    await tick()
    term.press('new-session message\r')
    const sent = await pending
    expect(sent).toMatchObject({ text: 'new-session message', images: [] })
  } finally { tui.dispose() }
})
it('restores the image bytes and marker when deletion is undone', async () => {
  const { term, tui } = fixture({ readClipboardImage: async () => image() })
  try {
    const pending = tui.readInput()
    term.press('\x16')
    await tick()
    term.press('\x7f\x7f\x1f')
    term.press('after undo\r')
    const sent = await pending
    expect(sent?.images).toEqual([{ ...image(), width: 1, height: 1 }])
    expect(sent?.text).toBe('after undo')
  } finally { tui.dispose() }
})
it('keeps literal image labels as text and orders the actual attachment', async () => {
  const literal = 'literal [Image #1, 1x1] should remain text'
  const { term, tui } = fixture({ readClipboardImage: async () => image() })
  try {
    const pending = tui.readInput()
    term.press('\x1b[200~' + literal + '\x1b[201~')
    await tick()
    term.press('\x16')
    await tick()
    term.press('\r')
    const sent = await pending
    expect(sent?.text).toBe(literal)
    expect(sent?.segments).toEqual([{ kind: 'text', text: literal }, { kind: 'image', index: 0 }])
  } finally { tui.dispose() }
})
it('retains readable images and reports missing paths in a mixed batch', async () => {
  const { term, tui } = fixture({ readImagePath: async path => path.includes('good') ? image('good.png') : null, readClipboardImage: async () => image('unrelated.png') })
  try {
    const pending = tui.readInput()
    term.press('\x1b[200~/tmp/good.png\n/tmp/missing.png\x1b[201~')
    await tick()
    term.press('describe\r')
    const sent = await pending
    expect(sent?.images.map(item => item.name)).toEqual(['good.png'])
    expect(stripAnsi(term.captured)).toContain('Could not read image /tmp/missing.png')
  } finally { tui.dispose() }
})
it('prepends failed input without rebinding a newer folded source to a literal label', async () => {
  const { term, tui } = fixture()
  const current = 'newer source\n'.repeat(12)
  const failed = 'older literal [Pasted #1: 13 lines] remains a token'
  try {
    const pending = tui.readInput()
    term.press('\x1b[200~' + current + '\x1b[201~')
    await tick()
    tui.restoreInput({ text: failed, images: [] })
    term.press('\r')
    const sent = await pending
    expect(sent?.text).toBe(failed + '\n' + current)
  } finally { tui.dispose() }
})

it('preserves source indentation and trailing newlines alongside an image', async () => {
  const source = '    first indented line\n' + '\tmore source\n'.repeat(12)
  const { term, tui } = fixture({ readClipboardImage: async () => image() })
  try {
    const pending = tui.readInput()
    term.press('\x1b[200~' + source + '\x1b[201~')
    await tick()
    term.press('\x16')
    await tick()
    term.press('\r')
    const sent = await pending
    const modelText = sent?.segments?.filter(segment => segment.kind === 'text').map(segment => segment.text).join('')
    expect(modelText).toBe(source)
    expect(sent?.text).toBe(source)
    const attachment = { attachmentId: AttachmentId('attachment:paste'), mediaType: 'image/webp' as const,
      name: 'clipboard.webp', width: 1, height: 1, bytes: data.length }
    const message = await createSubmissionMessage(sent!, { saveImages: async inputs => {
      expect(inputs[0]?.data).toEqual(data)
      return [attachment]
    } })
    expect(message.content.filter(part => part.type === 'text').map(part => part.text).join('')).toBe(source)
    expect(message.content.at(-1)).toEqual({ type: 'image', attachment })
    const event = { type: 'user/message' as const, seq: 1, time: 1, data: message }
    const state = applyEvent(initialTranscript(), event)
    expect(state.blocks[0]).toMatchObject({ kind: 'user', text: source + '[Image #1, 1x1]', image: attachment })
    expect(replayEvents([event]).blocks).toEqual(state.blocks)
  } finally { tui.dispose() }
})
it('cancels an image read before a question takes ownership of input', async () => {
  let resolveImage: ((value: ReturnType<typeof image>) => void) | undefined
  const { term, tui } = fixture({ readClipboardImage: () => new Promise(resolve => { resolveImage = resolve }) })
  try {
    term.press('\x16')
    const answer = tui.prompt({ question: 'Type a response', allowCustom: true })
    resolveImage!(image())
    await tick()
    term.press('\r')
    const result = await answer
    expect(result).toBeNull()
  } finally { tui.dispose() }
})

it('discards Enter queued for an image paste when a question replaces the composer', async () => {
  let resolveImage: ((value: ReturnType<typeof image>) => void) | undefined
  const { term, tui } = fixture({ readClipboardImage: () => new Promise(resolve => { resolveImage = resolve }) })
  try {
    term.press('\x16\r')
    const answer = vi.fn()
    const pending = tui.prompt({ question: 'Type a response', allowCustom: true }).then(answer)
    resolveImage!(image())
    await tick()
    expect(answer).not.toHaveBeenCalled()
    term.press('new answer\r')
    await pending
    expect(answer).toHaveBeenCalledWith('new answer')
  } finally { tui.dispose() }
})

it('keeps a newer paste active when a cancelled image read finishes', async () => {
  const readers: ((value: ReturnType<typeof image>) => void)[] = []
  const { term, tui } = fixture({ readClipboardImage: () => new Promise(resolve => { readers.push(resolve) }) })
  try {
    tui.setSession({ id: 'original', recent: [] })
    term.press('\x16')
    tui.setSession({ id: 'new', recent: [] })
    const pending = tui.readInput()
    term.press('\x16\r')
    readers[0]!(image('cancelled.png'))
    await tick()
    readers[1]!(image('current.png'))
    expect((await pending)?.images.map(image => image.name)).toEqual(['current.png'])
  } finally { tui.dispose() }
})

it('cancels a paste while Harness admission is pending', async () => {
  let rejectAdmission: ((error: Error) => void) | undefined
  const { term, tui } = fixture({ readClipboardImage: async () => image() })
  tui.setImageValidator(() => new Promise((_, reject) => { rejectAdmission = reject }))
  try {
    tui.setSession({ id: 'original', recent: [] })
    term.press('\x16')
    await tick()
    tui.setSession({ id: 'new', recent: [] })
    rejectAdmission!(new Error('stale admission failure'))
    await tick()
    const pending = tui.readInput()
    term.press('new draft\r')
    expect(await pending).toMatchObject({ text: 'new draft', images: [] })
    expect(stripAnsi(term.captured)).not.toContain('stale admission failure')
  } finally { tui.dispose() }
})

it('retains valid Finder images when another path throws and applies admission to each candidate', async () => {
  const validate = vi.fn(async () => {})
  const { term, tui } = fixture({ readClipboardFiles: async () => ['/tmp/good.png', '/tmp/missing.png'],
    readImagePath: async path => {
      if (path.includes('missing')) throw new Error('removed')
      return image('good.png')
    } })
  tui.setImageValidator(validate)
  try {
    const pending = tui.readInput()
    term.press('\x16\r')
    expect((await pending)?.images.map(image => image.name)).toEqual(['good.png'])
    expect(validate).toHaveBeenCalledTimes(1)
    expect(stripAnsi(term.captured)).toContain('Could not read image /tmp/missing.png')
  } finally { tui.dispose() }
})

it('keeps image identity across a saved draft containing an identical literal label', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'omdsh-paste-draft-'))
  const literal = 'literal [Image #1, 1x1] stays text'
  const first = fixture({ draftsPath: directory, readClipboardImage: async () => image() })
  try {
    first.tui.setSession({ id: 'saved', recent: [] })
    first.term.press('\x1b[200~' + literal + '\x1b[201~')
    await tick()
    first.term.press('\x16')
    await tick()
    first.tui.dispose()
    const second = fixture({ draftsPath: directory })
    try {
      second.tui.setSession({ id: 'saved', recent: [] })
      const pending = second.tui.readInput()
      second.term.press('\r')
      expect(await pending).toMatchObject({ text: literal, images: [{ name: 'probe.png' }],
        segments: [{ kind: 'text', text: literal }, { kind: 'image', index: 0 }] })
    } finally { second.tui.dispose() }
  } finally { first.tui.dispose(); rmSync(directory, { recursive: true, force: true }) }
})

it('keeps image bytes and expanded source through external editing', async () => {
  const source = '    original source\n'.repeat(12)
  const edit = vi.spyOn(externalEditor, 'editExternally').mockImplementation(text => text + 'tail')
  const { term, tui } = fixture({ readClipboardImage: async () => image() })
  try {
    const pending = tui.readInput()
    term.press('\x1b[200~' + source + '\x1b[201~')
    await tick()
    term.press('\x16')
    await tick()
    term.press('\x18\r')
    const sent = await pending
    expect(sent?.images.map(image => image.name)).toEqual(['probe.png'])
    expect(sent?.text).toBe(source + 'tail')
  } finally { tui.dispose(); edit.mockRestore() }
})

it('keeps composer images while bracketed text answers a question', async () => {
  const readImage = vi.fn(async () => image())
  const { term, tui } = fixture({ readClipboardImage: readImage, readClipboard: async () => 'answer\r\ntext' })
  try {
    term.press('\x16')
    await tick()
    const question = tui.prompt({ question: 'Type a response', allowCustom: true })
    term.press('\x1b[200~answer\r\ntext\x1b[201~\r')
    expect(await question).toBe('answer\ntext')
    expect(readImage).toHaveBeenCalledTimes(1)
    const pending = tui.readInput()
    term.press('\r')
    expect((await pending)?.images.map(image => image.name)).toEqual(['probe.png'])
  } finally { tui.dispose() }
})
