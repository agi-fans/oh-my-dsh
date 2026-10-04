/** Open files and prompt text with the selected editor, waiting for completion. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { resolveEditor, type EditorId } from './editor-discovery.ts'

export function editExternally(text: string, editor: EditorId = 'auto'): string {
  const editorCommand = resolveEditor(editor)
  const dir = mkdtempSync(join(tmpdir(), 'omdsh-editor-'))
  const path = join(dir, 'prompt.md')
  try {
    writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 })
    const result = spawnSync(editorCommand.command, [...editorCommand.args, path], { stdio: 'inherit', ...(editorCommand.env === undefined ? {} : { env: editorCommand.env }) })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`Editor exited with status ${String(result.status)}.`)
    return readFileSync(path, 'utf8').replace(/\n$/u, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Open an existing file with the user's configured editor. */
export function editFileExternally(path: string, editor: EditorId = 'auto'): void {
  const editorCommand = resolveEditor(editor)
  const result = spawnSync(editorCommand.command, [...editorCommand.args, path], { stdio: 'inherit', ...(editorCommand.env === undefined ? {} : { env: editorCommand.env }) })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`Editor exited with status ${String(result.status)}.`)
}
