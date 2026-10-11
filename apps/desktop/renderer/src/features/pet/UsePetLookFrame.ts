import { useEffect, useState, type RefObject } from 'react'
import type { DesktopPetOverlayWindowState } from '@pidex/shared/desktop-pet-overlay'
import { resolvePetLookFrame, type PetLookFrame } from './PetDirectionModel.js'
import { getPetPresentationBridge } from './PetPresentation.js'

const POINTER_SAMPLE_INTERVAL_MS = 50

export function usePetLookFrame(
  avatarRef: RefObject<HTMLElement | null>,
  spriteVersionNumber: 1 | 2 | undefined,
  enabled: boolean,
): PetLookFrame | null {
  const [lookFrame, setLookFrame] = useState<PetLookFrame | null>(null)

  useEffect(() => {
    if (!enabled || spriteVersionNumber !== 2) {
      setLookFrame(null)
      return
    }
    const bridge = getPetPresentationBridge()
    if (
      typeof bridge?.getPetGlobalPointerPosition !== 'function' ||
      typeof bridge.getPetOverlayWindowState !== 'function'
    ) {
      setLookFrame(null)
      return
    }

    let disposed = false
    let sampling = false
    const sample = async (): Promise<void> => {
      if (sampling) return
      sampling = true
      try {
        const [pointer, state] = await Promise.all([
          bridge.getPetGlobalPointerPosition!(),
          bridge.getPetOverlayWindowState(),
        ])
        if (disposed) return
        const avatar = avatarRef.current
        if (!avatar) {
          setLookFrame(null)
          return
        }
        setLookFrame(resolveLookFrameFromWindow(state, avatar.getBoundingClientRect(), pointer))
      } catch {
        if (!disposed) setLookFrame(null)
      } finally {
        sampling = false
      }
    }

    void sample()
    const timer = window.setInterval(() => void sample(), POINTER_SAMPLE_INTERVAL_MS)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [avatarRef, enabled, spriteVersionNumber])

  return lookFrame
}

function resolveLookFrameFromWindow(
  state: DesktopPetOverlayWindowState,
  avatar: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  pointer: { x: number; y: number },
): PetLookFrame | null {
  return resolvePetLookFrame(
    {
      left: state.bounds.x + avatar.left,
      top: state.bounds.y + avatar.top,
      width: avatar.width,
      height: avatar.height,
    },
    pointer,
    2,
  )
}
