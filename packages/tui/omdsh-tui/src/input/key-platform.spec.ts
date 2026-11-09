import { expect, it } from 'vitest'
import { useWindowsKeybindings } from './key-platform.ts'

it.each([
  ['win32', {}, true],
  ['darwin', { WSL_INTEROP: 'forwarded' }, false],
  ['linux', {}, false],
  ['linux', { WSL_DISTRO_NAME: 'Ubuntu' }, true],
  ['linux', { WSL_INTEROP: '/run/WSL/interop' }, true],
  ...['SSH_CONNECTION', 'SSH_CLIENT', 'SSH_TTY'].map(key => ['linux', { WSL_DISTRO_NAME: 'Ubuntu', [key]: 'remote' }, false]),
] as [NodeJS.Platform, NodeJS.ProcessEnv, boolean][])('selects terminal key defaults for %s with %j', (platform, env, expected) => {
  expect(useWindowsKeybindings(platform, env)).toBe(expected)
})
