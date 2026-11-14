import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Emit the CHANGELOG.md body of one released version as GitHub Release notes.
// The heading line stays out so the Release title can carry the version, and
// the comparison-link block at the bottom of the file never becomes notes.

const root = resolve(import.meta.dirname, '..')
const version = (process.argv[2] ?? '').replace(/^v/u, '')

if (version === '') {
  console.error('usage: node scripts/release-notes.mjs <version>')
  process.exit(2)
}

const lines = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/u)
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`))

if (start === -1) {
  console.error(`CHANGELOG.md has no "## [${version}]" section.`)
  process.exit(1)
}

let end = lines.findIndex((line, index) => index > start && line.startsWith('## ['))
if (end === -1) end = lines.length

const body = lines.slice(start + 1, end).join('\n').trim()

if (body === '') {
  console.error(`The "## [${version}]" section in CHANGELOG.md is empty.`)
  process.exit(1)
}

process.stdout.write(`${body}\n`)
