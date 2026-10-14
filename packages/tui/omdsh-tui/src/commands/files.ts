/** Workspace browsing, deliverables, and durable file attachments. */

import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { deliverableFiles, logAttachments } from '../views/session-files.ts'
import { filePreview, openSystemFile, reviewFiles } from '../runtime/file-review.ts'
import { previewImages } from '../runtime/image-preview.ts'
import { registerCommands } from './registration.ts'
import { loadProjectPaths, rankProjectPaths } from '../session/project-file-search.ts'
import { currentWorkingDirectory } from '../session/working-directory.ts'

export const name = 'omdsh-command-files'
export const inject = ['commands', 'tui', 'attachments']

export function userPath(input: string, cwd: string): string {
  const unquoted = input.replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2')
  return resolve(cwd, unquoted.startsWith('~/') ? homedir() + unquoted.slice(1) : unquoted)
}

async function searchWorkspaceFile(ctx: Context, root: string, initialQuery: string, signal: AbortSignal): Promise<string | null> {
  const entries = (await loadProjectPaths(root, signal)).filter(entry => !entry.directory)
  const ranked = initialQuery.trim() === '' ? entries.slice(0, 1000) : rankProjectPaths(entries, initialQuery, 500)
  if (ranked.length === 0) return null
  if (ranked.length === 1 && initialQuery.trim() !== '') return resolve(root, ranked[0]!.path)
  const answer = await ctx.tui.prompt({
    title: `Workspace files · ${root}`,
    question: initialQuery.trim() === '' ? 'Search workspace files' : `Matches for "${initialQuery.trim()}"`,
    presentation: 'fullscreen-list',
    optionLayout: 'compact',
    allowCustom: false,
    filterable: true,
    signal,
    notify: false,
    options: ranked.map(entry => ({ label: entry.path, value: resolve(root, entry.path) })),
  })
  return answer
}

async function browse(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const cwd = currentWorkingDirectory(ctx, invocation.agent.session)
  const rawQuery = invocation.rawInput.trim()
  let path = userPath(rawQuery, cwd)
  while (!invocation.signal.aborted) {
    let info
    try {
      info = await stat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && rawQuery !== '' && ctx.tui.interactive === true) {
        const matched = await searchWorkspaceFile(ctx, cwd, rawQuery, invocation.signal)
        if (matched !== null) {
          path = matched
          info = await stat(path)
        } else {
          throw error
        }
      } else {
        throw error
      }
    }
    if (info.isFile()) {
      if (ctx.tui.interactive !== true) return { kind: 'success', text: await filePreview(path, invocation.signal) }
      const directory = dirname(path)
      const files = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile())
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500)
        .map(entry => ({ path: resolve(directory, entry.name), label: entry.name }))
      if (!files.some(file => file.path === path)) files.push({ path, label: basename(path) })
      await reviewFiles(ctx.tui, `Files · ${directory}`, directory, files, index => filePreview(files[index]!.path, invocation.signal),
        invocation.signal, files.findIndex(file => file.path === path), false)
      path = directory
      continue
    }
    const entries = (await readdir(path, { withFileTypes: true })).filter(entry => entry.name !== '.git' && entry.name !== 'node_modules')
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    const page = entries.slice(0, 500)
    if (ctx.tui.interactive !== true) return { kind: 'success', text: page.map(entry => entry.name + (entry.isDirectory() ? '/' : '')).join('\n') }
    const answer = await ctx.tui.prompt({ title: `Files · ${path}`, question: path, presentation: 'fullscreen-list', optionLayout: 'compact',
      allowCustom: false, filterable: true, signal: invocation.signal, notify: false,
      detail: entries.length > page.length ? `Showing ${page.length} of ${entries.length} entries; Shift+F searches all workspace files.` : 'Shift+F searches workspace files · Shift+P shows this session’s deliverables.',
      options: [{ label: '../', value: dirname(path) }, ...page.map(entry => ({ label: entry.name + (entry.isDirectory() ? '/' : ''), value: resolve(path, entry.name) }))],
      actions: [{ key: 'F', label: 'search workspace', valuePrefix: 'search:' }, { key: 'P', label: 'deliverables', valuePrefix: 'present:' }] })
    if (answer === null) break
    if (answer.startsWith('search:')) {
      const picked = await searchWorkspaceFile(ctx, path, '', invocation.signal)
      if (picked === null) continue
      path = picked
      continue
    }
    if (answer.startsWith('present:')) {
      const files = deliverableFiles(invocation.agent.session.snapshotEvents()).map(path => ({ path, label: path }))
      if (files.length === 0) { ctx.tui.notice('No deliverables in this session.'); continue }
      await reviewFiles(ctx.tui, 'Deliverables', cwd, files, index => filePreview(resolve(cwd, files[index]?.path ?? ''), invocation.signal), invocation.signal, undefined, false)
    } else path = answer
  }
  return { kind: 'success' }
}

export async function attachFile(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (ctx.tui.interactive !== true || ctx.tui.stageFileAttachment === undefined) return { kind: 'error', text: 'File drafts require an interactive composer.' }
  let input = invocation.rawInput.trim()
  if (input === '') input = await ctx.tui.prompt({ title: 'Attach file', question: 'Path to the file', allowCustom: true, notify: false, signal: invocation.signal }) ?? ''
  if (input === '' || invocation.signal.aborted) return { kind: 'success' }
  const path = userPath(input, currentWorkingDirectory(ctx, invocation.agent.session))
  const info = await stat(path)
  if (!info.isFile()) return { kind: 'error', text: 'Select a regular file to attach.' }
  const source = createReadStream(path, { highWaterMark: 64 * 1024, signal: invocation.signal })
  try {
    const ref = await ctx.attachments.saveFileStream({ data: source, name: basename(path), signal: invocation.signal })
    invocation.signal.throwIfAborted()
    ctx.tui.stageFileAttachment(ref)
    return { kind: 'success', text: `Attached ${ref.name} · ${ref.bytes.toLocaleString()} bytes. Add a message and press Enter to send; deleting its marker removes the draft.` }
  } finally { source.destroy() }
}

async function attachments(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const refs = logAttachments(invocation.agent.session.snapshotEvents())
  if (ctx.tui.interactive !== true) return { kind: 'success', text: refs.map(ref => `${ref.name ?? ref.attachmentId} · ${ref.bytes} bytes`).join('\n') || 'No attachments in this session.' }
  while (!invocation.signal.aborted) {
    const answer = await ctx.tui.prompt({ title: 'Attachments', question: 'Choose a stored attachment', emptyText: 'No attachments in this session.',
      presentation: 'fullscreen-list', optionLayout: 'compact', filterable: true, allowCustom: false, signal: invocation.signal,
      notify: false,
      options: refs.map((ref, index) => ({ label: ref.name ?? String(ref.attachmentId), value: String(index), description: `${ref.bytes.toLocaleString()} bytes · ${'mediaType' in ref ? ref.mediaType : 'file'}` })) })
    if (answer === null) break
    const ref = refs[Number(answer)]
    if (ref === undefined) continue
    // Verify the durable bytes before opening the provider-owned original.
    if ('mediaType' in ref) {
      const stored = await ctx.attachments.readImage(ref, invocation.signal)
      const path = ctx.attachments.imageHostPath(ref)
      await previewImages(ctx.tui, [{ ...ref, data: stored.data }], invocation.signal,
        path === undefined ? undefined : () => openSystemFile(path))
      continue
    }
    else for await (const chunk of ctx.attachments.readFileStream(ref, invocation.signal)) { void chunk }
    const path = ctx.attachments.fileHostPath(ref)
    if (path === undefined) { ctx.tui.notice('This attachment provider does not expose a local file to open.'); continue }
    const action = await ctx.tui.prompt({ title: ref.name ?? 'Attachment', question: 'Open the stored original or preview it?', allowCustom: false, signal: invocation.signal,
      notify: false,
      options: [{ label: 'Preview', value: 'preview' }, { label: 'Open original', value: 'open' }] })
    if (action === 'open') await openSystemFile(path)
    else if (action === 'preview') await reviewFiles(ctx.tui, 'Attachment', '/', [{ path, label: ref.name ?? path }], () => filePreview(path, invocation.signal), invocation.signal, 0, false)
  }
  return { kind: 'success' }
}

export function apply(ctx: Context): void {
  const safe = (handler: (ctx: Context, invocation: CommandInvocation) => Promise<CommandResult>) => async (invocation: CommandInvocation): Promise<CommandResult> => {
    try { return await handler(ctx, invocation) } catch (error) { return { kind: 'error', text: invocation.signal.aborted ? 'File operation cancelled.' : error instanceof Error ? error.message : String(error) } }
  }
  registerCommands(ctx, [
    { name: 'files', description: 'Browse workspace files and session deliverables', input: { hint: '[path]' }, handler: safe(browse) },
    { name: 'attach', description: 'Add a file to the composer without sending it', input: { hint: '[path]' }, handler: safe(attachFile) },
    { name: 'attachments', description: 'View this session’s stored attachments', handler: safe(attachments) },
  ], 'omdsh file interaction')
}
