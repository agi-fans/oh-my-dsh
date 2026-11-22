import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { WhaleLogo } from '../components/WhaleLogo'
import { BRAND, FONT, easeInOutCubic } from '../tokens'

const NOISE_LINES = [
  '[DEBUG 10:14:02.119] tool_call.raw_payload: {"id":"call_98a7f","type":"function","args":{"path":"/Users/dev/project/src/..."}}',
  '[TRACE 10:14:02.124] stream.chunk delta="{\"content\":\"Let me inspect every single file in node_modules...\"}"',
  'WARN: Ansi wrap overflow at col 142 -> border corrupted │││████████████',
  '[ERROR] terminal alt-screen cleared 14,209 lines of shell scrollback history!',
  '{"thinking_tokens": 4128, "raw_stdout": "PASS src/a.spec.ts\\nPASS src/b.spec.ts\\nPASS src/c.spec.ts\\n... (942 more lines)"}',
  '  at renderFullScreenFrame (tui/screen.ts:412:19) -> redrawing 100% viewport (68ms jitter)',
  '[STDOUT] npm warn deprecated inflight@1.0.6 | downloading 483 blobs | dumping raw JSON...',
  '❯ Thinking... Thinking... Thinking... [unfolded 284 lines pushing final answer off-screen]',
]

export const Scene1Intro: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // Phase 1: 0..120 -> Terminal chaos / noise
  const noiseOpacity = interpolate(frame, [0, 14, 108, 122], [0, 0.92, 0.92, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // Horizontal cyan slice wipe at frame 114..134
  const sliceProgress = interpolate(frame, [112, 134], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const sliceOpacity = interpolate(frame, [112, 120, 136], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // Phase 2: 120..480 -> Whale particles assemble into DeepSeek mark
  const assemble = interpolate(frame, [118, 212], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const shimmer = interpolate(frame, [215, 295], [-0.3, 1.3], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const titleSpring = spring({
    frame: Math.max(0, frame - 165),
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.9 },
  })
  const sloganSpring = spring({
    frame: Math.max(0, frame - 205),
    fps,
    config: { damping: 20, stiffness: 130, mass: 0.85 },
  })
  const badgeSpring = spring({
    frame: Math.max(0, frame - 245),
    fps,
    config: { damping: 20, stiffness: 140 },
  })

  // Smooth zoom-out exit at 435..480
  const exitProgress = easeInOutCubic(
    interpolate(frame, [435, 480], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  )
  const heroScale = interpolate(frame, [120, 435], [0.96, 1.04], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  }) * (1 + exitProgress * 0.12)
  const heroOpacity = 1 - exitProgress

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      {/* PHASE 1: CHAOTIC TERMINAL NOISE */}
      {frame < 130 && (
        <AbsoluteFill
          style={{
            opacity: noiseOpacity,
            padding: '48px 64px',
            overflow: 'hidden',
            fontFamily: FONT.mono,
            fontSize: 16.5,
            lineHeight: 1.7,
            color: 'rgba(153, 161, 182, 0.34)',
          }}
        >
          <div
            style={{
              transform: `translateY(${-frame * 9.5}px)`,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {Array.from({ length: 42 }).map((_, i) => {
              const line = NOISE_LINES[i % NOISE_LINES.length]!
              const isErr = line.includes('ERROR') || line.includes('WARN')
              return (
                <div
                  key={i}
                  style={{
                    whiteSpace: 'nowrap',
                    color: isErr ? 'rgba(243, 139, 168, 0.42)' : 'rgba(147, 153, 178, 0.3)',
                    transform: `translateX(${((i * 37) % 90) - 45}px)`,
                  }}
                >
                  {line}
                </div>
              )
            })}
          </div>

          {/* Centered dark mask + tension question */}
          <AbsoluteFill
            style={{
              justifyContent: 'center',
              alignItems: 'center',
              background: 'radial-gradient(ellipse 60% 45% at 50% 50%, rgba(6, 10, 18, 0.92) 30%, rgba(6, 10, 18, 0.3) 100%)',
            }}
          >
            <div
              style={{
                textAlign: 'center',
                transform: `scale(${interpolate(frame, [0, 110], [0.95, 1.04])})`,
              }}
            >
              <div
                style={{
                  fontFamily: FONT.sans,
                  fontSize: 54,
                  fontWeight: 700,
                  letterSpacing: '-0.025em',
                  color: '#eef2ff',
                }}
              >
                Too much noise in your terminal.
              </div>
              <div
                style={{
                  marginTop: 14,
                  fontFamily: FONT.sans,
                  fontSize: 28,
                  color: BRAND.inkDim,
                  letterSpacing: '0.03em',
                }}
              >
                当终端被无休止的日志与刷屏淹没……
              </div>
            </div>
          </AbsoluteFill>
        </AbsoluteFill>
      )}

      {/* CYAN CLEANSE SLICE WIPE */}
      {sliceOpacity > 0.01 && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${interpolate(sliceProgress, [0, 1], [15, 85])}%`,
            height: 4,
            background: 'linear-gradient(90deg, transparent, #4d6bfe, #7ce7f2, #4d6bfe, transparent)',
            boxShadow: '0 0 42px 10px rgba(53, 200, 222, 0.7)',
            opacity: sliceOpacity,
          }}
        />
      )}

      {/* PHASE 2: DEEPSEEK WHALE ASSEMBLE + HERO BRAND LOCKUP */}
      {frame >= 115 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            transform: `scale(${heroScale})`,
            opacity: heroOpacity,
          }}
        >
          {/* Central radial spotlight behind whale */}
          <div
            style={{
              position: 'absolute',
              width: 820,
              height: 420,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(77, 107, 254, 0.34) 0%, rgba(53, 200, 222, 0.16) 45%, transparent 74%)',
              filter: 'blur(40px)',
              opacity: assemble,
              pointerEvents: 'none',
            }}
          />

          {/* Horizontal Lockup matching real omdsh welcome */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 54 }}>
            <WhaleLogo dotPitch={9.8} assembleProgress={assemble} shimmerPhase={shimmer} glow={0.95} />

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                opacity: titleSpring,
                transform: `translateX(${interpolate(titleSpring, [0, 1], [34, 0])}px)`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
                <span
                  style={{
                    fontFamily: FONT.sans,
                    fontSize: 94,
                    fontWeight: 700,
                    letterSpacing: '-0.035em',
                    lineHeight: 1,
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
                </span>
                <span
                  style={{
                    fontFamily: FONT.mono,
                    fontSize: 22,
                    fontWeight: 600,
                    color: BRAND.cyanBright,
                    padding: '4px 12px',
                    borderRadius: 8,
                    background: 'rgba(53, 200, 222, 0.12)',
                    border: '1px solid rgba(53, 200, 222, 0.35)',
                  }}
                >
                  v0.29
                </span>
              </div>

              <div
                style={{
                  marginTop: 18,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  opacity: sloganSpring,
                  transform: `translateY(${interpolate(sloganSpring, [0, 1], [14, 0])}px)`,
                }}
              >
                <span
                  style={{
                    fontFamily: FONT.mono,
                    fontSize: 30,
                    fontWeight: 500,
                    color: '#dbe7ff',
                    letterSpacing: '0.02em',
                  }}
                >
                  <span style={{ color: BRAND.cyan }}>$</span> Into the Unknown
                </span>
                <span style={{ color: BRAND.inkFaint, fontSize: 26 }}>·</span>
                <span
                  style={{
                    fontFamily: FONT.sans,
                    fontSize: 30,
                    fontWeight: 600,
                    color: BRAND.cyanBright,
                    letterSpacing: '0.08em',
                  }}
                >
                  探索未至之境
                </span>
              </div>
            </div>
          </div>

          {/* Bilingual sub-tagline pill */}
          <div
            style={{
              marginTop: 58,
              opacity: badgeSpring,
              transform: `translateY(${interpolate(badgeSpring, [0, 1], [18, 0])}px)`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                padding: '10px 28px',
                borderRadius: 999,
                border: '1px solid rgba(124, 147, 255, 0.34)',
                background: 'rgba(11, 17, 32, 0.78)',
                fontFamily: FONT.sans,
                fontSize: 22.5,
                color: '#d9e2f8',
                letterSpacing: '0.01em',
              }}
            >
              The Complete Terminal Companion for{' '}
              <span style={{ color: BRAND.blueBright, fontWeight: 700 }}>DeepSeek Harness</span>
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 19.5, color: BRAND.inkDim, letterSpacing: '0.03em' }}>
              全面对齐 DeepSeek Harness 能力与设置 · 原生终端形态 · 键鼠合一 · 毫秒级流畅
            </div>
          </div>
        </div>
      )}
    </AbsoluteFill>
  )
}
