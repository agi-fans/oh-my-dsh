import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { LocalTui, type TerminalLike } from './provider-local.ts'
import { copyToClipboard } from '../input/clipboard.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { openMessageQueue } from '../session/message-queue.ts'
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

  it('saves a queue edit in its original session when replacement aborts the editor', async () => {
    const f = fixture()
    const { tui, term } = f.open('a')
    const file = { attachmentId: AttachmentId('file'), name: 'notes.txt', bytes: 12 }
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'accepted' }, { type: 'file', attachment: file }] })
    const agent = { inbox: { nextTurn: [message], nextStep: [] } } as unknown as Agent
    const abort = new AbortController()
    const queue = openMessageQueue({ agent, tui, signal: abort.signal, assertActive: () => {},
      restore: async () => ({ text: 'accepted', images: [], files: [file] }) })
    term.press('\r')
    await new Promise<void>(resolve => setImmediate(resolve))
    term.press(' revised')
    abort.abort(new Error('active session changed'))
    switchTo(tui, 'b')
    await queue
    expect(f.store.load('a')?.editor.text).toContain('accepted revised')
    expect(f.store.load('a')?.files.entries[0]?.file).toEqual(file)
    expect(agent.inbox.nextTurn).toEqual([message])
    term.press('new session')
    const input = tui.readInput()
    term.press('\r')
    expect(await input).toEqual({ text: 'new session', images: [] })
    switchTo(tui, 'a')
    const restored = tui.readInput()
    term.press('\r')
    expect(await restored).toMatchObject({ text: 'accepted revised', files: [file], literal: true })
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
    expect(await pending).toEqual({
      text: 'describe',
      images: [image],
      files: [file],
      segments: [{ kind: 'image', index: 0 }, { kind: 'file', index: 0 }, { kind: 'text', text: 'describe' }],
    })
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

  it('keeps pending recovery separate from the composer draft', async () => {
    const f = fixture()
    const { tui, term } = f.open('a')
    term.press('queued\r')
    tui.dispose()
    expect(f.store.load('a')).toBeUndefined()
    const next = f.open('a')
    next.tui.setStatus('running')
    next.term.press('steer me'); next.term.press('\x1bs')
    expect(await next.tui.readInput()).toMatchObject({ text: 'steer me', delivery: 'steer' })
    next.tui.dispose()
    expect(f.store.load('a')).toBeUndefined()
  })

  it('keeps a failed steering draft and clears an explicitly discarded one', async () => {
    const f = fixture()
    const { tui, term } = f.open('a')
    tui.setStatus('running')
    term.press('still unsent'); term.press('\x1bs')
    tui.restoreInput((await tui.readInput())!)
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
    tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'waiting', writable: true })
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

it.each([true, false])('restores failed child attachments without changing parent input (disk=%s)', async disk => {
  const f = fixture()
  const term = new Terminal()
  const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, disk ? { draftsPath: f.directory } : {})
  instances.push(tui)
  switchTo(tui, 'parent')
  term.press('parent draft')
  const child = { id: 'child', label: 'Child', phase: 'waiting' as const, writable: true }
  tui.setInspectedSubagent(child)
  term.press('newer child draft')
  tui.setInspectedSubagent(undefined)
  const file = { attachmentId: AttachmentId('child-file'), name: 'notes.txt', bytes: 12 }
  const image = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }
  tui.restoreInput({ text: 'failed message', images: [image], files: [file] }, 'child')
  const parent = tui.readInput()
  term.press('\r')
  expect(await parent).toEqual({ text: 'parent draft', images: [] })
  const submitted = vi.fn()
  tui.onInspectSubmit(submitted)
  tui.setInspectedSubagent(child)
  term.press('\r')
  expect(submitted).toHaveBeenCalledWith(expect.objectContaining({
    text: expect.stringContaining('failed message'), images: [image], files: [file], delivery: 'queue',
  }))
  expect(submitted.mock.calls[0]?.[0].text).toContain('newer child draft')
  tui.setInspectedSubagent(undefined)
  tui.setInspectedSubagent(child)
  term.press('\r')
  expect(submitted).toHaveBeenCalledTimes(1)
})

it('restores a failed delivery behind a human prompt without replacing its answer', async () => {
  const { tui, term } = fixture().open('child')
  term.press('new draft')
  const question = tui.prompt({ title: 'Question', question: 'Answer?', allowCustom: true })
  term.press('my answer')
  tui.restoreInput({ text: 'failed delivery', images: [] }, 'child')
  term.press('\r')
  expect(await question).toBe('my answer')
  const submitted = tui.readInput()
  term.press('\r')
  expect((await submitted)?.text).toContain('failed delivery')
  expect((await submitted)?.text).toContain('new draft')
})

it('keeps local waiting input in its original root session', async () => {
  const { tui, term } = fixture().open('a')
  term.press('for A\r')
  switchTo(tui, 'b')
  expect(tui.pendingInputs.list()).toEqual([])
  const reading = tui.readInput()
  term.press('for B\r')
  const b = (await reading)!
  expect(b.text).toBe('for B')
  expect(tui.pendingInputs.receipt?.(b)?.sessionId).toBe('b')
  switchTo(tui, 'a')
  expect(tui.pendingInputs.list().map(row => row.submission.text)).toEqual(['for A'])
  expect((await tui.readInput())?.text).toBe('for A')
})

it('recovers waiting input and in-flight attachment delivery without sending automatically', async () => {
  const f = fixture()
  const image = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', name: 'draft.png' }
  const file = { attachmentId: AttachmentId('recover-file'), name: 'notes.txt', bytes: 3 }
  const { tui, term } = f.open('a', { readClipboardImage: async () => image })
  tui.setStatus('running')
  term.press('first ')
  term.press('\x16')
  await new Promise<void>(resolve => setImmediate(resolve))
  tui.stageFileAttachment(file)
  term.press(' last'); term.press('\x1bs')
  const sending = (await tui.readInput())!
  term.press('second\r'); term.press('composer')
  tui.dispose()
  const next = f.open('a')
  const entries = next.tui.pendingInputs.list()
  expect(entries.map(row => row.recovered)).toEqual([true, true])
  expect(entries[0]?.submission).toEqual(sending)
  expect(entries[0]?.submission).toMatchObject({ delivery: 'steer', literal: true, images: [image], files: [file],
    segments: [{ kind: 'text', text: 'first' }, { kind: 'image', index: 0 }, { kind: 'file', index: 0 }, { kind: 'text', text: 'last' }] })
  expect(stripAnsi(next.term.captured)).toContain('Recovered')
  const pending = next.tui.readInput()
  const resolved = vi.fn()
  void pending.then(resolved)
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(resolved).not.toHaveBeenCalled()
  next.tui.pendingInputs.update(entries[0]!.id, { kind: 'release' })
  expect(await pending).toEqual(sending)
  next.tui.pendingInputs.acknowledge?.((await pending)!)
  next.tui.dispose()
  const again = f.open('a')
  expect(again.tui.pendingInputs.list().map(row => row.submission.text)).toEqual(['second'])
  expect(f.store.load('a')?.editor.text).toBe('composer')
})

it('reconciles accepted message identities after exit between admission and acknowledgment', async () => {
  const f = fixture()
  const { tui, term } = f.open('a')
  term.press('accepted\r')
  const submission = (await tui.readInput())!
  tui.pendingInputs.prepare?.(submission, 'message:accepted')
  term.press('still local\r')
  tui.dispose()
  const next = f.open('a')
  next.tui.pendingInputs.reconcile?.('a', new Set(['message:accepted']))
  expect(next.tui.pendingInputs.list().map(row => row.submission.text)).toEqual(['still local'])
  next.tui.dispose()
  expect(f.open('a').tui.pendingInputs.list().map(row => row.submission.text)).toEqual(['still local'])
})

it('keeps recalled newer entries across restart without duplicating the composer', () => {
  const f = fixture()
  const { tui, term } = f.open('a')
  term.press('one\r'); term.press('two\r'); term.press('three\r')
  term.press('\x1b[A'); term.press('\x1b[A')
  tui.dispose()
  const next = f.open('a')
  expect(next.tui.pendingInputs.list().map(row => row.submission.text)).toEqual(['one', 'three'])
  expect(f.store.load('a')?.editor.text).toBe('two')
})

it('recovers child input in the child and never sends it to the root reader', async () => {
  const f = fixture()
  const { tui, term } = f.open('parent')
  const child = { id: 'child', label: 'Child', phase: 'waiting' as const, writable: true }
  tui.setInspectedSubagent(child)
  term.press('child message\r')
  tui.dispose()
  const next = f.open('parent')
  expect(next.tui.pendingInputs.list()).toEqual([])
  const submit = vi.fn()
  next.tui.onInspectSubmit(submit)
  next.tui.setInspectedSubagent(child)
  const row = next.tui.pendingInputs.list()[0]!
  expect(row.submission.text).toBe('child message')
  expect(stripAnsi(next.term.captured)).toContain('Recovered')
  const abort = new AbortController()
  const rootRead = next.tui.readInput(abort.signal)
  next.tui.pendingInputs.update(row.id, { kind: 'release' })
  expect(submit).toHaveBeenCalledWith(row.submission)
  abort.abort()
  expect(await rootRead).toBeNull()
})

it('drains only the returned root queue into an already waiting reader', async () => {
  const { tui, term } = fixture().open('a')
  term.press('A waiting\r')
  switchTo(tui, 'b')
  const reading = tui.readInput()
  switchTo(tui, 'a')
  const submission = (await reading)!
  expect(submission.text).toBe('A waiting')
  expect(tui.pendingInputs.receipt?.(submission)?.sessionId).toBe('a')
})

it('binds input typed during startup to the first session', async () => {
  const term = new Terminal(), tui = new LocalTui(term, 'm', false)
  instances.push(tui)
  term.press('early input\r')
  switchTo(tui, 'first')
  const submission = (await tui.readInput())!
  expect(submission.text).toBe('early input')
  expect(tui.pendingInputs.receipt?.(submission)?.sessionId).toBe('first')
})

it('sends recovered input only after the queue confirmation key', async () => {
  const f = fixture()
  const { tui, term } = f.open('a')
  term.press('recovered input\r'); tui.dispose()
  const next = f.open('a')
  const agent = { inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent
  next.tui.setQueueHandler(signal => openMessageQueue({ agent, tui: next.tui, signal, assertActive: () => {},
    restore: async () => ({ text: '', images: [] }) }))
  const reading = next.tui.readInput()
  const resolved = vi.fn()
  void reading.then(resolved)
  next.term.press('\x1bq')
  expect(stripAnsi(next.term.captured)).toContain('Recovered')
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(resolved).not.toHaveBeenCalled()
  next.term.press('\x1br')
  expect((await reading)?.text).toBe('recovered input')
})

it.each(['/new', '!echo recovered'])('never replays recovered command %s without confirmation', async text => {
  const f = fixture()
  const { tui, term } = f.open('a')
  tui.setCommands([{ name: 'new', description: 'New session' }])
  term.press(text + '\r'); tui.dispose()
  const next = f.open('a')
  const abort = new AbortController(), resolved = vi.fn()
  const reading = next.tui.readInput(abort.signal)
  void reading.then(resolved)
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(resolved).not.toHaveBeenCalled()
  expect(next.tui.pendingInputs.list()[0]).toMatchObject({ recovered: true, submission: { text } })
  abort.abort()
  expect(await reading).toBeNull()
})

it('restores a failed in-flight root submission to its receipt scope without duplicating recovery', async () => {
  const f = fixture()
  const { tui, term } = f.open('a')
  term.press('failed A\r')
  const submission = (await tui.readInput())!
  switchTo(tui, 'b')
  term.press('B draft')
  tui.restoreInput(submission)
  expect(f.store.load('a')?.editor.text).toBe('failed A')
  tui.dispose()
  expect(f.open('a').tui.pendingInputs.list()).toEqual([])
  expect(f.store.load('b')?.editor.text).toBe('B draft')
})

describe('empty-composer continuation gesture', () => {
  it('captures the current failure identity and coalesces repeated keys', async () => {
    const { tui, term } = fixture().open('a')
    tui.setSession({ id: 'a', recent: [], controls: { continuation: 42 } })
    let release!: () => void
    const handler = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    tui.setContinueHandler(handler)
    term.press('\x1br'); term.press('\x1br')
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith({ sessionId: 'a', failureSeq: 42 })
    tui.setSession({ id: 'b', recent: [] })
    release(); await new Promise<void>(resolve => setImmediate(resolve))
    term.press('\x1br')
    expect(handler).toHaveBeenCalledOnce()
  })

  it.each(['text', 'file', 'image', 'running', 'no-failure'])('leaves %s untouched without admitting a continuation', async kind => {
    const f = fixture()
    const image = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' as const }
    const { tui, term } = f.open('a', { readClipboardImage: async () => image })
    tui.setSession({ id: 'a', recent: [], controls: kind === 'no-failure' ? {} : { continuation: 42 } })
    const handler = vi.fn(async () => {})
    tui.setContinueHandler(handler)
    if (kind === 'text') term.press('my draft')
    if (kind === 'file') tui.stageFileAttachment({ attachmentId: AttachmentId('f'), name: 'n.txt', bytes: 1 })
    if (kind === 'image') { term.press('\x16'); await new Promise<void>(resolve => setImmediate(resolve)) }
    if (kind === 'running') tui.setStatus('running')
    term.press('\x1br')
    expect(handler).not.toHaveBeenCalled()
    switchTo(tui, 'b')
    const draft = f.store.load('a')
    if (kind === 'text') expect(draft?.editor.text).toBe('my draft')
    if (kind === 'file') expect(draft?.files.entries).toHaveLength(1)
    if (kind === 'image') expect(draft?.images).toEqual([image])
  })
})
