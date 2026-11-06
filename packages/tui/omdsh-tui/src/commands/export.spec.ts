import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Commands from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TuiPrompt } from '../definition.ts'
import * as command from './export.ts'
import { openSystemFile } from '../runtime/file-review.ts'

vi.mock('../runtime/file-review.ts', () => ({ openSystemFile: vi.fn(async () => {}) }))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})

async function fixture(interactive = false) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Commands)
  const prompt = vi.fn(async (_request: TuiPrompt): Promise<string | null> => null)
  const copyText = vi.fn(async () => {})
  ctx.provide('tui', { interactive, prompt, copyText } as never)
  await ctx.plugin(command)
  const session = ctx.sessions.create(SessionId('export-test'))
  const agent = { id: session.id, session, status: 'idle' } as Agent
  const run = (input: string) => ctx.commands.execute(agent, input, [], new AbortController().signal)
  return { ctx, prompt, copyText, run }
}

it('treats a bare markdown format as the default filename', async () => {
  const h = await fixture()
  const dir = await fs.mkdtemp(join(tmpdir(), 'omdsh-export-default-'))
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir)
  try {
    expect((await h.run('/export markdown'))?.result.kind).toBe('success')
    expect(await fs.readFile(join(dir, 'omdsh-transcript-export-test.md'), 'utf8')).toContain('export-test')
    expect(await fs.readdir(dir)).toEqual(['omdsh-transcript-export-test.md'])
  } finally { cwd.mockRestore(); await h.ctx.fiber.dispose(); await fs.rm(dir, { recursive: true, force: true }) }
})

it.each(['markdown', 'html'])('exports %s to a quoted path and protects an existing file', async format => {
  const h = await fixture(), dir = await fs.mkdtemp(join(tmpdir(), 'omdsh-export-'))
  const path = join(dir, 'my transcript.txt')
  try {
    expect((await h.run(`/export ${format} "${path}"`))?.result.kind).toBe('success')
    const contents = await fs.readFile(path, 'utf8')
    expect(contents).toContain('export-test')
    expect((await h.run(`/export ${format} "${path}"`))?.result).toMatchObject({ kind: 'error', text: expect.stringContaining('File already exists') })
    expect(await fs.readFile(path, 'utf8')).toBe(contents)
  } finally { await h.ctx.fiber.dispose(); await fs.rm(dir, { recursive: true, force: true }) }
})

it('chooses format and destination, then copies the saved path', async () => {
  const h = await fixture(true), dir = await fs.mkdtemp(join(tmpdir(), 'omdsh-export-'))
  const path = join(dir, 'result.html')
  h.prompt.mockResolvedValueOnce('html').mockResolvedValueOnce(path).mockResolvedValueOnce('copy')
  try {
    expect((await h.run('/export'))?.result.kind).toBe('success')
    expect(await fs.readFile(path, 'utf8')).toContain('<html')
    expect(h.prompt.mock.calls[1]![0].initialInput).toBe('omdsh-transcript-export-test.html')
    expect(h.copyText).toHaveBeenCalledWith(path, 'Export path')
  } finally { await h.ctx.fiber.dispose(); await fs.rm(dir, { recursive: true, force: true }) }
})

it('cancels export when another prompt takes over', async () => {
  const h = await fixture(true)
  h.prompt.mockImplementationOnce(async request => { request.onSuperseded?.(''); return 'html' })
  try {
    expect((await h.run('/export'))?.result.kind).toBe('success')
    expect(h.prompt).toHaveBeenCalledTimes(1)
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['exists', 'missing-directory'])('retries a %s destination without choosing the format again', async failure => {
  const h = await fixture(true), dir = await fs.mkdtemp(join(tmpdir(), 'omdsh-export-retry-'))
  const invalid = failure === 'exists' ? join(dir, 'existing.html') : join(dir, 'missing', 'result.html')
  const path = join(dir, 'result.html')
  if (failure === 'exists') await fs.writeFile(invalid, 'original')
  h.prompt.mockResolvedValueOnce('html').mockResolvedValueOnce(invalid).mockResolvedValueOnce(path).mockResolvedValueOnce('done')
  try {
    expect((await h.run('/export'))?.result.kind).toBe('success')
    const retry = h.prompt.mock.calls[2]![0]
    expect(retry).toMatchObject({ title: 'Export', question: 'Save to file', initialInput: invalid })
    expect(retry.detail).toContain(failure === 'exists' ? 'File already exists' : 'Could not save the file')
    expect(await fs.readFile(path, 'utf8')).toContain('<html')
    if (failure === 'exists') expect(await fs.readFile(invalid, 'utf8')).toBe('original')
    expect(h.prompt).toHaveBeenCalledTimes(4)
  } finally { await h.ctx.fiber.dispose(); await fs.rm(dir, { recursive: true, force: true }) }
})

it('can cancel a failed export without writing another file', async () => {
  const h = await fixture(true), dir = await fs.mkdtemp(join(tmpdir(), 'omdsh-export-cancel-'))
  const path = join(dir, 'existing.md')
  await fs.writeFile(path, 'original')
  h.prompt.mockResolvedValueOnce('markdown').mockResolvedValueOnce(path).mockResolvedValueOnce(null)
  try {
    expect((await h.run('/export'))?.result.kind).toBe('success')
    expect(await fs.readdir(dir)).toEqual(['existing.md'])
    expect(await fs.readFile(path, 'utf8')).toBe('original')
  } finally { await h.ctx.fiber.dispose(); await fs.rm(dir, { recursive: true, force: true }) }
})

it('removes a partially written export before retrying the same destination', async () => {
  const h = await fixture(true), dir = await fs.mkdtemp(join(tmpdir(), 'omdsh-export-partial-'))
  const path = join(dir, 'result.md')
  const { open: originalOpen } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const open = vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
    const handle = await originalOpen(...args)
    await handle.writeFile('partial')
    vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(new Error('disk full'))
    return handle
  })
  h.prompt.mockResolvedValueOnce('markdown').mockResolvedValueOnce(path).mockImplementationOnce(async request => {
    expect(request.initialInput).toBe(path)
    expect(request.detail).toContain('disk full')
    expect(await fs.readdir(dir)).toEqual([])
    return path
  }).mockResolvedValueOnce('done')
  try {
    expect((await h.run('/export'))?.result.kind).toBe('success')
    expect(await fs.readFile(path, 'utf8')).toContain('export-test')
  } finally { open.mockImplementation(originalOpen); await h.ctx.fiber.dispose(); await fs.rm(dir, { recursive: true, force: true }) }
})


it('keeps export actions available after open fails and after copying', async () => {
  const h = await fixture(true), dir = await fs.mkdtemp(join(tmpdir(), 'omdsh-export-actions-'))
  const path = join(dir, 'result.html')
  vi.mocked(openSystemFile).mockRejectedValueOnce(new Error('No associated application'))
  for (const answer of ['html', path, 'open', 'copy', 'open', 'done']) h.prompt.mockResolvedValueOnce(answer)
  try {
    expect((await h.run('/export'))?.result.kind).toBe('success')
    expect(h.prompt.mock.calls[3]![0]).toMatchObject({ title: 'Export complete', question: path, detail: expect.stringContaining('No associated application') })
    expect(h.prompt.mock.calls[4]![0].detail).toBe('Path copied.')
    expect(h.prompt.mock.calls[5]![0].detail).toBe('File opened.')
    expect(h.copyText).toHaveBeenCalledWith(path, 'Export path')
    expect(await fs.readdir(dir)).toEqual(['result.html'])
  } finally { await h.ctx.fiber.dispose(); await fs.rm(dir, { recursive: true, force: true }) }
})

it('returns from destination to format selection and exports the newly chosen format', async () => {
  const h = await fixture(true), dir = await fs.mkdtemp(join(tmpdir(), 'omdsh-export-back-'))
  const path = join(dir, 'result.html')
  for (const answer of ['markdown', null, 'html', path, 'done']) h.prompt.mockResolvedValueOnce(answer)
  try {
    expect((await h.run('/export'))?.result.kind).toBe('success')
    expect(h.prompt.mock.calls[2]![0]).toMatchObject({ question: 'Choose a format', initialValue: 'markdown' })
    expect(h.prompt.mock.calls[3]![0]).toMatchObject({ initialInput: 'omdsh-transcript-export-test.html', dismissLabel: 'Back' })
    expect(await fs.readFile(path, 'utf8')).toContain('<html')
  } finally { await h.ctx.fiber.dispose(); await fs.rm(dir, { recursive: true, force: true }) }
})
