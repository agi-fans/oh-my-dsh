#!/usr/bin/env node
/**
 * Product files, lockfiles, and installed links must not resolve into refs/.
 * Reference submodule worktrees, when present, must stay clean.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const fail = (message) => {
  process.stderr.write(message + '\n')
  process.exitCode = 1
}

let grep = ''
try {
  grep = execFileSync(
    'git',
    [
      'grep',
      '-n',
      '-I',
      '-E',
      'refs/deepseek-harness|link:refs',
      '--',
      'package.json',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      'tsconfig.base.json',
      'apps',
      'packages',
      'scripts',
    ],
    { cwd: root, encoding: 'utf8' },
  )
} catch (error) {
  if (error.status !== 1) throw error
  grep = typeof error.stdout === 'string' ? error.stdout : ''
}

const productHits = grep.split('\n').filter((line) => {
  if (line === '') return false
  const path = line.slice(0, line.indexOf(':'))
  return !path.endsWith('.md')
})
if (productHits.length > 0) {
  fail(productHits.join('\n'))
  fail('product files must not reference refs/')
}

const links = execFileSync(
  'find',
  ['node_modules', 'apps', 'packages', '-type', 'l', '-lname', '*refs/deepseek-harness*', '-print'],
  { cwd: root, encoding: 'utf8' },
).trim()
if (links !== '') fail(links + '\ndependency symlink resolves into refs/')

for (const dir of ['refs/deepseek-harness', 'refs/oh-my-pi', 'refs/pi']) {
  if (!existsSync(new URL(`../${dir}/.git`, import.meta.url))) continue
  const dirty = execFileSync('git', ['-C', dir, 'status', '--short'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (dirty.trim() !== '') fail(`${dir} is dirty\n${dirty}`)
}

if (process.exitCode) process.exit(process.exitCode)
