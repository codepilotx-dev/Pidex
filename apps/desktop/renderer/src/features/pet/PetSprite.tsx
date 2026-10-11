import React, { useEffect, useState } from 'react'
import { usePrefersReducedMotion } from '../../hooks/UsePrefersReducedMotion.js'
import { PET_ANIMATIONS, type PetAnimationName } from './PetAnimationModel.js'
import type { PetLookFrame } from './PetDirectionModel.js'

type Props = {
  animation: PetAnimationName
  lookFrame?: PetLookFrame | null
  size: number
  spriteVersionNumber: 1 | 2
  spritesheetUrl: string
}

export function PetSprite({
  animation,
  lookFrame = null,
  size,
  spriteVersionNumber,
  spritesheetUrl,
}: Props): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const [frame, setFrame] = useState(0)
  const [loops, setLoops] = useState(0)
  const [finished, setFinished] = useState(false)
  const effectiveAnimation = finished ? 'idle' : animation
  const definition = PET_ANIMATIONS[effectiveAnimation]

  useEffect(() => {
    setFrame(0)
    setLoops(0)
    setFinished(false)
  }, [animation, spritesheetUrl])

  useEffect(() => {
    if (lookFrame || reducedMotion) return
    const timeout = window.setTimeout(() => {
      const next = frame + 1
      if (next < definition.durations.length) {
        setFrame(next)
        return
      }
      const nextLoops = loops + 1
      if (definition.repeat !== null && nextLoops >= definition.repeat) {
        setFrame(0)
        setLoops(0)
        setFinished(true)
        return
      }
      setLoops(nextLoops)
      setFrame(0)
    }, definition.durations[frame] ?? 150)
    return () => window.clearTimeout(timeout)
  }, [definition, frame, lookFrame, loops, reducedMotion])

  const rows = spriteVersionNumber === 2 ? 11 : 9
  const visibleFrame = spriteVersionNumber === 2 ? lookFrame : null
  const columnIndex = visibleFrame?.columnIndex ?? frame
  const rowIndex = visibleFrame?.rowIndex ?? definition.row
  const width = size
  const height = Math.round((size * 208) / 192)
  return (
    <div
      aria-label={`宠物动画：${effectiveAnimation}`}
      className="pet-sprite tw:bg-no-repeat tw:[image-rendering:auto]"
      role="img"
      style={{
        width,
        height,
        backgroundImage: `url("${spritesheetUrl}")`,
        backgroundSize: `800% ${rows * 100}%`,
        backgroundPosition: `${columnIndex * (100 / 7)}% ${rowIndex * (100 / (rows - 1))}%`,
      }}
    />
  )
}
