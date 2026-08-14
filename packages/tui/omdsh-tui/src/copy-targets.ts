/**
 * `/copy` targets from the live transcript: last assistant text, last fenced
 * code block, or last bash command. Pure — the provider owns the clipboard.
 * @module @omdsh/tui
 */

import type { Block } from './event-views.ts'

/** What `/copy` should pull from the transcript. */
export type CopyKind = 'text' | 'code' | 'cmd'

/** One clipboard payload plus the status label shown after a successful copy. */
export interface CopyTarget {
  text: string
  label: string
}

const FENCE = /^```([^\n]*)$/

/** Parse `/copy` arguments. Undefined when the token is not a known kind. */
export function parseCopyKind(args: string): CopyKind | undefined {
  const token = args.trim().toLowerCase()
  if (token === '' || token === 'text') return 'text'
  if (token === 'code') return 'code'
  if (token === 'cmd' || token === 'command') return 'cmd'
  return undefined
}

/** Fenced bodies in document order (`lang` is the info string). */
export function extractCodeBlocks(text: string): { lang: string; code: string }[] {
  const lines = text.split('\n')
  const blocks: { lang: string; code: string }[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const open = FENCE.exec(lines[i] ?? '')
    if (open === null) continue
    let close = -1
    for (let k = i + 1; k < lines.length; k += 1) {
      if ((lines[k] ?? '').startsWith('```')) {
        close = k
        break
      }
    }
    if (close === -1) continue
    blocks.push({ lang: (open[1] ?? '').trim(), code: lines.slice(i + 1, close).join('\n') })
    i = close
  }
  return blocks
}

/** Cap on how many picker rows `/copy` lists (OMP recent-message window). */
export const COPY_TARGET_LIMIT = 50

/** One row in the `/copy` picker (flat: messages, fences, bash commands). */
export interface CopyPick {
  id: string
  label: string
  hint: string
  text: string
  copyMessage: string
}

function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed.replace(/\s+/g, ' ')
  }
  return text.trim().replace(/\s+/g, ' ')
}

function pluralLines(text: string): string {
  const count = text.length === 0 ? 0 : text.split('\n').length
  return String(count) + ' line' + (count === 1 ? '' : 's')
}

function codeHint(lang: string, code: string): string {
  return lang === '' ? pluralLines(code) : lang + ' · ' + pluralLines(code)
}

function codeLabel(lang: string, code: string): string {
  const line = firstLine(code)
  if (line !== '') return line
  return lang === '' ? 'code block' : lang + ' block'
}

function pushCodePicks(items: CopyPick[], source: string, nextId: () => string): void {
  for (const fence of extractCodeBlocks(source)) {
    items.push({
      id: nextId(),
      label: codeLabel(fence.lang, fence.code),
      hint: codeHint(fence.lang, fence.code),
      text: fence.code,
      copyMessage: fence.lang === '' ? 'code block' : fence.lang + ' block',
    })
  }
}

/** Newest-first picker rows from the live transcript. */
export function buildCopyTargets(blocks: readonly Block[], limit = COPY_TARGET_LIMIT): CopyPick[] {
  const items: CopyPick[] = []
  let messages = 0
  let codes = 0
  let commands = 0
  const cap = Math.max(0, limit)
  for (let i = blocks.length - 1; i >= 0 && items.length < cap; i -= 1) {
    const block = blocks[i]
    if (block === undefined) continue
    if (block.kind === 'assistant' && block.text.trim() !== '') {
      messages += 1
      items.push({
        id: 'msg:' + String(messages),
        label: firstLine(block.text),
        hint: pluralLines(block.text),
        text: block.text,
        copyMessage: messages === 1 ? 'last message' : 'assistant text',
      })
      if (items.length >= cap) break
      pushCodePicks(items, block.text, () => {
        codes += 1
        return 'code:' + String(codes)
      })
      continue
    }
    if (block.kind !== 'tool') continue
    if (block.output.trim() !== '') {
      pushCodePicks(items, block.output, () => {
        codes += 1
        return 'code:' + String(codes)
      })
    }
    if (items.length >= cap) break
    if (block.name !== 'bash') continue
    const command = bashCommand(block.args)
    if (command === undefined) continue
    commands += 1
    items.push({
      id: 'cmd:' + String(commands),
      label: firstLine(command),
      hint: 'bash · ' + pluralLines(command),
      text: command,
      copyMessage: 'bash command',
    })
  }
  return items.slice(0, cap)
}

function bashCommand(args: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(args)
    if (typeof parsed === 'object' && parsed !== null && 'command' in parsed) {
      const command = (parsed as { command: unknown }).command
      if (typeof command === 'string' && command !== '') return command
    }
  } catch {
    /* not JSON */
  }
  return undefined
}

/** Walk the transcript backwards for the requested copy target. */
export function extractCopyTarget(blocks: readonly Block[], kind: CopyKind): CopyTarget | undefined {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]
    if (block === undefined) continue
    if (kind === 'text' && block.kind === 'assistant' && block.text.trim() !== '') {
      return { text: block.text, label: 'assistant text' }
    }
    if (kind === 'code') {
      const source = block.kind === 'assistant'
        ? block.text
        : block.kind === 'tool' ? block.output : ''
      const fences = extractCodeBlocks(source)
      const last = fences[fences.length - 1]
      if (last !== undefined) {
        const lang = last.lang === '' ? 'code block' : last.lang + ' block'
        return { text: last.code, label: lang }
      }
    }
    if (kind === 'cmd' && block.kind === 'tool' && block.name === 'bash') {
      const command = bashCommand(block.args)
      if (command !== undefined) return { text: command, label: 'bash command' }
    }
  }
  return undefined
}
