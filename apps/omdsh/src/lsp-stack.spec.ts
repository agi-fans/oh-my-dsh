/**
 * Integration contract for the composed language-server stack: the real
 * `dsh-lsp` seam, the real `dsh-lsp-stdio` host, and a real stdio server
 * process. The fixture server speaks just enough LSP to prove that a query
 * travels from the seam through framing, transient document sync, and result
 * normalization.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import Lsp from '@deepseek-ai/dsh-lsp'
import * as LspStdio from '@deepseek-ai/dsh-lsp-stdio'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolLsp from '@deepseek-ai/dsh-tool-lsp'
import { afterEach, describe, expect, it } from 'vitest'

const fixture = fileURLToPath(new URL('./fixtures/fake-lsp-server.mjs', import.meta.url))

const roots: string[] = []

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), 'omdsh-lsp-workspace-'))
  roots.push(path)
  writeFileSync(join(path, 'a.ts'), 'export const answer = 42\n')
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

async function mount(): Promise<{ ctx: Context; root: string }> {
  const root = workspace()
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(Lsp)
  await ctx.plugin(LspStdio, {
    servers: {
      fake: {
        command: process.execPath,
        args: [fixture],
        extensionToLanguage: { '.ts': 'typescript' },
      },
    },
  })
  return { ctx, root }
}

describe('composed language-server stack', () => {
  it('answers definitions, references, implementations, and hover through a real stdio server', async () => {
    const { ctx, root } = await mount()
    try {
      const request = { filePath: 'a.ts', position: { line: 0, character: 0 }, workspaceRoot: root }
      const definition = await ctx.lsp.query({ ...request, operation: 'goToDefinition' })
      expect(definition.kind).toBe('locations')
      if (definition.kind !== 'locations') return
      expect(definition.locations).toHaveLength(1)
      expect(definition.locations[0]?.uri.endsWith('/a.ts')).toBe(true)
      expect(definition.locations[0]?.range.start).toEqual({ line: 3, character: 2 })

      const references = await ctx.lsp.query({ ...request, operation: 'findReferences' })
      expect(references.kind === 'locations' ? references.locations.length : 0).toBe(2)

      const implementations = await ctx.lsp.query({ ...request, operation: 'goToImplementation' })
      expect(implementations.kind === 'locations' ? implementations.locations.length : 0).toBe(1)

      const hover = await ctx.lsp.query({ ...request, operation: 'hover' })
      expect(hover.kind).toBe('hover')
      if (hover.kind !== 'hover') return
      expect(hover.hover?.contents).toContain('fake hover')
    } finally {
      await ctx.fiber.dispose()
    }
  }, 60_000)

  it('registers the model-facing lsp tool once the row trio is mounted', async () => {
    const root = workspace()
    const ctx = new Context()
    try {
      await ctx.plugin(LocalFileSystem)
      await ctx.plugin(LocalSubprocess)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(Lsp)
      await ctx.plugin(LspStdio, {
        servers: { fake: { command: process.execPath, args: [fixture], extensionToLanguage: { '.ts': 'typescript' } } },
      })
      await ctx.plugin(ToolLsp)
      const schema = ctx.tools.schemas().find(candidate => candidate.name === 'lsp')
      expect(schema).toBeDefined()
      const parameters = schema?.parameters as { properties?: Record<string, unknown> } | undefined
      expect(Object.keys(parameters?.properties ?? {}))
        .toEqual(expect.arrayContaining(['operation', 'file_path', 'line', 'character']))
      expect(JSON.stringify(schema)).toContain('goToDefinition')
    } finally {
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('rejects a query for an extension no provider handles', async () => {
    const { ctx, root } = await mount()
    try {
      writeFileSync(join(root, 'a.py'), 'print(1)\n')
      await expect(ctx.lsp.query({
        operation: 'goToDefinition',
        filePath: 'a.py',
        position: { line: 0, character: 0 },
        workspaceRoot: root,
      })).rejects.toMatchObject({ code: 'LSP_UNAVAILABLE' })
    } finally {
      await ctx.fiber.dispose()
    }
  }, 60_000)
})
