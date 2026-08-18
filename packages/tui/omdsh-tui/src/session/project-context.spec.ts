import { describe, expect, it } from 'vitest'
import { resolveProjectContext, type GitRunner } from './project-context.ts'

describe('resolveProjectContext', () => {
  it('projects the worktree root, branch, modified files, and untracked files', () => {
    const responses = new Map([
      ['rev-parse --show-toplevel', '/workspace/project\n'],
      ['symbolic-ref --quiet --short HEAD', 'main\n'],
      ['status --porcelain=v1 --untracked-files=normal', ' M src/a.ts\nA  src/b.ts\n?? notes.txt\n'],
    ])
    const runner: GitRunner = (_cwd, args) => responses.get(args.join(' ')) ?? ''

    expect(resolveProjectContext('/workspace/project/apps/app', runner)).toEqual({
      root: '/workspace/project',
      branch: 'main',
      modified: 2,
      untracked: 1,
      gitLabel: 'main *2 ?1',
    })
  })

  it('keeps the cwd and omits Git labels outside a repository', () => {
    const runner: GitRunner = () => { throw new Error('not a repository') }
    expect(resolveProjectContext('/workspace/plain', runner)).toEqual({
      root: '/workspace/plain',
      modified: 0,
      untracked: 0,
    })
  })
})
