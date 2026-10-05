/**
 * Best-effort system clipboard write for `/copy`.
 * @module @agi-fans/dsh-tui
 */

import { spawn } from 'node:child_process'

/** Writer used by `/copy`; injectable in tests. */
export type ClipboardWriter = (text: string) => Promise<ClipboardDelivery | void>

/** A terminal request has no acknowledgement; distinguish it from a successful local write. */
export type ClipboardDelivery = 'confirmed' | 'requested'

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

/** Bounded clipboard helper; payloads go through stdin rather than shell arguments. */
async function runCommand(
  command: readonly string[], text: string | undefined, spawnCmd: typeof spawn,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnCmd(command[0] ?? '', command.slice(1), { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('clipboard timed out')) }, 2000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      output += chunk
      if (output.length > 64 * 1024) { child.kill(); reject(new Error('clipboard helper output too large')) }
    })
    child.stdin?.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else reject(new Error('clipboard helper failed'))
    })
    child.stdin?.end(text)
  })
}

/** Forward to an attached client in this pane's session, never an unrelated tmux client. */
async function copyThroughTmux(text: string, pane: string, spawnCmd: typeof spawn): Promise<void> {
  const setting = await runCommand(['tmux', 'show-options', '-gv', 'set-clipboard'], undefined, spawnCmd)
  if (setting.trim() === 'off') throw new Error('tmux clipboard is off')
  const session = (await runCommand(['tmux', 'display-message', '-p', '-t', pane, '#{session_id}'], undefined, spawnCmd)).trim()
  if (!session) throw new Error('no tmux session')
  const clients = await runCommand(['tmux', 'list-clients', '-t', session, '-F', '#{client_activity}\t#{client_name}'], undefined, spawnCmd)
  const client = clients.trim().split('\n').map(line => {
    const [time, ...name] = line.split('\t')
    return { activity: Number(time), name: name.join('\t') }
  }).filter(client => client.name !== '' && Number.isFinite(client.activity))
    .sort((a, b) => b.activity - a.activity)[0]?.name
  if (!client) throw new Error('no attached tmux client')
  const capabilities = await runCommand(['tmux', 'show-messages', '-T', '-t', client], undefined, spawnCmd)
  if (!capabilities.split('\n').some(line => /Ms: \(string\) \S/.test(line))) throw new Error('tmux client cannot forward clipboard requests')
  await runCommand(['tmux', 'load-buffer', '-w', '-t', client, '-'], text, spawnCmd)
}

/** Copy locally, and forward to the user's terminal in remote or tmux sessions. */
export async function copyToClipboard(
  text: string,
  spawnCmd: typeof spawn = spawn,
  options: {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    output?: { isTTY?: boolean; write(chunk: string): unknown }
  } = {},
): Promise<ClipboardDelivery> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const output = options.output ?? process.stdout
  const remote = Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY)
  const cmd = clipboardCommand(platform, env)
  let confirmed = false
  if (cmd !== undefined) {
    try { await runCommand(cmd, text, spawnCmd); confirmed = true } catch { /* Try terminal forwarding. */ }
  }
  const forwardingNeeded = remote || Boolean(env.TMUX || env.TMUX_PANE) || !confirmed
  if (!forwardingNeeded) return 'confirmed'
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > 100_000) {
    if (confirmed && !remote) return 'confirmed'
    throw new Error('text exceeds terminal clipboard limit')
  }
  if (env.TMUX_PANE) {
    try { await copyThroughTmux(text, env.TMUX_PANE, spawnCmd); return confirmed && !remote ? 'confirmed' : 'requested' }
    catch { /* The outer terminal may allow direct OSC 52 passthrough. */ }
  }
  if (output.isTTY !== true) {
    if (confirmed && !remote) return 'confirmed'
    throw new Error('no clipboard available')
  }
  const sequence = `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`
  output.write(env.TMUX || env.TMUX_PANE
    ? `\x1bPtmux;${sequence.replaceAll('\x1b', '\x1b\x1b')}\x1b\\` : sequence)
  return confirmed && !remote ? 'confirmed' : 'requested'
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
