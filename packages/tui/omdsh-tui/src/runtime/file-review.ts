/** Bounded host-file previews and keyboard-driven document inspection. */

import { execFile, spawn } from 'node:child_process'
import { open, stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { TuiService } from '../definition.ts'
import { stripAnsi } from '../chrome/width.ts'
import { languageFromPath } from '../chrome/code-highlight.ts'

const exec = promisify(execFile)
export const PREVIEW_BYTES = 128 * 1024

/** Fence untrusted text without letting its own backticks end the block. */
export function codeDocument(text: string, language = ''): string {
  const clean = stripAnsi(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
  const longest = (clean.match(/`+/gu) ?? []).reduce((length, run) => Math.max(length, run.length), 2)
  const fence = '`'.repeat(longest + 1)
  return `${fence}${language}\n${clean}\n${fence}`
}

export async function gitOutput(cwd: string, args: readonly string[], signal: AbortSignal): Promise<string> {
  const { stdout } = await exec('git', [...args], { cwd, signal, maxBuffer: 2 * 1024 * 1024 })
  return stdout
}

/** Include staged, unstaged, deleted, and untracked paths without shell parsing. */
export async function changedPaths(cwd: string, signal: AbortSignal): Promise<string[]> {
  const results = await Promise.all([
    gitOutput(cwd, ['diff', '--name-only', '-z'], signal),
    gitOutput(cwd, ['diff', '--cached', '--name-only', '-z'], signal),
    gitOutput(cwd, ['ls-files', '--others', '--exclude-standard', '-z'], signal),
  ])
  return [...new Set(results.flatMap(result => result.split('\0').filter(Boolean)))].sort()
}

export async function filePreview(path: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  if (!(await stat(path)).isFile()) throw new Error('Select a regular file to preview.')
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Select a regular file to preview.')
    const bytes = Buffer.alloc(Math.min(PREVIEW_BYTES, stat.size))
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    signal.throwIfAborted()
    const data = bytes.subarray(0, bytesRead)
    if (data.includes(0) || ['.pdf', '.docx', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip'].includes(extname(path).toLowerCase())) return `Binary file · ${stat.size.toLocaleString()} bytes. Use Open to view it in its application.`
    const text = stripAnsi(data.toString('utf8')).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    const body = extname(path).toLowerCase() === '.md' ? text : codeDocument(text, languageFromPath(path) ?? '')
    return body + (stat.size > PREVIEW_BYTES ? '\n\nPreview truncated at 128 KiB; open the original to read more.' : '')
  } finally { await handle.close() }
}

/** Ask the OS to open an explicitly selected file, without a command shell. */
export async function openSystemFile(path: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open'
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, [resolve(path)], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`File opener exited with status ${String(code)}.`)))
  })
}

export interface ReviewFile { path: string; label: string; description?: string }

/** Keep file selection, document scrolling, and external opening in one loop. */
export async function reviewFiles(tui: TuiService, title: string, cwd: string, files: readonly ReviewFile[],
  readDiff: (index: number) => Promise<string>, signal: AbortSignal, initial?: number, hasDiff = true): Promise<void> {
  let index = initial
  let selected: string | undefined
  while (!signal.aborted) {
    if (index === undefined) {
      const answer = await tui.prompt({ title, question: 'Choose a file', emptyText: 'No files to review.',
        presentation: 'fullscreen-list', optionLayout: 'compact', filterable: true, allowCustom: false, signal, notify: false,
        ...(selected === undefined ? {} : { initialValue: selected }),
        options: files.map((file, at) => ({ label: file.label, value: String(at), ...(file.description === undefined ? {} : { description: file.description }) })) })
      if (answer === null) return
      index = Number(answer)
    }
    const file = files[index]
    if (file === undefined) return
    selected = String(index)
    let preview = false
    let feedback = ''
    while (!signal.aborted) {
      let detail: string
      try { detail = preview ? await filePreview(resolve(cwd, file.path), signal) : await readDiff(index) }
      catch (error) { if (signal.aborted) return; detail = error instanceof Error ? error.message : String(error) }
      if (feedback !== '') detail = feedback + '\n\n' + detail
      const multiple = files.length > 1
      const options = [{ label: 'Files', value: 'files' }, ...(hasDiff ? [{ label: preview ? 'Diff' : 'Preview', value: 'preview' }] : []),
        ...(multiple ? [{ label: 'Previous', value: 'previous' }, { label: 'Next', value: 'next' }] : []), { label: 'Open', value: 'open' },
        ...(tui.openFileInEditor === undefined ? [] : [{ label: 'Editor', value: 'editor' }])]
      const action = await tui.prompt({ title: `${title} · ${index + 1}/${files.length}`, question: file.label, detail,
        presentation: 'document', options, allowCustom: false, signal, notify: false,
        actions: [{ key: 'f', label: 'files', valuePrefix: 'files' }, ...(hasDiff ? [{ key: 'v', label: 'preview/diff', valuePrefix: 'preview' }] : []),
          ...(multiple ? [{ key: 'n', label: 'next', valuePrefix: 'next' }, { key: 'p', label: 'previous', valuePrefix: 'previous' }] : []), { key: 'o', label: 'open', valuePrefix: 'open' },
          ...(tui.openFileInEditor === undefined ? [] : [{ key: 'e', label: 'editor', valuePrefix: 'editor' }])] })
      if (action === null || action === 'files') { index = undefined; break }
      if (action === 'preview') { preview = !preview; feedback = ''; continue }
      if (action === 'next' || action === 'previous') { index = (index + files.length + (action === 'next' ? 1 : -1)) % files.length; break }
      try {
        if (action === 'editor') {
          tui.openFileInEditor?.(resolve(cwd, file.path))
          feedback = 'Editor command completed.'
        } else if (action === 'open') {
          await openSystemFile(resolve(cwd, file.path))
          feedback = 'Opened in the default application.'
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        feedback = 'Action failed:\n\n' + codeDocument(message)
        tui.notice(message, { level: 'error' })
      }
    }
  }
}
