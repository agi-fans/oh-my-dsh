import { describe, expect, it } from 'vitest'
import {
  applyCopySelectorEvent,
  createCopySelector,
  renderCopySelector,
} from './copy-selector.ts'
import type { CopyPick } from './copy-targets.ts'
import { createTheme } from '../chrome/theme.ts'
import type { KeyEvent } from '../input/keys.ts'

const theme = createTheme(false)
const key = (id: string): KeyEvent => ({ type: 'key', id })

const items: CopyPick[] = [
  { id: 'msg:1', label: 'hello from the model', hint: '1 line', text: 'hello from the model', copyMessage: 'last message' },
  { id: 'code:1', label: 'const x = 1', hint: 'ts · 1 line', text: 'const x = 1', copyMessage: 'ts block' },
  { id: 'cmd:1', label: 'pwd', hint: 'bash · 1 line', text: 'pwd', copyMessage: 'bash command' },
]

describe('applyCopySelectorEvent', () => {
  it('picks the focused row on enter or space', () => {
    const open = createCopySelector(items, 1)
    expect(applyCopySelectorEvent(open, key('enter'))).toEqual({ kind: 'pick', item: items[1] })
    expect(applyCopySelectorEvent(open, { type: 'text', value: ' ' })).toEqual({ kind: 'pick', item: items[1] })
  })

  it('moves between rows and closes on escape', () => {
    const open = createCopySelector(items)
    const down = applyCopySelectorEvent(open, key('down'))
    expect(down).toEqual({ kind: 'update', state: { items, selected: 1 } })
    const wrap = applyCopySelectorEvent(down.kind === 'update' ? down.state : open, key('down'))
    expect(wrap.kind === 'update' && wrap.state.selected).toBe(2)
    const again = applyCopySelectorEvent(wrap.kind === 'update' ? wrap.state : open, key('down'))
    expect(again.kind === 'update' && again.state.selected).toBe(0)
    expect(applyCopySelectorEvent(open, key('escape'))).toEqual({ kind: 'close' })
    expect(applyCopySelectorEvent(open, key('ctrl+c'))).toEqual({ kind: 'close' })
  })

  it('filters rows with text input and clears filter on escape before closing', () => {
    const open = createCopySelector(items)
    expect(applyCopySelectorEvent(open, key('ctrl+k'))).toEqual({ kind: 'ignore' })
    const filtered = applyCopySelectorEvent(open, { type: 'text', value: 'pwd' })
    expect(filtered).toEqual({ kind: 'update', state: { items, selected: 0, search: 'pwd' } })
    if (filtered.kind === 'update') {
      expect(applyCopySelectorEvent(filtered.state, key('enter'))).toEqual({ kind: 'pick', item: items[2] })
      const cleared = applyCopySelectorEvent(filtered.state, key('escape'))
      expect(cleared).toEqual({ kind: 'update', state: { items, selected: 0 } })
      if (cleared.kind === 'update') {
        expect(applyCopySelectorEvent(cleared.state, key('escape'))).toEqual({ kind: 'close' })
      }
    }
  })
})

describe('renderCopySelector', () => {
  it('paints the title, rows, preview, and hints', () => {
    const lines = renderCopySelector(createCopySelector(items), theme, 50).lines.join('\n')
    expect(lines).toContain('Copy')
    expect(lines).toContain('hello from the model')
    expect(lines).toContain('const x = 1')
    expect(lines).toContain('pwd')
    expect(lines).toContain('Preview')
    expect(lines).toContain('enter copy')
  })

  it('shows active filter query and empty match state', () => {
    const filtered = renderCopySelector({ items, selected: 0, search: 'nomatch' }, theme, 50).lines.join('\n')
    expect(filtered).toContain('Search: nomatch')
    expect(filtered).toContain('No matching copy targets.')
  })
})
