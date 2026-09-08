import { describe, expect, it } from 'vitest'
import { expandToolAliases, shellToolName } from './agent-profile.ts'

describe('agent preset tool aliases', () => {
  it('maps the shell alias to the platform shell tool', () => {
    expect(shellToolName('darwin')).toBe('bash')
    expect(shellToolName('linux')).toBe('bash')
    expect(shellToolName('win32')).toBe('pwsh')
    expect(expandToolAliases({ allow: ['shell', 'str_replace_editor'] }, 'win32'))
      .toEqual({ allow: ['pwsh', 'str_replace_editor'] })
    expect(expandToolAliases({ allow: ['shell', 'str_replace_editor'] }, 'linux'))
      .toEqual({ allow: ['bash', 'str_replace_editor'] })
  })

  it('leaves other names, duplicates, and deny lists untouched', () => {
    expect(expandToolAliases({ allow: ['read', 'read'] }, 'win32')).toEqual({ allow: ['read'] })
    expect(expandToolAliases({ deny: ['shell'] }, 'win32')).toEqual({ deny: ['shell'] })
    expect(expandToolAliases({}, 'win32')).toEqual({})
  })
})
