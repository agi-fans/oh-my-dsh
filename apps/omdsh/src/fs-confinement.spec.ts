/**
 * The product composition must mount a sandbox-enforcing filesystem backend.
 * A bare backend reports `sandboxMode === undefined`, which makes
 * `dsh-tool-fs` advertise no escalation and lets every `write`/`edit` escape
 * the `/permission` preset, so this pins both the composed row and the
 * confinement the row provides.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-fs-sandbox'
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
}

/** Every row of the composed product bundle, in mount order. */
function composedRows(): ComposedRow[] {
  const patches = loadBootPatches(process.cwd(), { OMDSH_HOME: temp('omdsh-fs-home-') })
  return patches.flatMap((patch) => {
    const inserted = (patch as { insert?: ComposedRow[] }).insert
    return Array.isArray(inserted) ? inserted : [patch as ComposedRow]
  })
}

function rowIndex(rows: readonly ComposedRow[], id: string): number {
  return rows.findIndex(row => row.id === id)
}

describe('composed filesystem confinement', () => {
  it('mounts the sandbox-enforcing backend, not the bare local one', () => {
    const rows = composedRows()
    expect(rows[rowIndex(rows, 'fs')]?.name).toBe('@deepseek-ai/dsh-fs-sandbox')
  })

  /** Mount the composed backend over a policy, exactly as the product composition does. */
  async function mountFs(mode: 'read-only' | 'workspace-write', workspace: string): Promise<Context> {
    const row = composedRows().find(candidate => candidate.id === 'fs')
    expect(row?.name).toBeDefined()
    const backend = (await import(row?.name as string)) as { default: unknown }
    const ctx = new Context()
    await ctx.plugin(SessionProjection)
    await ctx.plugin(SandboxPolicy, { mode, workspaceRoot: workspace })
    await ctx.plugin(backend.default as never)
    return ctx
  }

  it('confines mutations to the workspace and reports the capability fact', async () => {
    const workspace = temp('omdsh-fs-workspace-')
    const ctx = await mountFs('workspace-write', workspace)
    try {
      const policy = { mode: 'workspace-write' as const, workspaceRoot: workspace }
      expect(ctx.fs.sandboxMode).toBe('workspace-write')
      const inside = await ctx.fs.resolve(join(workspace, 'inside.txt'))
      await expect(ctx.fs.writeText(inside, 'ok', undefined, undefined, policy)).resolves.toBeDefined()
      const outside = await ctx.fs.resolve('/omdsh-confinement-probe.txt')
      await expect(ctx.fs.writeText(outside, 'denied', undefined, undefined, policy))
        .rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('denies every mutation under the read-only preset, including inside the workspace', async () => {
    const workspace = temp('omdsh-fs-readonly-')
    const ctx = await mountFs('read-only', workspace)
    try {
      const policy = { mode: 'read-only' as const, workspaceRoot: workspace }
      expect(ctx.fs.sandboxMode).toBe('read-only')
      const inside = await ctx.fs.resolve(join(workspace, 'inside.txt'))
      await expect(ctx.fs.writeText(inside, 'denied', undefined, undefined, policy))
        .rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
      await expect(ctx.fs.editText(
        inside,
        { oldString: 'a', newString: 'b', replaceAll: false },
        undefined,
        undefined,
        policy,
      )).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('trims oversized tool results before compaction runs', () => {
    const rows = composedRows()
    const pruner = rowIndex(rows, 'tool-result-pruner')
    const compaction = rowIndex(rows, 'compaction')
    expect(rows[pruner]?.name).toBe('@deepseek-ai/dsh-compaction-tool-result-pruner')
    expect(pruner).toBeGreaterThan(rowIndex(rows, 'token-meter'))
    expect(pruner).toBeLessThan(compaction)
  })

  it('mounts the tool-chain guards', () => {
    const rows = composedRows()
    expect(rows[rowIndex(rows, 'timeout-policy')]?.name).toBe('@deepseek-ai/dsh-tool-call-timeout-policy')
    expect(rows[rowIndex(rows, 'repeat-tool-reminder')]?.name).toBe('@deepseek-ai/dsh-repeat-tool-reminder')
  })
})
