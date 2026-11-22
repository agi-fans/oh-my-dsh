import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { AnsiTerminal, type SerializedTuiFrame } from '../components/AnsiTerminal'
import { BilingualHeader, KeycapHud } from '../components/Stage'
import liveFrames from '../data/live-frames.json'
import realFrames from '../data/real-frames.json'
import { BRAND, easeInOutCubic } from '../tokens'

const runningFrames = realFrames.s4RunningFrames as SerializedTuiFrame[]
const foldedFrame = realFrames.s4Folded as SerializedTuiFrame
const expandedFrame = realFrames.s4Expanded as SerializedTuiFrame
const atDropdown = liveFrames.liveShellAtDropdown as SerializedTuiFrame
const atInserted = liveFrames.liveShellAtInserted as SerializedTuiFrame
const btwTyping = realFrames.s4BtwTypingSteps as SerializedTuiFrame[]
const btwAnswered = realFrames.s4BtwAnswered as SerializedTuiFrame
const diffFrame = realFrames.s4Diff as SerializedTuiFrame
const diffQuoted = realFrames.s4DiffQuoted as SerializedTuiFrame
const sourcePreview = realFrames.s4SourcePreview as SerializedTuiFrame

export const Scene4CraftFlow: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // 960 frames (16.0s) — Every transition is 100% coherent input -> output:
  // Part 0: 0..360   (6.0s) -> Deep Driving shimmer -> Auto-fold -> Ctrl+O expand -> Telemetry focus
  // Part 1: 360..540 (3.0s) -> Inline !shell card + @mention fuzzy dropdown -> Tab inserts exact @file path!
  // Part 2: 540..720 (3.0s) -> Type exact `/btw Why does Catppuccin Latte keep #4d6bfe...` -> docked /btw answers THAT exact question!
  // Part 3: 720..960 (4.0s) -> /diff split-pane -> Alt+Y quotes into composer -> Click #L142 -> built-in Line 142 source preview!

  const part = frame < 360 ? 0 : frame < 540 ? 1 : frame < 720 ? 2 : 3
  const partStart = part === 0 ? 0 : part === 1 ? 360 : part === 2 ? 540 : 720
  const partLen = part === 0 ? 360 : part === 1 ? 180 : part === 2 ? 180 : 240
  const local = frame - partStart

  const enter = spring({
    frame: local,
    fps,
    config: { damping: 18, stiffness: 170, mass: 0.75 },
  })
  const exit = interpolate(local, [partLen - 14, partLen], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const headers = [
    {
      kicker: '07 · PROGRESSIVE DISCLOSURE & TELEMETRY',
      en: 'Noise Fades. Signal Stays.',
      zh: '过程自动折叠、Ctrl+O 随时展开 · 底部常驻实时上下文与吞吐遥测',
    },
    {
      kicker: '08 · INLINE !SHELL & @MENTIONS',
      en: 'Persistent !shell & Fuzzy @ References',
      zh: '输入框原地执行持久 Shell · @ 模糊补全一键插入文件或历史会话',
    },
    {
      kicker: '09 · EPHEMERAL /BTW SIDE QUERIES',
      en: 'Ask /btw Without Cluttering the Thread',
      zh: '输入 /btw 临时旁路提问，回答停靠上方阅后即散，零污染主对话',
    },
    {
      kicker: '10 · /DIFF QUOTE & CLICKABLE #L142 LINKS',
      en: 'Review Diffs. Click Links to Jump to Line.',
      zh: '/diff 双栏审阅并 Alt+Y 引用回输入框 · 点击本地路径直达行号预览',
    },
  ][part]!

  let activeFrame: SerializedTuiFrame
  let title = 'omdsh — ~/Workspace/oh-my-dsh'
  let footerHighlight: 'left' | 'right' | 'both' | null = null

  if (part === 0) {
    if (local < 114) {
      const idx = Math.min(runningFrames.length - 1, Math.floor(local / 19))
      activeFrame = runningFrames[idx]!
    } else if (local < 180) {
      activeFrame = foldedFrame
    } else if (local < 276) {
      activeFrame = expandedFrame
    } else {
      activeFrame = foldedFrame
      footerHighlight = local < 318 ? 'left' : 'right'
    }
  } else if (part === 1) {
    activeFrame = local < 96 ? atDropdown : atInserted
    title = 'omdsh — !shell & @mention'
  } else if (part === 2) {
    if (local < 72) {
      const idx = Math.min(btwTyping.length - 1, Math.floor(local / 18))
      activeFrame = btwTyping[idx]!
      title = 'omdsh — typing /btw side question'
    } else {
      activeFrame = btwAnswered
      title = 'omdsh — /btw · docked side answer'
    }
  } else {
    if (local < 84) {
      activeFrame = diffFrame
      title = 'omdsh — /diff · Workspace changes'
    } else if (local < 144) {
      activeFrame = diffQuoted
      title = 'omdsh — Alt+Y quoted diff -> click #L142'
    } else {
      activeFrame = sourcePreview
      title = 'omdsh — session-controller.ts#L142'
    }
  }

  // Subtle macro zoom on footer at end of Part 0
  const zoomP =
    part === 0
      ? easeInOutCubic(interpolate(local, [268, 304], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))
      : 0
  const camScale = 1.035 + zoomP * 0.14
  const camY = -zoomP * 82

  // Click pointer on #L142 during Part 3 (local 110..144)
  const showClickDot = part === 3 && local >= 104 && local < 145
  const cursorX = interpolate(local, [104, 134], [640, 472], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const cursorY = interpolate(local, [104, 134], [480, 412], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      {zoomP > 0.01 && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 265,
            background:
              'linear-gradient(180deg, rgba(6, 10, 18, 0.98) 48%, rgba(6, 10, 18, 0.72) 76%, rgba(6, 10, 18, 0) 100%)',
            opacity: zoomP,
            zIndex: 15,
            pointerEvents: 'none',
          }}
        />
      )}

      <div style={{ position: 'absolute', top: 30, left: 0, right: 0, zIndex: 20 }}>
        <BilingualHeader key={part} kicker={headers.kicker} en={headers.en} zh={headers.zh} />
      </div>

      <div
        style={{
          position: 'absolute',
          top: 210,
          perspective: 1900,
          opacity: Math.min(enter, exit),
          transform: `translateY(${interpolate(enter, [0, 1], [24, 0])}px)`,
        }}
      >
        <AnsiTerminal
          frameData={activeFrame}
          cols={realFrames.cols}
          rows={realFrames.rows}
          fontSize={16.2}
          title={title}
          blinkFrame={frame}
          footerHighlight={footerHighlight}
          cameraStyle={{
            transform: `translateY(${camY}px) rotateX(${2.0 + zoomP * 1.6}deg) rotateY(${part % 2 === 0 ? -1.8 : 1.8}deg) scale(${camScale})`,
          }}
          overlay={
            showClickDot ? (
              <div
                style={{
                  position: 'absolute',
                  left: cursorX,
                  top: cursorY,
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  border: `2.5px solid ${BRAND.cyanBright}`,
                  backgroundColor: 'rgba(124, 231, 242, 0.28)',
                  boxShadow: '0 0 22px rgba(53, 200, 222, 0.85)',
                  transform: `translate(-50%, -50%) scale(${local >= 134 ? 0.72 : 1})`,
                  pointerEvents: 'none',
                }}
              />
            ) : undefined
          }
        />
      </div>

      {part === 0 && (
        <KeycapHud
          keys={['Ctrl', 'O']}
          labelEn="Expand / Fold Details"
          labelZh="展开或收起思考与工具卡片"
          triggerFrame={174}
          duration={96}
          position="top-right"
        />
      )}
      {part === 1 && (
        <KeycapHud
          keys={['Tab']}
          joiner=""
          labelEn="Insert @ File Mention"
          labelZh="一键补全文件路径"
          triggerFrame={360 + 84}
          duration={84}
          position="top-right"
        />
      )}
      {part === 2 && (
        <KeycapHud
          keys={['/btw']}
          joiner=""
          labelEn="Ephemeral Side Pane"
          labelZh="旁路提问 · 不污染主线程"
          triggerFrame={540 + 66}
          duration={102}
          position="top-right"
        />
      )}
      {part === 3 && (
        <KeycapHud
          keys={['Alt', 'Y']}
          labelEn="Quote Diff → #L142 Preview"
          labelZh="引用改动 · 点击链接直达行号"
          triggerFrame={720 + 74}
          duration={148}
          position="top-right"
        />
      )}
    </AbsoluteFill>
  )
}
