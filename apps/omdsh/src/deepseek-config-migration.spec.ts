import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { Config as PiAiConfig } from '@deepseek-ai/dsh-llm-pi-ai'
import {
  formatDeepSeekImageLimitDiagnostic,
  inspectDeepSeekImageLimits,
  MAX_DEEPSEEK_IMAGE_TARGET_BYTES,
  migrateDeepSeekImageLimitFile,
  migrateDeepSeekImageLimitYaml,
  normalizeDeepSeekRuntimeConfig,
} from './deepseek-config-migration.ts'
import { PRODUCT_BUNDLE } from './profile.ts'

const app = fileURLToPath(new URL('../', import.meta.url))
const roots: string[] = []

function temp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function runProbe(script: string, cwd: string, env: NodeJS.ProcessEnv): Promise<{ status: number | null; out: string }> {
  const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, script], {
    cwd,
    env: {
      ...process.env,
      NO_COLOR: '1',
      NODE_PATH: fileURLToPath(new URL('../../../node_modules/.pnpm/node_modules', import.meta.url)),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', chunk => { out += String(chunk) })
  child.stderr.on('data', chunk => { out += String(chunk) })
  const status = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`probe timed out\n${out.slice(-3000)}`)) }, 60_000)
    child.on('error', reject)
    child.on('close', code => { clearTimeout(timer); resolve(code) })
  })
  return { status, out }
}

describe('legacy DeepSeek imageMaxBytes migration', () => {
  it('surgically migrates valid YAML keys while preserving string quoting, !!js tags, comments, and un-migrated oversize limits', () => {
    const source = [
      '# leading comment',
      '- id: "123"',
      '  name: "@deepseek-ai/dsh-llm-deepseek-api-key"',
      '  config:',
      '    baseURL: !!js "process.env.DEEPSEEK_BASE_URL || \'https://api.deepseek.com\'"',
      '    models:',
      '      - id: "007"',
      '        inputModalities: [text, image]',
      '        imageMaxBytes: 512000 # inline comment',
      '      - id: "008"',
      '        inputModalities: [text, image]',
      '        imageMaxBytes: 123456',
      '        imageTargetBytes: 256000',
      '      - id: "009"',
      '        inputModalities: [text, image]',
      `        imageMaxBytes: ${MAX_DEEPSEEK_IMAGE_TARGET_BYTES + 1}`,
      '- id: llm-deepseek-account',
      '  config:',
      '    modelOverrides:',
      '      deepseek-chat:',
      '        imageMaxBytes: 256000',
      '',
    ].join('\n')

    const migrated = migrateDeepSeekImageLimitYaml(source)
    expect(migrated.changed).toBe(true)
    expect(migrated.output).toContain('# leading comment')
    expect(migrated.output).toContain('id: "123"')
    expect(migrated.output).toContain('baseURL: !!js')
    expect(migrated.output).toContain('imageTargetBytes: 512000 # inline comment')
    expect(migrated.output).toContain('imageTargetBytes: 256000')
    // Oversize legacy value stays untouched so doctor continues reporting it.
    expect(migrated.output).toContain(`imageMaxBytes: ${MAX_DEEPSEEK_IMAGE_TARGET_BYTES + 1}`)
    expect(migrated.output).not.toContain(`imageTargetBytes: ${MAX_DEEPSEEK_IMAGE_TARGET_BYTES + 1}`)
    expect(migrated.findings.map(formatDeepSeekImageLimitDiagnostic).filter(Boolean)).toEqual([
      expect.stringContaining('32 MiB'),
    ])

    const dir = temp('omdsh-yaml-roundtrip-')
    const file = join(dir, 'cordis.patch.yml')
    writeFileSync(file, migrated.output)
    const parsed = loadOptionalPatches('omdsh', file) as Array<{
      id: unknown
      config: { baseURL?: unknown; models?: Array<Record<string, unknown>>; modelOverrides?: Record<string, Record<string, unknown>> }
    }>
    expect(parsed[0]?.id).toBe('123')
    expect(parsed[0]?.config.baseURL).toEqual({ __jsExpr: "process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'" })
    expect(parsed[0]?.config.models?.[0]).toMatchObject({ id: '007', imageTargetBytes: 512000 })
    expect(parsed[0]?.config.models?.[0]).not.toHaveProperty('imageMaxBytes')
    expect(parsed[0]?.config.models?.[1]).toMatchObject({ id: '008', imageTargetBytes: 256000 })
    expect(parsed[0]?.config.models?.[1]).not.toHaveProperty('imageMaxBytes')
    expect(parsed[0]?.config.models?.[2]).toMatchObject({ id: '009', imageMaxBytes: MAX_DEEPSEEK_IMAGE_TARGET_BYTES + 1 })
    expect(parsed[0]?.config.models?.[2]).not.toHaveProperty('imageTargetBytes')
    expect(parsed[1]?.config.modelOverrides?.['deepseek-chat']).toEqual({ imageTargetBytes: 256000 })
    // Subsequent inspection still flags the un-migrated oversize key.
    expect(inspectDeepSeekImageLimits(parsed).map(formatDeepSeekImageLimitDiagnostic).filter(Boolean)).toEqual([
      expect.stringContaining('32 MiB'),
    ])
  })

  it('handles imageTargetBytes: null without duplicate keys, preserves field-level !!js expressions, avoids mutating shared !!js objects, and serializes on the Profile package.json lock', async () => {
    const nullCoexist = [
      '- id: llm-deepseek',
      '  config:',
      '    models:',
      '      - id: nullable-model',
      '        inputModalities: [text, image]',
      '        imageTargetBytes: null',
      '        imageMaxBytes: 512000',
      '      - id: dyn-legacy',
      '        inputModalities: [text, image]',
      '        imageMaxBytes: !!js "512 * 1024"',
      '      - id: dyn-target',
      '        inputModalities: [text, image]',
      '        imageTargetBytes: !!js "40000000"',
      '',
    ].join('\n')

    const migrated = migrateDeepSeekImageLimitYaml(nullCoexist)
    expect(migrated.changed).toBe(true)
    expect(migrated.output.match(/imageTargetBytes:/gu)?.length).toBe(2)
    expect(migrated.output).toContain('imageTargetBytes: 512000')
    expect(migrated.output).not.toContain('imageTargetBytes: null')
    // Field-level !!js legacy expression stays un-renamed on disk and both dynamic fields report dynamic-expression.
    expect(migrated.output).toContain('imageMaxBytes: !!js "512 * 1024"')
    expect(migrated.findings.filter(item => item.kind === 'dynamic-expression').map(item => item.modelId)).toEqual([
      'dyn-legacy',
      'dyn-target',
    ])

    const dir = temp('omdsh-null-and-lock-')
    const patchPath = join(dir, 'cordis.patch.yml')
    const lockPath = join(dir, 'package.json')
    writeFileSync(patchPath, migrated.output)
    writeFileSync(lockPath, '{}\n')
    // Must re-parse cleanly through dsh-app-boot without DUPLICATE_KEY.
    const parsed = loadOptionalPatches('omdsh', patchPath) as Array<{ config: { models: Array<Record<string, unknown>> } }>
    expect(parsed[0]?.config.models[0]).toMatchObject({ id: 'nullable-model', imageTargetBytes: 512000 })
    expect(parsed[0]?.config.models[0]).not.toHaveProperty('imageMaxBytes')
    expect(inspectDeepSeekImageLimits(parsed).filter(item => item.kind === 'dynamic-expression').map(item => item.modelId)).toEqual([
      'dyn-legacy',
      'dyn-target',
    ])

    // Runtime normalization handles imageTargetBytes: null and never mutates a shared !!js result object.
    const sharedModel = { id: 'shared-vl', inputModalities: ['text', 'image'], imageTargetBytes: null, imageMaxBytes: 512000 }
    const sharedConfig = { models: [sharedModel] }
    const runtime = normalizeDeepSeekRuntimeConfig({ sharedConfig }, { __jsExpr: 'sharedConfig' }, 'llm-deepseek')
    expect(runtime.changed).toBe(true)
    expect(runtime.config).toEqual({ models: [{ id: 'shared-vl', inputModalities: ['text', 'image'], imageTargetBytes: 512000 }] })
    expect(sharedModel).toEqual({ id: 'shared-vl', inputModalities: ['text', 'image'], imageTargetBytes: null, imageMaxBytes: 512000 })

    // Migration serializes on the same package.json lock as ConfigEditor.edit() and re-reads post-lock edits.
    writeFileSync(patchPath, [
      '- id: llm-deepseek',
      '  config:',
      '    models:',
      '      - id: race-model',
      '        inputModalities: [text, image]',
      '        imageMaxBytes: 512000',
      '',
    ].join('\n'))
    let releaseLock!: () => void
    const lockAcquired = Promise.withResolvers<void>()
    const holder = withFileLock(lockPath, async () => {
      lockAcquired.resolve()
      await new Promise<void>(resolve => { releaseLock = resolve })
      // Concurrent ConfigEditor write replaces cordis.patch.yml with a newer value before releasing the lock.
      writeFileSync(patchPath, [
        '- id: llm-deepseek',
        '  config:',
        '    models:',
        '      - id: race-model',
        '        inputModalities: [text, image]',
        '        imageTargetBytes: 900000',
        '',
      ].join('\n'))
    })
    await lockAcquired.promise
    const migrationTask = migrateDeepSeekImageLimitFile(patchPath, { lockPath })
    await new Promise(resolve => setTimeout(resolve, 60))
    releaseLock()
    await holder
    const result = await migrationTask
    expect(result.migrated).toBe(false)
    expect(readFileSync(patchPath, 'utf8')).toContain('imageTargetBytes: 900000')

    // Dynamic imageTargetBytes paired with valid legacy imageMaxBytes keeps both keys on disk so pre/post-migration runtime evaluation stays equivalent.
    const dynamicCoexist = [
      '- id: llm-deepseek',
      '  config:',
      '    models:',
      '      - id: dyn-null-target',
      '        inputModalities: [text, image]',
      '        imageTargetBytes: !!js "null"',
      '        imageMaxBytes: 512000',
      '      - id: dyn-valid-target',
      '        inputModalities: [text, image]',
      '        imageTargetBytes: !!js "256000"',
      '        imageMaxBytes: 512000',
      '',
    ].join('\n')
    const dynamicMigrated = migrateDeepSeekImageLimitYaml(dynamicCoexist)
    expect(dynamicMigrated.changed).toBe(false)
    expect(dynamicMigrated.output).toBe(dynamicCoexist)
    expect(dynamicMigrated.findings.filter(item => item.kind === 'dynamic-expression').map(item => item.modelId)).toEqual([
      'dyn-null-target',
      'dyn-valid-target',
    ])
    writeFileSync(patchPath, dynamicMigrated.output)
    const beforeRuntime = normalizeDeepSeekRuntimeConfig({}, (loadOptionalPatches('omdsh', patchPath) as Array<{ config: unknown }>)[0]?.config, 'llm-deepseek')
    expect((await migrateDeepSeekImageLimitFile(patchPath, { lockPath })).migrated).toBe(false)
    const afterRuntime = normalizeDeepSeekRuntimeConfig({}, (loadOptionalPatches('omdsh', patchPath) as Array<{ config: unknown }>)[0]?.config, 'llm-deepseek')
    expect(afterRuntime.config).toEqual(beforeRuntime.config)
    expect(afterRuntime.config).toEqual({
      models: [
        { id: 'dyn-null-target', inputModalities: ['text', 'image'], imageTargetBytes: 512000 },
        { id: 'dyn-valid-target', inputModalities: ['text', 'image'], imageTargetBytes: 256000 },
      ],
    })
  })

  it('normalizes evaluated whole-config !!js expressions at runtime and reports oversize limits', () => {
    const valid = normalizeDeepSeekRuntimeConfig({}, {
      __jsExpr: "({ models: [{ id: 'vl', inputModalities: ['text', 'image'], imageMaxBytes: 512000 }] })",
    }, 'llm-deepseek')
    expect(valid.changed).toBe(true)
    expect(valid.config).toEqual({
      models: [{ id: 'vl', inputModalities: ['text', 'image'], imageTargetBytes: 512000 }],
    })

    const oversize = normalizeDeepSeekRuntimeConfig({}, {
      __jsExpr: "({ models: [{ id: 'huge', inputModalities: ['text', 'image'], imageMaxBytes: 40000000 }] })",
    }, 'llm-deepseek')
    expect(oversize.changed).toBe(false)
    expect(oversize.findings.map(formatDeepSeekImageLimitDiagnostic).filter(Boolean)).toEqual([
      expect.stringContaining('32 MiB'),
    ])
  })

  it('migrates a writable legacy Profile patch on disk atomically before adapter mount so DeepSeek registers and HMR re-reads cleanly', async () => {
    const root = temp('omdsh-legacy-image-max-')
    const workspace = join(root, 'workspace')
    const profileDir = join(root, 'profiles', 'omdsh')
    mkdirSync(workspace)
    mkdirSync(profileDir, { recursive: true })
    mkdirSync(join(root, 'omdsh'), { recursive: true })
    writeFileSync(join(root, 'omdsh', 'bundle-defaults.json'), JSON.stringify({ autoReviewBundle: true, worktreeBundle: true, worktree: true }))
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [PRODUCT_BUNDLE] } } }))
    const patchPath = join(profileDir, 'cordis.patch.yml')
    writeFileSync(patchPath, [
      '# legacy profile',
      '- id: llm-deepseek',
      '  config:',
      '    models:',
      '      - id: deepseek-vl',
      '        inputModalities: [text, image]',
      '        imageMaxBytes: 512000',
      '      - id: deepseek-explicit',
      '        inputModalities: [text, image]',
      '        imageMaxBytes: 99999999',
      '        imageTargetBytes: 256000',
      '',
    ].join('\n'))

    const script = join(root, 'probe.mjs')
    writeFileSync(script, `
      import { createRequire } from 'node:module'
      import { pathToFileURL } from 'node:url'
      const require = createRequire(${JSON.stringify(join(app, 'package.json'))})
      const { readProfilePatches } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
      const { mountOmdsh } = await import(${JSON.stringify(pathToFileURL(join(app, 'src/boot.ts')).href)})
      const ctx = await mountOmdsh({ args: [], mode: 'exec', exit: () => {} })
      try {
        const providers = ctx.get('llm')?.listProviders().map(p => p.id) ?? []
        const models = await ctx.get('llm')?.listModels('deepseek-official') ?? []
        const replayed = readProfilePatches('omdsh', ctx.get('profileContext'))
        console.log(JSON.stringify({
          hasOfficial: providers.includes('deepseek-official'),
          modelIds: models.map(m => m.id),
          replayedHasLegacy: JSON.stringify(replayed).includes('imageMaxBytes'),
          replayedHasTarget: JSON.stringify(replayed).includes('imageTargetBytes'),
        }))
      } finally {
        await ctx.fiber.dispose().catch(() => {})
      }
    `)

    const { status, out } = await runProbe(script, workspace, { OMDSH_HOME: root, DEEPSEEK_API_KEY: 'sk-legacy-image-test' })
    expect(status, out.slice(-3000)).toBe(0)
    const summary = JSON.parse(out.trim().split('\n').at(-1) ?? '{}')
    expect(summary).toEqual({
      hasOfficial: true,
      modelIds: ['deepseek-vl', 'deepseek-explicit'],
      replayedHasLegacy: false,
      replayedHasTarget: true,
    })
    const rewritten = readFileSync(patchPath, 'utf8')
    expect(rewritten).toContain('# legacy profile')
    expect(rewritten).toContain('imageTargetBytes: 512000')
    expect(rewritten).toContain('imageTargetBytes: 256000')
    expect(rewritten).not.toContain('imageMaxBytes')
    // Running migration a second time is a no-op.
    expect((await migrateDeepSeekImageLimitFile(patchPath)).migrated).toBe(false)
  }, 90_000)

  it('normalizes whole-config !!js and read-only lower layers at their composed precedence across boot and interactive HMR without overriding higher layers', async () => {
    const root = temp('omdsh-hmr-precedence-')
    const workspace = join(root, 'workspace')
    const profileDir = join(root, 'profiles', 'omdsh')
    mkdirSync(workspace)
    mkdirSync(profileDir, { recursive: true })
    mkdirSync(join(root, 'omdsh'), { recursive: true })
    writeFileSync(join(root, 'omdsh', 'bundle-defaults.json'), JSON.stringify({ autoReviewBundle: true, worktreeBundle: true, worktree: true }))
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [PRODUCT_BUNDLE] } } }))
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const homePatch = join(root, 'cordis.patch.yml')
    // Lower layer (Profile patch) uses a whole-config !!js expression with legacy imageMaxBytes (500_000).
    // Also mark it read-only on POSIX to test read-only handling simultaneously.
    writeFileSync(profilePatch, [
      '- id: tui',
      '  disabled: true',
      '- id: runner',
      '  disabled: true',
      '- id: web-server',
      '  disabled: true',
      '- id: llm-deepseek',
      '  config: !!js "({ models: [{ id: \'deepseek-vl\', inputModalities: [\'text\', \'image\'], imageMaxBytes: 500000 }] })"',
      '',
    ].join('\n'))
    if (process.platform !== 'win32') chmodSync(profilePatch, 0o444)
    // Higher layer (Home patch) sets imageTargetBytes to 700_000.
    writeFileSync(homePatch, [
      '- id: llm-deepseek',
      '  config:',
      '    models:',
      '      - id: deepseek-vl',
      '        inputModalities: [text, image]',
      '        imageTargetBytes: 700000',
      '',
    ].join('\n'))

    const script = join(root, 'precedence-probe.mjs')
    writeFileSync(script, `
      import { writeFileSync } from 'node:fs'
      import { pathToFileURL } from 'node:url'
      const { mountOmdsh } = await import(${JSON.stringify(pathToFileURL(join(app, 'src/boot.ts')).href)})
      const ctx = await mountOmdsh({ args: [], mode: 'interactive', exit: () => {} })
      try {
        const readEffectiveTarget = () => {
          const entry = [...ctx.loader.entries()].find(item => item.options.id === 'llm-deepseek')
          const modelsRef = entry?.fiber?.effectiveConfig?.models
          const list = typeof modelsRef?.get === 'function' ? modelsRef.get() : modelsRef
          return list?.[0]?.imageTargetBytes
        }
        const initialTarget = readEffectiveTarget()
        const overlayCount = ctx.get('profileContext')?.overlayPaths?.length ?? 0
        await new Promise(resolve => setTimeout(resolve, 400))
        // Update higher layer to 800_000 and verify HMR adopts 800_000 (never reverting to lower layer 500_000).
        writeFileSync(${JSON.stringify(homePatch)}, [
          '- id: llm-deepseek',
          '  config:',
          '    models:',
          '      - id: deepseek-vl',
          '        inputModalities: [text, image]',
          '        imageTargetBytes: 800000',
          '',
        ].join('\\n'))
        const deadline = Date.now() + 10_000
        let afterHigherUpdate = readEffectiveTarget()
        while (Date.now() < deadline && afterHigherUpdate !== 800000) {
          await new Promise(resolve => setTimeout(resolve, 100))
          afterHigherUpdate = readEffectiveTarget()
        }
        // Now remove the higher-layer override so the lower whole-config !!js layer (imageMaxBytes: 500000) becomes effective on HMR.
        writeFileSync(${JSON.stringify(homePatch)}, '[]\\n')
        const deadline2 = Date.now() + 10_000
        let afterFallback = readEffectiveTarget()
        while (Date.now() < deadline2 && afterFallback !== 500000) {
          await new Promise(resolve => setTimeout(resolve, 100))
          afterFallback = readEffectiveTarget()
        }
        const providers = ctx.get('llm')?.listProviders().map(p => p.id) ?? []
        console.log(JSON.stringify({
          overlayCount,
          initialTarget,
          afterHigherUpdate,
          afterFallback,
          hasOfficial: providers.includes('deepseek-official'),
        }))
      } finally {
        await ctx.fiber.dispose().catch(() => {})
      }
    `)

    try {
      const { status, out } = await runProbe(script, workspace, { OMDSH_HOME: root, DEEPSEEK_API_KEY: 'sk-hmr-precedence' })
      expect(status, out.slice(-3000)).toBe(0)
      const summary = JSON.parse(out.trim().split('\n').at(-1) ?? '{}')
      expect(summary).toEqual({
        overlayCount: 0,
        initialTarget: 700_000,
        afterHigherUpdate: 800_000,
        afterFallback: 500_000,
        hasOfficial: true,
      })
    } finally {
      if (process.platform !== 'win32') chmodSync(profilePatch, 0o644)
    }
  }, 90_000)

  it('edits and fetches models cleanly against the published dsh-llm-pi-ai Config schema (including empty default models: [])', async () => {
    const { modelReasoningLevels } = await import(pathToFileURL(join(app, '../../packages/tui/omdsh-tui/src/runtime/model-catalog-editor.ts')).href) as {
      modelReasoningLevels: (schema: unknown) => string[]
    }
    const { openModelSettings } = await import(pathToFileURL(join(app, '../../packages/tui/omdsh-tui/src/runtime/model-settings.ts')).href) as {
      openModelSettings: (ctx: Context, signal: AbortSignal) => Promise<void>
    }

    const realSchema = PiAiConfig.toJSON()
    const levels = modelReasoningLevels(realSchema)
    expect(levels).toEqual(expect.arrayContaining(['off', 'low', 'medium', 'high']))

    // Real Schemastery projection of `{ providers: { openai: {} } }` populates `models: []` and `modelOverrides: {}`.
    const projectPiAi = (input: unknown) => {
      const resolved = PiAiConfig(input as never) as unknown as { providers: { get(): Record<string, Record<string, unknown>> } }
      return { providers: structuredClone(resolved.providers.get()) }
    }
    const projected = projectPiAi({ providers: { openai: {} } })
    expect(projected.providers.openai?.models).toEqual([])
    expect(projected.providers.openai?.modelOverrides).toEqual({})

    const ctx = new Context()
    let section = {
      ns: 'llm-pi-ai',
      autoGenerate: false,
      applies: 'live' as const,
      schema: realSchema,
      revision: 1,
      value: structuredClone(projected),
      base: { providers: {} },
      user: { providers: { openai: {} } },
    }
    const mutate = vi.fn(async (_ns: string, ops: ReadonlyArray<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>) => {
      const next = structuredClone(section.value) as Record<string, unknown>
      for (const op of ops) {
        let parent = next
        for (const part of op.path.slice(0, -1)) parent = (parent[part] ??= {}) as Record<string, unknown>
        const key = op.path.at(-1)!
        if (op.op === 'unset') delete parent[key]
        else parent[key] = structuredClone(op.value)
      }
      // Validate mutated config against the real published PiAiConfig schema.
      section = { ...section, value: projectPiAi(next), revision: section.revision + 1 }
    })
    const answers = [
      'openai', 'models', 'model:0', 'reasoning', '@levels', 'off,low,high', '@done', 'keep', '@keep', 'apply',
      'openai', 'fetch', 'gpt-4o,gpt-5', 'apply',
      null,
    ]
    const prompt = vi.fn(async () => answers.shift() ?? null)
    ctx.provide('settings', { writable: true, describe: () => [section], mutate } as never)
    ctx.provide('credentials', { describe: async () => ({ configured: true, writable: true, source: 'file' as const }), set: vi.fn(), unset: vi.fn() } as never)
    ctx.provide('llm', {
      listConfigurableProviders: () => [{ provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], declared: false }],
      listProviders: () => [{ id: 'openai' }],
      listModels: async () => [{ id: 'gpt-4o' }, { id: 'o3-mini' }],
      discoverModels: async () => [{ id: 'gpt-4o', name: 'GPT-4o' }, { id: 'gpt-5', name: 'GPT-5' }],
    } as never)
    ctx.provide('tui', { prompt, notice: vi.fn(), prefs: () => ({ uiLanguage: 'en' }) } as never)

    try {
      await openModelSettings(ctx, new AbortController().signal)
      expect(mutate.mock.calls[0]?.[1]).toEqual([
        { op: 'set', path: ['providers', 'openai', 'modelOverrides'], value: { 'gpt-4o': { reasoningEfforts: { off: null, low: 'low', high: 'high' } } } },
      ])
      expect(mutate.mock.calls[1]?.[1]).toEqual([
        {
          op: 'set',
          path: ['providers', 'openai', 'models'],
          value: [
            { id: 'gpt-4o', name: 'GPT-4o', reasoningEfforts: { off: null, low: 'low', high: 'high' } },
            { id: 'gpt-5', name: 'GPT-5' },
          ],
        },
        { op: 'unset', path: ['providers', 'openai', 'modelOverrides'] },
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
