/** Read the containing tmux session's mouse policy without changing its configuration. */
import { execFile } from 'node:child_process'

export async function readTmuxMouseEnabled(
  env: NodeJS.ProcessEnv = process.env,
  execute: typeof execFile = execFile,
): Promise<boolean | undefined> {
  if (!env.TMUX && !env.TMUX_PANE) return undefined
  return new Promise(resolve => {
    const args = ['display-message', '-p', ...(env.TMUX_PANE ? ['-t', env.TMUX_PANE] : []), '#{mouse}']
    execute('tmux', args, { timeout: 1000, maxBuffer: 4096, encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      const value = error ? '' : String(stdout).trim()
      resolve(value === '0' || value === 'off' ? false : value === '1' || value === 'on' ? true : undefined)
    })
  })
}
