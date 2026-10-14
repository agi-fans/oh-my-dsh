/** File actions derive only from provider declarations and host-served summaries. */
import { dirname, isAbsolute, resolve } from 'node:path'
import type { FileLocation } from '@deepseek-ai/dsh-tools'
import type { TuiToolPresentation } from '../chrome/tool-renderers.ts'
import type { ReviewFile } from '../runtime/file-review.ts'
import type { Block } from './transcript-types.ts'

/** Tool arguments and arbitrary result text are not file declarations. */
export function toolFileLocations(presentation: TuiToolPresentation | undefined): readonly FileLocation[] {
  if (presentation === undefined) return []
  const files = new Map<string, FileLocation>()
  const add = (location: FileLocation): void => {
    if (location.path === '' || /[\u0000-\u001f\u007f-\u009f]/u.test(location.path)) return
    const prior = files.get(location.path)
    const line = prior?.line ?? location.line
    files.set(location.path, { path: location.path, ...(line === undefined || !Number.isSafeInteger(line) || line < 1 ? {} : { line }) })
  }
  const { call, result } = presentation
  if (call?.card === 'generic' || call?.card === 'diff') for (const location of call.locations ?? []) add(location)
  if (call?.card === 'diff') for (const diff of call.diffs) add({ path: diff.path })
  if (result?.card === 'read') add({ path: result.path, line: result.offset })
  else if (result?.card === 'diff') for (const diff of result.diffs) add({ path: diff.path })
  else if (result?.card === 'search') {
    if (result.shape === 'paths') for (const path of result.paths) add({ path })
    else for (const file of result.files) add({ path: file.path, ...(file.matches[0] === undefined ? {} : { line: file.matches[0].lineNumber }) })
  }
  return [...files.values()]
}

export interface FileAction {
  title: string
  cwd: string
  files: readonly ReviewFile[]
}

const actions = new WeakMap<Block, FileAction | undefined>()

export function blockFileAction(block: Block): FileAction | undefined {
  if (!actions.has(block)) actions.set(block, projectFileAction(block))
  return actions.get(block)
}

function projectFileAction(block: Block): FileAction | undefined {
  if (block.kind === 'workspace') {
    const summary = block.summary
    if (summary === undefined || summary.files.length === 0) return undefined
    return { title: `Turn ${summary.turn} files · current contents`, cwd: summary.cwd,
      files: summary.files.map(file => ({ path: file.path, label: file.display })) }
  }
  if (block.kind !== 'tool') return undefined
  const locations = toolFileLocations(block.presentation)
  if (locations.length === 0) return undefined
  const cwd = block.presentation?.cwd
  // Absolute declarations remain usable without a base; never guess a relative
  // call's old directory from the currently viewed Session.
  const available = cwd === undefined ? locations.filter(location => isAbsolute(location.path)) : locations
  if (available.length === 0) return undefined
  const base = cwd ?? dirname(available[0]!.path)
  const files = new Map<string, ReviewFile>()
  for (const location of available) {
    const path = resolve(base, location.path)
    const prior = files.get(path)
    const line = prior?.line ?? location.line
    files.set(path, { path, label: prior?.label ?? location.path, ...(line === undefined ? {} : { line }) })
  }
  return { title: 'Tool files · current contents', cwd: base, files: [...files.values()] }
}
