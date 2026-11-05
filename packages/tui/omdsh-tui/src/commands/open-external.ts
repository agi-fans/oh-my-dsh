import { spawn } from 'node:child_process'
import process from 'node:process'

/** Best-effort browser launch; callers always retain the full URL as a fallback. */
export function openExternal(url: string): void {
  const command = process.platform === 'darwin'
    ? { file: 'open', args: [url] }
    : process.platform === 'win32'
      ? { file: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] }
      : { file: 'xdg-open', args: [url] }
  try {
    const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' })
    child.once('error', () => undefined)
    child.unref()
  } catch {
    // Headless and remote terminals still receive the visible URL.
  }
}
