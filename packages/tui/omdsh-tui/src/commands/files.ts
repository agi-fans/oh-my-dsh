/**
 * File attachments: a file added to the composer, and the session's own log of
 * what has been attached.
 *
 * There used to be a `/files` browser as well — a full-screen directory walker
 * with its own workspace search and a deliverables view. It was a file manager
 * inside a chat, which is not what a chat needs: `@` already completes any path
 * in the workspace, a tool card's paths already open a preview, and the Agent
 * already reports the files it wrote. Nothing it offered was unreachable without
 * it, and it cost the reader a mode to learn.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { logAttachments } from '../views/session-files.ts'
import { filePreview, openSystemFile, reviewFiles } from '../runtime/file-review.ts'
import { previewImages } from '../runtime/image-preview.ts'
import { registerCommands } from './registration.ts'
import { currentWorkingDirectory } from '../session/working-directory.ts'

export const name = 'omdsh-command-files'
export const inject = ['commands', 'tui', 'attachments']

export function userPath(input: string, cwd: string): string {
  const unquoted = input.replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2')
  return resolve(cwd, unquoted.startsWith('~/') ? homedir() + unquoted.slice(1) : unquoted)
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
    { name: 'attach', description: 'Add a file to the composer without sending it', input: { hint: '[path]' }, handler: safe(attachFile) },
    { name: 'attachments', description: 'View this session’s stored attachments', handler: safe(attachments) },
  ], 'omdsh file interaction')
}
