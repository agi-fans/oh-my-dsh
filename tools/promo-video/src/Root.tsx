import React from 'react'
import { Composition } from 'remotion'
import { OmdshPromo } from './OmdshPromo'
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from './tokens'

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="OmdshPromo"
      component={OmdshPromo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  )
}
