import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { LocalTui, type TerminalLike } from './provider-local.ts'
import { copyToClipboard } from '../input/clipboard.ts'
import { ComposerDraftStore } from '../session/composer-drafts.ts'
import { stripAnsi } from '../chrome/width.ts'

class Terminal implements TerminalLike {
  captured = ''
  input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {} })
  output = { isTTY: true, write: (text: string): void => { this.captured += text } }
  width(): number { return 80 }
  height(): number { return 24 }
  press(text: string): void { this.input.write(text) }
}
const instances: LocalTui[] = []
const directories: string[] = []
afterEach(() => {
  for (const tui of instances.splice(0)) tui.dispose()
  vi.useRealTimers(); vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function fixture(): { directory: string; store: ComposerDraftStore; open: (id: string, paths?: ConstructorParameters<typeof LocalTui>[5]) => { tui: LocalTui; term: Terminal } } {
  const directory = mkdtempSync(join(tmpdir(), 'omdsh-draft-tui-'))
  directories.push(directory)
  const store = new ComposerDraftStore(directory)
  return { directory, store, open: (id, paths = {}) => {
    const term = new Terminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { draftsPath: directory, ...paths })
    instances.push(tui)
    tui.setSession({ id, recent: [] })
    return { tui, term }
  } }
}
const switchTo = (tui: LocalTui, id: string): void => { tui.setSession({ id, recent: [] }) }

describe('local composer recovery', () => {
  it('saves each session on switch and resumes its draft at the retained cursor', async () => {
    const f = fixture()
    const { tui, term } = f.open('a')
    term.press('hello'); term.press('\x1b[D')
    switchTo(tui, 'b')
    expect(f.store.load('a')?.editor.cursor).toBe(4)
    term.press('another')
    switchTo(tui, 'a')
    term.press('!')
    switchTo(tui, 'b')
    expect(f.store.load('a')?.editor.text).toBe('hell!o')
    const pending = tui.readline()
    term.press('\r')
    expect(await pending).toBe('another')
    expect(f.store.load('b')).toBeUndefined()
  })

  it('debounces edits without rewriting drafts for transcript updates', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const spy = vi.spyOn(ComposerDraftStore.prototype, 'save')
    const { tui, term } = f.open('a')
    term.press('one'); term.press('two')
    await vi.advanceTimersByTimeAsync(499)
    expect(spy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(spy).toHaveBeenCalledTimes(1)
    tui.notice('update'); switchTo(tui, 'a'); tui.notice('more output')
    await vi.advanceTimersByTimeAsync(1000)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(f.store.load('a')?.editor.text).toBe('onetwo')
  })

  it('flushes pending legacy paste input at shutdown and reloads it', async () => {
    const f = fixture()
    const { tui, term } = f.open('a')
    term.press('unsent content')
    tui.dispose()
    expect(f.store.load('a')?.editor.text).toBe('unsent content')
    const next = f.open('a')
    const pending = next.tui.readline()
    next.term.press('\r')
    expect(await pending).toBe('unsent content')
    expect(f.store.load('a')).toBeUndefined()
  })

  it('restores folded paste source and literal slash semantics after restart', async () => {
    const f = fixture()
    const source = '/clear\n' + '中文 🐳\n'.repeat(15)
    const { tui, term } = f.open('a')
    term.press('\x1b[200~' + source + '\x1b[201~')
    tui.dispose()
    expect(f.store.load('a')?.editor.pastes[0]?.content).toBe(source)
    const next = f.open('a')
    expect(stripAnsi(next.term.captured)).toContain('[Pasted #1:')
    const pending = next.tui.readInput()
    next.term.press('\r')
    expect(await pending).toEqual({ text: source, literal: true, images: [] })
    expect(f.store.load('a')).toBeUndefined()
  })

  it('persists images and file references together with their owned markers', async () => {
    const f = fixture()
    const image = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' as const, name: 'clipboard.png' }
    const file = { attachmentId: AttachmentId('saved-file'), name: '文档.txt', bytes: 42 }
    const { tui, term } = f.open('a', { readClipboardImage: async () => image })
    term.press('\x16')
    await new Promise<void>(resolve => { setImmediate(resolve) })
    tui.stageFileAttachment(file)
    term.press(' describe')
    tui.dispose()
    const saved = f.store.load('a')!
    expect(saved.images).toEqual([image])
    expect(saved.files.entries[0]?.file).toEqual(file)
    const next = f.open('a')
    const pending = next.tui.readInput()
    next.term.press('\r')
    expect(await pending).toEqual({ text: '[Image #1]   describe', images: [image], files: [file] })
  })

  it('keeps prompt answers and secrets out of the composer recovery file', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const { tui, term } = f.open('a')
    term.press('my draft')
    const prompt = tui.prompt({ title: 'Credential', question: 'Enter secret', secret: true })
    term.press('very-private')
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.store.load('a')?.editor.text).toBe('my draft')
    expect(readFileSync(f.store.path('a'), 'utf8')).not.toContain('very-private')
    tui.dispose()
    expect(await prompt).toBe(null)
    expect(f.store.load('a')?.editor.text).toBe('my draft')
  })

  it('preserves the original folded draft when leaving while browsing input history', async () => {
    const f = fixture()
    const { tui, term } = f.open('a')
    const pending = tui.readline()
    term.press('old prompt\r')
    expect(await pending).toBe('old prompt')
    const source = 'draft\n'.repeat(15)
    term.press('\x1b[200~' + source + '\x1b[201~')
    term.press('\x1b[A')
    switchTo(tui, 'b')
    expect(f.store.load('a')?.editor.pastes[0]?.content).toBe(source)
    switchTo(tui, 'a')
    term.press('\x1b[A'); term.press('\x1b[B')
    const next = tui.readline()
    term.press('\r')
    expect(await next).toBe(source)
  })

  it('does not resurrect queued or successfully steered messages', async () => {
    const f = fixture()
    const { tui, term } = f.open('a')
    term.press('queued\r')
    tui.dispose()
    expect(f.store.load('a')).toBeUndefined()
    const next = f.open('a')
    next.tui.setStatus('running')
    const steer = vi.fn()
    next.tui.setSteerHandler(steer)
    next.term.press('steer me'); next.term.press('\x1bs')
    expect(steer).toHaveBeenCalledWith('steer me')
    next.tui.dispose()
    expect(f.store.load('a')).toBeUndefined()
  })

  it('keeps a refused steering draft and clears an explicitly discarded one', () => {
    const f = fixture()
    const { tui, term } = f.open('a')
    tui.setStatus('running')
    tui.setSteerHandler(() => { throw new Error('refused') })
    term.press('still unsent'); term.press('\x1bs')
    tui.dispose()
    expect(f.store.load('a')?.editor.text).toBe('still unsent')
    const next = f.open('a')
    next.term.press('\x03')
    next.tui.dispose()
    expect(f.store.load('a')).toBeUndefined()
  })

  it('isolates inspected child drafts from the parent and ignores same-session metadata refreshes', () => {
    const f = fixture()
    const { tui, term } = f.open('parent')
    term.press('parent draft')
    tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'idle', writable: true })
    term.press('child draft')
    switchTo(tui, 'parent')
    tui.setInspectedSubagent(undefined)
    expect(f.store.load('child')?.editor.text).toBe('child draft')
    tui.dispose()
    expect(f.store.load('parent')?.editor.text).toBe('parent draft')
  })

  it('leaves damaged recovery files intact through prompt round trips until input is edited', async () => {
    const f = fixture()
    const { tui, term } = f.open('a')
    term.press('saved'); tui.dispose()
    writeFileSync(f.store.path('a'), '{broken')
    const next = f.open('a')
    expect(stripAnsi(next.term.captured)).toContain('Could not restore composer draft')
    const prompt = next.tui.prompt({ title: 'Question', question: 'Continue?' })
    next.term.press('answer\r')
    expect(await prompt).toBe('answer')
    next.tui.dispose()
    expect(readFileSync(f.store.path('a'), 'utf8')).toBe('{broken')
  })

  it('keeps input usable and caches the draft if persistence fails', async () => {
    const f = fixture()
    const save = vi.spyOn(ComposerDraftStore.prototype, 'save').mockImplementation(() => { throw new Error('disk full') })
    const { tui, term } = f.open('a')
    term.press('keep this')
    switchTo(tui, 'b')
    expect(stripAnsi(term.captured)).toContain('Could not save composer draft')
    switchTo(tui, 'a')
    save.mockRestore()
    const pending = tui.readline()
    term.press('\r')
    expect(await pending).toBe('keep this')
  })

  it('does not persist pipe input', () => {
    const f = fixture()
    const term = new Terminal()
    term.input.isTTY = false
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { draftsPath: f.directory })
    instances.push(tui)
    switchTo(tui, 'a')
    term.press('piped input')
    tui.dispose()
    expect(existsSync(f.store.path('a'))).toBe(false)
  })
})
