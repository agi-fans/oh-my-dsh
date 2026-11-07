import { PassThrough } from 'node:stream'
import { expect, it } from 'vitest'
import { LocalTui } from './provider-local.ts'
import { stripAnsi } from '../chrome/width.ts'
import { matchArgumentOptions } from '../session/session-controller.ts'

it.each(['\r', '\t\r'])('renders session titles and submits the selected ID through %j', async keys => {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} })
  let output = ''
  const tui = new LocalTui({ input, output: { isTTY: true, write(text) { output += text } }, width: () => 90, height: () => 24 }, 'model', false)
  try {
    tui.setCommands([{ name: 'resume', description: 'Resume', complete: prefix => matchArgumentOptions([
      { value: 'session-first-exact-id', label: '项目 中文 简介', description: '2h ago · done · first' },
      { value: 'session-second-exact-id', label: '项目 中文 简介', description: '3h ago · done · second' },
    ], prefix) }])
    const submitted = tui.readline()
    input.write('/resume 中文 简介')
    expect(stripAnsi(output)).toContain('项目 中文 简介')
    expect(stripAnsi(output)).not.toContain('session-first-exact-id')
    input.write('\x1b[B')
    input.write(keys)
    expect(await submitted).toBe('/resume session-second-exact-id')
  } finally { tui.dispose() }
})

it.each(['\r', '\t\r'])('replaces a model argument suffix when completing in the middle through %j', async keys => {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} })
  const tui = new LocalTui({ input, output: { isTTY: true, write() {} }, width: () => 90, height: () => 24 }, 'model', false)
  try {
    tui.setCommands([{ name: 'model', description: 'Model', complete: () => [{ value: 'demo/alpha' }] }])
    const submitted = tui.readline()
    input.write('/model alpha')
    input.write('\x1b[D\x1b[D\x1b[D')
    input.write(keys)
    expect(await submitted).toBe('/model demo/alpha')
  } finally { tui.dispose() }
})
