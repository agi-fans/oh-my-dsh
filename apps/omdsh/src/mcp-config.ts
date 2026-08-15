/**
 * Native omdsh MCP configuration adapter.
 *
 * This module owns only deployment discovery: it translates the familiar
 * `mcpServers` JSON shape into one Harness `dsh-mcp-client` plugin row per
 * server. Protocol, connection lifecycle, tool registration, and reconnects
 * remain owned by the Harness MCP client.
 * @module @agi-fans/oh-my-dsh
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export interface McpPluginRow {
  id: string
  name: '@deepseek-ai/dsh-mcp-client'
  config: Record<string, unknown>
}

export interface McpInsertPatch {
  insert: McpPluginRow[]
}

interface McpDocument {
  mcpServers: Record<string, unknown>
}

function configError(path: string, detail: string): Error {
  return new Error(`omdsh: invalid MCP config ${path}: ${detail}`)
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readDocument(path: string): McpDocument | undefined {
  if (!existsSync(path)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw configError(path, error instanceof Error ? error.message : String(error))
  }
  if (!object(parsed) || !object(parsed.mcpServers)) {
    throw configError(path, 'expected an object with an "mcpServers" object')
  }
  return { mcpServers: parsed.mcpServers }
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

function optionalNumber(value: unknown, path: string, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw configError(path, `"${field}" must be a positive number`)
  }
  return value
}

function commonConfig(server: Record<string, unknown>, path: string): Record<string, unknown> {
  const timeout = optionalNumber(server.toolCallTimeoutMs ?? server.timeout, path, 'toolCallTimeoutMs')
  const fail = optionalBoolean(server.failOnStartupError, path, 'failOnStartupError')
  if (server.reconnect !== undefined && !object(server.reconnect)) {
    throw configError(path, '"reconnect" must be an object')
  }
  return {
    ...(timeout === undefined ? {} : { toolCallTimeoutMs: timeout }),
    ...(fail === undefined ? {} : { failOnStartupError: fail }),
    ...(server.reconnect === undefined ? {} : { reconnect: server.reconnect }),
  }
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
  const enabled = optionalBoolean(value.enabled, path, `${name}.enabled`)
  if (enabled === false) return undefined
  const command = value.command
  const url = value.url
  if (typeof command === 'string' && command !== '') {
    if (url !== undefined) throw configError(path, `server "${name}" cannot set both "command" and "url"`)
    const args = stringArray(value.args, path, `${name}.args`)
    const env = stringRecord(value.env, path, `${name}.env`)
    if (value.cwd !== undefined && typeof value.cwd !== 'string') {
      throw configError(path, `"${name}.cwd" must be a string`)
    }
    return {
      serverName: name,
      transport: 'stdio',
      command,
      ...(args === undefined ? {} : { args }),
      ...(env === undefined ? {} : { env }),
      ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
      ...commonConfig(value, path),
    }
  }
  if (typeof url === 'string' && url !== '') {
    const headers = stringRecord(value.headers, path, `${name}.headers`)
    return {
      serverName: name,
      transport: 'streamable-http',
      url,
      ...(headers === undefined ? {} : { headers }),
      ...commonConfig(value, path),
    }
  }
  throw configError(path, `server "${name}" requires either a non-empty "command" or "url"`)
}

function safeId(name: string): string {
  return 'mcp-' + name
}

/** Resolve the native user-level MCP document. */
export function omdshHome(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.OMDSH_HOME?.trim() || environment.DSH_HOME?.trim()
  return configured === undefined
    ? join(homedir(), '.dsh')
    : (isAbsolute(configured) ? configured : resolve(configured))
}

function projectRoot(cwd: string): string {
  const fallback = resolve(cwd)
  let current = fallback
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return fallback
    current = parent
  }
}

/**
 * Load user and project MCP definitions and turn them into Loader insert
 * patches. Project definitions override same-named user definitions.
 */
export function loadMcpPatches(
  cwd: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): McpInsertPatch[] {
  const files = [
    join(omdshHome(environment), 'mcp.json'),
    join(projectRoot(cwd), '.dsh', 'mcp.json'),
  ]
  const merged = new Map<string, { value: unknown; path: string }>()
  for (const path of files) {
    const document = readDocument(path)
    if (document === undefined) continue
    for (const [name, value] of Object.entries(document.mcpServers)) merged.set(name, { value, path })
  }
  const rows: McpPluginRow[] = []
  for (const [name, source] of merged) {
    const config = serverConfig(name, source.value, source.path, environment)
    if (config === undefined) continue
    rows.push({ id: safeId(name), name: '@deepseek-ai/dsh-mcp-client', config })
  }
  return rows.length === 0 ? [] : [{ insert: rows }]
}
