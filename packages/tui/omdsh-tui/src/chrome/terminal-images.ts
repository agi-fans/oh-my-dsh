/** Graphics payloads are renderer-owned, never part of untrusted display rows. */
export type ImageProtocol = 'kitty' | 'iterm2'

export interface PreviewImage {
  /** A bounded, decoded and re-encoded PNG; original attachment bytes stay separate. */
  data: Uint8Array
  width: number
  height: number
  description: string
}

export interface ImagePlacement {
  image: PreviewImage
  protocol: ImageProtocol
  row: number
  column: number
  columns: number
  rows: number
}

/** Only known direct terminals opt in. Outer-terminal hints do not prove passthrough. */
export function imageProtocol(env: NodeJS.ProcessEnv): ImageProtocol | undefined {
  if (env.TMUX || env.STY || env.ZELLIJ || env.HERDR_ENV === '1' || /^(?:tmux|screen)/u.test(env.TERM ?? '')) return undefined
  const program = (env.TERM_PROGRAM ?? '').toLowerCase()
  if (env.KITTY_WINDOW_ID || env.TERM === 'xterm-kitty' || ['ghostty', 'wezterm'].includes(program)) return 'kitty'
  if (program === 'iterm.app' || env.LC_TERMINAL === 'iTerm2') return 'iterm2'
  return undefined
}

/** Fit in display cells while preserving the source's pixel aspect ratio. */
export function imageSize(image: PreviewImage, columns: number, rows: number, cell = { width: 9, height: 18 }): { columns: number; rows: number } {
  const scale = Math.min(columns * cell.width / image.width, rows * cell.height / image.height)
  return { columns: Math.max(1, Math.min(columns, Math.round(image.width * scale / cell.width))),
    rows: Math.max(1, Math.min(rows, Math.round(image.height * scale / cell.height))) }
}

/** Kitty suppresses replies and cursor movement; each base64 chunk is at most 4096 bytes. */
export function imageSequence(placement: ImagePlacement, id: number): string {
  const { image, protocol, row, column, columns, rows } = placement
  const base64 = Buffer.from(image.data).toString('base64')
  let out = `\x1b[${row + 1};${column + 1}H`
  if (protocol === 'iterm2') return out + `\x1b]1337;File=inline=1;size=${image.data.length};width=${columns};height=${rows};preserveAspectRatio=1:${base64}\x07`
  for (let offset = 0; offset < base64.length; offset += 4096) {
    const more = offset + 4096 < base64.length ? 1 : 0
    const control = offset === 0 ? `a=T,f=100,q=2,C=1,i=${id},c=${columns},r=${rows},m=${more}` : `m=${more}`
    out += `\x1b_G${control};${base64.slice(offset, offset + 4096)}\x1b\\`
  }
  return out
}

/** Delete just this renderer's Kitty resource, including its backing data. */
export function deleteImage(id: number): string { return `\x1b_Ga=d,d=I,i=${id},q=2\x1b\\` }
