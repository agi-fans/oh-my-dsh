import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { WhaleLogo } from '../components/WhaleLogo'
import { BRAND, FONT, TUI_DARK, easeOutCubic } from '../tokens'

const INSTALL_CMD = 'npm i -g @agi-fans/oh-my-dsh && omdsh'

export const Scene6Outro: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // 0..147   -> Centered glowing 🐳 Composer typing install command
  // 147      -> Enter! Ripple wave bursts outward
  // 150..360 -> Final Hero Brand Lockup + Website + GitHub + gentle fade out

  const typedLen = Math.floor(
    interpolate(frame, [26, 138], [0, INSTALL_CMD.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  )

  const boxEnter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 150 },
  })
  const boxExit = interpolate(frame, [144, 162], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const rippleP = easeOutCubic(
    interpolate(frame, [146, 206], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  )
  const rippleOpacity = interpolate(frame, [146, 165, 206], [0, 0.85, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const finalSpring = spring({
    frame: Math.max(0, frame - 154),
    fps,
    config: { damping: 17, stiffness: 115, mass: 0.9 },
  })
  const shimmer = interpolate(frame, [175, 255], [-0.3, 1.3], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const outroFade = interpolate(frame, [328, 360], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: outroFade }}>
      {/* PHASE 1: CENTERED GLOWING COMPOSER */}
      {frame < 168 && (
        <div
          style={{
            width: 1020,
            padding: '22px 30px',
            borderRadius: 18,
            backgroundColor: TUI_DARK.bg,
            border: '1px solid rgba(124, 147, 255, 0.4)',
            boxShadow: '0 32px 100px rgba(0,0,0,0.68), 0 0 60px rgba(77, 107, 254, 0.25)',
            transform: `scale(${(0.9 + 0.1 * boxEnter) * (1 + (1 - boxExit) * 0.08)})`,
            opacity: Math.min(boxEnter, boxExit),
            fontFamily: FONT.mono,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, marginBottom: 14 }}>
            <span style={{ color: TUI_DARK.borderMuted }}>──</span>
            <span style={{ fontSize: 22 }}>🐳</span>
            <div style={{ flex: 1, height: 1, backgroundColor: TUI_DARK.borderMuted }} />
            <span style={{ color: BRAND.cyanBright, fontSize: 14 }}>ready to explore</span>
            <span style={{ color: TUI_DARK.borderMuted }}>─</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 26, color: '#f3f7ff', minHeight: 42 }}>
            <span style={{ color: BRAND.cyan, fontWeight: 700 }}>$</span>
            <span>{INSTALL_CMD.slice(0, typedLen)}</span>
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 28,
                backgroundColor: BRAND.cyanBright,
                opacity: frame % 26 < 14 ? 1 : 0.15,
              }}
            />
          </div>

          <div style={{ height: 1, backgroundColor: TUI_DARK.borderMuted, marginTop: 14 }} />
        </div>
      )}

      {/* ENERGY RIPPLE ON ENTER */}
      {rippleOpacity > 0.01 && (
        <div
          style={{
            position: 'absolute',
            width: 240 + rippleP * 1400,
            height: 240 + rippleP * 1400,
            borderRadius: '50%',
            border: '2px solid rgba(124, 231, 242, 0.75)',
            boxShadow: '0 0 64px rgba(77, 107, 254, 0.6), inset 0 0 42px rgba(53, 200, 222, 0.35)',
            opacity: rippleOpacity,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* PHASE 2: FINAL HERO BRAND LOCKUP */}
      {frame >= 152 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            opacity: finalSpring,
            transform: `scale(${0.92 + 0.08 * finalSpring})`,
          }}
        >
          <WhaleLogo dotPitch={10.2} assembleProgress={1} shimmerPhase={shimmer} glow={1.0} />

          <div
            style={{
              marginTop: 28,
              fontFamily: FONT.sans,
              fontSize: 92,
              fontWeight: 700,
              letterSpacing: '-0.035em',
              lineHeight: 1.02,
              color: '#f5f8ff',
            }}
          >
            Oh My{' '}
            <span
              style={{
                background: BRAND.grad,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              DSH
            </span>
          </div>

          <div
            style={{
              marginTop: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              fontSize: 30,
            }}
          >
            <span style={{ fontFamily: FONT.mono, color: '#dbe7ff' }}>Into the Unknown</span>
            <span style={{ color: BRAND.inkFaint }}>·</span>
            <span style={{ fontFamily: FONT.sans, fontWeight: 600, color: BRAND.cyanBright, letterSpacing: '0.08em' }}>
              探索未至之境
            </span>
          </div>

          {/* Install command pill */}
          <div
            style={{
              marginTop: 42,
              padding: '14px 30px',
              borderRadius: 14,
              background: 'rgba(11, 17, 32, 0.86)',
              border: '1px solid rgba(124, 147, 255, 0.38)',
              boxShadow: '0 14px 44px rgba(0, 0, 0, 0.45)',
              fontFamily: FONT.mono,
              fontSize: 22,
              color: '#eef4ff',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span>🐳</span>
            <span style={{ color: BRAND.cyan }}>$</span>
            <span>npm i -g @agi-fans/oh-my-dsh</span>
          </div>

          {/* Footer links */}
          <div
            style={{
              marginTop: 26,
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              fontFamily: FONT.mono,
              fontSize: 19,
              color: BRAND.inkDim,
            }}
          >
            <span style={{ color: BRAND.cyanBright }}>omdsh.agi.fans</span>
            <span>·</span>
            <span>github.com/agi-fans/oh-my-dsh</span>
            <span>·</span>
            <span>MIT License</span>
          </div>
        </div>
      )}
    </AbsoluteFill>
  )
}
