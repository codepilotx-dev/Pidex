import type { Transition } from 'motion/react'

const standardEase = [0.4, 0, 0.2, 1] as const
const entranceEase = [0.22, 1, 0.36, 1] as const

export const instantTween: Transition = {
  duration: 0,
}

export const stateTween: Transition = {
  duration: 0.16,
  ease: standardEase,
}

export const feedbackTween: Transition = {
  duration: 0.16,
  ease: standardEase,
}

export const enterTween: Transition = {
  duration: 0.16,
  ease: entranceEase,
}

export const exitTween: Transition = {
  duration: 0.16,
  ease: standardEase,
}

export const layoutTween: Transition = {
  duration: 0.22,
  ease: entranceEase,
}

export const panelTween: Transition = {
  duration: 0.22,
  ease: entranceEase,
}

export const disclosureTween: Transition = {
  duration: 0.22,
  ease: entranceEase,
}

export const pageTween: Transition = {
  duration: 0.34,
  ease: entranceEase,
}

export const loadingTween: Transition = {
  duration: 0.9,
  ease: 'linear',
}

/**
 * 右工作区宽度转换：显隐与 split/full 几何共用 Codex 外壳的 spring 分支，
 * 不影响弹层、底栏与 composer 使用的 100ms layoutTween。
 */
export const workspacePanelSpring: Transition = {
  type: 'spring',
  duration: 0.35,
  bounce: 0.1,
}

export const workspacePanelExitSpring: Transition = {
  type: 'spring',
  duration: 0.5,
  bounce: 0.1,
}

// Compatibility names for components that still use the previous motion scale.
export const fastTween = stateTween
export const standardTween = enterTween
export const emphasisTween = layoutTween

export type FloatingSurfaceSide = 'top' | 'right' | 'bottom' | 'left'

export function floatingSurfaceMotion(side: FloatingSurfaceSide): {
  initial: { opacity: number; x: number; y: number }
  animate: { opacity: number; x: number; y: number }
  exit: { opacity: number; x: number; y: number }
} {
  const offset =
    side === 'top'
      ? { x: 0, y: 4 }
      : side === 'bottom'
        ? { x: 0, y: -4 }
        : side === 'left'
          ? { x: 4, y: 0 }
          : { x: -4, y: 0 }

  return {
    initial: { opacity: 0, ...offset },
    animate: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, ...offset },
  }
}

export function motionTransition(
  reducedMotion: boolean,
  transition: Transition = enterTween,
): Transition {
  return reducedMotion ? instantTween : transition
}
