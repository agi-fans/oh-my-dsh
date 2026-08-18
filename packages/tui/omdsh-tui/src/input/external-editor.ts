/** Open the current prompt in `$VISUAL`/`$EDITOR` and return its saved text. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function commandParts(command: string): string[] {
  return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/gu)?.map(part => part.replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2')) ?? []
}

export function editExternally(text: string, editor = process.env.VISUAL ?? process.env.EDITOR): string {
  if (editor === undefined || editor.trim() === '') throw new Error('Set $VISUAL or $EDITOR to use the external editor.')
  const parts = commandParts(editor)
  const command = parts.shift()
  if (command === undefined) throw new Error('The configured editor command is empty.')
  const dir = mkdtempSync(join(tmpdir(), 'omdsh-editor-'))
  const path = join(dir, 'prompt.md')
  try {
    writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 })
    const result = spawnSync(command, [...parts, path], { stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`Editor exited with status ${String(result.status)}.`)
    return readFileSync(path, 'utf8').replace(/\n$/u, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
