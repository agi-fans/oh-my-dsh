/**
 * Parse Markdown link destinations that refer to local workspace or host files.
 *
 * Accepts relative paths, absolute POSIX/Windows paths, `~/...`, and local
 * `file://` URIs. Local `file://` URIs accept `#L12` / `#L12C3-L14` fragments;
 * plain paths also accept `:12`, `:12:3`, or `:12-14` line locators. Rejects
 * web URLs, remote `file://` hosts, UNC paths, query strings, control
 * characters, and directory paths.
 */

import { homedir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface LocalFileLink {
  readonly path: string
  readonly label: string
  readonly line?: number
  readonly column?: number
}

const MAX_DESTINATION_LENGTH = 8_192
const MAX_PATH_LENGTH = 4_096
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f]/u
const SCHEME_AUTHORITY_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u
const NON_FILE_SCHEME_RE = /^(?:mailto|tel|data|javascript|vbscript|blob|about|urn):/iu
const WINDOWS_DRIVE_RE = /^[A-Za-z]:[/\\]/u
const HASH_LOCATION_RE = /^L(\d+)(?:C(\d+))?(?:-L\d+(?:C\d+)?)?$/iu
const COLON_LOCATION_RE = /:(\d+)(?::(\d+))?(?:[-–]\d+(?::\d+)?)?$/u

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined
}

function parseHashLocation(fragment: string): { line?: number; column?: number } {
  const match = HASH_LOCATION_RE.exec(fragment)
  if (match === null) return {}
  const line = parsePositiveInt(match[1])
  const column = parsePositiveInt(match[2])
  return {
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  }
}

function formatLabel(fullPath: string, fallback: string, baseDir: string): string {
  const sameStyle = WINDOWS_DRIVE_RE.test(fullPath) === WINDOWS_DRIVE_RE.test(baseDir)
  if (baseDir !== '' && sameStyle) {
    const rel = relative(baseDir, fullPath).replaceAll('\\', '/')
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !WINDOWS_DRIVE_RE.test(rel)) return rel
  }
  return fallback.replaceAll('\\', '/')
}

/**
 * Parse `destination` into a resolved local file path and optional 1-based line
 * number. Returns `undefined` for non-local links (web URLs, pure anchors,
 * directories, remote hosts, UNC shares, or malformed targets).
 */
export function parseLocalFileLink(destination: string, baseDir: string, home = homedir()): LocalFileLink | undefined {
  const raw = destination.trim()
  if (raw === '' || raw.length > MAX_DESTINATION_LENGTH || CONTROL_CHAR_RE.test(raw) || raw.includes('?')) {
    return undefined
  }

  let pathText: string
  let line: number | undefined
  let column: number | undefined

  if (raw.toLowerCase().startsWith('file://')) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return undefined
    }
    if (url.hostname !== '' && url.hostname.toLowerCase() !== 'localhost') return undefined
    const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : ''
    if (fragment !== '') {
      const loc = parseHashLocation(fragment)
      line = loc.line
      column = loc.column
    }
    const decodedPathname = safeDecode(url.pathname)
    if (/^\/[A-Za-z]:\//u.test(decodedPathname)) {
      if (process.platform === 'win32') {
        try {
          pathText = fileURLToPath(`${url.protocol}//${url.hostname}${url.pathname}`)
        } catch {
          pathText = decodedPathname.slice(1)
        }
      } else {
        pathText = decodedPathname.slice(1)
      }
    } else {
      try {
        pathText = fileURLToPath(`${url.protocol}//${url.hostname}${url.pathname}`)
      } catch {
        pathText = decodedPathname
      }
    }
  } else {
    if (SCHEME_AUTHORITY_RE.test(raw) || NON_FILE_SCHEME_RE.test(raw)) return undefined
    let body = raw
    const hashIndex = raw.lastIndexOf('#')
    if (hashIndex >= 0) {
      const candidatePath = raw.slice(0, hashIndex)
      const fragment = raw.slice(hashIndex + 1)
      if (candidatePath === '') return undefined
      body = candidatePath
      const loc = parseHashLocation(fragment)
      line = loc.line
      column = loc.column
    }
    if (line === undefined) {
      const colon = COLON_LOCATION_RE.exec(body)
      if (colon !== null) {
        const candidatePath = body.slice(0, body.length - colon[0].length)
        if (candidatePath !== '') {
          body = candidatePath
          line = parsePositiveInt(colon[1])
          column = parsePositiveInt(colon[2])
        }
      }
    }
    pathText = safeDecode(body)
  }

  if (
    pathText === ''
    || pathText.length > MAX_PATH_LENGTH
    || CONTROL_CHAR_RE.test(pathText)
    || pathText.endsWith('/')
    || pathText.endsWith('\\')
    || /^[/\\]{2}/u.test(pathText)
  ) {
    return undefined
  }

  // Reject unrecognized schemes such as `foo:bar` while keeping Windows drives (`C:/...`).
  const colonAt = pathText.indexOf(':')
  if (colonAt >= 0 && !(colonAt === 1 && WINDOWS_DRIVE_RE.test(pathText))) return undefined

  let expanded = pathText
  if (pathText === '~') return undefined
  if (pathText.startsWith('~/') || pathText.startsWith('~\\')) {
    const rest = pathText.slice(2)
    if (home === '' || rest === '' || /^[/\\]/u.test(rest)) return undefined
    expanded = resolve(home, rest)
  }

  const fullPath = isAbsolute(expanded) || WINDOWS_DRIVE_RE.test(expanded)
    ? expanded
    : resolve(baseDir, expanded)

  if (/^[/\\]{2}/u.test(expanded) || /^[/\\]{2}/u.test(fullPath)) return undefined

  return {
    path: fullPath,
    label: formatLabel(fullPath, pathText, baseDir),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  }
}

/**
 * Resolve `destination` against ordered base directories (for example current
 * working directory, then Git repository root), deduplicated by resolved path.
 */
export function parseLocalFileLinkCandidates(
  destination: string,
  baseDirs: readonly (string | undefined)[],
  home = homedir(),
): readonly LocalFileLink[] {
  const seen = new Set<string>()
  const out: LocalFileLink[] = []
  for (const base of baseDirs) {
    if (base === undefined || base === '') continue
    const parsed = parseLocalFileLink(destination, base, home)
    if (parsed === undefined || seen.has(parsed.path)) continue
    seen.add(parsed.path)
    out.push(parsed)
  }
  return out
}
