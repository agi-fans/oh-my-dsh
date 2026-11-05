/** Actions use retained tool data, independently of terminal wrapping and decoration. */
import type { Block } from './transcript-types.ts'
import { toolCommand } from './copy-targets.ts'
import { languageFromPath } from '../chrome/code-highlight.ts'

export interface ToolSource { label: string; text: string; language?: string }

export function toolActionContext(block: Extract<Block, { kind: 'tool' }>): string {
  const call = block.presentation?.call
  const command = toolCommand(block)
  if (command !== undefined) return command
  return call?.title ?? (block.presentation?.result?.card === 'read' ? block.presentation.result.path : block.name)
}

/** Read ranges remain historical: never reopen a changed host file to copy a recorded result. */
export function toolSource(block: Extract<Block, { kind: 'tool' }>): ToolSource | undefined {
  const view = block.presentation?.result
  if (view?.card !== 'read' || view.lines.length === 0) return
  // Do not join disjoint excerpts into source that never existed.
  if (view.lines.some((line, index) => !Number.isSafeInteger(line.number) || line.number < 1
    || index > 0 && line.number !== view.lines[index - 1]!.number + 1)) return
  const language = languageFromPath(view.path)
  return { label: `${view.path}:${view.lines[0]!.number}–${view.lines.at(-1)!.number}`,
    text: view.lines.map(line => line.text).join('\n'), ...(language === undefined ? {} : { language }) }
}

/** A fence longer than any source fence keeps embedded Markdown literal. */
export function sourceQuote(source: ToolSource): string {
  const longest = (source.text.match(/`+/gu) ?? []).reduce((length, run) => Math.max(length, run.length), 2)
  const fence = '`'.repeat(longest + 1)
  return `${source.label}\n\n${fence}${source.language ?? ''}\n${source.text}\n${fence}`
}
