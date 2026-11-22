import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { AnsiTerminal, type SerializedTuiFrame } from '../components/AnsiTerminal'
import { BilingualHeader, KeycapHud } from '../components/Stage'
import liveFrames from '../data/live-frames.json'

const settingsModels = liveFrames.liveSettingsModels as SerializedTuiFrame
const settingsPresets = liveFrames.liveSettingsPresets as SerializedTuiFrame
const settingsPlugins = liveFrames.liveSettingsPlugins as SerializedTuiFrame
const settingsTermDark = liveFrames.liveSettingsTerminalDark as SerializedTuiFrame
const settingsTermLight = liveFrames.liveSettingsTerminalLight as SerializedTuiFrame
const pluginsHome = liveFrames.livePluginsHome as SerializedTuiFrame
const pluginsBundles = liveFrames.livePluginsBundles as SerializedTuiFrame
const liveMcp = liveFrames.liveMcp as SerializedTuiFrame

export const Scene3SettingsEco: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // 720 frames (12.0s) — 100% LIVE real `omdsh` PTY captures!
  // Part 0: 0..240   (4.0s) -> Real /settings: Models (85f) -> Agent presets (65f) -> Plugins (90f)
  // Part 1: 240..480 (4.0s) -> Real /settings -> Terminal: Catppuccin Dark (120f) -> Catppuccin Light (120f)
  // Part 2: 480..720 (4.0s) -> Real /plugins menu (75f) -> Real /plugins Bundles (Codex/Claude/Worktree/Auto-review, 95f) -> Real /mcp (70f)

  const part = frame < 240 ? 0 : frame < 480 ? 1 : 2
  const local = frame - part * 240

  const enter = spring({
    frame: local,
    fps,
    config: { damping: 18, stiffness: 165, mass: 0.78 },
  })
  const exit = interpolate(local, [224, 240], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const headers = [
    {
      kicker: '04 · COMPLETE HARNESS SETTINGS',
      en: 'All 6 Setting Sections. Docked Live.',
      zh: '100% 对齐 DSH 六大设置分组：常规 · 模型 · 预设 · 插件 · 终端 · 高级',
    },
    {
      kicker: '05 · LIVE THEME & TERMINAL CONTROLS',
      en: 'Catppuccin Dark & Light. Instant Apply.',
      zh: '对话上方停靠调整终端偏好，Catppuccin 深浅配色实时生效无需重启',
    },
    {
      kicker: '06 · PLUGINS, BUNDLES & LIVE MCP',
      en: 'Manage Bundles, Codex / Claude & MCP',
      zh: '/plugins 管理官方扩展与 Codex / Claude Code 集成 · /mcp 实时增删探测',
    },
  ][part]!

  let activeFrame: SerializedTuiFrame
  let title: string
  if (part === 0) {
    if (local < 85) {
      activeFrame = settingsModels
      title = 'omdsh — /settings · Models'
    } else if (local < 150) {
      activeFrame = settingsPresets
      title = 'omdsh — /settings · Agent presets'
    } else {
      activeFrame = settingsPlugins
      title = 'omdsh — /settings · Plugins'
    }
  } else if (part === 1) {
    activeFrame = local < 120 ? settingsTermDark : settingsTermLight
    title = local < 120 ? 'omdsh — /settings · Terminal (Catppuccin Dark)' : 'omdsh — /settings · Terminal (Catppuccin Light)'
  } else {
    if (local < 65) {
      activeFrame = pluginsHome
      title = 'omdsh — /plugins'
    } else if (local < 160) {
      activeFrame = pluginsBundles
      title = 'omdsh — /plugins · Bundles'
    } else {
      activeFrame = liveMcp
      title = 'omdsh — /mcp · Runtime MCP Manager'
    }
  }

  const themeWave =
    part === 1 && local >= 116 && local <= 148
      ? interpolate(local, [116, 148], [-20, 120], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
      : -100

  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <div style={{ position: 'absolute', top: 30, left: 0, right: 0, zIndex: 20 }}>
        <BilingualHeader key={part} kicker={headers.kicker} en={headers.en} zh={headers.zh} />
      </div>

      <div
        style={{
          position: 'absolute',
          top: 210,
          perspective: 1900,
          opacity: Math.min(enter, exit),
          transform: `translateY(${interpolate(enter, [0, 1], [26, 0])}px)`,
        }}
      >
        <AnsiTerminal
          frameData={activeFrame}
          cols={liveFrames.cols}
          rows={liveFrames.rows}
          fontSize={16.2}
          title={title}
          blinkFrame={frame}
          cameraStyle={{
            transform: `rotateX(2.2deg) rotateY(${part === 1 ? 2.0 : -2.0}deg) scale(1.035)`,
          }}
          overlay={
            themeWave > -50 ? (
              <div
                style={{
                  position: 'absolute',
                  inset: -30,
                  background: `linear-gradient(115deg, transparent ${themeWave - 14}%, rgba(124, 231, 242, 0.55) ${themeWave}%, transparent ${themeWave + 14}%)`,
                  pointerEvents: 'none',
                }}
              />
            ) : undefined
          }
        />
      </div>

      {part === 0 && (
        <KeycapHud
          keys={['Tab']}
          joiner=""
          labelEn="6 Harness Setting Tabs"
          labelZh="切换完整 6 大 DSH 设置分组"
          triggerFrame={76}
          duration={148}
          position="top-right"
        />
      )}
      {part === 1 && (
        <KeycapHud
          keys={['←', '→']}
          joiner="/"
          labelEn="Live Theme Switch"
          labelZh="深浅主题即刻生效"
          triggerFrame={240 + 110}
          duration={115}
          position="top-right"
        />
      )}
      {part === 2 && local < 158 && (
        <KeycapHud
          keys={['/plugins']}
          joiner=""
          labelEn="Bundles & Subagents"
          labelZh="管理官方扩展与 Codex / Claude"
          triggerFrame={480 + 58}
          duration={98}
          position="top-right"
        />
      )}
      {part === 2 && local >= 158 && (
        <KeycapHud
          keys={['/mcp']}
          joiner=""
          labelEn="Live MCP Servers"
          labelZh="实时接入、探测与管理工具"
          triggerFrame={480 + 158}
          duration={74}
          position="top-right"
        />
      )}
    </AbsoluteFill>
  )
}
