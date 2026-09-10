import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadKeybindings } from './keybindings-config.ts'

describe('loadKeybindings', () => {
  it('merges valid user bindings and ignores unknown actions', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'omdsh-keys-')), 'keys.json')
    writeFileSync(path, JSON.stringify({ 'ctrl+e': 'external-editor', bad: 'launch-missiles' }))
    const bindings = loadKeybindings(path)
    expect(bindings['ctrl+e']).toBe('external-editor')
    expect(bindings.bad).toBeUndefined()
    expect(bindings['alt+r']).toBe('retry')
    expect(bindings['ctrl+p']).toBe('cycle-model-forward')
    expect(bindings['alt+p']).toBe('cycle-model-backward')
    expect(bindings['ctrl+t']).toBe('cycle-reasoning')
  })

  it('ships configurable scroll, tool, and history actions', () => {
    const bindings = loadKeybindings(undefined)
    expect(bindings['ctrl+o']).toBe('toggle-tools')
    expect(bindings['pageup']).toBe('scroll-page-up')
    expect(bindings['pagedown']).toBe('scroll-page-down')
    expect(bindings['shift+up']).toBe('scroll-fast-up')
    expect(bindings['shift+down']).toBe('scroll-fast-down')
    expect(bindings['ctrl+r']).toBe('search-history')
  })

  it('lets a user move one of the new actions to another chord', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'omdsh-keys-')), 'keys.json')
    writeFileSync(path, JSON.stringify({ 'alt+o': 'toggle-tools', 'ctrl+o': 'retry' }))
    const bindings = loadKeybindings(path)
    expect(bindings['alt+o']).toBe('toggle-tools')
    // A user row replaces the shipped chord for the same key id.
    expect(bindings['ctrl+o']).toBe('retry')
  })
})
