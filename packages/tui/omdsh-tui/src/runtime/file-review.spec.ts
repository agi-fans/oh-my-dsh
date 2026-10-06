import sharp from 'sharp'
import { ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TuiService } from '../definition.ts'
import { changedPaths, codeDocument, fileDocument, filePreview, MAX_PREVIEW_BYTES, PREVIEW_BYTES, reviewFiles } from './file-review.ts'
import { renderMarkdown } from '../chrome/markdown.ts'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: vi.fn() }))

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function directory() { const root = await mkdtemp(join(tmpdir(), 'omdsh-review-')); roots.push(root); return root }
const signal = () => new AbortController().signal

describe('file inspection', () => {
  it('loads bounded prefixes without replacing a split UTF-8 character and caps explicit loads', async () => {
    const root = await directory(), path = join(root, 'large.txt')
    await writeFile(path, 'x'.repeat(PREVIEW_BYTES - 1) + '🐳 tail')
    const first = await fileDocument(path, signal())
    expect(first.text).toBe('x'.repeat(PREVIEW_BYTES - 1))
    expect(first.text).not.toContain('\uFFFD')
    expect(first).toMatchObject({ truncated: true, status: expect.stringContaining('L loads more') })
    const next = await fileDocument(path, signal(), PREVIEW_BYTES * 2)
    expect(next.text).toContain('🐳 tail')
    expect(next.truncated).toBe(false)
    await writeFile(path, 'x'.repeat(MAX_PREVIEW_BYTES + 10))
    const capped = await fileDocument(path, signal(), MAX_PREVIEW_BYTES * 2)
    expect(capped.text).toHaveLength(MAX_PREVIEW_BYTES)
    expect(capped.status).toContain('Preview limit reached')
  })

  it('retains independent file and diff positions through editor actions and navigation', async () => {
    const root = await directory()
    await writeFile(join(root, 'a.ts'), 'const a = 1\n'.repeat(80))
    await writeFile(join(root, 'b.ts'), 'const b = 2\n')
    const actions = ['preview', 'editor', 'next', 'previous', 'preview', 'files', '0', null, null]
    const prompt = vi.fn<TuiService['prompt']>(async request => {
      request.onDocumentPosition?.({ row: request.documentSource?.diff ? 12 : 40, wrap: 0, query: request.documentSource?.diff ? 'patch' : 'const' })
      return actions.shift() ?? null
    })
    const editor = vi.fn()
    await reviewFiles({ prompt, notice: vi.fn(), openFileInEditor: editor } as unknown as TuiService, 'Review', root,
      [{ path: 'a.ts', label: 'a' }, { path: 'b.ts', label: 'b' }], async () => ({ text: '@@ -1 +1 @@\n-old\n+new', diff: true }), signal(), 0)
    expect(prompt.mock.calls[2]?.[0].documentPosition).toEqual({ row: 40, wrap: 0, query: 'const' })
    expect(prompt.mock.calls[4]?.[0].documentPosition).toEqual({ row: 40, wrap: 0, query: 'const' })
    expect(prompt.mock.calls[5]?.[0].documentPosition).toEqual({ row: 12, wrap: 0, query: 'patch' })
    expect(prompt.mock.calls[7]?.[0].documentPosition).toEqual({ row: 12, wrap: 0, query: 'patch' })
    expect(editor).toHaveBeenCalledWith(join(root, 'a.ts'))
  })

  it('offers progressive loading and switches Markdown rendering without interpreting source text', async () => {
    const root = await directory(), path = join(root, 'large.md')
    await writeFile(path, '# Heading\n' + 'body\n'.repeat(30_000))
    const answers = ['more', 'markdown', 'markdown', null, null]
    const prompt = vi.fn<TuiService['prompt']>(async request => {
      request.onDocumentPosition?.({ row: 20, wrap: 0, query: 'body' })
      return answers.shift() ?? null
    })
    await reviewFiles({ prompt, notice: vi.fn() } as unknown as TuiService, 'Files', root,
      [{ path, label: 'large.md' }], async () => '', signal(), 0, false)
    expect(prompt.mock.calls[0]?.[0].options).toContainEqual({ label: 'Load more', value: 'more' })
    expect(prompt.mock.calls[1]?.[0].options).not.toContainEqual({ label: 'Load more', value: 'more' })
    expect(prompt.mock.calls[1]?.[0].documentPosition?.row).toBe(20)
    expect(prompt.mock.calls[2]?.[0].documentSource).toBeUndefined()
    expect(prompt.mock.calls[2]?.[0].detail).toContain('# Heading')
    expect(prompt.mock.calls[3]?.[0].documentSource?.text).toContain('# Heading')
    expect(prompt.mock.calls[3]?.[0].documentPosition?.row).toBe(20)
  })

  it('lists staged, unstaged and untracked files with literal Unicode and whitespace paths', async () => {
    const root = await directory()
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root })
    git('init', '--quiet')
    await writeFile(join(root, 'changed 中文.txt'), 'before')
    await writeFile(join(root, 'staged.txt'), 'before')
    git('add', '.')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture')
    await writeFile(join(root, 'changed 中文.txt'), 'after')
    await writeFile(join(root, 'staged.txt'), 'after')
    git('add', 'staged.txt')
    await writeFile(join(root, 'new\nname.txt'), 'new')
    expect(await changedPaths(root, signal())).toEqual(['changed 中文.txt', 'new\nname.txt', 'staged.txt'])
    expect(git('diff', '--cached', '--name-only').toString()).toContain('staged.txt')
  })

  it('bounds text previews, strips controls and handles binary files without decoding them', async () => {
    const root = await directory()
    const path = join(root, 'large.txt')
    await writeFile(path, 'x'.repeat(PREVIEW_BYTES + 20))
    const preview = await filePreview(path, signal())
    expect(preview).toContain('Preview truncated at 128 KiB')
    expect(preview.length).toBeLessThan(PREVIEW_BYTES + 120)
    await writeFile(path, Buffer.from([1, 0, 2]))
    expect(await filePreview(path, signal())).toContain('Binary file')
    expect(codeDocument('\x1b[31mred\x1b[0m\x07\n```')).toBe('````\nred\n```\n````')
    const abort = new AbortController(); abort.abort()
    await expect(filePreview(path, abort.signal)).rejects.toThrow()
  })

  it('keeps file selection and external editor errors inside the review loop', async () => {
    const prompt = vi.fn<TuiService['prompt']>()
    for (const answer of ['0', 'next', 'editor', null, null]) prompt.mockResolvedValueOnce(answer)
    const editor = vi.fn(() => { throw new Error('Editor unavailable') })
    const notice = vi.fn()
    await reviewFiles({ prompt, notice, openFileInEditor: editor } as unknown as TuiService, 'Review', '/workspace',
      [{ path: 'a.txt', label: 'a' }, { path: 'b.txt', label: 'b' }], async index => `Patch ${index}`, signal())
    expect(prompt.mock.calls[2]![0].question).toBe('b')
    expect(editor).toHaveBeenCalledWith('/workspace/b.txt')
    expect(notice).toHaveBeenCalledWith('Editor unavailable', { level: 'error' })
    expect(prompt.mock.calls[3]![0].detail).toContain('Editor unavailable')
    expect(prompt.mock.calls.at(-1)![0].initialValue).toBe('1')
  })

  it('omits unavailable navigation on a single file and keeps browsing notifications off', async () => {
    const prompt = vi.fn<TuiService['prompt']>().mockResolvedValue(null)
    await reviewFiles({ prompt, notice: vi.fn() } as unknown as TuiService, 'File', '/workspace',
      [{ path: 'a.txt', label: 'a' }], async () => 'Content', signal(), 0, false)
    expect(prompt.mock.calls[0]![0].options?.map(option => option.value)).toEqual(['files', 'open'])
    expect(prompt.mock.calls[0]![0].notify).toBe(false)
  })

  it.each([false, true])('reports the external Open result in the preview (failure=%s)', async failure => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const child = new ChildProcess()
      queueMicrotask(() => failure ? child.emit('error', new Error('Default app unavailable')) : child.emit('exit', 0))
      return child as ReturnType<typeof spawn>
    })
    const prompt = vi.fn<TuiService['prompt']>()
    for (const answer of ['open', null, null]) prompt.mockResolvedValueOnce(answer)
    await reviewFiles({ prompt, notice: vi.fn() } as unknown as TuiService, 'File', '/workspace',
      [{ path: 'a.txt', label: 'a' }], async () => 'Content', signal(), 0, false)
    expect(spawn).toHaveBeenLastCalledWith(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open',
      [join('/workspace', 'a.txt')], { stdio: 'ignore' })
    expect(prompt.mock.calls[1]![0].detail).toContain(failure ? 'Default app unavailable' : 'Opened in the default application.')
  })

  it('renders a real source preview with multiline syntax and cell-safe wrapped padding', async () => {
    const root = await directory()
    const path = join(root, 'example.mts')
    const content = '/* start\nconst hidden = 1\n*/\nconst label = "中文🐳e\u0301' + 'x'.repeat(80) + '";\n'
    await writeFile(path, content)
    const preview = await filePreview(path, signal())
    expect(preview).toMatch(/^```ts\n/u)
    for (const colors of [true, false]) {
      const theme = createTheme(colors, true)
      for (const width of [24, 40, 80]) {
        const rows = renderMarkdown(preview, theme, width)
        expect(rows.every(row => visibleWidth(row) <= width)).toBe(true)
        expect(rows.every(row => stripAnsi(row).startsWith('  │ '))).toBe(true)
        expect(rows.map(stripAnsi).map(row => row.slice(4)).join('')).toBe(content.replace(/\n/gu, ''))
        if (colors) expect(rows.find(row => stripAnsi(row).includes('const hidden'))).not.toContain(theme.getFgAnsi('mdKeyword'))
      }
    }
    for (const [name, language] of [['Dockerfile', 'docker'], ['Makefile', 'makefile'], ['config.yml', 'yaml'], ['script.ps1', 'powershell']] as const) {
      const path = join(root, name)
      await writeFile(path, 'example')
      expect(await filePreview(path, signal())).toMatch(new RegExp('^```' + language + '\\n', 'u'))
    }
  })
})

it('opens file images through the graphics reader and keeps next-file navigation', async () => {
  const root = await directory()
  await writeFile(join(root, 'a.png'), await sharp({ create: { width: 20, height: 10, channels: 3, background: '#1569a5' } }).png().toBuffer())
  await writeFile(join(root, 'b.txt'), 'text file')
  const answers = ['next', null, null]
  const prompt = vi.fn<TuiService['prompt']>().mockImplementation(async () => answers.shift() ?? null)
  await reviewFiles({ prompt } as unknown as TuiService, 'Files', root,
    [{ path: 'a.png', label: 'a.png' }, { path: 'b.txt', label: 'b.txt' }], async () => '', signal(), 0, false)
  expect(prompt.mock.calls[0]?.[0].documentImage).toMatchObject({ width: 20, height: 10 })
  expect(prompt.mock.calls[1]?.[0].documentImage).toBeUndefined()
  expect(prompt.mock.calls[1]?.[0].documentSource?.text).toBe('text file')
})
