import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { BRAND, FONT, beatPulse, easeOutQuint } from '../tokens'

const METRICS = [
  {
    target: 2.567,
    unit: 'ms',
    en: 'Replay a 10,000-turn session history',
    zh: '回放 10,000 回合历史会话中位耗时',
    tag: 'SESSION REPLAY',
  },
  {
    target: 0.383,
    unit: 'ms',
    en: 'Scroll a 109,500-character Markdown preview',
    zh: '滚动 109,500 字符超长 Markdown 预览',
    tag: 'STREAMING MARKDOWN',
  },
  {
    target: 0.212,
    unit: 'ms',
    en: 'Pan a 10,000-line source code preview',
    zh: '在 10,000 行源码预览中横向平移',
    tag: 'SOURCE VIEWPORT',
  },
] as const

export const Scene5Speed: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // 3 punchy 2-second (120-frame) beats = 360 frames total (44s..50s)
  const idx = frame < 120 ? 0 : frame < 240 ? 1 : 2
  const local = frame - idx * 120
  const m = METRICS[idx]!

  const pop = spring({
    frame: local,
    fps,
    config: { damping: 14, stiffness: 200, mass: 0.7 },
  })
  const countP = easeOutQuint(interpolate(local, [0, 32], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))
  const shownNum = (m.target * countP).toFixed(3)

  const localFadeOut = interpolate(local, [104, 118], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const sceneExit = interpolate(frame, [340, 360], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const pulse = beatPulse(frame)

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: sceneExit }}>
      {/* Dynamic horizontal speed lines */}
      <AbsoluteFill style={{ overflow: 'hidden', opacity: 0.28, pointerEvents: 'none' }}>
        {Array.from({ length: 14 }).map((_, i) => {
          const y = 90 + i * 70
          const speed = 22 + (i % 4) * 11
          const x = ((frame * speed + i * 310) % 2400) - 420
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: 180 + (i % 3) * 140,
                height: 2,
                background:
                  i % 2 === 0
                    ? 'linear-gradient(90deg, transparent, rgba(77, 107, 254, 0.75), transparent)'
                    : 'linear-gradient(90deg, transparent, rgba(53, 200, 222, 0.7), transparent)',
              }}
            />
          )
        })}
      </AbsoluteFill>

      {/* Top persistent kicker */}
      <div
        style={{
          position: 'absolute',
          top: 72,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 16,
            letterSpacing: '0.18em',
            color: BRAND.cyanBright,
            textTransform: 'uppercase',
          }}
        >
          ENGINEERED FOR REAL TERMINALS · 本地实测性能基准
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 13.5, color: BRAND.inkFaint }}>
          Median local CPU time · Apple M5 Pro · pnpm benchmark:tui
        </div>
      </div>

      {/* Main Impact Number */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: Math.min(pop, localFadeOut),
          transform: `scale(${0.82 + 0.18 * pop + pulse * 0.015}) translateY(${interpolate(pop, [0, 1], [24, 0])}px)`,
        }}
      >
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 17,
            letterSpacing: '0.16em',
            color: BRAND.blueBright,
            padding: '5px 16px',
            borderRadius: 999,
            border: '1px solid rgba(124, 147, 255, 0.35)',
            background: 'rgba(11, 17, 32, 0.8)',
            marginBottom: 22,
          }}
        >
          {m.tag}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 20,
            filter: 'drop-shadow(0 0 42px rgba(77, 107, 254, 0.45))',
          }}
        >
          <span
            style={{
              fontFamily: FONT.mono,
              fontSize: 186,
              fontWeight: 700,
              letterSpacing: '-0.04em',
              lineHeight: 0.95,
              background: 'linear-gradient(115deg, #ffffff 10%, #89b4fa 52%, #7ce7f2 92%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {shownNum}
          </span>
          <span
            style={{
              fontFamily: FONT.mono,
              fontSize: 66,
              fontWeight: 600,
              color: BRAND.cyan,
            }}
          >
            {m.unit}
          </span>
        </div>

        <div
          style={{
            marginTop: 26,
            fontFamily: FONT.sans,
            fontSize: 36,
            fontWeight: 600,
            color: '#f0f5ff',
            letterSpacing: '-0.01em',
          }}
        >
          {m.en}
        </div>
        <div
          style={{
            marginTop: 10,
            fontFamily: FONT.sans,
            fontSize: 24,
            color: BRAND.inkDim,
          }}
        >
          {m.zh}
        </div>
      </div>

      {/* Bottom 3 architecture pillars */}
      <div
        style={{
          position: 'absolute',
          bottom: 72,
          display: 'flex',
          gap: 22,
        }}
      >
        {[
          { en: 'Native Scrollback Preserved', zh: '完整保留原生滚动历史', active: idx === 0 },
          { en: 'CJK & Emoji Pixel-Aligned', zh: '中英文与 Emoji 精准对齐', active: idx === 1 },
          { en: 'DeepSeek Harness Runtime', zh: '插件化运行时底座', active: idx === 2 },
        ].map((pill) => (
          <div
            key={pill.en}
            style={{
              padding: '13px 24px',
              borderRadius: 14,
              background: pill.active ? 'rgba(14, 22, 40, 0.92)' : 'rgba(11, 17, 32, 0.58)',
              border: `1px solid ${pill.active ? BRAND.cyan : 'rgba(124, 147, 255, 0.2)'}`,
              boxShadow: pill.active ? '0 0 28px rgba(53, 200, 222, 0.25)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ fontFamily: FONT.sans, fontSize: 18, fontWeight: 600, color: '#eef4ff' }}>{pill.en}</span>
            <span style={{ fontFamily: FONT.sans, fontSize: 14, color: BRAND.inkDim }}>{pill.zh}</span>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}
