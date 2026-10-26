import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { keysForAction } from '../views/hotkeys.ts'
import { reportBindingConflicts } from './actions.ts'
import { loadKeybindings, saveKeybindings } from './keybindings-config.ts'

describe('loadKeybindings', () => {
  it('merges valid user bindings and ignores unknown actions', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'omdsh-keys-')), 'keys.json')
    writeFileSync(path, JSON.stringify({ 'ctrl+e': 'external-editor', bad: 'launch-missiles' }))
    const bindings = loadKeybindings(path)
    expect(bindings['ctrl+e']).toBe('external-editor')
    expect(bindings.bad).toBeUndefined()
    expect(bindings['alt+r']).toBe('retry')
    expect(bindings['ctrl+p']).toBe('cycle-model-forward')
    // A migration alias still resolves, so Pi habits keep working.
    expect(bindings['ctrl+shift+p']).toBe('cycle-model-backward')
    expect(bindings['alt+p']).toBe('cycle-model-backward')
    expect(bindings['ctrl+t']).toBe('toggle-thinking')
    expect(bindings['shift+tab']).toBe('cycle-thinking')
  })

  it('reports the chords a user document makes ambiguous', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'omdsh-keys-')), 'keys.json')
    writeFileSync(path, JSON.stringify({ 'ctrl+o': 'retry' }))
    const conflicts = reportBindingConflicts(loadKeybindings(path))
    // Ctrl+O now answers to `retry`, so `toggle-tools` has no key left and the
    // document says why instead of leaving the shortcut silently unusable.
    expect(conflicts).toEqual([])
    expect(loadKeybindings(path)['ctrl+o']).toBe('retry')
    expect(keysForAction(loadKeybindings(path), 'toggle-tools')).toBe('Disabled')
  })

  it('hides migration aliases from the keys a hint prints', () => {
    const bindings = loadKeybindings(undefined)
    // Both chords resolve, but only the shipped primary is taught.
    expect(keysForAction(bindings, 'search-transcript')).toBe('Ctrl+Shift+F')
    expect(keysForAction(bindings, 'copy-prompt')).toBe('Alt+C')
    expect(keysForAction(bindings, 'external-editor')).toBe('Ctrl+X / Ctrl+G')
    expect(keysForAction(bindings, 'interrupt')).toBe('Esc')
  })

  it('ships configurable scroll, tool, stash, and history actions', () => {
    const bindings = loadKeybindings(undefined)
    expect(bindings['alt+i']).toBe('expand-paste')
    expect(bindings['alt+s']).toBe('steer-turn')
    expect(bindings['ctrl+s']).toBe('stash-draft')
    expect(bindings['ctrl+o']).toBe('toggle-tools')
    expect(bindings['alt+o']).toBe('toggle-tool-details')
    expect(bindings['pageup']).toBe('scroll-page-up')
    expect(bindings['pagedown']).toBe('scroll-page-down')
    expect(bindings['shift+up']).toBe('scroll-fast-up')
    expect(bindings['shift+down']).toBe('scroll-fast-down')
    expect(bindings['ctrl+r']).toBe('search-history')
  })

  it('lets a user move one of the new actions to another chord or unbind a default', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'omdsh-keys-')), 'keys.json')
    writeFileSync(path, JSON.stringify({ 'alt+o': 'toggle-tools', 'ctrl+o': 'retry', 'ctrl+s': null }))
    const bindings = loadKeybindings(path)
    expect(bindings['alt+o']).toBe('toggle-tools')
    // A user row replaces the shipped chord for the same key id.
    expect(bindings['ctrl+o']).toBe('retry')
    expect(bindings['ctrl+s']).toBeUndefined()
  })

  it('persists custom keybindings and unbinds removed defaults via saveKeybindings', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'omdsh-keys-')), 'nested', 'keybindings.json')
    const defaults = loadKeybindings(undefined)
    const { 'ctrl+s': _removed, ...next } = defaults
    next['alt+d'] = 'stash-draft'
    saveKeybindings(path, next)
    const reloaded = loadKeybindings(path)
    expect(reloaded['ctrl+s']).toBeUndefined()
    expect(reloaded['alt+d']).toBe('stash-draft')
    expect(keysForAction(reloaded, 'stash-draft')).toBe('Alt+D')
  })
})
