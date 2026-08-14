import { describe, expect, it } from 'vitest'
import { formatWorkspaceText } from './pwd.ts'

describe('formatWorkspaceText', () => {
  it('lists cwd, optional branch, and model', () => {
    expect(formatWorkspaceText({ cwd: '/proj', model: 'm' })).toBe(
      ['Workspace', '  cwd: /proj', '  model: m'].join('\n'),
    )
    expect(formatWorkspaceText({ cwd: '~/p', branch: 'main', model: 'flash' })).toBe(
      ['Workspace', '  cwd: ~/p', '  branch: main', '  model: flash'].join('\n'),
    )
  })
})
