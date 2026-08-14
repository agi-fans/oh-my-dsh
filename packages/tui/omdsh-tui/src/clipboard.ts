/**
 * Best-effort system clipboard write for `/copy`.
 * @module @omdsh/tui
 */

import { spawn } from 'node:child_process'

/** Writer used by `/copy`; injectable in tests. */
export type ClipboardWriter = (text: string) => Promise<void>

/** Reader used by raw-paste bindings; injectable in tests. */
export type ClipboardReader = () => Promise<string>

/** Platform clipboard argv, or undefined when no tool is available. */
export function clipboardCommand(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] | undefined {
  if (platform === 'darwin') return ['pbcopy']
  if (platform === 'win32') return ['clip']
  if (env.WAYLAND_DISPLAY) return ['wl-copy']
  if (env.DISPLAY) return ['xclip', '-selection', 'clipboard']
  return undefined
}

/**
 * Pipe `text` to the platform clipboard tool.
 * @param text - payload to copy.
 * @param spawnCmd - override for tests.
 */
export function copyToClipboard(
  text: string,
  spawnCmd: typeof spawn = spawn,
): Promise<void> {
  const cmd = clipboardCommand()
  if (cmd === undefined) return Promise.reject(new Error('no clipboard tool'))
  return new Promise((resolve, reject) => {
    const child = spawnCmd(cmd[0] ?? '', cmd.slice(1), { stdio: ['pipe', 'ignore', 'ignore'] })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('clipboard timed out'))
    }, 2000)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error('clipboard exited ' + String(code)))
    })
    child.stdin?.end(text)
  })
}

/** Read raw UTF-8 text from the platform clipboard. */
export function readFromClipboard(spawnCmd: typeof spawn = spawn): Promise<string> {
  const cmd = process.platform === 'darwin'
    ? ['pbpaste']
    : process.platform === 'win32'
      ? ['powershell.exe', '-NoProfile', '-Command', 'Get-Clipboard -Raw']
      : process.env.WAYLAND_DISPLAY
        ? ['wl-paste', '-n']
        : process.env.DISPLAY ? ['xclip', '-selection', 'clipboard', '-o'] : undefined
  if (cmd === undefined) return Promise.reject(new Error('no clipboard tool'))
  return new Promise((resolve, reject) => {
    const child = spawnCmd(cmd[0] ?? '', cmd.slice(1), { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('clipboard timed out'))
    }, 2000)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { output += chunk })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else reject(new Error('clipboard exited ' + String(code)))
    })
  })
}
