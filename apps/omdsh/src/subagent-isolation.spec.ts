/**
 * Regression coverage for the process-isolated subagent transport.
 *
 * Every in-process subagent backend runs the child agent on the TUI's own
 * event loop, so a heavy delegation starves rendering and the activity
 * animation. The shipped composition therefore also mounts the ACP backend,
 * which spawns a whole child runtime instead. These assertions pin the
 * properties that make that isolation real rather than nominal, and the three
 * settings ACP's absent capabilities force — each of which fails the mount
 * loudly, not silently, when it regresses.
 * @module @agi-fans/oh-my-dsh
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

interface ComposedRow {
  id?: string
  name?: string
  config?: Record<string, unknown>
  disabled?: unknown
}

/** Every row the shipped product bundle mounts, home patch included. */
function shippedRows(): ComposedRow[] {
  const cwd = temp('omdsh-subagent-cwd-')
  const home = temp('omdsh-subagent-home-')
  const patches = loadBootPatches(cwd, { OMDSH_HOME: home }) as ComposedRow[]
  return patches.flatMap(patch => {
    const inserted = (patch as { insert?: ComposedRow[] }).insert
    return Array.isArray(inserted) ? [patch, ...inserted] : [patch]
  })
}

function row(id: string): ComposedRow {
  const found = shippedRows().filter(candidate => candidate.id === id)
  expect(found, `shipped composition rows with id "${id}"`).toHaveLength(1)
  return found[0]!
}

/**
 * A `!!js` config value survives composition as its un-evaluated source, which
 * is what the loader evaluates at mount time.
 */
function jsExpr(value: unknown): string {
  if (typeof value === 'string') return value
  const source = (value as { __jsExpr?: unknown } | undefined)?.__jsExpr
  expect(source, 'config value should be a !!js expression').toBeTypeOf('string')
  return source as string
}

/** Evaluate one `!!js` config expression against a given environment. */
function evalExpr(value: unknown, environment: NodeJS.ProcessEnv): unknown {
  return new Function('process', `return (${jsExpr(value)})`)({ env: environment })
}

describe('process-isolated subagent transport', () => {
  it('mounts the ACP backend under its own provider name', () => {
    const acp = row('subagent-acp')
    expect(acp.name).toBe('@deepseek-ai/dsh-subagent-acp')
    expect(acp.disabled).toBeUndefined()
    // A distinct name keeps the isolated transport addable rather than a
    // replacement for the in-process providers.
    expect(acp.config?.providerName).toBe('acp')
  })

  it('mounts the isolated tool on the ACP provider', () => {
    const tool = row('tool-subagent-isolated')
    expect(tool.name).toBe('@deepseek-ai/dsh-tool-subagent')
    expect(tool.disabled).toBeUndefined()
    expect(tool.config?.provider).toBe('acp')
    // The `subagent_` prefix is what routes this tool through the TUI's
    // existing subagent card renderer instead of the generic card.
    expect(tool.config?.toolName).toBe('subagent_isolated')
  })

  it('keeps every in-process transport mounted', () => {
    // Isolation is opt-in: `subagent` keeps parent-shared capabilities and
    // continuable runs, which ACP cannot honour.
    for (const [id, name, provider, tool] of [
      ['subagent-spawn', '@deepseek-ai/dsh-subagent-spawn-in-process', 'spawn', undefined],
      ['subagent-fork', '@deepseek-ai/dsh-subagent-fork-in-process', 'fork', undefined],
      ['tool-subagent', '@deepseek-ai/dsh-tool-subagent', 'spawn', 'subagent'],
      ['tool-subagent-fork', '@deepseek-ai/dsh-tool-subagent', 'fork', 'subagent_fork'],
    ] as const) {
      const candidate = row(id)
      expect(candidate.name).toBe(name)
      expect(candidate.disabled).toBeUndefined()
      expect(candidate.config?.providerName ?? candidate.config?.provider).toBe(provider)
      if (tool !== undefined) expect(candidate.config?.toolName).toBe(tool)
    }
    // Continuable background delegation survives on the in-process tool.
    expect(row('tool-subagent').config?.backgroundMode).toBe('continuable')
  })

  it('configures the isolated tool for the capabilities ACP actually has', () => {
    const config = row('tool-subagent-isolated').config ?? {}
    // A numeric depth cap is refused, because the provider cannot enforce
    // recursion depth across a process boundary.
    expect(config.maxDepth).toBe('provider-managed')
    // The published ACP provider implements no `prepareContinuable`, so a
    // continuable run is refused at mount.
    expect(config.backgroundMode).toBe('one-shot')
    // Each of these is refused outright rather than silently dropped.
    for (const unsupported of ['agentOptions', 'persona', 'toolFilter', 'modelSelectionSettings']) {
      expect(config, `isolated tool must not request ${unsupported}`).not.toHaveProperty(unsupported)
    }
  })

  it('gives the child runtime its own DSH_HOME', () => {
    const env = (row('subagent-acp').config?.env ?? {}) as Record<string, unknown>
    // The child boots its own profile. Sharing the parent's home would let it
    // read the parent's profiles and credentials, and recurse if that
    // composition also delegated over ACP.
    expect(env).toHaveProperty('DSH_HOME')

    // Resolve the expression the loader will evaluate, against a parent home
    // that deliberately sits inside this run's temp root.
    const home = temp('omdsh-subagent-resolve-')
    const resolved = evalExpr(env.DSH_HOME, { OMDSH_HOME: home, HOME: '/home/example' })
    expect(resolved).toBe(join(home, 'acp-child'))
    // Never the parent home itself: that would defeat the isolation.
    expect(resolved).not.toBe(home)
  })

  it('does not hand the parent home to the child', () => {
    const env = (row('subagent-acp').config?.env ?? {}) as Record<string, unknown>
    // With no explicit home configured, DSH_HOME must still not fall back to
    // the parent's own directory.
    const resolved = evalExpr(env.DSH_HOME, { HOME: '/home/example' })
    expect(String(resolved)).not.toBe('/home/example/.dsh')
    expect(String(resolved)).toContain('/acp-child')
    // OMDSH_HOME is deliberately absent when unset, so the child does not
    // inherit the parent's product home.
    expect(evalExpr(env.OMDSH_HOME, { HOME: '/home/example' })).toBeUndefined()
  })

  it('forwards a credential to the child so it can run turns', () => {
    const env = (row('subagent-acp').config?.env ?? {}) as Record<string, unknown>
    // The child is a separate runtime with its own credential store, so the
    // parent must forward one. The subprocess seam scrubs ambient
    // credential-shaped variables before these are layered on.
    const resolved = evalExpr(env.DEEPSEEK_API_KEY, { OMDSH_DEEPSEEK_API_KEY: 'sk-test' })
    expect(resolved).toBe('sk-test')
  })
})

describe('workflow and Ralph tool box', () => {
  it('mounts the worker-thread engine as the workflowEngine provider', () => {
    const engine = row('workflow-worker-thread')
    expect(engine.name).toBe('@deepseek-ai/dsh-workflow-worker-thread')
    expect(engine.disabled).toBeUndefined()
    expect(engine.config?.provider).toBe('spawn')
    // The seam package itself must NOT be mounted: it would double-register
    // the `workflowEngine` service and fail the boot.
    expect(shippedRows().filter(candidate => candidate.name === '@deepseek-ai/dsh-workflow')).toHaveLength(0)
  })

  it('exposes the workflow tool under a name that cannot read as /workflow', () => {
    const tool = row('tool-workflow')
    expect(tool.name).toBe('@deepseek-ai/dsh-tool-workflow')
    expect(tool.disabled).toBeUndefined()
    // omdsh owns a `/workflow` slash command for Default/Plan mode; a bare
    // `workflow` tool name would be read as that command.
    expect(tool.config?.toolName).toBe('workflow_run')
    expect(tool.config?.toolName).not.toBe('workflow')
  })

  it('mounts Ralph against the continuable in-process provider', () => {
    const ralph = row('tool-ralph')
    expect(ralph.name).toBe('@deepseek-ai/dsh-tool-ralph')
    expect(ralph.disabled).toBeUndefined()
    // Ralph iterates fresh agents, so it needs the continuable transport the
    // in-process spawn provider supplies.
    expect(ralph.config?.subagentProvider).toBe('spawn')
    expect(typeof ralph.config?.maxRounds).toBe('number')
  })
})
