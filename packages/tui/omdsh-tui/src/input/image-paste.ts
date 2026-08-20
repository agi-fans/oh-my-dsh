/** Clipboard and path image ingestion owned by the local terminal provider. */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, platform, tmpdir } from 'node:os'
import { basename, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { TuiInputImage } from '../definition.ts'

const MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const CLIPBOARD_LIMIT = 64 * 1024 * 1024
const EXPLICIT_PATH_PREFIX = /^(?:\/|~\/|\.{1,2}\/|file:\/\/|[A-Za-z]:[\\/]|\\\\)/u
const INTERIOR_PATH_ANCHOR = /\s(?:\/|~\/|\.{1,2}\/|file:\/\/|[A-Za-z]:[\\/]|\\\\)/u

function unquote(value: string): string {
  const first = value.at(0)
  const last = value.at(-1)
  if (value.length >= 2 && (first === '"' || first === "'") && last === first) return value.slice(1, -1)
  return value
}

/** Parse a paste made entirely of supported local image paths. */
export function imagePathCandidates(text: string): string[] {
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return []
  const paths: string[] = []
  for (const line of lines) {
    const quoted = (line.startsWith('"') && line.endsWith('"')) || (line.startsWith("'") && line.endsWith("'"))
    if (!quoted && /(^|[^\\])\s/u.test(line)
      && (!EXPLICIT_PATH_PREFIX.test(line) || INTERIOR_PATH_ANCHOR.test(line.slice(1)))) return []
    let candidate = unquote(line)
    try {
      if (candidate.startsWith('file://')) candidate = fileURLToPath(candidate)
      else candidate = candidate.replace(/\\([\\ ])/gu, '$1')
    } catch {
      return []
    }
    if (MEDIA_TYPES[extname(candidate).toLowerCase()] === undefined) return []
    paths.push(candidate)
  }
  return paths
}

function uint24le(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16)
}

function jpegDimensions(data: Uint8Array): { width: number; height: number } | undefined {
  if (data[0] !== 0xff || data[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = data[offset + 1]
    offset += 2
    if (marker === undefined || marker === 0xd8 || marker === 0xd9) continue
    if (marker === 0xda) break
    const length = ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)
    if (length < 2 || offset + length > data.length) break
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame && length >= 7) {
      const height = ((data[offset + 3] ?? 0) << 8) | (data[offset + 4] ?? 0)
      const width = ((data[offset + 5] ?? 0) << 8) | (data[offset + 6] ?? 0)
      if (width > 0 && height > 0) return { width, height }
    }
    offset += length
  }
  return undefined
}

/** Read intrinsic dimensions without decoding the complete image. */
export function probeImageDimensions(
  data: Uint8Array,
  mediaType: ImageMediaType,
): { width: number; height: number } | undefined {
  if (mediaType === 'image/png' && data.length >= 24
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (mediaType === 'image/gif' && data.length >= 10) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  if (mediaType === 'image/jpeg') return jpegDimensions(data)
  if (mediaType === 'image/webp' && data.length >= 30
    && String.fromCharCode(...data.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...data.slice(8, 12)) === 'WEBP') {
    const kind = String.fromCharCode(...data.slice(12, 16))
    if (kind === 'VP8X') {
      return { width: uint24le(data, 24) + 1, height: uint24le(data, 27) + 1 }
    }
    if (kind === 'VP8 ' && data.length >= 30 && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
      return {
        width: ((data[26] ?? 0) | ((data[27] ?? 0) << 8)) & 0x3fff,
        height: ((data[28] ?? 0) | ((data[29] ?? 0) << 8)) & 0x3fff,
      }
    }
    if (kind === 'VP8L' && data.length >= 25 && data[20] === 0x2f) {
      const bits = (data[21] ?? 0) | ((data[22] ?? 0) << 8) | ((data[23] ?? 0) << 16) | ((data[24] ?? 0) << 24)
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
  }
  return undefined
}

/** Compact, stable composer placeholder matching OMP's image draft label. */
export function imageMarker(index: number, image: TuiInputImage): string {
  const dimensions = image.width === undefined || image.height === undefined
    ? ''
    : `, ${image.width}x${image.height}`
  return `[Image #${index + 1}${dimensions}]`
}

/**
 * Drop one TUI-owned image marker and the single adjacent separator space the
 * composer inserts around it. Other user whitespace stays intact.
 */
function removeComposerImageMarker(text: string, marker: string): string {
  const start = text.indexOf(marker)
  if (start < 0) return text
  let from = start
  let to = start + marker.length
  if (text[to] === ' ') to += 1
  else if (from > 0 && text[from - 1] === ' ') from -= 1
  return text.slice(0, from) + text.slice(to)
}

/**
 * Remove composer placeholders that match attached drafts.
 *
 * Without images the text is returned unchanged, including a handwritten
 * `[Image #1]` that is not backed by an attachment. With images, each draft
 * removes one matching {@link imageMarker} and its TUI-inserted neighboring
 * space. A handwritten copy of the same token is left in place, and remaining
 * user spacing is not collapsed or trimmed.
 */
export function stripComposerImageMarkers(text: string, images: readonly TuiInputImage[]): string {
  if (images.length === 0) return text
  let result = text
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]
    if (image === undefined) continue
    result = removeComposerImageMarker(result, imageMarker(index, image))
  }
  return result
}

/** True when composer text is a slash command after dropping attached image markers. */
export function looksLikeSlashCommand(text: string, images: readonly TuiInputImage[]): boolean {
  return stripComposerImageMarkers(text, images).trimStart().startsWith('/')
}

/** Load a supported local image without exposing its path beyond the TUI boundary. */
export async function readImageFile(path: string, cwd = process.cwd()): Promise<TuiInputImage | null> {
  const expanded = path.startsWith('~/') ? homedir() + path.slice(1) : path
  const absolute = resolve(cwd, expanded)
  const mediaType = MEDIA_TYPES[extname(absolute).toLowerCase()]
  if (mediaType === undefined) return null
  try {
    return { data: new Uint8Array(await readFile(absolute)), mediaType, name: basename(absolute) }
  } catch {
    return null
  }
}

function execBytes(command: string, args: readonly string[]): Promise<Uint8Array> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, [...args], { encoding: 'buffer', maxBuffer: CLIPBOARD_LIMIT, timeout: 5000 }, (error, stdout) => {
      if (error !== null) reject(error)
      else resolvePromise(new Uint8Array(stdout))
    })
  })
}

function execText(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, [...args], { encoding: 'utf8', maxBuffer: CLIPBOARD_LIMIT, timeout: 5000 }, (error, stdout) => {
      if (error !== null) reject(error)
      else resolvePromise(stdout)
    })
  })
}

async function readMacClipboardImage(): Promise<TuiInputImage | null> {
  const dir = await mkdtemp(resolve(tmpdir(), 'omdsh-clipboard-'))
  const tiff = resolve(dir, 'clipboard.tiff')
  const png = resolve(dir, 'clipboard.png')
  const script = [
    'set imageData to the clipboard as «class TIFF»',
    `set outputFile to open for access POSIX file ${JSON.stringify(tiff)} with write permission`,
    'try',
    'set eof outputFile to 0',
    'write imageData to outputFile',
    'on error messageText number messageNumber',
    'close access outputFile',
    'error messageText number messageNumber',
    'end try',
    'close access outputFile',
  ].join('\n')
  try {
    await execText('osascript', ['-e', script])
    await execText('sips', ['-s', 'format', 'png', tiff, '--out', png])
    return { data: new Uint8Array(await readFile(png)), mediaType: 'image/png', name: 'clipboard.png' }
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Read Finder's file-url pasteboard flavor, which `pbpaste` cannot expose. */
export async function readMacClipboardFiles(): Promise<string[]> {
  if (platform() !== 'darwin') return []
  const script = [
    'set output to ""',
    'try',
    'if (clipboard info for «class furl») is {} then return output',
    'set clipboardFiles to the clipboard as «class furl»',
    'if class of clipboardFiles is list then',
    'repeat with clipboardFile in clipboardFiles',
    'try',
    'set output to output & POSIX path of clipboardFile & linefeed',
    'end try',
    'end repeat',
    'else',
    'set output to POSIX path of clipboardFiles & linefeed',
    'end if',
    'end try',
    'return output',
  ].join('\n')
  try {
    return (await execText('osascript', ['-e', script])).split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

async function readLinuxClipboardImage(): Promise<TuiInputImage | null> {
  try {
    const types = await execText('wl-paste', ['--list-types'])
    const mediaType = (['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const)
      .find(type => types.split(/\s+/u).includes(type))
    if (mediaType === undefined) return null
    return { data: await execBytes('wl-paste', ['--no-newline', '--type', mediaType]), mediaType, name: 'clipboard' + extensionFor(mediaType) }
  } catch {
    for (const mediaType of ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const) {
      try {
        const data = await execBytes('xclip', ['-selection', 'clipboard', '-t', mediaType, '-o'])
        if (data.byteLength > 0) return { data, mediaType, name: 'clipboard' + extensionFor(mediaType) }
      } catch { /* try the next available target */ }
    }
    return null
  }
}

function extensionFor(mediaType: ImageMediaType): string {
  if (mediaType === 'image/jpeg') return '.jpg'
  return '.' + mediaType.slice('image/'.length)
}

async function readWindowsClipboardImage(): Promise<TuiInputImage | null> {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$image = [System.Windows.Forms.Clipboard]::GetImage()',
    'if ($null -eq $image) { exit 2 }',
    '$stream = New-Object System.IO.MemoryStream',
    '$image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)',
    '[Convert]::ToBase64String($stream.ToArray())',
  ].join('; ')
  try {
    const encoded = (await execText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])).trim()
    return encoded === '' ? null : { data: new Uint8Array(Buffer.from(encoded, 'base64')), mediaType: 'image/png', name: 'clipboard.png' }
  } catch {
    return null
  }
}

/** Best-effort native clipboard image reader; null lets text paste take over. */
export async function readImageFromClipboard(): Promise<TuiInputImage | null> {
  if (platform() === 'darwin') return readMacClipboardImage()
  if (platform() === 'win32') return readWindowsClipboardImage()
  if (platform() === 'linux') {
    if (process.env.WSL_DISTRO_NAME !== undefined || process.env.WSL_INTEROP !== undefined) {
      const windows = await readWindowsClipboardImage()
      if (windows !== null) return windows
    }
    return readLinuxClipboardImage()
  }
  return null
}

export type ClipboardImageReader = () => Promise<TuiInputImage | null>
export type ClipboardFileReader = () => Promise<string[]>
export type ImagePathReader = (path: string) => Promise<TuiInputImage | null>
