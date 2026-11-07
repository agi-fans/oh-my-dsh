import { Terminal } from '@xterm/headless'
import { describe, expect, it, vi } from 'vitest'
import type { TuiFileReview } from '../definition.ts'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import { fileBrowserDocument, renderFileBrowser } from '../views/file-browser.ts'
import { FileBrowser } from './file-browser.ts'

const flush = async () => { await new Promise<void>(resolve => setImmediate(resolve)) }
const theme = createTheme(false, 'truecolor')
function setup(read?: TuiFileReview['read']) {
  const abort = new AbortController()
  const request: TuiFileReview = { title: 'Workspace changes · HEAD → working tree', signal: abort.signal,
    files: [{ path: 'src/中文🐳é.ts', label: 'src/中文🐳é.ts', status: 'M', description: '+4 −2 · staged' },
      { path: 'src/other.ts', label: 'src/other.ts', status: '?' }], canEdit: true, canQuote: true,
    read: read ?? vi.fn(async (_index, mode) => ({ source: { text: Array.from({ length: 80 }, (_, at) => `${at === 55 ? 'needle' : 'line'} ${at} ${'宽'.repeat(100)}`).join('\n'), diff: mode === 'diff' } })),
    action: vi.fn() }
  const close = vi.fn(), change = vi.fn()
  const browser = new FileBrowser(request, change, close)
  const key = (id: string, width = 120) => browser.input({ type: 'key', id }, theme, width, 24)
  const text = (value: string, width = 120) => browser.input({ type: 'text', value }, theme, width, 24)
  browser.start()
  return { browser, key, text, abort, request, close }
}

describe('file browser', () => {
  it.each([{ colors: false, language: 'diff' }, { colors: true, language: 'diff' }, { colors: false, language: 'ts' }, { colors: true, language: 'ts' }])('isolates $language preview colors from file names and padding (colors=$colors)', async ({ colors, language }) => {
    const source = language === 'diff'
      ? { diff: true, text: '@@ -1 +1 @@\n-' + 'x'.repeat(180) + '\n+' + 'x'.repeat(180) }
      : { language, text: 'const value = \"' + 'x'.repeat(360) + '\";' }
    const { browser } = setup(async () => ({ source }))
    await flush()
    browser.state.files = Array.from({ length: 18 }, (_, at) => ({ path: `src/f${at}.ts`, label: `src/f${at}.ts`, status: 'M' }))
    try {
      for (const mode of ['dark', 'light'] as const) for (const width of [100, 140]) for (const wordWrap of [true, false]) {
        browser.state.position = { row: 0, wrap: 0, query: '', wordWrap, column: wordWrap ? 0 : 12 }
        const palette = createTheme(colors, 'truecolor', mode)
        const frame = renderFileBrowser(browser.state, palette, width, 24)
        const doc = fileBrowserDocument(browser.state, palette, width, 24)
        const terminal = new Terminal({ cols: width, rows: 24, allowProposedApi: true })
        try {
          await new Promise<void>(resolve => terminal.write(frame.lines.join('\r\n'), resolve))
          for (let at = 0; at < doc.page; at++) {
            const row = terminal.buffer.active.getLine(4 + at)!
            if (at > 0) expect.soft(row.getCell(4)!.isFgDefault(), `file ${at}, width ${width}, wrap ${wordWrap}`).toBe(true)
            expect.soft(row.getCell(width - 1)!.isFgDefault(), `padding ${at}, width ${width}, wrap ${wordWrap}`).toBe(true)
            const x = row.translateToString().indexOf('x', doc.left + 1)
            if (x >= 0) expect(row.getCell(x)!.isFgDefault()).toBe(!colors)
          }
        } finally { terminal.dispose() }
      }
    } finally { browser.close() }
  })

  it('scrolls cached Markdown while refresh and width changes use a new layout', async () => {
    const { browser, key } = setup(async () => ({ source: { text: '# Preview\n\n' + 'A paragraph 中文🐳 '.repeat(100) } }))
    await flush()
    browser.state.mode = 'source'
    browser.state.markdown = true
    const first = fileBrowserDocument(browser.state, theme, 120, 24)
    key('tab')
    key('pageDown')
    const scrolled = fileBrowserDocument(browser.state, theme, 120, 24)
    expect(scrolled.rows).toBe(first.rows)
    expect(scrolled.documentStart).toBeGreaterThan(first.documentStart)
    expect(fileBrowserDocument(browser.state, theme, 60, 24).rows).not.toBe(first.rows)
    browser.state.source = { text: '# Updated\n\nFresh content' }
    const updated = fileBrowserDocument(browser.state, theme, 120, 24)
    expect(updated.rows.slice().join('\n')).toContain('Updated')
    expect(updated.documentStart).toBe(0)
    browser.close()
  })

  it('keeps padding and complete frames at narrow and wide display-cell widths with and without color', async () => {
    const { browser } = setup(); await flush()
    for (const colors of [true, false]) for (const width of [12, 24, 60, 99, 100, 140]) for (const height of [8, 24]) {
      for (const focus of ['files', 'document'] as const) {
        browser.state.focus = focus
        const frame = renderFileBrowser(browser.state, createTheme(colors, 'truecolor'), width, height)
        expect(frame.lines.length).toBeLessThanOrEqual(height)
        expect(frame.lines.every(line => visibleWidth(line) === width)).toBe(true)
        if (width >= 100) expect(stripAnsi(frame.lines[4]!)).toContain('│')
      }
    }
    browser.close()
  })

  it('retains filter, selected file, per-file positions and comparison/source positions', async () => {
    const { browser, key, text } = setup(); await flush()
    text('/'); text('中文'); key('enter')
    expect(browser.state.filter).toBe('中文')
    key('tab'); key('pageDown'); const first = browser.state.position.row
    text('v'); await flush(); key('down'); const source = browser.state.position.row
    text('v'); await flush(); expect(browser.state.position.row).toBe(first)
    text('v'); await flush(); expect(browser.state.position.row).toBe(source)
    expect(browser.state.filter).toBe('中文')
    browser.state.filter = ''
    text('n'); await flush(); key('pageDown')
    text('p'); await flush()
    expect(browser.state.position.row).toBe(source)
    expect(browser.state.mode).toBe('source')
    browser.close()
  })

  it('searches, jumps to new-file lines, clamps scrolling, and routes wheel by pane', async () => {
    const { browser, key, text } = setup(); await flush()
    text('v'); await flush(); key('tab'); text('/'); text('needle'); key('enter')
    expect(browser.state.position.row).toBe(55)
    text('g'); text('12'); key('enter'); expect(browser.state.position.row).toBe(11)
    key('end'); const end = fileBrowserDocument(browser.state, theme, 120, 24)
    expect(end.documentStart).toBe(end.max)
    browser.input({ type: 'wheel', direction: 'up', column: 80, row: 10 }, theme, 120, 24)
    expect(browser.state.selected).toBe(0)
    expect(fileBrowserDocument(browser.state, theme, 120, 24).documentStart).toBe(end.max - 3)
    browser.input({ type: 'wheel', direction: 'down', column: 3, row: 10 }, theme, 120, 24)
    expect(browser.state.selected).toBe(1)
    browser.close()
  })

  it('supports single-pane file selection and returns to the same list on Escape', async () => {
    const { browser, key } = setup(); await flush()
    browser.click(5, 8, 60, 24); await flush()
    expect(browser.state.selected).toBe(1)
    expect(browser.state.focus).toBe('document')
    key('escape', 60); expect(browser.state.focus).toBe('files')
    key('escape', 60); await browser.done
  })

  it('ignores stale completions and aborts pending reads on selection and close', async () => {
    const pending: { resolve: (value: { message: string }) => void; signal: AbortSignal }[] = []
    const { browser, abort } = setup(async (_index, _mode, _limit, signal) => await new Promise(resolve => { pending.push({ resolve, signal }) }))
    browser.select(1)
    expect(pending[0]!.signal.aborted).toBe(true)
    pending[1]!.resolve({ message: 'second' }); await flush()
    pending[0]!.resolve({ message: 'stale first' }); await flush()
    expect(browser.state.message).toBe('second')
    abort.abort(); await browser.done
    expect(pending[1]!.signal.aborted).toBe(true)
  })

  it('offers actions through keyboard selection and does not reread on scroll', async () => {
    const { browser, key, text, request } = setup(); await flush()
    key('tab'); key('down'); key('down'); expect(request.read).toHaveBeenCalledTimes(1)
    text('a'); key('down'); key('enter'); await flush()
    expect(request.action).toHaveBeenCalledWith('editor', 0, expect.any(Object), expect.any(Object))
    text('r'); await flush(); expect(request.read).toHaveBeenCalledTimes(2)
    browser.close()
  })
})

it('keeps the selected action visible in a short terminal and bounds help scrolling', async () => {
  const { browser } = setup(); await flush()
  const key = (id: string) => browser.input({ type: 'key', id }, theme, 100, 10)
  browser.input({ type: 'text', value: 'a' }, theme, 100, 10)
  for (let at = 0; at < 4; at++) key('down')
  expect(renderFileBrowser(browser.state, theme, 100, 10).lines.map(stripAnsi).join('\n')).toContain('Keyboard help')
  key('enter')
  for (let at = 0; at < 50; at++) key('pageDown')
  expect(renderFileBrowser(browser.state, theme, 100, 10).lines.map(stripAnsi).join('\n')).toContain('Click / Drag / Right-click  Select file / select text / copy')
  browser.close()
})

it('keeps a read failure in its file and allows an explicit retry', async () => {
  const read = vi.fn<TuiFileReview['read']>().mockRejectedValueOnce(new Error('File changed while reading')).mockResolvedValueOnce({ source: { text: 'recovered' } })
  const { browser, text } = setup(read); await flush()
  expect(browser.state.message).toContain('File changed')
  text('r'); await flush()
  expect(browser.state.source?.text).toBe('recovered')
  browser.close()
})
