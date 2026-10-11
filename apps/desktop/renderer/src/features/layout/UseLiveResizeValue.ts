import { useMotionTemplate, useMotionValue, type MotionValue } from 'motion/react'
import { useCallback, useLayoutEffect, useRef } from 'react'

export type LiveResizeValue = {
  liveSize: MotionValue<number>
  liveSizePixels: MotionValue<string>
  previewSize: (nextSize: number | null) => void
}

export function normalizeLiveResizeSize(
  size: number,
  pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio,
): number {
  const safePixelRatio = Number.isFinite(pixelRatio) ? Math.max(1, pixelRatio) : 1
  return Math.round(size * safePixelRatio) / safePixelRatio
}

/**
 * 折叠态（面板已隐藏但宿主保留挂载）下，尺寸提交与预览都必须收敛到 0；
 * 否则隐藏的宿主仍按上次提交的分屏宽度占位，把聊天区域挤窄。
 */
export function resolveLiveResizeTarget(committedSize: number, collapsed: boolean): number {
  return collapsed ? 0 : normalizeLiveResizeSize(committedSize)
}

/**
 * `collapsed` 只影响提交/预览的落点，不驱动过渡：显隐动画由面板宿主负责，
 * 因此它不进入 effect 依赖，避免把入场/离场动画打成瞬间跳变。
 */
export function useLiveResizeValue(committedSize: number, collapsed = false): LiveResizeValue {
  const committedSizeRef = useRef(committedSize)
  const collapsedRef = useRef(collapsed)
  const previewingRef = useRef(false)
  const initialSize = normalizeLiveResizeSize(committedSize)
  const liveSize = useMotionValue(initialSize)
  const liveSizePixels = useMotionTemplate`${liveSize}px`

  collapsedRef.current = collapsed

  useLayoutEffect(() => {
    const normalizedSize = normalizeLiveResizeSize(committedSize)
    committedSizeRef.current = normalizedSize
    const target = resolveLiveResizeTarget(normalizedSize, collapsedRef.current)
    if (!previewingRef.current && liveSize.get() !== target) {
      liveSize.set(target)
    }
  }, [committedSize, liveSize])

  const previewSize = useCallback(
    (nextSize: number | null): void => {
      if (collapsedRef.current) {
        previewingRef.current = false
        if (liveSize.get() !== 0) liveSize.set(0)
        return
      }
      if (nextSize === null) {
        if (!previewingRef.current) return
        previewingRef.current = false
        const committed = committedSizeRef.current
        if (liveSize.get() !== committed) liveSize.set(committed)
        return
      }

      previewingRef.current = true
      const normalizedSize = normalizeLiveResizeSize(nextSize)
      if (liveSize.get() !== normalizedSize) liveSize.set(normalizedSize)
    },
    [liveSize],
  )

  return {
    liveSize,
    liveSizePixels,
    previewSize,
  }
}
