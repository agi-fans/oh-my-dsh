import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadLspPatches } from './lsp-config.ts'

const roots: string[] = []

function temp(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name))
  roots.push(path)
  return path
}

function writeConfig(root: string, value: unknown): void {
  mkdirSync(join(root, '.dsh'), { recursive: true })
  writeFileSync(join(root, '.dsh', 'lsp.json'), JSON.stringify(value))
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('native LSP config', () => {
  it('mounts the seam, host, and tool together for configured servers', () => {
    const cwd = temp('omdsh-lsp-project-')
    writeConfig(cwd, { servers: {
      typescript: {
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' },
      },
      off: { enabled: false, command: 'ignored', extensionToLanguage: { '.x': 'x' } },
    } })
    expect(loadLspPatches(cwd, { OMDSH_HOME: temp('omdsh-lsp-home-') })).toEqual([{ insert: [
      { id: 'lsp', name: '@deepseek-ai/dsh-lsp' },
      {
        id: 'lsp-stdio',
        name: '@deepseek-ai/dsh-lsp-stdio',
        config: {
          servers: {
            typescript: {
              command: 'typescript-language-server',
              args: ['--stdio'],
              extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' },
            },
          },
        },
      },
      { id: 'tool-lsp', name: '@deepseek-ai/dsh-tool-lsp' },
    ] }])
  })

  it('mounts nothing without a configured server', () => {
    const cwd = temp('omdsh-lsp-project-')
    expect(loadLspPatches(cwd, { OMDSH_HOME: temp('omdsh-lsp-home-') })).toEqual([])
    writeConfig(cwd, { servers: { off: { enabled: false, command: 'x', extensionToLanguage: { '.x': 'x' } } } })
    expect(loadLspPatches(cwd, { OMDSH_HOME: temp('omdsh-lsp-home-') })).toEqual([])
  })

  it('lets project definitions override user definitions', () => {
    const cwd = temp('omdsh-lsp-project-')
    const home = temp('omdsh-lsp-home-')
    mkdirSync(join(cwd, '.git'))
    writeFileSync(join(home, 'lsp.json'), JSON.stringify({ servers: {
      shared: { command: 'user-server', extensionToLanguage: { '.x': 'x' } },
      user: { command: 'user-only', extensionToLanguage: { '.y': 'y' } },
    } }))
    writeConfig(cwd, { servers: {
      shared: { command: 'project-server', extensionToLanguage: { '.x': 'x' } },
    } })
    const servers = loadLspPatches(join(cwd, 'nested'), { OMDSH_HOME: home })[0]?.insert[1]?.config?.servers
    expect(Object.keys(servers as object)).toEqual(['shared', 'user'])
    expect((servers as Record<string, { command: string }>).shared?.command).toBe('project-server')
  })

  it('fails loud on malformed definitions', () => {
    const cwd = temp('omdsh-lsp-project-')
    writeConfig(cwd, { servers: { broken: { command: 'x' } } })
    expect(() => loadLspPatches(cwd, { OMDSH_HOME: temp('omdsh-lsp-home-') }))
      .toThrow('"broken.extensionToLanguage" must be an object of extension-to-language entries')

    writeConfig(cwd, { servers: { broken: { extensionToLanguage: { '.x': 'x' } } } })
    expect(() => loadLspPatches(cwd, { OMDSH_HOME: temp('omdsh-lsp-home-') }))
      .toThrow('server "broken" requires a non-empty "command"')

    writeConfig(cwd, { servers: { broken: { command: 'x', extensionToLanguage: { 'x': 'x' } } } })
    expect(() => loadLspPatches(cwd, { OMDSH_HOME: temp('omdsh-lsp-home-') }))
      .toThrow('must be a lowercase leading-dot extension')

    writeConfig(cwd, { servers: { 'bad name': { command: 'x', extensionToLanguage: { '.x': 'x' } } } })
    expect(() => loadLspPatches(cwd, { OMDSH_HOME: temp('omdsh-lsp-home-') }))
      .toThrow('server name "bad name" must match')
  })

  it('expands environment placeholders and defaults', () => {
    const cwd = temp('omdsh-lsp-project-')
    writeConfig(cwd, { servers: { typescript: {
      command: '${LSP_BIN:-typescript-language-server}',
      args: ['--tsserver-path', '${TS_SERVER}'],
      extensionToLanguage: { '.ts': 'typescript' },
    } } })
    const servers = loadLspPatches(cwd, {
      OMDSH_HOME: temp('omdsh-lsp-home-'), TS_SERVER: '/opt/tsserver',
    })[0]?.insert[1]?.config?.servers as Record<string, { command: string; args: string[] }>
    expect(servers.typescript?.command).toBe('typescript-language-server')
    expect(servers.typescript?.args).toEqual(['--tsserver-path', '/opt/tsserver'])
  })
})
