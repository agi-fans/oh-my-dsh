import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { AnsiTerminal, type SerializedTuiFrame } from '../components/AnsiTerminal'
import { BilingualHeader, KeycapHud } from '../components/Stage'
import liveFrames from '../data/live-frames.json'
import realFrames from '../data/real-frames.json'

const permDefault = liveFrames.livePermission0 as SerializedTuiFrame
const permAuto = liveFrames.livePermissionAuto as SerializedTuiFrame
const teamFrames = realFrames.s5TeamFrames as SerializedTuiFrame[]
const trajectoryFrame = realFrames.s5Trajectory as SerializedTuiFrame
const treeBranch = realFrames.s5TreeBranch as SerializedTuiFrame
const treeRestored = realFrames.s5TreeRestored as SerializedTuiFrame

export const Scene5Autonomy: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // 720 frames (12.0s):
  // Part 0: 0..240   (4.0s) -> /goal bar + /schedule cron table + /permission Auto review selector
  // Part 1: 240..480 (4.0s) -> /team Agent Teams shared task board + live Subagent roster & Workflow tree
  // Part 2: 480..720 (4.0s) -> /trajectory event ledger (90f) -> Esc Esc Session Tree (90f) -> Alt+R Snapshot Restored (60f)

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
      kicker: '11 · PERMISSION PRESETS & AUTO REVIEW',
      en: 'Sandboxed Access & Auto Review Mode',
      zh: '/permission 细粒度权限预设与模型预审查 Auto review，安全掌控工具调用',
    },
    {
      kicker: '12 · AGENT TEAMS & WORKFLOWS',
      en: 'Parallel /team Board & Live Subagents',
      zh: '/team 共享任务看板、写范围隔离与子智能体 / Workflow 实时编排',
    },
    {
      kicker: '13 · TRAJECTORY, BRANCHES & SNAPSHOTS',
      en: '/trajectory · Esc Esc Tree · Alt+R Rewind',
      zh: '全事件时间线账本 · 会话分支树自由探索 · 文件快照一键安全回溯',
    },
  ][part]!

  let activeFrame: SerializedTuiFrame
  let title: string
  if (part === 0) {
    activeFrame = local < 90 ? permDefault : permAuto
    title = 'omdsh — /permission · Access & Auto review'
  } else if (part === 1) {
    const idx = Math.floor(local / 16) % teamFrames.length
    activeFrame = teamFrames[idx]!
    title = 'omdsh — /team · Agent Teams & Subagents'
  } else {
    if (local < 84) {
      activeFrame = trajectoryFrame
      title = 'omdsh — /trajectory · Session Event Ledger'
    } else if (local < 168) {
      activeFrame = treeBranch
      title = 'omdsh — Session Tree (Esc Esc)'
    } else {
      activeFrame = treeRestored
      title = 'omdsh — Snapshot Restored (Alt+R)'
    }
  }

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
          cols={realFrames.cols}
          rows={realFrames.rows}
          fontSize={16.2}
          title={title}
          blinkFrame={frame}
          cameraStyle={{
            transform: `rotateX(2.2deg) rotateY(${part === 1 ? 2.0 : -2.0}deg) scale(1.035)`,
          }}
        />
      </div>

      {part === 2 && (
        <>
          <KeycapHud
            keys={['Esc', 'Esc']}
            joiner=""
            labelEn="Session Branch Tree"
            labelZh="展开会话分支树"
            triggerFrame={480 + 80}
            duration={80}
            position="top-right"
          />
          <KeycapHud
            keys={['Alt', 'R']}
            labelEn="Restore File Snapshot"
            labelZh="一键还原文件快照"
            triggerFrame={480 + 166}
            duration={70}
            position="top-right"
          />
        </>
      )}
    </AbsoluteFill>
  )
}
