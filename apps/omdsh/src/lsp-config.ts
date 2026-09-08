/**
 * Native omdsh language-server configuration adapter.
 *
 * This module owns only deployment discovery: it translates a `servers` JSON
 * shape into the three Harness rows a language server needs — the `dsh-lsp`
 * seam, the `dsh-lsp-stdio` host, and the model-facing `dsh-tool-lsp` tool.
 * Server process lifecycle, protocol framing, and result normalization remain
 * owned by the Harness packages. Nothing is mounted when no server is
 * configured, so a composition without language servers never advertises an
 * `lsp` tool that can only fail.
 * @module @agi-fans/oh-my-dsh
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { omdshHome, projectRoot } from './config-paths.ts'

export interface LspPluginRow {
  id: string
  name: string
  config?: Record<string, unknown>
}

export interface LspInsertPatch {
  insert: LspPluginRow[]
}

interface LspDocument {
  servers: Record<string, unknown>
}

function configError(path: string, detail: string): Error {
  return new Error(`omdsh: invalid LSP config ${path}: ${detail}`)
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readDocument(path: string): LspDocument | undefined {
  if (!existsSync(path)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw configError(path, error instanceof Error ? error.message : String(error))
  }
  if (!object(parsed) || !object(parsed.servers)) {
    throw configError(path, 'expected an object with a "servers" object')
  }
  return { servers: parsed.servers }
}

function stringArray(value: unknown, path: string, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw configError(path, `"${field}" must be an array of strings`)
  }
  return value
}

function stringRecord(value: unknown, path: string, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!object(value) || Object.values(value).some(item => typeof item !== 'string')) {
    throw configError(path, `"${field}" must be an object of string values`)
  }
  return value as Record<string, string>
}

function optionalBoolean(value: unknown, path: string, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw configError(path, `"${field}" must be a boolean`)
  return value
}

/** Lowercase leading-dot extension → LSP language id, as the stdio host requires. */
function extensionToLanguage(value: unknown, path: string, field: string): Record<string, string> {
  if (!object(value)) throw configError(path, `"${field}" must be an object of extension-to-language entries`)
  const entries = Object.entries(value)
  if (entries.length === 0) throw configError(path, `"${field}" must map at least one extension`)
  for (const [extension, language] of entries) {
    if (!/^\.[a-z0-9]+$/u.test(extension)) {
      throw configError(path, `"${field}.${extension}" must be a lowercase leading-dot extension`)
    }
    if (typeof language !== 'string' || language === '') {
      throw configError(path, `"${field}.${extension}" must name a non-empty language id`)
    }
  }
  return value as Record<string, string>
}

function expandEnvironment(value: unknown, environment: NodeJS.ProcessEnv): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/gu, (token, name: string, fallback: string | undefined) =>
      environment[name] ?? fallback ?? token)
  }
  if (Array.isArray(value)) return value.map(item => expandEnvironment(item, environment))
  if (!object(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandEnvironment(item, environment)]))
}

function serverConfig(
  name: string,
  raw: unknown,
  path: string,
  environment: NodeJS.ProcessEnv,
): Record<string, unknown> | undefined {
  if (!/^[A-Za-z0-9_-]{1,32}$/u.test(name)) {
    throw configError(path, `server name "${name}" must match [A-Za-z0-9_-]{1,32}`)
  }
  const value = expandEnvironment(raw, environment)
  if (!object(value)) throw configError(path, `server "${name}" must be an object`)
  if (optionalBoolean(value.enabled, path, `${name}.enabled`) === false) return undefined
  const command = value.command
  if (typeof command !== 'string' || command === '') {
    throw configError(path, `server "${name}" requires a non-empty "command"`)
  }
  const args = stringArray(value.args, path, `${name}.args`)
  const env = stringRecord(value.env, path, `${name}.env`)
  const languages = extensionToLanguage(value.extensionToLanguage, path, `${name}.extensionToLanguage`)
  return {
    command,
    ...(args === undefined ? {} : { args }),
    ...(env === undefined ? {} : { env }),
    extensionToLanguage: languages,
    ...(value.initializationOptions === undefined ? {} : { initializationOptions: value.initializationOptions }),
    ...(value.configuration === undefined ? {} : { configuration: value.configuration }),
  }
}

/**
 * Load user and project language-server definitions and turn them into Loader
 * insert patches. Project definitions override same-named user definitions.
 * All three rows are emitted together or not at all: the seam and tool without
 * a provider would advertise an `lsp` tool whose every call fails.
 */
export function loadLspPatches(
  cwd: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): LspInsertPatch[] {
  const files = [
    join(omdshHome(environment), 'lsp.json'),
    join(projectRoot(cwd), '.dsh', 'lsp.json'),
  ]
  const merged = new Map<string, { value: unknown; path: string }>()
  for (const path of files) {
    const document = readDocument(path)
    if (document === undefined) continue
    for (const [name, value] of Object.entries(document.servers)) merged.set(name, { value, path })
  }
  const servers: Record<string, unknown> = {}
  for (const [name, source] of merged) {
    const config = serverConfig(name, source.value, source.path, environment)
    if (config !== undefined) servers[name] = config
  }
  if (Object.keys(servers).length === 0) return []
  return [{
    insert: [
      { id: 'lsp', name: '@deepseek-ai/dsh-lsp' },
      { id: 'lsp-stdio', name: '@deepseek-ai/dsh-lsp-stdio', config: { servers } },
      { id: 'tool-lsp', name: '@deepseek-ai/dsh-tool-lsp' },
    ],
  }]
}
