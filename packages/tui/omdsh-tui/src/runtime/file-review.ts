/** Bounded host-file previews and keyboard-driven document inspection. */

import { execFile } from 'node:child_process'
import { open, stat } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { StringDecoder } from 'node:string_decoder'
import type { TuiDocumentPosition, TuiDocumentSource, TuiService, TuiReviewFile, TuiPrompt } from '../definition.ts'
import { stripAnsi } from '../chrome/width.ts'
import { documentModel } from '../views/document-reader.ts'
import { parseLocalFileLinkCandidates, type LocalFileLink } from '../views/local-file-link.ts'
import { openSystemFile } from './file-open.ts'
import { imageFile, imageMediaType } from './image-preview.ts'
import type { PreviewImage } from '../chrome/terminal-images.ts'
import { languageFromPath } from '../chrome/code-highlight.ts'

export { openSystemFile } from './file-open.ts'

const exec = promisify(execFile)
export const PREVIEW_BYTES = 128 * 1024
export const MAX_PREVIEW_BYTES = 4 * 1024 * 1024

export interface FileDocument extends TuiDocumentSource { truncated?: boolean; binary?: boolean }

export function formatQuoteReference(cwd: string, file: ReviewFile, source: TuiDocumentSource | undefined, position: TuiDocumentPosition | undefined): string {
  const rel = relative(cwd, resolve(cwd, file.path)).replaceAll('\\', '/')
  const rawPath = rel !== '' && !rel.startsWith('..') ? rel : file.path.replaceAll('\\', '/')
  const quotedPath = /\s/u.test(rawPath) ? `"${rawPath.replaceAll('"', '\\"')}"` : rawPath
  let line = file.line
  if (source !== undefined) {
    const model = documentModel(source)
    const startRow = Math.max(0, Math.min(position?.row ?? 0, Math.max(0, model.numbers.length - 1)))
    for (let at = startRow; at < model.numbers.length; at += 1) {
      const candidate = model.numbers[at]?.next ?? model.numbers[at]?.old
      if (candidate !== undefined) {
        line = candidate
        break
      }
    }
    if (line === undefined && source.diff !== true) line = (source.firstLine ?? 1) + startRow
  }
  return `@${quotedPath}${line === undefined ? '' : `:${line}`}`
}

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

/** Git's NUL records retain literal whitespace and both sides of a rename. */
export async function changedFiles(cwd: string, signal: AbortSignal): Promise<ReviewFile[]> {
  const status = await gitOutput(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal)
  const records = status.split('\0')
  const files: ReviewFile[] = []
  for (let at = 0; at < records.length; at++) {
    const record = records[at]!
    if (record.length < 4) continue
    const xy = record.slice(0, 2), path = record.slice(3)
    const previousPath = /[RC]/u.test(xy) ? records[++at] : undefined
    const kind = xy === '??' ? '?' : xy.includes('U') || xy === 'AA' || xy === 'DD' ? 'U'
      : xy.includes('R') ? 'R' : xy.includes('D') ? 'D' : xy.includes('A') ? 'A' : xy.includes('C') ? 'C' : 'M'
    const scope = xy === '??' ? 'untracked' : xy[0] !== ' ' && xy[1] !== ' ' ? 'staged + working tree' : xy[0] !== ' ' ? 'staged' : 'working tree'
    files.push({ path, label: path, status: kind, description: scope, ...(previousPath === undefined ? {} : { previousPath }) })
  }
  let numstat: string
  try { numstat = await gitOutput(cwd, ['diff', 'HEAD', '--numstat', '-z'], signal) }
  catch { numstat = await gitOutput(cwd, ['diff', '--cached', '--numstat', '-z'], signal) }
  const stats = numstat.split('\0')
  for (let at = 0; at < stats.length; at++) {
    const record = stats[at]!, match = /^(\d+|-)\t(\d+|-)\t(.*)$/su.exec(record)
    if (!match) continue
    let path = match[3]!
    if (path === '') { at++; path = stats[++at] ?? '' }
    const file = files.find(file => file.path === path)
    if (file !== undefined) file.description = (match[1] === '-' ? 'binary' : `+${match[1]} −${match[2]}`) + ` · ${file.description}`
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
}

/** Include staged, unstaged, deleted, and untracked paths without shell parsing. */
export async function changedPaths(cwd: string, signal: AbortSignal): Promise<string[]> {
  return (await changedFiles(cwd, signal)).map(file => file.path)
}

export async function filePreview(path: string, signal: AbortSignal): Promise<string> {
  const source = await fileDocument(path, signal)
  if (source.binary) return source.text
  const body = extname(path).toLowerCase() === '.md' ? source.text : codeDocument(source.text, source.language ?? '')
  return body + (source.truncated ? '\n\nPreview truncated at 128 KiB; open the original to read more.' : '')
}

/** Read an explicitly bounded prefix; incomplete UTF-8 characters await the next load. */
export async function fileDocument(path: string, signal: AbortSignal, limit = PREVIEW_BYTES, sourcePath = path): Promise<FileDocument> {
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
    const truncated = bytesRead < stat.size
    let invalidUtf8 = false
    try { new TextDecoder('utf-8', { fatal: true }).decode(data, { stream: truncated }) } catch { invalidUtf8 = true }
    if (invalidUtf8 || data.includes(0) || ['.pdf', '.docx', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip'].includes(extname(sourcePath).toLowerCase())) return { binary: true, text: `Binary file · ${stat.size.toLocaleString()} bytes. Use Open to view it in its application.` }
    const decoder = new StringDecoder('utf8')
    const text = stripAnsi(decoder.write(data) + (truncated ? '' : decoder.end())).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    const language = languageFromPath(sourcePath)
    return { text, ...(language === undefined ? {} : { language }), truncated,
      ...(truncated ? { status: `${Math.ceil(bytesRead / 1024)} KiB of ${Math.ceil(stat.size / 1024)} KiB · ${bytesRead >= MAX_PREVIEW_BYTES ? 'Preview limit reached; Open reads the original.' : 'L loads more'}` } : {}) }
  } finally { await handle.close() }
}

export type ReviewFile = TuiReviewFile
export type FileReviewSurface = Pick<TuiService, 'prompt' | 'notice' | 'openFileInEditor' | 'insertText' | 'reviewFiles'>

/** Keep file selection, document scrolling, and external opening in one loop. */
export async function reviewFiles(tui: FileReviewSurface, title: string, cwd: string, files: readonly ReviewFile[],
  readDiff: (index: number, signal: AbortSignal) => Promise<string | TuiDocumentSource>, signal: AbortSignal, initial?: number, hasDiff = true): Promise<void> {
  if (hasDiff && tui.reviewFiles !== undefined) {
    await tui.reviewFiles({ title, files, signal, ...(initial === undefined ? {} : { initial }),
      canEdit: tui.openFileInEditor !== undefined, canQuote: tui.insertText !== undefined,
      read: async (index, mode, limit, readSignal) => {
        if (mode === 'source') {
          const content = await fileDocument(resolve(cwd, files[index]!.path), readSignal, limit)
          return content.binary ? { message: content.text } : { source: content, truncated: content.truncated === true }
        }
        const content = await readDiff(index, readSignal)
        readSignal.throwIfAborted()
        if (typeof content === 'string') return { message: content }
        // Empty comparisons must explain why; a current file is never an implicit historical fallback.
        if (content.diff !== true) return { message: content.status ?? 'No comparison is available. Press V to view the current file.' }
        return { source: content }
      },
      action: async (action, index, source, position) => {
        const file = files[index]!
        if (action === 'editor') tui.openFileInEditor?.(resolve(cwd, file.path))
        else if (action === 'open') await openSystemFile(resolve(cwd, file.path), signal)
        else if (action === 'image') {
          const image = await imageFile(resolve(cwd, file.path), signal)
          if (image !== undefined) await tui.prompt({ title: file.label, question: 'Current file', documentImage: image,
            presentation: 'document', options: [{ label: 'Back', value: 'back' }], allowCustom: false, notify: false, signal })
        } else {
          const ref = formatQuoteReference(cwd, file, source, position)
          tui.insertText?.(ref)
          tui.notice(`Quoted ${ref} in composer.`)
        }
      },
    })
    return
  }
  let index = initial
  let selected: string | undefined
  const positions = new Map<string, TuiDocumentPosition>()
  const limits = new Map<number, number>()
  const modes = new Map<number, 'diff' | 'source' | 'markdown'>()
  while (!signal.aborted) {
    if (index === undefined) {
      const answer = await tui.prompt({ title, question: 'Choose a file', emptyText: 'No files to review.',
        presentation: 'card', filterable: true, allowCustom: false, signal, notify: false,
        ...(selected === undefined ? {} : { initialValue: selected }),
        options: files.map((file, at) => ({ label: file.label, value: String(at), ...(file.description === undefined ? {} : { description: file.description }) })) })
      if (answer === null) return
      index = Number(answer)
    }
    const file = files[index]
    if (file === undefined) return
    selected = String(index)
    let feedback = ''
    let previewImage: PreviewImage | undefined
    while (!signal.aborted) {
      const mode = modes.get(index) ?? (hasDiff ? 'diff' : 'source')
      const preview = mode !== 'diff'
      const key = `${index}:${mode}`
      let detail = ''
      let source: TuiDocumentSource | undefined
      let loaded: FileDocument | undefined
      let image: PreviewImage | undefined
      try {
        if (preview && imageMediaType(file.path) !== undefined) image = previewImage ??= await imageFile(resolve(cwd, file.path), signal)
        let content: string | FileDocument = image !== undefined ? { binary: true, text: '' } : preview ? loaded = await fileDocument(resolve(cwd, file.path), signal, limits.get(index)) : await readDiff(index, signal)
        if (typeof content !== 'string' && content.diff !== true && hasDiff && !preview && 'truncated' in content) {
          modes.set(index, 'source'); continue
        }
        // A declared match can lie beyond the first prefix. Grow only until it
        // is reachable, retaining the same bounded preview policy as Load more.
        if (preview && loaded !== undefined && loaded.binary !== true && file.line !== undefined && !positions.has(key)) {
          while (loaded.truncated === true && loaded.text.split('\n').length <= file.line && (limits.get(index) ?? PREVIEW_BYTES) < MAX_PREVIEW_BYTES) {
            const limit = Math.min(MAX_PREVIEW_BYTES, (limits.get(index) ?? PREVIEW_BYTES) * 2)
            limits.set(index, limit)
            loaded = await fileDocument(resolve(cwd, file.path), signal, limit)
          }
          content = loaded
          if (loaded.binary !== true && loaded.text.split('\n').length < file.line) feedback = `Line ${file.line} is outside this preview. The file may have changed; Open reads the original.`
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
        ...(tui.insertText === undefined ? [] : [{ label: 'Quote', value: 'quote' }]),
        ...(preview && extname(file.path).toLowerCase() === '.md' && loaded !== undefined && loaded.binary !== true ? [{ label: mode === 'markdown' ? 'Source' : 'Markdown', value: 'markdown' }] : []),
        ...(loaded?.truncated === true && (limits.get(index) ?? PREVIEW_BYTES) < MAX_PREVIEW_BYTES ? [{ label: 'Load more', value: 'more' }] : [])]
      const position = positions.get(key) ?? (preview && file.line !== undefined
        ? { row: Math.max(0, file.line - (source?.firstLine ?? 1)), wrap: 0, query: '' } : undefined)
      const action = await tui.prompt({ title: `${title} · ${index + 1}/${files.length}`, question: file.label, detail,
        ...(image === undefined ? {} : { documentImage: image }),
        ...(source === undefined ? {} : { documentSource: source }), ...(position === undefined ? {} : { documentPosition: position }), onDocumentPosition: position => { positions.set(key, position) },
        presentation: 'document', options, allowCustom: false, signal, notify: false,
        actions: [{ key: 'f', label: 'files', valuePrefix: 'files' }, ...(hasDiff ? [{ key: 'v', label: 'preview/diff', valuePrefix: 'preview' }] : []),
          ...(multiple ? [{ key: 'n', label: 'next', valuePrefix: 'next' }, { key: 'p', label: 'previous', valuePrefix: 'previous' }] : []), { key: 'o', label: 'open', valuePrefix: 'open' },
          ...(tui.openFileInEditor === undefined ? [] : [{ key: 'e', label: 'editor', valuePrefix: 'editor' }]),
          ...(tui.insertText === undefined ? [] : [{ key: 'q', label: 'quote', valuePrefix: 'quote' }]),
          ...(options.some(option => option.value === 'markdown') ? [{ key: 'm', label: 'source/markdown', valuePrefix: 'markdown' }] : []),
          ...(options.some(option => option.value === 'more') ? [{ key: 'l', label: 'load more', valuePrefix: 'more' }] : [])] })
      if (action === null || action === 'files') { index = undefined; break }
      if (action === 'preview') { modes.set(index, preview ? 'diff' : 'source'); feedback = ''; continue }
      if (action === 'markdown') { modes.set(index, mode === 'markdown' ? 'source' : 'markdown'); feedback = ''; continue }
      if (action === 'more') { limits.set(index, Math.min(MAX_PREVIEW_BYTES, (limits.get(index) ?? PREVIEW_BYTES) * 2)); feedback = ''; continue }
      if (action === 'next' || action === 'previous') { index = (index + files.length + (action === 'next' ? 1 : -1)) % files.length; break }
      if (action === 'quote') {
        const ref = formatQuoteReference(cwd, file, source, positions.get(key) ?? position)
        tui.insertText?.(ref)
        tui.notice(`Quoted ${ref} in composer.`)
        return
      }
      try {
        if (action === 'editor') {
          tui.openFileInEditor?.(resolve(cwd, file.path))
          feedback = 'Editor command completed.'
        } else if (action === 'open') {
          await openSystemFile(resolve(cwd, file.path), signal)
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

export type DocumentCommand =
  | { type: 'action'; value: string }
  | { type: 'link'; target: string }
  | { type: 'escape' }

export interface FileLinkPreviewSurface {
  prompt(
    request: TuiPrompt,
    onDocumentCommand?: (command: DocumentCommand, position: TuiDocumentPosition | undefined) => boolean,
  ): Promise<string | null>
  updatePrompt?(request: TuiPrompt, notice?: string): void
  setPromptNotice?(notice: string | undefined): void
  canQuote?: () => boolean
  translate?(key: string, params?: Record<string, string | number>): string
  notice: TuiService['notice']
  status?: (text: string) => void
  openFileInEditor?: TuiService['openFileInEditor']
  insertText?: TuiService['insertText']
}

function isMarkdownPath(path: string): boolean {
  const ext = extname(path).toLowerCase()
  return ext === '.md' || ext === '.markdown'
}

export async function resolveExistingFileLink(
  candidates: readonly LocalFileLink[],
  signal?: AbortSignal,
): Promise<{ status: 'ok'; link: LocalFileLink } | { status: 'not-found'; label: string } | { status: 'not-file'; label: string } | { status: 'error'; message: string }> {
  let nonFile: string | undefined
  let firstError: string | undefined
  for (const candidate of candidates) {
    if (signal?.aborted === true) return { status: 'not-found', label: candidate.label }
    try {
      const info = await stat(candidate.path)
      if (info.isFile()) return { status: 'ok', link: candidate }
      nonFile ??= candidate.label
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        firstError ??= error instanceof Error ? error.message : String(error)
      }
    }
  }
  if (nonFile !== undefined) return { status: 'not-file', label: nonFile }
  if (firstError !== undefined) return { status: 'error', message: firstError }
  return { status: 'not-found', label: candidates[0]?.label ?? '' }
}

interface PreviewFrame {
  readonly link: LocalFileLink
  mode: 'source' | 'markdown'
  limit: number
  positions: Partial<Record<'source' | 'markdown', TuiDocumentPosition>>
  source?: TuiDocumentSource | undefined
  image?: PreviewImage | undefined
  imageLoaded?: boolean
}

/**
 * Preview a clicked local file link in the document reader with line jump,
 * Markdown/Source toggle, in-place reload, and relative-link navigation with a
 * back stack. Keeps the reader overlay active across reloads and link jumps so
 * focus never leaks back to the main screen during async file I/O.
 */
export async function previewFileLink(
  tui: FileLinkPreviewSurface,
  cwd: string,
  initial: LocalFileLink,
  signal: AbortSignal,
  projectRoot?: string,
): Promise<void> {
  const t = (key: string, params?: Record<string, string | number>): string => {
    if (tui.translate !== undefined) return tui.translate(key, params)
    return params === undefined ? key : key.replace(/\{(\w+)\}/gu, (_m, name: string) => String(params[name] ?? ''))
  }
  const createFrame = (link: LocalFileLink): PreviewFrame => ({
    link,
    mode: isMarkdownPath(link.path) && link.line === undefined ? 'markdown' : 'source',
    limit: PREVIEW_BYTES,
    positions: {},
  })
  const stack: PreviewFrame[] = [createFrame(initial)]

  const loadFrame = async (
    frame: PreviewFrame,
    depth: number,
    loadSignal: AbortSignal,
    options: { forceReload?: boolean; mode?: 'source' | 'markdown'; limit?: number } = {},
  ): Promise<{ request: TuiPrompt; notice?: string; mode: 'source' | 'markdown'; limit: number; source?: TuiDocumentSource | undefined; image?: PreviewImage | undefined; imageLoaded?: boolean }> => {
    const markdown = isMarkdownPath(frame.link.path)
    const mode = options.mode ?? frame.mode
    let limit = options.limit ?? frame.limit
    let detail = ''
    let source: TuiDocumentSource | undefined
    let loaded: FileDocument | undefined
    let image: PreviewImage | undefined
    let imageLoaded = frame.imageLoaded === true
    let notice: string | undefined
    try {
      if (imageMediaType(frame.link.path) !== undefined) {
        if (options.forceReload === true || !imageLoaded) {
          image = await imageFile(frame.link.path, loadSignal)
          imageLoaded = true
        } else {
          image = frame.image
        }
      }
      if (image === undefined) {
        loaded = await fileDocument(frame.link.path, loadSignal, limit)
        if (loaded.binary !== true && frame.link.line !== undefined && frame.positions[mode] === undefined) {
          while (loaded.truncated === true && loaded.text.split('\n').length <= frame.link.line && limit < MAX_PREVIEW_BYTES) {
            limit = Math.min(MAX_PREVIEW_BYTES, limit * 2)
            loaded = await fileDocument(frame.link.path, loadSignal, limit)
          }
          if (loaded.binary !== true && loaded.text.split('\n').length < frame.link.line) {
            notice = `Line ${frame.link.line} is outside this preview. The file may have changed; Open reads the original.`
          }
        }
        if (loaded.binary === true) detail = loaded.text
        else if (mode === 'markdown') detail = loaded.text
        else source = loaded
      }
    } catch (error) {
      if (loadSignal.aborted) throw error
      detail = error instanceof Error ? error.message : String(error)
    }

    const canGoBack = depth > 1
    const canToggleMarkdown = markdown && loaded !== undefined && loaded.binary !== true && image === undefined
    const canLoadMore = loaded?.truncated === true && limit < MAX_PREVIEW_BYTES
    const quoteAvailable = tui.insertText !== undefined && tui.canQuote?.() !== false
    const optionsList = [
      ...(canGoBack ? [{ label: 'Back', value: 'back' }] : [{ label: 'Close', value: 'close' }]),
      { label: 'Open', value: 'open' },
      ...(tui.openFileInEditor === undefined ? [] : [{ label: 'Editor', value: 'editor' }]),
      ...(quoteAvailable ? [{ label: 'Quote', value: 'quote' }] : []),
      ...(canToggleMarkdown ? [{ label: mode === 'markdown' ? 'Source' : 'Markdown', value: 'markdown' }] : []),
      { label: 'Reload', value: 'reload' },
      ...(canLoadMore ? [{ label: 'Load more', value: 'more' }] : []),
    ]
    const actions = [
      ...(canGoBack ? [{ key: 'b', label: 'back', valuePrefix: 'back' }] : []),
      { key: 'o', label: 'open', valuePrefix: 'open' },
      ...(tui.openFileInEditor === undefined ? [] : [{ key: 'e', label: 'editor', valuePrefix: 'editor' }]),
      ...(quoteAvailable ? [{ key: 'q', label: 'quote', valuePrefix: 'quote' }] : []),
      ...(canToggleMarkdown ? [{ key: 'm', label: 'source/markdown', valuePrefix: 'markdown' }] : []),
      { key: 'r', label: 'reload', valuePrefix: 'reload' },
      ...(canLoadMore ? [{ key: 'l', label: 'load more', valuePrefix: 'more' }] : []),
    ]
    const position = frame.positions[mode] ?? (frame.link.line !== undefined && source !== undefined
      ? { row: Math.max(0, frame.link.line - (source.firstLine ?? 1)), wrap: 0, query: '' }
      : undefined)
    const question = frame.link.line === undefined ? frame.link.label : `${frame.link.label}:${frame.link.line}`
    const title = canGoBack ? `File preview · ${depth}` : 'File preview'
    const request: TuiPrompt = {
      localize: ['title', 'options', 'actions'],
      title,
      question,
      detail,
      ...(image === undefined ? {} : { documentImage: image }),
      ...(source === undefined ? {} : { documentSource: source }),
      ...(position === undefined ? {} : { documentPosition: position }),
      onDocumentPosition: nextPos => { frame.positions[frame.mode] = nextPos },
      presentation: 'document',
      options: optionsList,
      actions,
      allowCustom: false,
      signal,
      notify: false,
    }
    return { request, mode, limit, source, image, imageLoaded, ...(notice === undefined ? {} : { notice }) }
  }

  const commitFrame = (frame: PreviewFrame, loaded: Awaited<ReturnType<typeof loadFrame>>): void => {
    frame.mode = loaded.mode
    frame.limit = loaded.limit
    frame.source = loaded.source
    frame.image = loaded.image
    frame.imageLoaded = loaded.imageLoaded === true
  }

  let initialLoaded: Awaited<ReturnType<typeof loadFrame>>
  try {
    initialLoaded = await loadFrame(stack[0]!, 1, signal)
  } catch (error) {
    if (signal.aborted) return
    throw error
  }
  if (signal.aborted) return
  commitFrame(stack[0]!, initialLoaded)

  let closed = false
  let inFlight: AbortController | undefined
  const startTask = (run: (taskSignal: AbortSignal) => Promise<void>): void => {
    inFlight?.abort()
    const controller = new AbortController()
    inFlight = controller
    const onOuterAbort = (): void => { controller.abort() }
    signal.addEventListener('abort', onOuterAbort, { once: true })
    void run(controller.signal)
      .catch(error => {
        if (closed || controller.signal.aborted || signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        tui.setPromptNotice?.(stripAnsi(message).replace(/[\u0000-\u001f\u007f]+/gu, ' '))
      })
      .finally(() => {
        signal.removeEventListener('abort', onOuterAbort)
        if (inFlight === controller) inFlight = undefined
      })
  }

  const navigateBack = (): boolean => {
    if (stack.length <= 1) {
      inFlight?.abort()
      return false
    }
    const targetDepth = stack.length - 1
    const previous = stack[targetDepth - 1]!
    startTask(async taskSignal => {
      const next = await loadFrame(previous, targetDepth, taskSignal)
      if (closed || taskSignal.aborted) return
      // Keep the displayed frame at stack top until the previous document is
      // ready to paint, so Q/O/E during an in-flight load still target what is visible.
      stack.length = targetDepth
      commitFrame(previous, next)
      tui.updatePrompt?.(next.request, next.notice)
    })
    return true
  }

  const onDocumentCommand = (command: DocumentCommand, currentPosition: TuiDocumentPosition | undefined): boolean => {
    const current = stack[stack.length - 1]
    if (current === undefined) return false
    if (currentPosition !== undefined) current.positions[current.mode] = currentPosition

    if (command.type === 'escape') return navigateBack()

    if (command.type === 'link') {
      if (current.mode !== 'markdown' || current.image !== undefined) return false
      const candidates = parseLocalFileLinkCandidates(command.target, [dirname(current.link.path), cwd, projectRoot])
      if (candidates.length === 0) return false
      startTask(async taskSignal => {
        const resolved = await resolveExistingFileLink(candidates, taskSignal)
        if (closed || taskSignal.aborted) return
        if (resolved.status === 'not-found') {
          tui.setPromptNotice?.(t('File not found: {path}', { path: resolved.label }))
          return
        }
        if (resolved.status === 'not-file') {
          tui.setPromptNotice?.(t('Not a regular file: {path}', { path: resolved.label }))
          return
        }
        if (resolved.status === 'error') {
          tui.setPromptNotice?.(resolved.message)
          return
        }
        const nextFrame = createFrame(resolved.link)
        const next = await loadFrame(nextFrame, stack.length + 1, taskSignal)
        if (closed || taskSignal.aborted) return
        commitFrame(nextFrame, next)
        stack.push(nextFrame)
        tui.updatePrompt?.(next.request, next.notice)
      })
      return true
    }

    const action = command.value
    if (action === 'close') {
      inFlight?.abort()
      return false
    }
    if (action === 'quote') {
      if (tui.insertText === undefined || tui.canQuote?.() === false) {
        tui.setPromptNotice?.(t('Read-only session; cannot quote to composer.'))
        return true
      }
      inFlight?.abort()
      return false
    }
    if (action === 'back') return navigateBack()
    if (action === 'markdown') {
      const nextMode = current.mode === 'markdown' ? 'source' : 'markdown'
      startTask(async taskSignal => {
        const next = await loadFrame(current, stack.length, taskSignal, { mode: nextMode })
        if (closed || taskSignal.aborted) return
        commitFrame(current, next)
        tui.updatePrompt?.(next.request, next.notice)
      })
      return true
    }
    if (action === 'reload') {
      startTask(async taskSignal => {
        const next = await loadFrame(current, stack.length, taskSignal, { forceReload: true })
        if (closed || taskSignal.aborted) return
        commitFrame(current, next)
        tui.updatePrompt?.(next.request, next.notice)
      })
      return true
    }
    if (action === 'more') {
      const nextLimit = Math.min(MAX_PREVIEW_BYTES, current.limit * 2)
      startTask(async taskSignal => {
        const next = await loadFrame(current, stack.length, taskSignal, { limit: nextLimit })
        if (closed || taskSignal.aborted) return
        commitFrame(current, next)
        tui.updatePrompt?.(next.request, next.notice)
      })
      return true
    }
    if (action === 'editor') {
      try {
        tui.openFileInEditor?.(current.link.path)
        tui.setPromptNotice?.('Editor command completed.')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        tui.setPromptNotice?.('Action failed: ' + stripAnsi(message).replace(/[\u0000-\u001f\u007f]+/gu, ' '))
      }
      return true
    }
    if (action === 'open') {
      startTask(async taskSignal => {
        try {
          await openSystemFile(current.link.path, taskSignal)
          if (!closed && !taskSignal.aborted) tui.setPromptNotice?.('Opened in the default application.')
        } catch (error) {
          if (closed || taskSignal.aborted) return
          const message = error instanceof Error ? error.message : String(error)
          tui.setPromptNotice?.('Action failed: ' + stripAnsi(message).replace(/[\u0000-\u001f\u007f]+/gu, ' '))
        }
      })
      return true
    }
    return false
  }

  const promptPromise = tui.prompt(initialLoaded.request, onDocumentCommand)
  if (initialLoaded.notice !== undefined) tui.setPromptNotice?.(initialLoaded.notice)
  const answer = await promptPromise
  closed = true
  inFlight?.abort()

  if (signal.aborted || answer !== 'quote') return
  const current = stack[stack.length - 1]
  if (current === undefined || tui.insertText === undefined || tui.canQuote?.() === false) return
  const reviewFile: ReviewFile = {
    path: current.link.path,
    label: current.link.label,
    ...(current.link.line === undefined ? {} : { line: current.link.line }),
  }
  const ref = formatQuoteReference(cwd, reviewFile, current.source, current.positions[current.mode])
  tui.insertText(ref)
  if (tui.status !== undefined) tui.status(`Quoted ${ref} in composer.`)
  else tui.notice(`Quoted ${ref} in composer.`)
}
