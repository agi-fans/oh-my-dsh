import { describe, expect, it } from 'vitest'
import { edgeIndex, listNavigation, navigateIndex } from './list-navigation.ts'
import type { KeyEvent } from '../input/keys.ts'

const key = (id: string): KeyEvent => ({ type: 'key', id })

describe('listNavigation', () => {
  it('reads the movement keys every list shares', () => {
    expect(listNavigation(key('up'))).toEqual({ kind: 'move', delta: -1 })
    expect(listNavigation(key('down'))).toEqual({ kind: 'move', delta: 1 })
    // Tab moves like an arrow in a list; the panel-switching overlay handles it
    // first and never asks.
    expect(listNavigation(key('shift+tab'))).toEqual({ kind: 'move', delta: -1 })
    expect(listNavigation(key('tab'))).toEqual({ kind: 'move', delta: 1 })
  })

  it('reads edges and pages', () => {
    expect(listNavigation(key('home'))).toEqual({ kind: 'edge', edge: 'first' })
    expect(listNavigation(key('end'))).toEqual({ kind: 'edge', edge: 'last' })
    expect(listNavigation(key('pageUp'))).toEqual({ kind: 'page', direction: -1 })
    expect(listNavigation(key('pageDown'))).toEqual({ kind: 'page', direction: 1 })
  })

  it('treats both closing keys as one intent', () => {
    // A reader should not have to learn which key this overlay prefers.
    expect(listNavigation(key('escape'))).toEqual({ kind: 'close' })
    expect(listNavigation(key('ctrl+c'))).toEqual({ kind: 'close' })
  })

  it('reports anything else as none, including text', () => {
    expect(listNavigation(key('ctrl+t'))).toEqual({ kind: 'none' })
    expect(listNavigation({ type: 'text', value: 't' })).toEqual({ kind: 'none' })
    expect(listNavigation({ type: 'paste-start' })).toEqual({ kind: 'none' })
  })
})

describe('navigateIndex', () => {
  it('wraps at both ends, which is what a filtered list expects', () => {
    expect(navigateIndex({ kind: 'move', delta: -1 }, 0, 5, 3)).toBe(4)
    expect(navigateIndex({ kind: 'move', delta: 1 }, 4, 5, 3)).toBe(0)
  })

  it('pages by the surface page size', () => {
    expect(navigateIndex({ kind: 'page', direction: 1 }, 0, 20, 5)).toBe(5)
    expect(navigateIndex({ kind: 'page', direction: -1 }, 0, 20, 5)).toBe(15)
  })

  it('clamps instead of wrapping when the surface asks', () => {
    expect(navigateIndex({ kind: 'move', delta: 1 }, 4, 5, 3, { wrap: false })).toBe(4)
    expect(navigateIndex({ kind: 'move', delta: -1 }, 0, 5, 3, { wrap: false })).toBe(0)
  })

  it('keeps the selection when there is nothing to move through', () => {
    expect(navigateIndex({ kind: 'move', delta: 1 }, 3, 0, 3)).toBe(3)
  })

  it('never pages by zero even if a surface reports a tiny pane', () => {
    expect(navigateIndex({ kind: 'page', direction: 1 }, 0, 10, 0)).toBe(1)
  })
})

describe('edgeIndex', () => {
  it('answers the first and last row', () => {
    expect(edgeIndex({ kind: 'edge', edge: 'first' }, 5)).toBe(0)
    expect(edgeIndex({ kind: 'edge', edge: 'last' }, 5)).toBe(4)
    // An empty list still has a valid index 0 rather than a negative one.
    expect(edgeIndex({ kind: 'edge', edge: 'last' }, 0)).toBe(0)
  })
})

describe('overlay agreement', () => {
  // Each overlay used to carry its own switch over these keys. This pins the
  // intent they must share, so a new overlay cannot quietly disagree and an
  // existing one cannot drift.
  const shared = ['up', 'down', 'tab', 'shift+tab', 'home', 'end', 'pageUp', 'pageDown']

  it('agrees about movement on every key a list spends on it', () => {
    for (const id of shared) {
      const intent = listNavigation(key(id))
      expect(intent.kind, `${id} must be navigation`).not.toBe('none')
    }
  })

  it('agrees that escape and ctrl+c mean one thing', () => {
    expect(listNavigation(key('escape'))).toEqual(listNavigation(key('ctrl+c')))
  })
})
