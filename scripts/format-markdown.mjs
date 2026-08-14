import { readFile, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const check = process.argv.includes('--check')
const skippedDirectories = new Set(['.git', 'lib', 'node_modules', 'refs'])

async function markdownFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path)
  }
  return files
}

function isStandaloneBlock(line) {
  const trimmed = line.trimStart()
  return /^(?:#{1,6}\s|>|<|\[[^\]]+\]:|(?:[-*_]\s*){3,}$)/u.test(trimmed)
    || /^\s{4}|^\t/u.test(line)
    || line.includes('|')
}

function listItem(line) {
  return /^(\s*(?:[-+*]|\d+[.)])\s+)(.*)$/u.exec(line)
}

function formatMarkdown(source) {
  const input = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  const output = []
  let paragraph = []
  let fence
  let frontmatter = input[0] === '---'

  const flush = () => {
    if (paragraph.length === 0) return
    output.push(paragraph.map(line => line.trim()).join(' '))
    paragraph = []
  }

  for (let index = 0; index < input.length; index += 1) {
    const line = input[index] ?? ''

    if (frontmatter) {
      output.push(line)
      if (index > 0 && line === '---') frontmatter = false
      continue
    }

    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line)
    if (fence !== undefined) {
      output.push(line)
      if (fenceMatch?.[1]?.startsWith(fence[0]) && fenceMatch[1].length >= fence.length) fence = undefined
      continue
    }
    if (fenceMatch?.[1] !== undefined) {
      flush()
      fence = fenceMatch[1]
      output.push(line)
      continue
    }

    if (line.trim() === '') {
      flush()
      if (output.at(-1) !== '') output.push('')
      continue
    }

    if (/ {2}$|\\$/u.test(line)) {
      flush()
      output.push(line)
      continue
    }

    const item = listItem(line)
    if (item !== null) {
      flush()
      paragraph = [(item[1] ?? '') + (item[2] ?? '').trim()]
      continue
    }

    if (isStandaloneBlock(line)) {
      flush()
      output.push(line)
      continue
    }

    paragraph.push(line)
  }
  flush()
  while (output.at(-1) === '') output.pop()
  return output.join('\n') + '\n'
}

const changed = []
for (const file of await markdownFiles(root)) {
  const source = await readFile(file, 'utf8')
  const formatted = formatMarkdown(source)
  if (formatted === source) continue
  changed.push(relative(root, file))
  if (!check) await writeFile(file, formatted)
}

if (changed.length > 0) {
  const action = check ? 'Need formatting' : 'Formatted'
  process.stdout.write(`${action}:\n${changed.map(file => `  ${file}`).join('\n')}\n`)
  if (check) process.exitCode = 1
}
