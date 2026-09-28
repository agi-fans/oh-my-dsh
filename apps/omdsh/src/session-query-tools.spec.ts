import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootTuiTurn, requestToolNames } from './test-support/tui-boot.ts'
import { loadBootPatches } from './composition.ts'

const roots: string[] = []

function temp(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name))
  roots.push(path)
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

/** The five read-only tools the Harness registers for model-facing history. */
const SESSION_QUERY_TOOLS = [
  'session_search',
  'session_event_search',
  'session_trace',
  'session_event_trace',
  'session_event_read',
]

describe('model-facing session history', () => {
  it('mounts the tools row inside the session-query chain it depends on', () => {
    const patches = loadBootPatches(temp('omdsh-sq-cwd-'), { OMDSH_HOME: temp('omdsh-sq-home-') })
    const rows = ((patches[0] as { insert?: Array<{ id?: string, name?: string }> }).insert) ?? []
    const index = (id: string): number => rows.findIndex(row => row.id === id)
    expect(rows[index('tool-session-query')]?.name).toBe('@deepseek-ai/dsh-tool-session-query')
    // The row injects tools, systemPrompt, sessionQuery and
    // sessionProjections; each of those has to be mounted too.
    for (const dependency of ['tools', 'system-prompt', 'session-query', 'session-projection']) {
      expect(index(dependency), `dependency row ${dependency}`).toBeGreaterThanOrEqual(0)
    }
  })

  it('exposes all five history tools to the model by default', async () => {
    const turn = await bootTuiTurn({ preset: 'standard', home: temp('omdsh-sq-turn-') })
    const clean = turn.output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, '')
    expect(turn.status, clean.slice(-2000)).toBe(0)
    expect(turn.bodies, clean.slice(-2000)).not.toHaveLength(0)
    const names = requestToolNames(turn.bodies[0])
    for (const tool of SESSION_QUERY_TOOLS) expect(names, `tool ${tool}`).toContain(tool)
  }, 180_000)

  it('keeps the tools read-only: no mutation tool joins the catalog', async () => {
    const turn = await bootTuiTurn({ preset: 'standard', home: temp('omdsh-sq-ro-') })
    const clean = turn.output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, '')
    expect(turn.status, clean.slice(-2000)).toBe(0)
    const names = requestToolNames(turn.bodies[0])
    // The package advertises five read-only tools; a write-shaped sibling
    // appearing here would mean the authorization model changed.
    const historyTools = names.filter(name => name.includes('session'))
    expect(historyTools.sort()).toEqual([...SESSION_QUERY_TOOLS].sort())
  }, 180_000)
})
