import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { BRAND, FONT, beatPulse } from '../tokens'

export const StageBackdrop: React.FC<{
  globalFrame: number
  lightFlash?: number
  intensity?: number
  accentShift?: number
}> = ({ globalFrame, lightFlash = 0, intensity = 1, accentShift = 0 }) => {
  const pulse = beatPulse(globalFrame)
  const driftX = Math.sin(globalFrame * 0.012 + accentShift) * 65
  const driftY = Math.cos(globalFrame * 0.009 + accentShift) * 45

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.bg,
        overflow: 'hidden',
      }}
    >
      {/* Subtle architectural terminal grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(to right, rgba(77, 107, 254, 0.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(53, 200, 222, 0.045) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 75% 75% at 50% 50%, black 20%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 75% 75% at 50% 50%, black 20%, transparent 100%)',
          opacity: 0.75 * intensity,
        }}
      />

      {/* Deep blue primary ambient orb */}
      <div
        style={{
          position: 'absolute',
          left: `${24 + driftX * 0.06}%`,
          top: `${16 + driftY * 0.06}%`,
          width: 960,
          height: 680,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(77, 107, 254, 0.28) 0%, rgba(77, 107, 254, 0) 68%)',
          filter: 'blur(40px)',
          transform: `translate(-50%, -50%) scale(${1 + pulse * 0.07})`,
          opacity: (0.78 + pulse * 0.22) * intensity,
        }}
      />

      {/* Cyan secondary ambient orb */}
      <div
        style={{
          position: 'absolute',
          left: `${76 - driftX * 0.05}%`,
          top: `${78 - driftY * 0.05}%`,
          width: 880,
          height: 640,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(53, 200, 222, 0.22) 0%, rgba(53, 200, 222, 0) 68%)',
          filter: 'blur(44px)',
          transform: `translate(-50%, -50%) scale(${1 + pulse * 0.05})`,
          opacity: (0.72 + pulse * 0.18) * intensity,
        }}
      />

      {/* Subtle light flash on Catppuccin Light switch */}
      {lightFlash > 0.01 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at 50% 50%, rgba(239, 241, 245, 0.34), rgba(137, 180, 250, 0.08))',
            opacity: lightFlash,
          }}
        />
      )}

      {/* Cinema vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse 85% 82% at 50% 50%, transparent 45%, rgba(2, 4, 10, 0.72) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  )
}

export const BilingualHeader: React.FC<{
  kicker: string
  en: string
  zh: string
  align?: 'left' | 'center'
  delay?: number
  fadeOutAt?: number
}> = ({ kicker, en, zh, align = 'center', delay = 0, fadeOutAt }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const enter = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: { damping: 20, stiffness: 180, mass: 0.7 },
  })
  const exitOpacity =
    fadeOutAt !== undefined
      ? interpolate(frame, [fadeOutAt, fadeOutAt + 14], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1

  const opacity = Math.min(enter, exitOpacity)
  const y = interpolate(enter, [0, 1], [18, 0])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        textAlign: align,
        opacity,
        transform: `translateY(${y}px)`,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '5px 14px',
          borderRadius: 999,
          border: '1px solid rgba(124, 147, 255, 0.32)',
          background: 'rgba(11, 17, 32, 0.75)',
          fontFamily: FONT.mono,
          fontSize: 15,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: BRAND.cyanBright,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: BRAND.cyan,
            boxShadow: `0 0 10px ${BRAND.cyan}`,
          }}
        />
        {kicker}
      </div>
      <div
        style={{
          fontFamily: FONT.sans,
          fontSize: 46,
          fontWeight: 700,
          letterSpacing: '-0.025em',
          lineHeight: 1.08,
          color: '#f3f6ff',
          textShadow: '0 8px 32px rgba(0, 0, 0, 0.55)',
        }}
      >
        {en}
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: FONT.sans,
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: '0.02em',
          color: BRAND.inkDim,
        }}
      >
        {zh}
      </div>
    </div>
  )
}

export const KeycapHud: React.FC<{
  keys: string[]
  joiner?: string
  labelEn: string
  labelZh: string
  triggerFrame: number
  duration?: number
  position?: 'bottom-right' | 'top-right' | 'bottom-center'
}> = ({ keys, joiner = '+', labelEn, labelZh, triggerFrame, duration = 90, position = 'bottom-right' }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const local = frame - triggerFrame
  if (local < -4 || local > duration + 18) return null

  const pop = spring({
    frame: Math.max(0, local),
    fps,
    config: { damping: 14, stiffness: 260, mass: 0.6 },
  })
  const pressScale =
    local >= 4 && local <= 14
      ? interpolate(local, [4, 8, 14], [1, 0.91, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
      : 1
  const out = interpolate(local, [duration - 14, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const posStyle: React.CSSProperties =
    position === 'top-right'
      ? { top: 44, right: 56 }
      : position === 'bottom-center'
        ? { bottom: 26, left: '50%', transform: `translateX(-50%) scale(${(0.85 + 0.15 * pop) * pressScale})` }
        : { bottom: 24, right: 44 }

  const transform =
    position === 'bottom-center'
      ? posStyle.transform
      : `translateY(${interpolate(pop, [0, 1], [16, 0])}px) scale(${(0.88 + 0.12 * pop) * pressScale})`

  return (
    <div
      style={{
        position: 'absolute',
        ...posStyle,
        transform,
        opacity: Math.min(pop, out),
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 18px',
        borderRadius: 14,
        background: 'rgba(11, 17, 32, 0.92)',
        border: '1px solid rgba(124, 147, 255, 0.45)',
        boxShadow: '0 14px 44px rgba(0, 0, 0, 0.58), 0 0 28px rgba(77, 107, 254, 0.28)',
        backdropFilter: 'blur(12px)',
        zIndex: 50,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {keys.map((k, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && joiner && (
              <span style={{ color: BRAND.inkFaint, fontFamily: FONT.mono, fontSize: 15 }}>{joiner}</span>
            )}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 34,
                padding: '4px 11px',
                borderRadius: 8,
                background: 'linear-gradient(180deg, #212c4d 0%, #141c33 100%)',
                border: '1px solid rgba(124, 231, 242, 0.48)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16), 0 3px 0 #0a0f1f',
                fontFamily: FONT.mono,
                fontSize: 17,
                fontWeight: 700,
                color: '#eef4ff',
              }}
            >
              {k}
            </span>
          </React.Fragment>
        ))}
      </div>
      <div style={{ width: 1, height: 28, background: 'rgba(124, 147, 255, 0.25)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
        <span style={{ fontFamily: FONT.sans, fontSize: 16, fontWeight: 600, color: '#f0f4ff' }}>{labelEn}</span>
        <span style={{ fontFamily: FONT.sans, fontSize: 13.5, color: BRAND.inkDim }}>{labelZh}</span>
      </div>
    </div>
  )
}
