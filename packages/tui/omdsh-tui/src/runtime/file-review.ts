/** Bounded host-file previews and keyboard-driven document inspection. */

import { execFile, spawn } from 'node:child_process'
import { open, stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { StringDecoder } from 'node:string_decoder'
import type { TuiDocumentPosition, TuiDocumentSource, TuiService } from '../definition.ts'
import { stripAnsi } from '../chrome/width.ts'
import { languageFromPath } from '../chrome/code-highlight.ts'

const exec = promisify(execFile)
export const PREVIEW_BYTES = 128 * 1024
export const MAX_PREVIEW_BYTES = 4 * 1024 * 1024

export interface FileDocument extends TuiDocumentSource { truncated?: boolean; binary?: boolean }

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
  const source = await fileDocument(path, signal)
  if (source.binary) return source.text
  const body = extname(path).toLowerCase() === '.md' ? source.text : codeDocument(source.text, source.language ?? '')
  return body + (source.truncated ? '\n\nPreview truncated at 128 KiB; open the original to read more.' : '')
}

/** Read an explicitly bounded prefix; incomplete UTF-8 characters await the next load. */
export async function fileDocument(path: string, signal: AbortSignal, limit = PREVIEW_BYTES): Promise<FileDocument> {
  signal.throwIfAborted()
  if (!(await stat(path)).isFile()) throw new Error('Select a regular file to preview.')
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Select a regular file to preview.')
    const bytes = Buffer.alloc(Math.min(MAX_PREVIEW_BYTES, Math.max(PREVIEW_BYTES, limit), stat.size))
    let bytesRead = 0
    while (bytesRead < bytes.length) {
      signal.throwIfAborted()
      const read = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead)
      if (read.bytesRead === 0) break
      bytesRead += read.bytesRead
    }
    signal.throwIfAborted()
    const data = bytes.subarray(0, bytesRead)
    if (data.includes(0) || ['.pdf', '.docx', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip'].includes(extname(path).toLowerCase())) return { binary: true, text: `Binary file · ${stat.size.toLocaleString()} bytes. Use Open to view it in its application.` }
    const truncated = bytesRead < stat.size
    const decoder = new StringDecoder('utf8')
    const text = stripAnsi(decoder.write(data) + (truncated ? '' : decoder.end())).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    const language = languageFromPath(path)
    return { text, ...(language === undefined ? {} : { language }), truncated,
      ...(truncated ? { status: `${Math.ceil(bytesRead / 1024)} KiB of ${Math.ceil(stat.size / 1024)} KiB · ${bytesRead >= MAX_PREVIEW_BYTES ? 'Preview limit reached; Open reads the original.' : 'L loads more'}` } : {}) }
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
  readDiff: (index: number) => Promise<string | TuiDocumentSource>, signal: AbortSignal, initial?: number, hasDiff = true): Promise<void> {
  let index = initial
  let selected: string | undefined
  const positions = new Map<string, TuiDocumentPosition>()
  const limits = new Map<number, number>()
  const modes = new Map<number, 'diff' | 'source' | 'markdown'>()
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
    let feedback = ''
    while (!signal.aborted) {
      const mode = modes.get(index) ?? (hasDiff ? 'diff' : 'source')
      const preview = mode !== 'diff'
      const key = `${index}:${mode}`
      let detail = ''
      let source: TuiDocumentSource | undefined
      let loaded: FileDocument | undefined
      try {
        const content = preview ? loaded = await fileDocument(resolve(cwd, file.path), signal, limits.get(index)) : await readDiff(index)
        if (typeof content !== 'string' && content.diff !== true && hasDiff && !preview && 'truncated' in content) {
          modes.set(index, 'source'); continue
        }
        if (typeof content === 'string') detail = content
        else if ('binary' in content && content.binary === true) detail = content.text
        else if (mode === 'markdown') detail = content.text
        else source = { ...content, ...(feedback === '' ? {} : { status: feedback + (content.status === undefined ? '' : ` · ${content.status}`) }) }
      }
      catch (error) { if (signal.aborted) return; detail = error instanceof Error ? error.message : String(error) }
      if (source === undefined && feedback !== '') detail = feedback + '\n\n' + detail
      const multiple = files.length > 1
      const options = [{ label: 'Files', value: 'files' }, ...(hasDiff ? [{ label: preview ? 'Diff' : 'Preview', value: 'preview' }] : []),
        ...(multiple ? [{ label: 'Previous', value: 'previous' }, { label: 'Next', value: 'next' }] : []), { label: 'Open', value: 'open' },
        ...(tui.openFileInEditor === undefined ? [] : [{ label: 'Editor', value: 'editor' }]),
        ...(preview && extname(file.path).toLowerCase() === '.md' && loaded !== undefined && loaded.binary !== true ? [{ label: mode === 'markdown' ? 'Source' : 'Markdown', value: 'markdown' }] : []),
        ...(loaded?.truncated === true && (limits.get(index) ?? PREVIEW_BYTES) < MAX_PREVIEW_BYTES ? [{ label: 'Load more', value: 'more' }] : [])]
      const position = positions.get(key)
      const action = await tui.prompt({ title: `${title} · ${index + 1}/${files.length}`, question: file.label, detail,
        ...(source === undefined ? {} : { documentSource: source }), ...(position === undefined ? {} : { documentPosition: position }), onDocumentPosition: position => { positions.set(key, position) },
        presentation: 'document', options, allowCustom: false, signal, notify: false,
        actions: [{ key: 'f', label: 'files', valuePrefix: 'files' }, ...(hasDiff ? [{ key: 'v', label: 'preview/diff', valuePrefix: 'preview' }] : []),
          ...(multiple ? [{ key: 'n', label: 'next', valuePrefix: 'next' }, { key: 'p', label: 'previous', valuePrefix: 'previous' }] : []), { key: 'o', label: 'open', valuePrefix: 'open' },
          ...(tui.openFileInEditor === undefined ? [] : [{ key: 'e', label: 'editor', valuePrefix: 'editor' }]),
          ...(options.some(option => option.value === 'markdown') ? [{ key: 'm', label: 'source/markdown', valuePrefix: 'markdown' }] : []),
          ...(options.some(option => option.value === 'more') ? [{ key: 'l', label: 'load more', valuePrefix: 'more' }] : [])] })
      if (action === null || action === 'files') { index = undefined; break }
      if (action === 'preview') { modes.set(index, preview ? 'diff' : 'source'); feedback = ''; continue }
      if (action === 'markdown') { modes.set(index, mode === 'markdown' ? 'source' : 'markdown'); feedback = ''; continue }
      if (action === 'more') { limits.set(index, Math.min(MAX_PREVIEW_BYTES, (limits.get(index) ?? PREVIEW_BYTES) * 2)); feedback = ''; continue }
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
        feedback = 'Action failed: ' + stripAnsi(message).replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        tui.notice(message, { level: 'error' })
      }
    }
  }
}
