import React, { useMemo } from 'react'
import { FONT, TUI_DARK, TUI_LIGHT } from '../tokens'

export interface SerializedTuiFrame {
  lines: string[]
  cursor: { row: number; column: number }
  cursorVisible: boolean
  theme: 'dark' | 'light'
}

interface TextSpan {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
  strike?: boolean
}

const ANSI_16_DARK = [
  '#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#cba6f7', '#89dceb', '#bac2de',
  '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#cba6f7', '#89dceb', '#cdd6f4',
]

const BRAILLE_BITS: ReadonlyArray<readonly [number, number, number]> = [
  [0x01, 0, 0], [0x02, 0, 1], [0x04, 0, 2],
  [0x08, 1, 0], [0x10, 1, 1], [0x20, 1, 2],
  [0x40, 0, 3], [0x80, 1, 3],
]

const BOX_DRAWING_CHARS = new Set(['─', '━', '│', '┃', '╭', '╮', '╰', '╯', '┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼'])

function xterm256ToHex(n: number): string {
  if (n < 16) return ANSI_16_DARK[n] ?? '#cdd6f4'
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return `rgb(${v},${v},${v})`
  }
  const idx = n - 16
  const b = idx % 6
  const g = Math.floor(idx / 6) % 6
  const r = Math.floor(idx / 36)
  const scale = [0, 95, 135, 175, 215, 255]
  return `rgb(${scale[r]},${scale[g]},${scale[b]})`
}

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 || cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33bf) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe6f) ||
    (cp >= 0xff01 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff)
  )
}

function isBrailleCodePoint(cp: number): boolean {
  return cp >= 0x2800 && cp <= 0x28ff
}

function parseAnsiLine(raw: string): TextSpan[] {
  const clean = raw.replace(/\x1b\]8;[^;\x07\x1b]*;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  const spans: TextSpan[] = []
  let fg: string | undefined
  let bg: string | undefined
  let bold = false
  let dim = false
  let italic = false
  let underline = false
  let inverse = false
  let strike = false

  const regex = /\x1b\[([0-9;]*)m/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  const pushText = (text: string) => {
    if (!text) return
    spans.push({ text, fg, bg, bold, dim, italic, underline, inverse, strike })
  }

  while ((match = regex.exec(clean)) !== null) {
    if (match.index > lastIndex) {
      pushText(clean.slice(lastIndex, match.index))
    }
    const codes = match[1] === '' ? [0] : match[1]!.split(';').map((s) => Number.parseInt(s || '0', 10))
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!
      if (c === 0) {
        fg = undefined
        bg = undefined
        bold = false
        dim = false
        italic = false
        underline = false
        inverse = false
        strike = false
      } else if (c === 1) bold = true
      else if (c === 2) dim = true
      else if (c === 3) italic = true
      else if (c === 4) underline = true
      else if (c === 7) inverse = true
      else if (c === 9) strike = true
      else if (c === 22) { bold = false; dim = false }
      else if (c === 23) italic = false
      else if (c === 24) underline = false
      else if (c === 27) inverse = false
      else if (c === 29) strike = false
      else if (c === 39) fg = undefined
      else if (c === 49) bg = undefined
      else if (c >= 30 && c <= 37) fg = ANSI_16_DARK[c - 30]
      else if (c >= 90 && c <= 97) fg = ANSI_16_DARK[c - 90 + 8]
      else if (c >= 40 && c <= 47) bg = ANSI_16_DARK[c - 40]
      else if (c >= 100 && c <= 107) bg = ANSI_16_DARK[c - 100 + 8]
      else if (c === 38 && codes[i + 1] === 2) {
        fg = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`
        i += 4
      } else if (c === 48 && codes[i + 1] === 2) {
        bg = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`
        i += 4
      } else if (c === 38 && codes[i + 1] === 5) {
        fg = xterm256ToHex(codes[i + 2] ?? 7)
        i += 2
      } else if (c === 48 && codes[i + 1] === 5) {
        bg = xterm256ToHex(codes[i + 2] ?? 0)
        i += 2
      }
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < clean.length) {
    pushText(clean.slice(lastIndex))
  }
  return spans
}

/**
 * Ghostty/Kitty-style GPU-crisp vector box-drawing glyph that spans the full
 * [0..cellW] x [0..rowH] terminal cell with ZERO gaps between adjacent rows or columns!
 */
const VectorBoxGlyph: React.FC<{
  char: string
  color: string
  bg?: string
  dim?: boolean
  cellW: number
  rowH: number
}> = ({ char, color, bg, dim, cellW, rowH }) => {
  const cx = cellW / 2
  const cy = rowH / 2
  const heavy = char === '━' || char === '┃'
  const sw = heavy ? 2.2 : 1.35
  const r = Math.min(cx, cy) * 0.82
  // Slight 0.5px bleed on outer edges eliminates subpixel anti-alias hairlines between rows
  const top = -0.5
  const bot = rowH + 0.5
  const left = -0.5
  const right = cellW + 0.5

  let d = ''
  switch (char) {
    case '│':
    case '┃':
      d = `M ${cx} ${top} L ${cx} ${bot}`
      break
    case '─':
    case '━':
      d = `M ${left} ${cy} L ${right} ${cy}`
      break
    case '╭':
      d = `M ${cx} ${bot} L ${cx} ${cy + r} Q ${cx} ${cy} ${cx + r} ${cy} L ${right} ${cy}`
      break
    case '╮':
      d = `M ${left} ${cy} L ${cx - r} ${cy} Q ${cx} ${cy} ${cx} ${cy + r} L ${cx} ${bot}`
      break
    case '╰':
      d = `M ${cx} ${top} L ${cx} ${cy - r} Q ${cx} ${cy} ${cx + r} ${cy} L ${right} ${cy}`
      break
    case '╯':
      d = `M ${left} ${cy} L ${cx - r} ${cy} Q ${cx} ${cy} ${cx} ${cy - r} L ${cx} ${top}`
      break
    case '┌':
      d = `M ${cx} ${bot} L ${cx} ${cy} L ${right} ${cy}`
      break
    case '┐':
      d = `M ${left} ${cy} L ${cx} ${cy} L ${cx} ${bot}`
      break
    case '└':
      d = `M ${cx} ${top} L ${cx} ${cy} L ${right} ${cy}`
      break
    case '┘':
      d = `M ${left} ${cy} L ${cx} ${cy} L ${cx} ${top}`
      break
    case '├':
      d = `M ${cx} ${top} L ${cx} ${bot} M ${cx} ${cy} L ${right} ${cy}`
      break
    case '┤':
      d = `M ${cx} ${top} L ${cx} ${bot} M ${left} ${cy} L ${cx} ${cy}`
      break
    case '┬':
      d = `M ${left} ${cy} L ${right} ${cy} M ${cx} ${cy} L ${cx} ${bot}`
      break
    case '┴':
      d = `M ${left} ${cy} L ${right} ${cy} M ${cx} ${top} L ${cx} ${cy}`
      break
    case '┼':
      d = `M ${left} ${cy} L ${right} ${cy} M ${cx} ${top} L ${cx} ${bot}`
      break
  }

  return (
    <svg
      width={cellW}
      height={rowH}
      viewBox={`0 0 ${cellW} ${rowH}`}
      style={{
        display: 'inline-block',
        verticalAlign: 'top',
        flexShrink: 0,
        overflow: 'visible',
        opacity: dim ? 0.68 : 1,
      }}
    >
      {bg && <rect x={0} y={0} width={cellW} height={rowH} fill={bg} />}
      <path d={d} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="butt" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Seamless horizontal run of identical box lines (e.g. `────────`) rendered as a single crisp SVG line.
 */
const VectorHorizontalRun: React.FC<{
  count: number
  heavy: boolean
  color: string
  bg?: string
  dim?: boolean
  cellW: number
  rowH: number
}> = ({ count, heavy, color, bg, dim, cellW, rowH }) => {
  const w = count * cellW
  const cy = rowH / 2
  const sw = heavy ? 2.2 : 1.35
  return (
    <svg
      width={w}
      height={rowH}
      viewBox={`0 0 ${w} ${rowH}`}
      style={{
        display: 'inline-block',
        verticalAlign: 'top',
        flexShrink: 0,
        overflow: 'visible',
        opacity: dim ? 0.68 : 1,
      }}
    >
      {bg && <rect x={0} y={0} width={w} height={rowH} fill={bg} />}
      <line x1={-0.5} y1={cy} x2={w + 0.5} y2={cy} stroke={color} strokeWidth={sw} />
    </svg>
  )
}

const SeamlessBrailleRun: React.FC<{
  chars: { char: string; color: string; bg?: string }[]
  cellW: number
  rowH: number
}> = ({ chars, cellW, rowH }) => {
  const totalW = chars.length * cellW
  const subW = cellW / 2
  const subH = rowH / 4
  const r = Math.min(subW, subH) * 0.44

  return (
    <svg
      width={totalW}
      height={rowH}
      viewBox={`0 0 ${totalW} ${rowH}`}
      style={{ display: 'inline-block', verticalAlign: 'top', flexShrink: 0, overflow: 'visible' }}
    >
      {chars.map((item, colIdx) => {
        const mask = (item.char.codePointAt(0) ?? 0x2800) - 0x2800
        return (
          <React.Fragment key={colIdx}>
            {item.bg && <rect x={colIdx * cellW} y={0} width={cellW} height={rowH} fill={item.bg} />}
            {mask !== 0 &&
              BRAILLE_BITS.map(([bit, dx, dy]) => {
                if ((mask & bit) === 0) return null
                const cx = colIdx * cellW + (dx + 0.5) * subW
                const cy = (dy + 0.5) * subH
                return <circle key={bit} cx={cx} cy={cy} r={r} fill={item.color} />
              })}
          </React.Fragment>
        )
      })}
    </svg>
  )
}

interface RowChunk {
  kind: 'ascii' | 'cell' | 'braille' | 'box' | 'hline'
  text: string
  cells: number
  span: TextSpan
  heavy?: boolean
  brailleChars?: { char: string; color: string; bg?: string }[]
}

function buildRowChunks(spans: TextSpan[], defaultFg: string): RowChunk[] {
  const chunks: RowChunk[] = []

  for (const sp of spans) {
    const chars = Array.from(sp.text)
    let asciiBuf = ''

    const flushAscii = () => {
      if (!asciiBuf) return
      chunks.push({ kind: 'ascii', text: asciiBuf, cells: asciiBuf.length, span: sp })
      asciiBuf = ''
    }

    for (const ch of chars) {
      const cp = ch.codePointAt(0) ?? 32
      if (cp >= 0x20 && cp <= 0x7e) {
        asciiBuf += ch
      } else if (isBrailleCodePoint(cp)) {
        flushAscii()
        const fg = sp.inverse ? (sp.bg ?? '#161722') : (sp.fg ?? defaultFg)
        const bg = sp.inverse ? (sp.fg ?? defaultFg) : sp.bg
        const last = chunks[chunks.length - 1]
        if (last && last.kind === 'braille' && last.brailleChars) {
          last.brailleChars.push({ char: ch, color: fg, bg })
          last.cells += 1
        } else {
          chunks.push({
            kind: 'braille',
            text: ch,
            cells: 1,
            span: sp,
            brailleChars: [{ char: ch, color: fg, bg }],
          })
        }
      } else if (ch === '─' || ch === '━') {
        flushAscii()
        const heavy = ch === '━'
        const last = chunks[chunks.length - 1]
        if (
          last &&
          last.kind === 'hline' &&
          last.heavy === heavy &&
          last.span.fg === sp.fg &&
          last.span.bg === sp.bg &&
          last.span.dim === sp.dim
        ) {
          last.cells += 1
        } else {
          chunks.push({ kind: 'hline', text: ch, cells: 1, span: sp, heavy })
        }
      } else if (BOX_DRAWING_CHARS.has(ch)) {
        flushAscii()
        chunks.push({ kind: 'box', text: ch, cells: 1, span: sp })
      } else {
        flushAscii()
        const w = isWideCodePoint(cp) ? 2 : 1
        chunks.push({ kind: 'cell', text: ch, cells: w, span: sp })
      }
    }
    flushAscii()
  }

  return chunks
}

/**
 * Pixel-accurate real ANSI terminal renderer for frames generated directly
 * by oh-my-dsh's actual `renderView()` engine.
 */
export const AnsiTerminal: React.FC<{
  frameData: SerializedTuiFrame
  cols?: number
  rows?: number
  fontSize?: number
  title?: string
  showCursor?: boolean
  blinkFrame?: number
  cameraStyle?: React.CSSProperties
  overlay?: React.ReactNode
  footerHighlight?: 'left' | 'right' | 'both' | null
}> = ({
  frameData,
  cols = 104,
  rows = 29,
  fontSize = 15.6,
  title = 'omdsh — ~/Workspace/oh-my-dsh',
  showCursor = true,
  blinkFrame = 0,
  cameraStyle,
  overlay,
  footerHighlight = null,
}) => {
  const isLight = frameData.theme === 'light'
  const palette = isLight ? TUI_LIGHT : TUI_DARK
  const defaultFg = palette.text
  const defaultBg = palette.bg

  const cellW = fontSize * 0.6
  const rowH = Math.round(fontSize * 1.48)
  const padX = 24
  const padY = 16
  const termW = Math.ceil(cols * cellW) + padX * 2
  const termH = rows * rowH + padY * 2 + 40

  const rowChunksList = useMemo(
    () => frameData.lines.slice(0, rows).map((line) => buildRowChunks(parseAnsiLine(line), defaultFg)),
    [frameData.lines, rows, defaultFg],
  )
  const cursorVisible = showCursor && frameData.cursorVisible && blinkFrame % 36 < 22

  return (
    <div
      style={{
        width: termW,
        height: termH,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: defaultBg,
        border: `1px solid ${isLight ? 'rgba(77, 107, 254, 0.34)' : 'rgba(124, 147, 255, 0.25)'}`,
        boxShadow: isLight
          ? '0 40px 120px rgba(0, 0, 0, 0.42), 0 0 84px rgba(53, 200, 222, 0.24)'
          : '0 40px 120px rgba(0, 0, 0, 0.74), 0 0 76px rgba(77, 107, 254, 0.17), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        ...cameraStyle,
      }}
    >
      {/* Authentic macOS terminal title bar */}
      <div
        style={{
          height: 40,
          padding: '0 18px',
          backgroundColor: palette.chromeBg,
          borderBottom: `1px solid ${palette.borderMuted}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          fontFamily: FONT.mono,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 12.5, height: 12.5, borderRadius: '50%', background: '#ff5f56' }} />
          <span style={{ width: 12.5, height: 12.5, borderRadius: '50%', background: '#ffbd2e' }} />
          <span style={{ width: 12.5, height: 12.5, borderRadius: '50%', background: '#27c93f' }} />
        </div>
        <span style={{ fontSize: 13, color: palette.dim }}>{title}</span>
        <span style={{ fontSize: 12, color: palette.dim }}>omdsh v0.29.2</span>
      </div>

      {/* Exact pixel-locked terminal cell grid with seamless vector box drawing */}
      <div
        style={{
          position: 'relative',
          padding: `${padY}px ${padX}px`,
          fontFamily: FONT.mono,
          fontSize,
          lineHeight: `${rowH}px`,
          color: defaultFg,
          whiteSpace: 'pre',
          fontVariantLigatures: 'none',
          flex: 1,
        }}
      >
        {rowChunksList.map((chunks, rowIdx) => (
          <div
            key={rowIdx}
            style={{
              height: rowH,
              width: cols * cellW,
              display: 'flex',
              alignItems: 'center',
              overflow: 'visible',
            }}
          >
            {chunks.map((chunk, cIdx) => {
              if (chunk.kind === 'braille' && chunk.brailleChars) {
                return <SeamlessBrailleRun key={cIdx} chars={chunk.brailleChars} cellW={cellW} rowH={rowH} />
              }
              const s = chunk.span
              const fg = s.inverse ? (s.bg ?? defaultBg) : (s.fg ?? defaultFg)
              const bg = s.inverse ? (s.fg ?? defaultFg) : s.bg

              if (chunk.kind === 'hline') {
                return (
                  <VectorHorizontalRun
                    key={cIdx}
                    count={chunk.cells}
                    heavy={chunk.heavy === true}
                    color={fg}
                    bg={bg}
                    dim={s.dim}
                    cellW={cellW}
                    rowH={rowH}
                  />
                )
              }
              if (chunk.kind === 'box') {
                return (
                  <VectorBoxGlyph
                    key={cIdx}
                    char={chunk.text}
                    color={fg}
                    bg={bg}
                    dim={s.dim}
                    cellW={cellW}
                    rowH={rowH}
                  />
                )
              }

              const style: React.CSSProperties = {
                width: chunk.cells * cellW,
                height: rowH,
                lineHeight: `${rowH}px`,
                color: fg,
                backgroundColor: bg,
                fontWeight: s.bold ? 700 : 400,
                fontStyle: s.italic ? 'italic' : 'normal',
                textDecoration:
                  s.underline && s.strike
                    ? 'underline line-through'
                    : s.underline
                      ? 'underline'
                      : s.strike
                        ? 'line-through'
                        : undefined,
                opacity: s.dim ? 0.68 : 1,
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: chunk.kind === 'cell' ? 'center' : 'flex-start',
                overflow: 'visible',
              }
              return (
                <span key={cIdx} style={style}>
                  {chunk.text}
                </span>
              )
            })}
          </div>
        ))}

        {/* Authentic hardware terminal caret */}
        {cursorVisible && (
          <div
            style={{
              position: 'absolute',
              left: padX + frameData.cursor.column * cellW,
              top: padY + frameData.cursor.row * rowH + 2,
              width: Math.max(2, Math.round(cellW * 0.24)),
              height: rowH - 4,
              backgroundColor: palette.accent,
              boxShadow: `0 0 8px ${palette.accent}`,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Optional telemetry highlight ring anchored precisely over real footer row */}
        {footerHighlight && (
          <>
            {(footerHighlight === 'left' || footerHighlight === 'both') && (
              <div
                style={{
                  position: 'absolute',
                  left: padX + cellW * 1,
                  bottom: padY - 2,
                  width: cellW * 38,
                  height: rowH + 4,
                  borderRadius: 6,
                  border: '1.5px solid #4d6bfe',
                  backgroundColor: 'rgba(77, 107, 254, 0.14)',
                  boxShadow: '0 0 18px rgba(77, 107, 254, 0.35)',
                  pointerEvents: 'none',
                }}
              />
            )}
            {(footerHighlight === 'right' || footerHighlight === 'both') && (
              <div
                style={{
                  position: 'absolute',
                  right: padX + cellW * 1,
                  bottom: padY - 2,
                  width: cellW * 42,
                  height: rowH + 4,
                  borderRadius: 6,
                  border: '1.5px solid #35c8de',
                  backgroundColor: 'rgba(53, 200, 222, 0.14)',
                  boxShadow: '0 0 18px rgba(53, 200, 222, 0.35)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </>
        )}

        {overlay}
      </div>
    </div>
  )
}
