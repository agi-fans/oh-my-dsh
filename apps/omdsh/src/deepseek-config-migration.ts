/**
 * Compatibility migration and validation for legacy DeepSeek model `imageMaxBytes`
 * overrides retired in DSH 0.2.3-alpha.2 in favor of `imageTargetBytes` (capped at 32 MiB).
 * @module @agi-fans/oh-my-dsh
 */

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { interpolate, isJsExpr } from '@deepseek-ai/cordis-plugin-loader'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isMap, isPair, isScalar, isSeq, parseDocument, type Pair, type Scalar, type YAMLMap } from 'yaml'

/** Maximum encoded-byte target accepted by `@deepseek-ai/dsh-llm-deepseek` (32 MiB). */
export const MAX_DEEPSEEK_IMAGE_TARGET_BYTES = 32 * 1024 * 1024

export type DeepSeekImageLimitFindingKind =
  | 'legacy-valid'
  | 'legacy-oversize'
  | 'legacy-invalid'
  | 'target-oversize'
  | 'target-invalid'
  | 'dynamic-expression'

export interface DeepSeekImageLimitFinding {
  readonly rowId: string | undefined
  readonly modelId: string
  readonly kind: DeepSeekImageLimitFindingKind
  readonly value: unknown
  readonly hasExplicitTarget: boolean
}

export interface DeepSeekRuntimeConfigNormalization {
  readonly config: unknown
  readonly changed: boolean
  readonly findings: readonly DeepSeekImageLimitFinding[]
}

const DEEPSEEK_IDS = new Set(['llm-deepseek', 'llm-deepseek-account'])
const DEEPSEEK_NAMES = new Set(['@deepseek-ai/dsh-llm-deepseek-api-key', '@deepseek-ai/dsh-llm-deepseek-account'])
const JS_TAG = 'tag:yaml.org,2002:js'
const YAML_PARSE_OPTIONS = {
  schema: 'core' as const,
  customTags: [{ tag: JS_TAG, resolve: (value: string) => value }],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isDeepSeekEntryRow(row: { id?: unknown; name?: unknown }): boolean {
  return (typeof row.id === 'string' && DEEPSEEK_IDS.has(row.id))
    || (typeof row.name === 'string' && DEEPSEEK_NAMES.has(row.name))
}

function isYamlJsScalar(node: unknown): node is Scalar<unknown> & { readonly tag: typeof JS_TAG } {
  return isScalar(node) && node.tag === JS_TAG
}

function classifyLimit(value: unknown): 'valid' | 'oversize' | 'invalid' {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return 'invalid'
  }
  return value > MAX_DEEPSEEK_IMAGE_TARGET_BYTES ? 'oversize' : 'valid'
}

function inspectTargetValue(
  value: unknown,
  rowId: string | undefined,
  modelId: string,
  findings: DeepSeekImageLimitFinding[],
): void {
  if (isJsExpr(value)) {
    findings.push({ rowId, modelId, kind: 'dynamic-expression', value: value.__jsExpr, hasExplicitTarget: true })
    return
  }
  const status = classifyLimit(value)
  if (status === 'oversize') {
    findings.push({ rowId, modelId, kind: 'target-oversize', value, hasExplicitTarget: true })
  } else if (status === 'invalid') {
    findings.push({ rowId, modelId, kind: 'target-invalid', value, hasExplicitTarget: true })
  }
}

function inspectModelRecord(
  model: Record<string, unknown>,
  rowId: string | undefined,
  fallbackId: string,
  findings: DeepSeekImageLimitFinding[],
): void {
  const modelId = typeof model.id === 'string' && model.id.length > 0 ? model.id : fallbackId
  const hasTargetKey = Object.hasOwn(model, 'imageTargetBytes')
  const hasExplicitTarget = hasTargetKey && model.imageTargetBytes !== undefined && model.imageTargetBytes !== null
  const hasLegacyKey = Object.hasOwn(model, 'imageMaxBytes')

  if (hasExplicitTarget) {
    inspectTargetValue(model.imageTargetBytes, rowId, modelId, findings)
  } else if (hasTargetKey && model.imageTargetBytes === null && !hasLegacyKey) {
    findings.push({ rowId, modelId, kind: 'target-invalid', value: null, hasExplicitTarget: false })
  }

  if (!hasLegacyKey) return
  const legacyValue = model.imageMaxBytes
  if (hasExplicitTarget) {
    findings.push({ rowId, modelId, kind: 'legacy-valid', value: legacyValue, hasExplicitTarget: true })
    return
  }
  if (isJsExpr(legacyValue)) {
    findings.push({ rowId, modelId, kind: 'dynamic-expression', value: legacyValue.__jsExpr, hasExplicitTarget: false })
    return
  }
  const status = classifyLimit(legacyValue)
  findings.push({
    rowId,
    modelId,
    kind: status === 'valid' ? 'legacy-valid' : status === 'oversize' ? 'legacy-oversize' : 'legacy-invalid',
    value: legacyValue,
    hasExplicitTarget: false,
  })
}

function inspectRowConfig(row: Record<string, unknown>, findings: DeepSeekImageLimitFinding[]): void {
  if (row.disabled === true || !isDeepSeekEntryRow(row)) return
  const rowId = typeof row.id === 'string' ? row.id : undefined
  const config = row.config
  if (isJsExpr(config)) {
    if (/\b(?:imageMaxBytes|imageTargetBytes)\b/u.test(config.__jsExpr)) {
      findings.push({ rowId, modelId: rowId ?? 'llm-deepseek', kind: 'dynamic-expression', value: config.__jsExpr, hasExplicitTarget: false })
    }
    return
  }
  if (!isRecord(config)) return
  if (isJsExpr(config.models)) {
    if (/\b(?:imageMaxBytes|imageTargetBytes)\b/u.test(config.models.__jsExpr)) {
      findings.push({ rowId, modelId: 'models', kind: 'dynamic-expression', value: config.models.__jsExpr, hasExplicitTarget: false })
    }
  } else if (Array.isArray(config.models)) {
    for (const [index, entry] of config.models.entries()) {
      if (isJsExpr(entry)) {
        if (/\b(?:imageMaxBytes|imageTargetBytes)\b/u.test(entry.__jsExpr)) {
          findings.push({ rowId, modelId: `models[${index}]`, kind: 'dynamic-expression', value: entry.__jsExpr, hasExplicitTarget: false })
        }
      } else if (isRecord(entry)) {
        inspectModelRecord(entry, rowId, `models[${index}]`, findings)
      }
    }
  }
  if (isJsExpr(config.modelOverrides)) {
    if (/\b(?:imageMaxBytes|imageTargetBytes)\b/u.test(config.modelOverrides.__jsExpr)) {
      findings.push({ rowId, modelId: 'modelOverrides', kind: 'dynamic-expression', value: config.modelOverrides.__jsExpr, hasExplicitTarget: false })
    }
  } else if (isRecord(config.modelOverrides)) {
    for (const [id, entry] of Object.entries(config.modelOverrides)) {
      if (isJsExpr(entry)) {
        if (/\b(?:imageMaxBytes|imageTargetBytes)\b/u.test(entry.__jsExpr)) {
          findings.push({ rowId, modelId: id, kind: 'dynamic-expression', value: entry.__jsExpr, hasExplicitTarget: false })
        }
      } else if (isRecord(entry)) {
        inspectModelRecord(entry, rowId, id, findings)
      }
    }
  }
}

/**
 * Format an actionable configuration diagnostic for invalid, oversized, or
 * dynamic DeepSeek image-limit settings. Returns `undefined` for valid legacy
 * values that auto-migrate cleanly.
 */
export function formatDeepSeekImageLimitDiagnostic(finding: DeepSeekImageLimitFinding): string | undefined {
  switch (finding.kind) {
    case 'legacy-valid':
      return undefined
    case 'legacy-oversize':
      return `DeepSeek model "${finding.modelId}" uses legacy imageMaxBytes (${String(finding.value)}), which exceeds the 32 MiB (${MAX_DEEPSEEK_IMAGE_TARGET_BYTES} bytes) imageTargetBytes limit. Replace imageMaxBytes with imageTargetBytes set to a positive integer at most ${MAX_DEEPSEEK_IMAGE_TARGET_BYTES}.`
    case 'legacy-invalid':
      return `DeepSeek model "${finding.modelId}" uses invalid legacy imageMaxBytes (${String(finding.value)}). Replace imageMaxBytes with imageTargetBytes set to a positive integer at most ${MAX_DEEPSEEK_IMAGE_TARGET_BYTES}.`
    case 'target-oversize':
      return `DeepSeek model "${finding.modelId}" sets imageTargetBytes (${String(finding.value)}), which exceeds the 32 MiB (${MAX_DEEPSEEK_IMAGE_TARGET_BYTES} bytes) limit. Set imageTargetBytes to a positive integer at most ${MAX_DEEPSEEK_IMAGE_TARGET_BYTES}.`
    case 'target-invalid':
      return `DeepSeek model "${finding.modelId}" sets invalid imageTargetBytes (${String(finding.value)}). Set imageTargetBytes to a positive integer at most ${MAX_DEEPSEEK_IMAGE_TARGET_BYTES}.`
    case 'dynamic-expression':
      return `DeepSeek configuration "${finding.modelId}" uses a dynamic !!js image limit expression (imageMaxBytes/imageTargetBytes) that cannot be statically validated. Ensure it resolves to imageTargetBytes as a positive integer at most ${MAX_DEEPSEEK_IMAGE_TARGET_BYTES}.`
  }
}

/**
 * Inspect composed entries or patch lists without mutating them and report
 * legacy `imageMaxBytes`, invalid/oversized `imageTargetBytes`, and dynamic
 * `!!js` expressions affecting image limits.
 */
export function inspectDeepSeekImageLimits(rows: readonly unknown[]): DeepSeekImageLimitFinding[] {
  const findings: DeepSeekImageLimitFinding[] = []
  const visit = (items: readonly unknown[]): void => {
    for (const item of items) {
      if (!isRecord(item) || item.disabled === true) continue
      if (Array.isArray(item.insert)) {
        visit(item.insert)
        continue
      }
      if (item.group === true && Array.isArray(item.config)) {
        visit(item.config)
        continue
      }
      inspectRowConfig(item, findings)
    }
  }
  visit(rows)
  return findings
}

function hasLegacyOrDynamicModelConfig(config: unknown): boolean {
  if (isJsExpr(config)) return true
  if (!isRecord(config)) return false
  if (isJsExpr(config.models) || isJsExpr(config.modelOverrides)) return true
  if (Array.isArray(config.models)) {
    for (const entry of config.models) {
      if (isJsExpr(entry)) return true
      if (isRecord(entry) && (Object.hasOwn(entry, 'imageMaxBytes') || Object.hasOwn(entry, 'imageTargetBytes'))) {
        return true
      }
    }
  }
  if (isRecord(config.modelOverrides)) {
    for (const entry of Object.values(config.modelOverrides)) {
      if (isJsExpr(entry)) return true
      if (isRecord(entry) && (Object.hasOwn(entry, 'imageMaxBytes') || Object.hasOwn(entry, 'imageTargetBytes'))) {
        return true
      }
    }
  }
  return false
}

function normalizeEvaluatedModelObject(
  source: Record<string, unknown>,
  rowId: string | undefined,
  fallbackId: string,
  findings: DeepSeekImageLimitFinding[],
): { readonly model: Record<string, unknown>; readonly changed: boolean } {
  const modelId = typeof source.id === 'string' && source.id.length > 0 ? source.id : fallbackId
  const hasTargetKey = Object.hasOwn(source, 'imageTargetBytes')
  const hasExplicitTarget = hasTargetKey && source.imageTargetBytes !== undefined && source.imageTargetBytes !== null
  const hasLegacyKey = Object.hasOwn(source, 'imageMaxBytes')

  if (hasExplicitTarget) {
    inspectTargetValue(source.imageTargetBytes, rowId, modelId, findings)
  } else if (hasTargetKey && source.imageTargetBytes === null && !hasLegacyKey) {
    findings.push({ rowId, modelId, kind: 'target-invalid', value: null, hasExplicitTarget: false })
  }

  if (!hasLegacyKey) return { model: source, changed: false }
  const legacyValue = source.imageMaxBytes
  if (hasExplicitTarget) {
    findings.push({ rowId, modelId, kind: 'legacy-valid', value: legacyValue, hasExplicitTarget: true })
    const copy = { ...source }
    delete copy.imageMaxBytes
    return { model: copy, changed: true }
  }
  const status = classifyLimit(legacyValue)
  if (status === 'valid') {
    findings.push({ rowId, modelId, kind: 'legacy-valid', value: legacyValue, hasExplicitTarget: false })
    const copy: Record<string, unknown> = { ...source, imageTargetBytes: legacyValue }
    delete copy.imageMaxBytes
    return { model: copy, changed: true }
  }
  findings.push({
    rowId,
    modelId,
    kind: status === 'oversize' ? 'legacy-oversize' : 'legacy-invalid',
    value: legacyValue,
    hasExplicitTarget: false,
  })
  // Preserve invalid/oversize legacy values un-migrated so upstream rejects with
  // a clear diagnostic rather than masking an out-of-range limit.
  return { model: source, changed: false }
}

/**
 * Normalize a DeepSeek plugin entry's runtime config inside Cordis
 * `internal/config` (after layer composition, before schema validation).
 *
 * Handles read-only patch files, higher-layer overrides, HMR reloads, volatile
 * updates, and whole-`config` / nested `!!js` expressions without injecting a
 * high-priority overlay snapshot or mutating caller-shared objects in place.
 */
export function normalizeDeepSeekRuntimeConfig(
  ctx: object,
  rawConfig: unknown,
  rowId?: string,
): DeepSeekRuntimeConfigNormalization {
  if (!hasLegacyOrDynamicModelConfig(rawConfig)) {
    return { config: rawConfig, changed: false, findings: [] }
  }

  let working: unknown
  let evaluatedAny = false
  if (isJsExpr(rawConfig)) {
    working = interpolate(ctx, rawConfig)
    evaluatedAny = true
  } else if (isRecord(rawConfig)) {
    const clone: Record<string, unknown> = { ...rawConfig }
    if (isJsExpr(clone.models)) {
      clone.models = interpolate(ctx, clone.models)
      evaluatedAny = true
    } else if (Array.isArray(clone.models)) {
      clone.models = clone.models.map(item => isJsExpr(item)
        ? (evaluatedAny = true, interpolate(ctx, item))
        : isRecord(item)
          ? {
              ...item,
              ...(isJsExpr(item.imageMaxBytes) ? { imageMaxBytes: (evaluatedAny = true, interpolate(ctx, item.imageMaxBytes)) } : {}),
              ...(isJsExpr(item.imageTargetBytes) ? { imageTargetBytes: (evaluatedAny = true, interpolate(ctx, item.imageTargetBytes)) } : {}),
            }
          : item)
    }
    if (isJsExpr(clone.modelOverrides)) {
      clone.modelOverrides = interpolate(ctx, clone.modelOverrides)
      evaluatedAny = true
    } else if (isRecord(clone.modelOverrides)) {
      const nextOverrides: Record<string, unknown> = {}
      for (const [id, item] of Object.entries(clone.modelOverrides)) {
        if (isJsExpr(item)) {
          evaluatedAny = true
          nextOverrides[id] = interpolate(ctx, item)
        } else if (isRecord(item)) {
          nextOverrides[id] = {
            ...item,
            ...(isJsExpr(item.imageMaxBytes) ? { imageMaxBytes: (evaluatedAny = true, interpolate(ctx, item.imageMaxBytes)) } : {}),
            ...(isJsExpr(item.imageTargetBytes) ? { imageTargetBytes: (evaluatedAny = true, interpolate(ctx, item.imageTargetBytes)) } : {}),
          }
        } else {
          nextOverrides[id] = item
        }
      }
      clone.modelOverrides = nextOverrides
    }
    working = clone
  } else {
    return { config: rawConfig, changed: false, findings: [] }
  }

  if (!isRecord(working)) {
    return { config: evaluatedAny ? working : rawConfig, changed: false, findings: [] }
  }

  const findings: DeepSeekImageLimitFinding[] = []
  let changed = false
  // Copy top-level container and collections before normalizing so objects
  // returned by shared `!!js` expressions are never mutated in place.
  const nextConfig: Record<string, unknown> = { ...working }
  if (Array.isArray(working.models)) {
    let modelsChanged = false
    const nextModels = working.models.map((entry, index) => {
      if (!isRecord(entry)) return entry
      const result = normalizeEvaluatedModelObject(entry, rowId, `models[${index}]`, findings)
      if (result.changed) modelsChanged = true
      return result.model
    })
    if (modelsChanged) {
      nextConfig.models = nextModels
      changed = true
    }
  }
  if (isRecord(working.modelOverrides)) {
    let overridesChanged = false
    const nextOverrides: Record<string, unknown> = {}
    for (const [id, entry] of Object.entries(working.modelOverrides)) {
      if (!isRecord(entry)) {
        nextOverrides[id] = entry
        continue
      }
      const result = normalizeEvaluatedModelObject(entry, rowId, id, findings)
      if (result.changed) overridesChanged = true
      nextOverrides[id] = result.model
    }
    if (overridesChanged) {
      nextConfig.modelOverrides = nextOverrides
      changed = true
    }
  }

  if (!changed && !evaluatedAny) {
    return { config: rawConfig, changed: false, findings }
  }
  return { config: changed ? nextConfig : working, changed, findings }
}

function getScalarString(map: YAMLMap, key: string): string | undefined {
  const node = map.get(key, true)
  return isScalar(node) && !isYamlJsScalar(node) && typeof node.value === 'string' ? node.value : undefined
}

function isDeepSeekYamlRow(map: YAMLMap): boolean {
  const id = getScalarString(map, 'id')
  const name = getScalarString(map, 'name')
  return (id !== undefined && DEEPSEEK_IDS.has(id)) || (name !== undefined && DEEPSEEK_NAMES.has(name))
}

function findMapPair(map: YAMLMap, key: string): Pair | undefined {
  for (const item of map.items) {
    if (isPair(item) && isScalar(item.key) && item.key.value === key) return item
  }
  return undefined
}

function migrateYamlModelMap(
  modelMap: YAMLMap,
  rowId: string | undefined,
  fallbackId: string,
  findings: DeepSeekImageLimitFinding[],
): boolean {
  const idStr = getScalarString(modelMap, 'id')
  const modelId = idStr !== undefined && idStr.length > 0 ? idStr : fallbackId
  const targetPair = findMapPair(modelMap, 'imageTargetBytes')
  const targetIsDynamic = targetPair !== undefined && isYamlJsScalar(targetPair.value)
  const targetIsNullish = targetPair !== undefined
    && !targetIsDynamic
    && (targetPair.value === null || targetPair.value === undefined
      || (isScalar(targetPair.value) && (targetPair.value.value === null || targetPair.value.value === undefined)))
  const hasExplicitTarget = targetPair !== undefined && !targetIsDynamic && !targetIsNullish

  if (targetIsDynamic && targetPair !== undefined && isYamlJsScalar(targetPair.value)) {
    findings.push({ rowId, modelId, kind: 'dynamic-expression', value: targetPair.value.value, hasExplicitTarget: true })
  } else if (hasExplicitTarget && targetPair !== undefined) {
    const targetVal = isScalar(targetPair.value) ? targetPair.value.value : undefined
    inspectTargetValue(targetVal, rowId, modelId, findings)
  }

  const legacyPair = findMapPair(modelMap, 'imageMaxBytes')
  if (legacyPair === undefined) {
    if (targetIsNullish) {
      findings.push({ rowId, modelId, kind: 'target-invalid', value: null, hasExplicitTarget: false })
    }
    return false
  }

  // When `imageTargetBytes` is a dynamic `!!js` expression, its runtime value
  // may evaluate to `null`/`undefined`; preserve both keys on disk so runtime
  // `internal/config` decides precedence after evaluation without losing a
  // valid legacy fallback.
  if (targetIsDynamic) {
    if (isYamlJsScalar(legacyPair.value)) {
      findings.push({ rowId, modelId, kind: 'dynamic-expression', value: legacyPair.value.value, hasExplicitTarget: false })
    } else {
      const legacyVal = isScalar(legacyPair.value) ? legacyPair.value.value : undefined
      const status = classifyLimit(legacyVal)
      findings.push({
        rowId,
        modelId,
        kind: status === 'valid' ? 'legacy-valid' : status === 'oversize' ? 'legacy-oversize' : 'legacy-invalid',
        value: legacyVal,
        hasExplicitTarget: false,
      })
    }
    return false
  }

  if (hasExplicitTarget) {
    const legacyVal = isYamlJsScalar(legacyPair.value)
      ? { __jsExpr: String(legacyPair.value.value) }
      : isScalar(legacyPair.value) ? legacyPair.value.value : undefined
    findings.push({ rowId, modelId, kind: 'legacy-valid', value: legacyVal, hasExplicitTarget: true })
    modelMap.delete('imageMaxBytes')
    return true
  }

  // Keep field-level dynamic `!!js` expressions un-migrated on disk so static
  // `doctor` continues surfacing a `not-checked` diagnostic; runtime
  // `internal/config` evaluates and normalizes valid values cleanly.
  if (isYamlJsScalar(legacyPair.value)) {
    findings.push({ rowId, modelId, kind: 'dynamic-expression', value: legacyPair.value.value, hasExplicitTarget: false })
    return false
  }

  const legacyVal = isScalar(legacyPair.value) ? legacyPair.value.value : undefined
  const status = classifyLimit(legacyVal)
  if (status === 'valid') {
    findings.push({ rowId, modelId, kind: 'legacy-valid', value: legacyVal, hasExplicitTarget: false })
    // Remove an existing null/empty `imageTargetBytes` pair before renaming so
    // the output never contains duplicate `imageTargetBytes` keys.
    if (targetIsNullish) modelMap.delete('imageTargetBytes')
    ;(legacyPair.key as Scalar).value = 'imageTargetBytes'
    return true
  }

  // Keep oversize/invalid values untouched so `doctor` and subsequent boots
  // continue reporting the unresolved configuration issue.
  findings.push({
    rowId,
    modelId,
    kind: status === 'oversize' ? 'legacy-oversize' : 'legacy-invalid',
    value: legacyVal,
    hasExplicitTarget: false,
  })
  return false
}

function migrateYamlRow(rowMap: YAMLMap, findings: DeepSeekImageLimitFinding[]): boolean {
  const disabledNode = rowMap.get('disabled', true)
  if (isScalar(disabledNode) && disabledNode.value === true) return false
  if (!isDeepSeekYamlRow(rowMap)) return false
  const rowId = getScalarString(rowMap, 'id')
  const configNode = rowMap.get('config', true)
  if (isYamlJsScalar(configNode)) {
    if (typeof configNode.value === 'string' && /\b(?:imageMaxBytes|imageTargetBytes)\b/u.test(configNode.value)) {
      findings.push({ rowId, modelId: rowId ?? 'llm-deepseek', kind: 'dynamic-expression', value: configNode.value, hasExplicitTarget: false })
    }
    return false
  }
  if (!isMap(configNode)) return false

  let edited = false
  const modelsNode = configNode.get('models', true)
  if (isYamlJsScalar(modelsNode)) {
    if (typeof modelsNode.value === 'string' && /\b(?:imageMaxBytes|imageTargetBytes)\b/u.test(modelsNode.value)) {
      findings.push({ rowId, modelId: 'models', kind: 'dynamic-expression', value: modelsNode.value, hasExplicitTarget: false })
    }
  } else if (isSeq(modelsNode)) {
    for (const [index, item] of modelsNode.items.entries()) {
      if (isYamlJsScalar(item)) {
        if (typeof item.value === 'string' && /\b(?:imageMaxBytes|imageTargetBytes)\b/u.test(item.value)) {
          findings.push({ rowId, modelId: `models[${index}]`, kind: 'dynamic-expression', value: item.value, hasExplicitTarget: false })
        }
      } else if (isMap(item) && migrateYamlModelMap(item, rowId, `models[${index}]`, findings)) {
        edited = true
      }
    }
  }

  const overridesNode = configNode.get('modelOverrides', true)
  if (isYamlJsScalar(overridesNode)) {
    if (typeof overridesNode.value === 'string' && /\b(?:imageMaxBytes|imageTargetBytes)\b/u.test(overridesNode.value)) {
      findings.push({ rowId, modelId: 'modelOverrides', kind: 'dynamic-expression', value: overridesNode.value, hasExplicitTarget: false })
    }
  } else if (isMap(overridesNode)) {
    for (const pair of overridesNode.items) {
      if (!isPair(pair)) continue
      const key = isScalar(pair.key) ? String(pair.key.value) : 'override'
      if (isYamlJsScalar(pair.value)) {
        if (typeof pair.value.value === 'string' && /\b(?:imageMaxBytes|imageTargetBytes)\b/u.test(pair.value.value)) {
          findings.push({ rowId, modelId: key, kind: 'dynamic-expression', value: pair.value.value, hasExplicitTarget: false })
        }
      } else if (isMap(pair.value) && migrateYamlModelMap(pair.value, rowId, key, findings)) {
        edited = true
      }
    }
  }

  return edited
}

/**
 * Surgically migrate valid legacy DeepSeek `imageMaxBytes` keys inside a YAML
 * patch document while preserving comments, scalar quoting (`id: "123"`),
 * key ordering, and `!!js` tags. Re-parses the rendered document before
 * signaling a write so duplicate keys or syntax errors can never be emitted.
 */
export function migrateDeepSeekImageLimitYaml(source: string): {
  readonly changed: boolean
  readonly output: string
  readonly findings: readonly DeepSeekImageLimitFinding[]
} {
  const document = parseDocument(source, YAML_PARSE_OPTIONS)
  if (document.errors.length > 0 || !isSeq(document.contents)) {
    return { changed: false, output: source, findings: [] }
  }
  const findings: DeepSeekImageLimitFinding[] = []
  let changed = false
  const visitSeq = (items: readonly unknown[]): void => {
    for (const item of items) {
      if (!isMap(item)) continue
      const insertNode = item.get('insert', true)
      if (isSeq(insertNode)) {
        visitSeq(insertNode.items)
        continue
      }
      if (migrateYamlRow(item, findings)) changed = true
    }
  }
  visitSeq(document.contents.items)
  if (!changed) {
    return { changed: false, output: source, findings }
  }
  const output = String(document)
  const verified = parseDocument(output, YAML_PARSE_OPTIONS)
  if (verified.errors.length > 0 || !isSeq(verified.contents)) {
    return { changed: false, output: source, findings }
  }
  return { changed: true, output, findings }
}

/**
 * Atomically migrate valid legacy DeepSeek `imageMaxBytes` keys in one writable
 * YAML patch file in place. Callers pass the owning Profile's `package.json` as
 * `lockPath` so migration serializes against `ConfigEditor.edit()`. Read-only
 * files, oversize/invalid values, and `!!js` expressions stay untouched on disk;
 * valid runtime normalization still runs via the host `internal/config` hook.
 */
export async function migrateDeepSeekImageLimitFile(
  filePath: string,
  options: { readonly lockPath?: string } = {},
): Promise<{
  readonly migrated: boolean
  readonly findings: readonly DeepSeekImageLimitFinding[]
}> {
  if (!existsSync(filePath)) return { migrated: false, findings: [] }
  let initial: ReturnType<typeof migrateDeepSeekImageLimitYaml>
  try {
    initial = migrateDeepSeekImageLimitYaml(readFileSync(filePath, 'utf8'))
  } catch {
    return { migrated: false, findings: [] }
  }
  if (!initial.changed) return { migrated: false, findings: initial.findings }

  const lockTarget = options.lockPath ?? filePath
  try {
    return await withFileLock(lockTarget, async () => {
      if (!existsSync(filePath)) return { migrated: false, findings: [] }
      try {
        accessSync(filePath, constants.W_OK)
      } catch {
        return { migrated: false, findings: initial.findings }
      }
      const current = readFileSync(filePath, 'utf8')
      const next = migrateDeepSeekImageLimitYaml(current)
      if (!next.changed) return { migrated: false, findings: next.findings }
      const mode = statSync(filePath).mode & 0o777
      await writeFileAtomic(filePath, next.output, { mode: mode === 0 ? 0o644 : mode })
      return { migrated: true, findings: next.findings }
    })
  } catch {
    return { migrated: false, findings: initial.findings }
  }
}
