#!/usr/bin/env node
/**
 * Syncs docs/ and CHANGELOG.md into the VitePress src tree. The repository
 * docs stay the documentation source of truth; everything this script writes
 * is generated output and must never be committed.
 *
 * Transformations applied to synced Markdown:
 * - drop the `[English](...) | [简体中文](...)` language-toggle line
 * - rewrite `*.zh-CN.md` link targets inside Chinese content to the locale tree
 * - rewrite relative links that escape docs/ (AGENTS.md, examples/, apps/) to
 *   their github.com/agi-fans/oh-my-dsh blob or tree URLs
 */
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const siteDir = fileURLToPath(new URL('..', import.meta.url))
const rootDir = resolve(siteDir, '../..')
const docsDir = join(rootDir, 'docs')
const srcDir = join(siteDir, 'src')
const changelogPath = join(rootDir, 'CHANGELOG.md')

const languageToggle = /^\[English\]\([^)]*\)\s*\|\s*(?:\[简体中文\]\([^)]*\)|简体中文)\s*$/
const fenceStart = /^\s*(`{3,}|~{3,})/

function githubUrl(absolute) {
  const kind = statSync(absolute).isDirectory() ? 'tree' : 'blob'
  return `https://github.com/agi-fans/oh-my-dsh/${kind}/main/${relative(rootDir, absolute)}`
}

function rewriteTarget(target, chinese, sourceDir) {
  if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) return target
  const hash = target.indexOf('#')
  const anchor = hash === -1 ? '' : target.slice(hash)
  let path = hash === -1 ? target : target.slice(0, hash)
  if (chinese && path.endsWith('.zh-CN.md')) path = path.slice(0, -'.zh-CN.md'.length) + '.md'
  const absolute = resolve(sourceDir, path)
  if (relative(docsDir, absolute).startsWith('..')) {
    if (!existsSync(absolute)) return target
    return githubUrl(absolute) + anchor
  }
  return path + anchor
}

function transform(source, { chinese, sourcePath }) {
  const sourceDir = dirname(sourcePath)
  const output = []
  let fence
  for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
    const match = fenceStart.exec(line)
    if (fence !== undefined) {
      output.push(line)
      if (match?.[1]?.startsWith(fence[0]) && match[1].length >= fence.length) fence = undefined
      continue
    }
    if (match?.[1] !== undefined) {
      fence = match[1]
      output.push(line)
      continue
    }
    if (languageToggle.test(line)) continue
    output.push(line.replaceAll(/(\]\(|^\[[^\]]+\]:\s*)([^\s)]+)/g, (whole, prefix, target) => {
      return prefix + rewriteTarget(target, chinese, sourceDir)
    }))
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n')
}

async function collectMarkdown(directory, targets) {
  const pairs = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    if (entry.name.endsWith('.zh-CN.md')) {
      pairs.push({ source: join(directory, entry.name), target: join(targets.zh, entry.name.replace('.zh-CN.md', '.md')), chinese: true })
    } else {
      pairs.push({ source: join(directory, entry.name), target: join(targets.en, entry.name), chinese: false })
    }
  }
  return pairs
}

for (const stale of [
  join(srcDir, 'docs'),
  join(srcDir, 'zh', 'docs'),
  join(srcDir, 'changelog.md'),
  join(srcDir, 'zh', 'changelog.md'),
]) {
  await rm(stale, { recursive: true, force: true })
}

const pairs = [
  ...await collectMarkdown(docsDir, { en: join(srcDir, 'docs'), zh: join(srcDir, 'zh', 'docs') }),
  ...await collectMarkdown(join(docsDir, 'tutorials'), { en: join(srcDir, 'docs', 'tutorials'), zh: join(srcDir, 'zh', 'docs', 'tutorials') }),
  { source: changelogPath, target: join(srcDir, 'changelog.md'), chinese: false },
  { source: changelogPath, target: join(srcDir, 'zh', 'changelog.md'), chinese: false },
]

for (const { source, target, chinese } of pairs) {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, transform(await readFile(source, 'utf8'), { chinese, sourcePath: source }))
}

process.stdout.write(`Synced ${pairs.length} Markdown files into ${relative(rootDir, srcDir)}\n`)
