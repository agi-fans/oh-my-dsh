/** Resolve editor preferences without launching applications or running a shell. */
import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

export const EDITOR_IDS = ['auto', 'code', 'cursor', 'codium', 'nvim', 'vim', 'nano', 'vi'] as const
export type EditorId = typeof EDITOR_IDS[number]
export interface EditorChoice { id: EditorId; label: string }
export interface EditorCommand { command: string; args: string[]; env?: NodeJS.ProcessEnv }
export interface EditorDiscovery {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  executable(path: string): boolean
}
const LABELS: Record<EditorId, string> = {
  auto: 'Auto', code: 'VS Code', cursor: 'Cursor', codium: 'VSCodium', nvim: 'Neovim',
  vim: 'Vim', nano: 'Nano', vi: 'Vi',
}
function systemDiscovery(): EditorDiscovery {
  return {
    platform: process.platform, env: process.env, home: homedir(),
    executable(path) {
      try {
        if (!statSync(path).isFile()) return false
        accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
        return true
      } catch { return false }
    },
  }
}
function environmentEditor(env: NodeJS.ProcessEnv): string | undefined {
  return [env.VISUAL, env.EDITOR].find(value => value !== undefined && value.trim() !== '')
}
function commandParts(command: string): string[] {
  return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/gu)?.map(part => part.replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2')) ?? []
}
function findEditor(id: Exclude<EditorId, 'auto'>, discovery: EditorDiscovery): EditorCommand | undefined {
  const windows = discovery.platform === 'win32'
  const paths = windows ? win32 : posix
  const gui = ['code', 'cursor', 'codium'].includes(id)
  const candidates = (discovery.env.PATH ?? '').split(windows ? ';' : ':').filter(Boolean)
    .map(directory => paths.join(directory, windows ? `${id}.exe` : id))
  if (discovery.platform === 'darwin' && gui) {
    const app = id === 'code' ? 'Visual Studio Code' : id === 'cursor' ? 'Cursor' : 'VSCodium'
    for (const directory of ['/Applications', paths.join(discovery.home, 'Applications')]) {
      candidates.unshift(paths.join(directory, `${app}.app`, 'Contents', 'Resources', 'app', 'bin', id === 'cursor' ? 'code' : id))
    }
  }
  if (windows && gui) {
    const product = id === 'code' ? 'Microsoft VS Code' : id === 'cursor' ? 'cursor' : 'VSCodium'
    const exe = id === 'code' ? 'Code.exe' : id === 'cursor' ? 'Cursor.exe' : 'VSCodium.exe'
    const roots = [discovery.env.LOCALAPPDATA && paths.join(discovery.env.LOCALAPPDATA, 'Programs'), discovery.env.ProgramFiles, discovery.env['ProgramFiles(x86)']]
    // Windows launchers are often .cmd files. Invoke Electron's CLI directly,
    // keeping filenames as arguments rather than passing them through cmd.exe.
    const installations = roots.filter((root): root is string => Boolean(root)).map(root => paths.join(root, product))
    for (const directory of (discovery.env.PATH ?? '').split(';').filter(Boolean)) {
      installations.push(directory, paths.resolve(directory, '..'))
    }
    for (const installation of installations) {
      const command = paths.join(installation, exe)
      const cli = paths.join(installation, 'resources', 'app', 'out', 'cli.js')
      if (discovery.executable(command) && discovery.executable(cli)) {
        return { command, args: [cli, '--wait'], env: { ...discovery.env, ELECTRON_RUN_AS_NODE: '1' } }
      }
    }
  }
  if (windows && gui) return undefined
  const command = candidates.find(candidate => discovery.executable(candidate))
  return command === undefined ? undefined : { command, args: gui ? ['--wait'] : [] }
}

/** Auto honors existing environment preferences before choosing an installed editor. */
export function resolveEditor(id: EditorId = 'auto', discovery: EditorDiscovery = systemDiscovery()): EditorCommand {
  if (id === 'auto') {
    const configured = environmentEditor(discovery.env)
    if (configured !== undefined) {
      const [command, ...args] = commandParts(configured)
      if (command !== undefined) return { command, args }
    }
    for (const candidate of EDITOR_IDS) {
      if (candidate === 'auto') continue
      const found = findEditor(candidate, discovery)
      if (found !== undefined) return found
    }
    throw new Error('No editor was found. Install an editor, then select it in /settings → General → Editor.')
  }
  const found = findEditor(id, discovery)
  if (found === undefined) throw new Error(`${LABELS[id] ?? id} is unavailable. Choose an installed editor in /settings → General → Editor.`)
  return found
}

/** Choices contain installed applications and preserve a missing saved selection. */
export function discoverEditors(selected: EditorId = 'auto', discovery: EditorDiscovery = systemDiscovery()): EditorChoice[] {
  const available = EDITOR_IDS.filter((id): id is Exclude<EditorId, 'auto'> => id !== 'auto' && findEditor(id, discovery) !== undefined)
  const automatic = environmentEditor(discovery.env) !== undefined ? 'environment' : available[0] === undefined ? 'none found' : LABELS[available[0]]
  const choices: EditorChoice[] = [{ id: 'auto', label: `Auto (${automatic})` }, ...available.map(id => ({ id, label: LABELS[id] }))]
  if (!choices.some(choice => choice.id === selected)) choices.push({ id: selected, label: `${LABELS[selected]} (unavailable)` })
  return choices
}
