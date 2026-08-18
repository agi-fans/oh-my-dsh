import { describe, expect, it } from 'vitest'
import { clipboardCommand } from './clipboard.ts'

describe('clipboardCommand', () => {
  it('picks the platform clipboard tool', () => {
    expect(clipboardCommand('darwin', {})).toEqual(['pbcopy'])
    expect(clipboardCommand('win32', {})).toEqual(['clip'])
    expect(clipboardCommand('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toEqual(['wl-copy'])
    expect(clipboardCommand('linux', { DISPLAY: ':0' })).toEqual(['xclip', '-selection', 'clipboard'])
    expect(clipboardCommand('linux', {})).toBeUndefined()
  })
})
