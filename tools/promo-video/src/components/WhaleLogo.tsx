import React, { useMemo } from 'react'
import { DEEPSEEK_LOGO, whaleGradientColor, easeOutQuint } from '../tokens'

interface Dot {
  id: string
  gx: number
  gy: number
  color: string
  scatterX: number
  scatterY: number
  delay: number
}

const BRAILLE_BITS: ReadonlyArray<readonly [number, number, number]> = [
  [0x01, 0, 0],
  [0x02, 0, 1],
  [0x04, 0, 2],
  [0x08, 1, 0],
  [0x10, 1, 1],
  [0x20, 1, 2],
  [0x40, 0, 3],
  [0x80, 1, 3],
]

export function decodeBrailleDots(lines: readonly string[]): { dots: Dot[]; gridW: number; gridH: number } {
  const rows = lines.length
  const cols = Math.max(...lines.map((r) => Array.from(r).length))
  const gridW = cols * 2
  const gridH = rows * 4
  const dots: Dot[] = []

  lines.forEach((line, row) => {
    Array.from(line).forEach((char, col) => {
      const code = char.codePointAt(0) ?? 0
      if (code < 0x2800 || code > 0x28ff) return
      const mask = code - 0x2800
      for (const [bit, dx, dy] of BRAILLE_BITS) {
        if ((mask & bit) === 0) continue
        const gx = col * 2 + dx
        const gy = row * 4 + dy
        const seed = (gy + 1) * 131 + (gx + 1) * 47
        const angle = ((seed * 137.508) % 360) * (Math.PI / 180)
        const dist = 180 + ((seed * 37) % 360)
        dots.push({
          id: `${gx}-${gy}`,
          gx,
          gy,
          color: whaleGradientColor(gx, gy, gridW, gridH),
          scatterX: Math.cos(angle) * dist,
          scatterY: Math.sin(angle) * dist * 0.68,
          delay: (gx / gridW) * 0.28 + (gy / gridH) * 0.14,
        })
      }
    })
  })

  return { dots, gridW, gridH }
}

/**
 * Seamless high-density SVG dot-matrix DeepSeek whale decoded from the
 * authentic Braille bitmap in theme.ts, preserving the true terminal cell
 * vertical aspect ratio (pitchY / pitchX ≈ 1.22) so the whale is full and
 * never vertically squashed, with zero gaps between characters or rows.
 */
export const WhaleLogo: React.FC<{
  dotPitch?: number         // horizontal dot pitch in px
  aspectY?: number          // vertical-to-horizontal pitch ratio matching real terminal cells
  assembleProgress?: number // 0 = swirling particles, 1 = tight seamless whale
  shimmerPhase?: number     // -0.3 .. 1.3 diagonal light sweep
  glow?: number
}> = ({ dotPitch = 9.4, aspectY = 1.24, assembleProgress = 1, shimmerPhase = -1, glow = 0.7 }) => {
  const { dots, gridW, gridH } = useMemo(() => decodeBrailleDots(DEEPSEEK_LOGO), [])

  const pitchX = dotPitch
  const pitchY = dotPitch * aspectY
  const padX = pitchX * 1.2
  const padY = pitchY * 1.1
  const svgW = (gridW - 1) * pitchX + padX * 2
  const svgH = (gridH - 1) * pitchY + padY * 2
  const baseR = pitchX * 0.43

  return (
    <svg
      width={svgW}
      height={svgH}
      viewBox={`0 0 ${svgW} ${svgH}`}
      style={{
        overflow: 'visible',
        display: 'block',
        filter:
          glow > 0
            ? `drop-shadow(0 0 ${Math.round(14 * glow)}px rgba(77, 107, 254, ${0.55 * glow})) drop-shadow(0 0 ${Math.round(32 * glow)}px rgba(53, 200, 222, ${0.32 * glow}))`
            : undefined,
      }}
    >
      {dots.map((d) => {
        const localP = easeOutQuint(
          Math.max(0, Math.min(1, (assembleProgress - d.delay * 0.55) / (1 - d.delay * 0.55))),
        )
        const inv = 1 - localP
        const cx = padX + d.gx * pitchX + d.scatterX * inv
        const cy = padY + d.gy * pitchY + d.scatterY * inv

        const diag = (d.gx / gridW) * 0.72 + (d.gy / gridH) * 0.28
        const shimmerDist = Math.abs(diag - shimmerPhase)
        const shimmerBoost = shimmerPhase >= -0.25 ? Math.max(0, 1 - shimmerDist * 5.0) : 0

        const r = baseR * (0.45 + 0.55 * localP + shimmerBoost * 0.22)
        const fill = shimmerBoost > 0.35 ? '#eafcff' : d.color
        const opacity = Math.min(1, localP * 1.4)

        return <circle key={d.id} cx={cx} cy={cy} r={r} fill={fill} opacity={opacity} />
      })}
    </svg>
  )
}
