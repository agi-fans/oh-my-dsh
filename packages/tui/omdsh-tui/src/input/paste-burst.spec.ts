import { describe, expect, it } from 'vitest'
import { PasteBurst } from './paste-burst.ts'
import type { KeyEvent } from './keys.ts'
const text = (value: string): KeyEvent => ({ type: 'text', value })
const key = (id: string): KeyEvent => ({ type: 'key', id })

describe('PasteBurst', () => {
  it('passes ordinary typing, bulk text, IME commits and intentional Enter immediately', () => {
    const burst = new PasteBurst()
    for (const value of ['a', '中文', '🐳', 'long ordinary typed message']) {
      expect(burst.push(text(value), 100)).toEqual([text(value)])
    }
    expect(burst.push(key('enter'), 100)).toEqual([key('enter')])
  })

  it('buffers multiline reads without submitting their embedded Enter keys', () => {
    const burst = new PasteBurst()
    expect(burst.pushBatch([text('first'), key('enter'), text('中文 🐳'), key('enter')], 100)).toEqual([])
    expect(burst.flush(124)).toEqual([])
    expect(burst.flush(125)).toEqual([{ type: 'paste', value: 'first\n中文 🐳\n' }])
    expect(burst.push(key('enter'), 200)).toEqual([key('enter')])
  })

  it('protects Enter across chunk boundaries and a preceding timed flush', () => {
    const burst = new PasteBurst()
    burst.pushBatch([text('first'), key('enter'), text('second')], 100)
    expect(burst.flush(125)).toEqual([{ type: 'paste', value: 'first\nsecond' }])
    expect(burst.push(key('enter'), 130)).toEqual([])
    expect(burst.push(text('third'), 135)).toEqual([])
    expect(burst.flush(160)).toEqual([{ type: 'paste', value: '\nthird' }])
  })

  it('recognizes rapid single ASCII key streams without delaying their initial keys', () => {
    const burst = new PasteBurst()
    for (let i = 0; i < 7; i++) expect(burst.push(text('a'), 100 + i)).toEqual([text('a')])
    expect(burst.push(text('b'), 107)).toEqual([])
    expect(burst.push(key('enter'), 108)).toEqual([])
    expect(burst.flush(133)).toEqual([{ type: 'paste', value: 'b\n' }])
  })

  it('flushes before shortcuts, keeps order, and resets suppression after clear', () => {
    const burst = new PasteBurst()
    burst.pushBatch([text('a'), key('enter'), text('b')], 0)
    expect(burst.push(key('ctrl+c'), 1)).toEqual([{ type: 'paste', value: 'a\nb' }, key('ctrl+c')])
    burst.clear()
    expect(burst.push(key('enter'), 2)).toEqual([key('enter')])
    expect(burst.pending).toBe(false)
  })

  it('does not group a batch containing navigation or explicit paste boundaries', () => {
    const burst = new PasteBurst()
    expect(burst.pushBatch([text('a'), key('enter'), key('up'), text('b')], 0)).toEqual([
      text('a'), key('enter'), key('up'), text('b'),
    ])
  })
})

it('treats a large single-line chunk and its trailing Enter as a paste', () => {
  const burst = new PasteBurst(), source = '🐳'.repeat(1001)
  expect(burst.pushBatch([text(source), key('enter')], 100)).toEqual([])
  expect(burst.flush(125)).toEqual([{ type: 'paste', value: source + '\n' }])
})
