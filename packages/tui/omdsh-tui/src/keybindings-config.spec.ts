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
  })
})
