import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'
import React from 'react'
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { StageBackdrop } from './components/Stage'
import { Scene1Intro } from './scenes/Scene1Intro'
import { Scene2Agents } from './scenes/Scene2Agents'
import { Scene3SettingsEco } from './scenes/Scene3SettingsEco'
import { Scene4CraftFlow } from './scenes/Scene4CraftFlow'
import { Scene5Autonomy } from './scenes/Scene5Autonomy'
import { Scene5Speed } from './scenes/Scene5Speed'
import { Scene6Outro } from './scenes/Scene6Outro'
import { SCENES } from './tokens'

export const OmdshPromo: React.FC = () => {
  const frame = useCurrentFrame()

  // Subtle backdrop flash when Catppuccin Light activates at frame 1560 (26.0s)
  const lightFlash = interpolate(frame, [1556, 1568, 1678], [0, 0.85, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill>
      <StageBackdrop globalFrame={frame} lightFlash={lightFlash} />

      <Audio src={staticFile('media/soundtrack-72s.m4a')} volume={1} />

      <Sequence from={SCENES.intro.from} durationInFrames={SCENES.intro.duration}>
        <Scene1Intro />
      </Sequence>

      <Sequence from={SCENES.agents.from} durationInFrames={SCENES.agents.duration}>
        <Scene2Agents />
      </Sequence>

      <Sequence from={SCENES.settings.from} durationInFrames={SCENES.settings.duration}>
        <Scene3SettingsEco />
      </Sequence>

      <Sequence from={SCENES.craft.from} durationInFrames={SCENES.craft.duration}>
        <Scene4CraftFlow />
      </Sequence>

      <Sequence from={SCENES.autonomy.from} durationInFrames={SCENES.autonomy.duration}>
        <Scene5Autonomy />
      </Sequence>

      <Sequence from={SCENES.speed.from} durationInFrames={SCENES.speed.duration}>
        <Scene5Speed />
      </Sequence>

      <Sequence from={SCENES.outro.from} durationInFrames={SCENES.outro.duration}>
        <Scene6Outro />
      </Sequence>
    </AbsoluteFill>
  )
}
