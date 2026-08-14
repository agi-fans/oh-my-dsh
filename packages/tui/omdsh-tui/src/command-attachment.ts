/** Image attachment command registered through dsh-commands. */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { registerCommands } from './command-registration.ts'

export const name = 'omdsh-command-attachment'
export const inject = ['commands']

const MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

async function attach(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const input = invocation.rawInput.trim()
  if (input === '') return { kind: 'error', text: 'Usage: /attach <image-path>' }
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return { kind: 'error', text: 'Attachment storage is not configured.' }
  const unquoted = input.replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2')
  const path = resolve(unquoted.startsWith('~/') ? homedir() + unquoted.slice(1) : unquoted)
  const mediaType = MEDIA_TYPES[extname(path).toLowerCase()]
  if (mediaType === undefined) return { kind: 'error', text: 'Supported images: PNG, JPEG, WebP, GIF.' }
  try {
    const data = await readFile(path)
    const name = path.split('/').at(-1)
    const attachment = await attachments.saveImage({
      data,
      mediaType,
      ...(name === undefined ? {} : { name }),
    })
    invocation.agent.followup(createUserMessage({
      content: [{ type: 'image', attachment }],
      source: { kind: 'user' },
    }))
    return { kind: 'success', text: `Attached ${name ?? path} (${attachment.width}×${attachment.height}).` }
  } catch (error: unknown) {
    return { kind: 'error', text: 'Attach failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [{
    name: 'attach',
    description: 'Attach a PNG/JPEG/WebP/GIF as an image-only prompt',
    input: { hint: '<path>' },
    handler: invocation => attach(ctx, invocation),
  }], 'omdsh attachment command')
}
