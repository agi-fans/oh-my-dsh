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

describe('DeepSeek hosted web search', () => {
  it('mounts the provider with the conversation credential and bounds each request', () => {
    const patches = loadBootPatches(temp('omdsh-search-cwd-'), { OMDSH_HOME: temp('omdsh-search-home-') })
    const rows = ((patches[0] as { insert?: Array<{ id?: string, name?: string, config?: Record<string, unknown> }> }).insert) ?? []
    const index = (id: string) => rows.findIndex(row => row.id === id)
    expect(rows[index('web-search-deepseek')]?.name).toBe('@deepseek-ai/dsh-web-search-deepseek')
    expect(rows[index('web-search-deepseek')]?.config).toMatchObject({ apiKeyEnv: 'DEEPSEEK_API_KEY', maxUses: 5 })
    expect(index('web-search-deepseek')).toBeLessThan(index('web-fetch-http'))
    expect(rows[index('tool-web')]?.config).toMatchObject({ search: true, fetch: true, searchTimeoutMs: 60000 })
  })

  it('exposes both web tools to the model by default', async () => {
    const turn = await bootTuiTurn({ preset: 'standard', home: temp('omdsh-search-') })
    const clean = turn.output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, '')
    expect(turn.status, clean.slice(-2000)).toBe(0)
    expect(turn.bodies, clean.slice(-2000)).not.toHaveLength(0)
    const names = requestToolNames(turn.bodies[0])
    expect(names).toContain('web_search')
    expect(names).toContain('web_fetch')
  }, 180_000)
})
