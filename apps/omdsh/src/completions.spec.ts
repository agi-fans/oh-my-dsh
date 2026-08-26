import { describe, expect, it } from 'vitest'
import { generateCompletions } from './completions.ts'

describe('generateCompletions', () => {
  it.each(['bash', 'zsh', 'fish'] as const)('generates %s from the canonical command and option metadata', (shell) => {
    const script = generateCompletions(shell)
    expect(script).toContain('omdsh')
    expect(script).toContain('completions')
    expect(script).toContain('plugin')
    expect(script).toContain('resume')
    expect(script).toContain('provider')
  })
})
