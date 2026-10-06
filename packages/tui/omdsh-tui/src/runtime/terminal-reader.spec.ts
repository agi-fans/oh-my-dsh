import { describe, expect, it, vi } from 'vitest'
import type { TerminalReadRequest } from '@deepseek-ai/dsh-terminal'
import { documentModel } from '../views/document-reader.ts'
import { TerminalReader } from './terminal-reader.ts'

function fixture(count = 1000) {
  let lines = Array.from({ length: count }, (_, at) => `output ${at + 1} 中文🐳`)
  let clipped = false, cap = Infinity
  const read = vi.fn(({ offset = 0, count = 300 }: TerminalReadRequest) => {
    const end = Math.max(0, lines.length - offset), start = Math.max(0, end - Math.min(count, cap))
    return { text: lines.slice(start, end).join('\n'), totalLines: lines.length, lineBegin: offset, lineEnd: offset + end - start, truncated: clipped }
  })
  return { reader: new TerminalReader(read), read,
    append: (...text: string[]) => { lines.push(...text) },
    rotate: () => { lines = [...lines.slice(10), ...Array.from({ length: 10 }, (_, at) => `new ${at}`)]; clipped = true },
    reset: () => { lines = ['reset'] }, cap: (value: number) => { cap = value } }
}

describe('terminal scrollback reader', () => {
  it('loads chronological older pages without duplicates and stops at the retention boundary', () => {
    const h = fixture()
    expect(h.reader.refresh(true)).toMatchObject({ firstLine: 701 })
    expect(h.reader.loadEarlier()).toBe(300)
    expect(h.reader.refresh(false)).toMatchObject({ firstLine: 401 })
    expect(h.reader.loadEarlier()).toBe(300)
    expect(h.reader.loadEarlier()).toBe(100)
    const model = documentModel(h.reader.refresh(false))
    expect(model.lines).toHaveLength(1000)
    expect(model.lines[0]).toBe('output 1 中文🐳')
    expect(model.lines.at(-1)).toBe('output 1000 中文🐳')
    expect(new Set(model.lines).size).toBe(1000)
    expect(h.reader.loadEarlier()).toBe(0)
    expect(h.reader.refresh(false).status).toContain('No earlier retained output')
  })

  it('freezes paused text without reading, then resumes at the newest page', () => {
    const h = fixture(), original = h.reader.refresh(true)
    expect(h.reader.refresh(true)).toBe(original)
    h.append('newest')
    const reads = h.read.mock.calls.length
    expect(h.reader.refresh(false)).toBe(original)
    expect(h.read).toHaveBeenCalledTimes(reads)
    const next = h.reader.refresh(true)
    expect(next.firstLine).toBe(702)
    expect(documentModel(next).lines.at(-1)).toBe('newest')
    expect(next).not.toBe(original)
  })

  it('accounts for output appended after pausing and between repeated history loads', () => {
    const h = fixture()
    h.reader.refresh(true)
    h.append('new 1', 'new 2')
    expect(h.reader.loadEarlier()).toBe(300)
    h.append('new 3')
    expect(h.reader.loadEarlier()).toBe(300)
    const model = documentModel(h.reader.refresh(false))
    expect(model.lines).toHaveLength(900)
    expect(model.numbers[0]).toEqual({ next: 101 })
    expect(model.lines.at(-1)).toBe('output 1000 中文🐳')
  })

  it('rejects rotating or reset scrollback instead of splicing unrelated pages', () => {
    for (const change of ['rotate', 'reset'] as const) {
      const h = fixture(), original = h.reader.refresh(true)
      h[change]()
      expect(h.reader.loadEarlier()).toBe(0)
      expect(h.reader.refresh(false).text).toBe(original.text)
      expect(h.reader.refresh(false).status).toContain('History changed or was clipped')
      expect(h.reader.refresh(true).text).not.toBe(original.text)
    }
  })

  it('honors backend page limits and refuses history that changes during the read', () => {
    const h = fixture()
    h.reader.refresh(true); h.cap(30)
    expect(h.reader.loadEarlier()).toBe(10)
    expect(documentModel(h.reader.refresh(false)).lines).toHaveLength(310)
    const original = h.reader.refresh(false)
    h.read.mockImplementationOnce(() => ({ text: '', totalLines: 1000, lineBegin: 0, lineEnd: 0, truncated: false }))
      .mockImplementationOnce(() => ({ text: '', totalLines: 1001, lineBegin: 290, lineEnd: 290, truncated: false }))
    expect(h.reader.loadEarlier()).toBe(0)
    expect(h.reader.refresh(false).text).toBe(original.text)
  })

  it('retains empty final lines, literal fences, and ANSI text without introducing Markdown', () => {
    const h = fixture(0)
    h.append('```', '\x1b[31mred\x1b[0m', '')
    const source = h.reader.refresh(true)
    expect(documentModel(source).lines).toEqual(['```', 'red', ''])
    expect(documentModel(source).numbers).toEqual([{ next: 1 }, { next: 2 }, { next: 3 }])
  })

  it('bounds loaded history to 10,000 lines', () => {
    const h = fixture(11_000)
    h.reader.refresh(true)
    for (let at = 0; at < 40; at++) h.reader.loadEarlier()
    const source = h.reader.refresh(false)
    expect(documentModel(source).lines).toHaveLength(10_000)
    expect(source.status).toContain('Reader limit: 10,000 lines')
  })

  it('bounds both the initial page and accumulated history to 4 MiB', () => {
    const h = fixture(0)
    h.append(...Array.from({ length: 1000 }, (_, at) => `${at}:` + 'x'.repeat(10_000)))
    const original = h.reader.refresh(true)
    expect(h.reader.loadEarlier()).toBe(0)
    expect(h.reader.refresh(false).text).toBe(original.text)
    expect(h.reader.refresh(false).status).toContain('Reader limit: 4 MiB')
    const large = fixture(0)
    large.append('x'.repeat(5 * 1024 * 1024))
    const source = large.reader.refresh(true)
    expect(Buffer.byteLength(source.text)).toBeLessThanOrEqual(4 * 1024 * 1024 + 1)
    expect(source.status).toContain('leading text clipped')
  })
})
