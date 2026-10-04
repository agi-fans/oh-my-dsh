import { ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TuiService } from '../definition.ts'
import { changedPaths, codeDocument, filePreview, PREVIEW_BYTES, reviewFiles } from './file-review.ts'
import { renderMarkdown } from '../chrome/markdown.ts'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: vi.fn() }))

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function directory() { const root = await mkdtemp(join(tmpdir(), 'omdsh-review-')); roots.push(root); return root }
const signal = () => new AbortController().signal

describe('file inspection', () => {
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
