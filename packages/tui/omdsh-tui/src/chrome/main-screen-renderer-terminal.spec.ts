import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { MainScreenRenderer } from './main-screen-renderer.ts'
import type { Frame } from './renderer.ts'

describe('MainScreenRenderer with terminal buffers', () => {
  it('keeps selection repaints in the owning buffer and restores the untouched transcript', async () => {
    const terminal = new Terminal({ cols: 40, rows: 12, scrollback: 100, allowProposedApi: true })
    let pending = Promise.resolve()
    const renderer = new MainScreenRenderer({ write: chunk => {
      pending = pending.then(() => new Promise<void>(resolve => { terminal.write(chunk, resolve) }))
    } }, { width: 40, height: 12, alternateScreenOverlays: true })
    const visible = async (): Promise<string[]> => {
      await pending
      const buffer = terminal.buffer.active
      return Array.from({ length: terminal.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '')
    }
    const main: Frame = { lines: Array.from({ length: 20 }, (_, i) => `transcript-${i}`), liveStart: 18 }
    const overlay: Frame = { lines: Array.from({ length: 12 }, (_, i) => `detail-${i}`), liveStart: 0, transientSurface: 'overlay' }
    const selected = (rows: readonly string[]): string[] => rows.map((row, i) => i === 4 ? '\x1b[7m' + row + '\x1b[27m' : row)
    try {
      renderer.render(main)
      const original = await visible()
      const history = terminal.buffer.normal.baseY
      renderer.render(overlay, selected)
      const inspected = await visible()
      renderer.render(overlay, selected)
      expect(await visible()).toEqual(inspected)
      renderer.render(overlay)
      expect(await visible()).toEqual(inspected)
      renderer.render(overlay, selected)
      renderer.render(main)
      expect(await visible()).toEqual(original)
      expect(terminal.buffer.normal.baseY).toBe(history)
      renderer.render(overlay, selected)
      renderer.finish()
      expect(await visible()).toEqual(original)
      expect(terminal.buffer.active.type).toBe('normal')
    } finally { terminal.dispose() }
  })

  it.each(['none', 'width', 'height', 'both'] as const)(
    'restores the transcript and anchored composer after preview (%s resize)', async resize => {
      const terminal = new Terminal({ cols: 60, rows: 24, scrollback: 2000, allowProposedApi: true })
      const writes: string[] = []
      let pending = Promise.resolve()
      const renderer = new MainScreenRenderer({ write: chunk => {
        writes.push(chunk)
        pending = pending.then(() => new Promise<void>(resolve => { terminal.write(chunk, resolve) }))
      } }, { width: 60, height: 24, alternateScreenOverlays: true })
      const visible = async (): Promise<string[]> => {
        await pending
        const buffer = terminal.buffer.active
        return Array.from({ length: terminal.rows }, (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true).trimEnd() ?? '')
      }
      const body = Array.from({ length: 30 }, (_, row) => `document-${row}`.padEnd(59))
      const frame: Frame = {
        lines: [...body, 'COMPOSER'.padEnd(59), 'draft'.padEnd(59), 'BOTTOM'.padEnd(59), 'status', 'telemetry'],
        liveStart: 12,
        cursor: { row: body.length + 1, column: 2 },
        documentRows: { documentStart: 0, documentEnd: body.length, frameStart: 0 },
      }
      const preview: Frame = {
        lines: Array.from({ length: 24 }, (_, row) => `preview-${row}`.padEnd(59)),
        liveStart: 0,
        transientSurface: 'overlay',
      }
      try {
        renderer.render(frame)
        const before = await visible()
        const history = terminal.buffer.normal.baseY
        renderer.render(preview)
        await visible()
        if (resize !== 'none') {
          const columns = resize === 'height' ? 60 : 50
          const rows = resize === 'width' ? 24 : 19
          terminal.resize(columns, rows)
          renderer.resize(columns, rows)
          renderer.render({ ...preview, lines: preview.lines.slice(0, rows).map(line => line.slice(0, columns - 1)) })
          await visible()
          terminal.resize(60, 24)
          renderer.resize(60, 24)
          renderer.render(preview)
          await visible()
        }
        const restore = writes.length
        renderer.render(frame)
        expect(await visible()).toEqual(before)
        expect(terminal.buffer.active.type).toBe('normal')
        expect((await visible()).slice(-5)).toEqual(['COMPOSER', 'draft', 'BOTTOM', 'status', 'telemetry'])
        expect(writes.join('')).not.toContain('\x1b[3J')
        if (resize === 'none') {
          expect(terminal.buffer.normal.baseY).toBe(history)
          // An alternate-buffer restore is not proof that cached rows still match.
          expect(writes.slice(restore).join('')).toContain('COMPOSER')
        }
      } finally { terminal.dispose() }
    },
  )
})
