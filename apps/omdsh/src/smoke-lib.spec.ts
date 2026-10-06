/** Smoke subprocesses must not report lifecycle for the agent running them. */
import { afterEach, describe, expect, it, vi } from 'vitest'

const { smokeEnv } = await import(new URL('../../../scripts/smoke-lib.mjs', import.meta.url).href)

afterEach(() => { vi.unstubAllEnvs() })

describe('smoke subprocess environment', () => {
  it('removes inherited Herdr pane identity while retaining normal environment', () => {
    vi.stubEnv('HERDR_ENV', '1')
    vi.stubEnv('HERDR_PANE_ID', 'parent:pane')
    vi.stubEnv('HERDR_SOCKET_PATH', '/tmp/parent-herdr.sock')
    vi.stubEnv('HERDR_WORKSPACE_ID', 'parent')
    vi.stubEnv('SMOKE_TEST_NORMAL_ENV', 'retained')
    const env = smokeEnv('/tmp/smoke-home')
    expect(Object.keys(env).filter(key => key.startsWith('HERDR_'))).toEqual([])
    expect(env.SMOKE_TEST_NORMAL_ENV).toBe('retained')
    expect(env.OMDSH_HOME).toBe('/tmp/smoke-home')
    expect(process.env.HERDR_PANE_ID).toBe('parent:pane')
  })

  it('allows an explicit isolated Herdr transport fixture', () => {
    vi.stubEnv('HERDR_PANE_ID', 'parent:pane')
    expect(smokeEnv('/tmp/smoke-home', {
      HERDR_ENV: '1', HERDR_PANE_ID: 'fixture:pane', HERDR_SOCKET_PATH: '/tmp/fixture-herdr.sock',
    })).toMatchObject({
      HERDR_ENV: '1', HERDR_PANE_ID: 'fixture:pane', HERDR_SOCKET_PATH: '/tmp/fixture-herdr.sock',
    })
  })
})
