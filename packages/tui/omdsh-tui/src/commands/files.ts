/**
 * File attachments: one surface for adding a file to the composer and for
 * reading back everything this session has already attached.
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

/** Staged leaf names the picker offers, mapped back to the durable reference. */
const ADD_CANDIDATE_PREFIX = 'add:'

/**
 * One attachment surface, not three. A path argument attaches immediately; no
 * argument opens the session's stored attachments with an Add entry at the top,
 * so reading what is there and adding something new are the same gesture
 * instead of two commands the reader has to keep apart.
 */
export async function attachFile(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const input = invocation.rawInput.trim()
  // A bare `/attach` reads this session's log, which needs no composer; asking
  // for a path, or offering to add one, is the part that does.
  if (input === '' && ctx.tui.interactive !== true) return listAttachments(ctx, invocation)
  if (input === '') return attachments(ctx, invocation)
  if (ctx.tui.interactive !== true || ctx.tui.stageFileAttachment === undefined) return { kind: 'error', text: 'File drafts require an interactive composer.' }
  return stageAttachment(ctx, invocation, input)
}

/** Plain-mode list: the same rows the picker offers, as transcript text. */
function listAttachments(_ctx: Context, invocation: CommandInvocation): CommandResult {
  const refs = logAttachments(invocation.agent.session.snapshotEvents())
  return { kind: 'success', text: refs.map(ref => `${ref.name ?? ref.attachmentId} · ${ref.bytes} bytes`).join('\n') || 'No attachments in this session.' }
}

async function stageAttachment(ctx: Context, invocation: CommandInvocation, input: string): Promise<CommandResult> {
  if (ctx.tui.stageFileAttachment === undefined) return { kind: 'error', text: 'File drafts require an interactive composer.' }
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
  if (ctx.tui.interactive !== true) return listAttachments(ctx, invocation)
  while (!invocation.signal.aborted) {
    // Re-read every pass: adding a file during this loop has to show up in it.
    const refs = logAttachments(invocation.agent.session.snapshotEvents())
    const answer = await ctx.tui.prompt({
      title: 'Attachments',
      question: ctx.tui.stageFileAttachment === undefined ? 'Choose a stored attachment' : 'Choose a stored attachment, or add a file',
      presentation: 'fullscreen-list', optionLayout: 'compact', filterable: true, allowCustom: false, signal: invocation.signal,
      notify: false,
      options: [
        ...(ctx.tui.stageFileAttachment === undefined
          ? []
          : [{ label: 'Add a file', value: ADD_CANDIDATE_PREFIX, description: 'Attach a new file from disk without sending it' }]),
        ...refs.map((ref, index) => ({ label: ref.name ?? String(ref.attachmentId), value: String(index), description: `${ref.bytes.toLocaleString()} bytes · ${'mediaType' in ref ? ref.mediaType : 'file'}` })),
      ],
    })
    if (answer === null) break
    if (answer === ADD_CANDIDATE_PREFIX && ctx.tui.stageFileAttachment !== undefined) {
      const staged = await stageAttachment(ctx, invocation, await ctx.tui.prompt({ title: 'Attach file', question: 'Path to the file', allowCustom: true, notify: false, signal: invocation.signal }) ?? '')
      if (staged.kind === 'error') return staged
      // The list the reader just left is now stale; reopen it with the new row.
      continue
    }
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
    {
      name: 'attach',
      description: 'Attach a file to the composer, or review what this session already attached',
      input: { hint: '[path]' },
      handler: safe(attachFile),
    },
  ], 'omdsh file interaction')
}
