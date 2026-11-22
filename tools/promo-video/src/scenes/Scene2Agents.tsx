import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { AnsiTerminal, type SerializedTuiFrame } from '../components/AnsiTerminal'
import { BilingualHeader, KeycapHud } from '../components/Stage'
import liveFrames from '../data/live-frames.json'
import realFrames from '../data/real-frames.json'

const agentSelect = [
  liveFrames.liveAgent0 as SerializedTuiFrame,
  liveFrames.liveAgent1 as SerializedTuiFrame,
  liveFrames.liveAgent2 as SerializedTuiFrame,
  liveFrames.liveAgent3 as SerializedTuiFrame,
  liveFrames.liveAgent1 as SerializedTuiFrame,
]
const liveModel = liveFrames.liveModel as SerializedTuiFrame
const ptcSubcalls = realFrames.s2PtcSubcalls as SerializedTuiFrame
const ptcExpanded = realFrames.s2PtcExpanded as SerializedTuiFrame
const cordisFrame = realFrames.s2Cordis as SerializedTuiFrame

export const Scene2Agents: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // 720 frames (12.0s):
  // Part 0: 0..240   (4.0s) -> LIVE real /agent picker cycling Standard -> PTC -> Minimal -> Creator -> PTC
  // Part 1: 240..480 (4.0s) -> PTC (code) in action: run_code nested tool dispatch -> Ctrl+O expand PTC source & output
  // Part 2: 480..720 (4.0s) -> Creator (cordis) (120f) -> LIVE real /model picker (120f)

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
      kicker: '01 · DEEPSEEK HARNESS AGENT PRESETS',
      en: 'Standard · PTC · Minimal · Creator',
      zh: '完整对齐 DeepSeek Harness 四大官方智能体预设，按任务切换运行模式',
    },
    {
      kicker: '02 · PROGRAMMATIC TOOL CALLING (PTC)',
      en: 'Orchestrate Chained Tools in run_code',
      zh: 'PTC 代码编排模式：单回合脚本串联多工具执行，完整呈现嵌套子调用',
    },
    {
      kicker: '03 · CREATOR MODE & MODEL ROUTING',
      en: 'Author Cordis Plugins · Switch Models Live',
      zh: 'Creator 模式终端内编写 Cordis 插件 · /model 一键切换模型、收藏与推理强度',
    },
  ][part]!

  let activeFrame: SerializedTuiFrame
  let title: string
  if (part === 0) {
    const idx = local < 55 ? 0 : local < 105 ? 1 : local < 150 ? 2 : local < 195 ? 3 : 4
    activeFrame = agentSelect[idx]!
    title = 'omdsh — /agent · Choose Agent Composition'
  } else if (part === 1) {
    activeFrame = local < 116 ? ptcSubcalls : ptcExpanded
    title = 'omdsh — PTC (code) · run_code & Nested Subcalls'
  } else {
    activeFrame = local < 120 ? cordisFrame : liveModel
    title = local < 120 ? 'omdsh — Creator (cordis) · Plugin Authoring' : 'omdsh — /model · DeepSeek Models & Favorites'
  }

  const angles = [
    { rx: 2.6, ry: -2.2 },
    { rx: 2.0, ry: 2.2 },
    { rx: 2.4, ry: -1.8 },
  ][part]!

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
          transform: `translateY(${interpolate(enter, [0, 1], [28, 0])}px)`,
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
            transform: `rotateX(${angles.rx}deg) rotateY(${angles.ry}deg) scale(1.035)`,
          }}
        />
      </div>

      {part === 0 && (
        <KeycapHud
          keys={['/agent']}
          joiner=""
          labelEn="Switch Harness Preset"
          labelZh="切换四大官方 Agent 预设"
          triggerFrame={18}
          duration={205}
          position="top-right"
        />
      )}
      {part === 1 && (
        <KeycapHud
          keys={['Ctrl', 'O']}
          labelEn="Inspect PTC Source & Calls"
          labelZh="展开 PTC 源码与嵌套调用"
          triggerFrame={240 + 110}
          duration={118}
          position="top-right"
        />
      )}
      {part === 2 && (
        <KeycapHud
          keys={['/model']}
          joiner=""
          labelEn="Favorites & Effort"
          labelZh="模型收藏、单会话切换与推理强度"
          triggerFrame={480 + 114}
          duration={114}
          position="top-right"
        />
      )}
    </AbsoluteFill>
  )
}
