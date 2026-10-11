import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { swapStatusText } from '../../startup/StatusTextSwap.js'

export type FullScreenWhaleLoadingProps = {
  label: string
  variant?: 'fullscreen' | 'contained'
}

/**
 * 唯一的 Renderer 品牌加载组件：与 index.html 静态启动遮罩共用
 * `.full-screen-whale-loader` DOM/CSS 契约（56px 主标、2200ms 扫光、单行
 * 状态窗）。
 * - `variant="fullscreen"`：整窗 fixed 覆盖（用于启动开屏与 Setup 页面）
 * - `variant="contained"`：会话主区域容器化居中加载（不遮挡侧边栏与面板）
 * 文案只随真实加载阶段变化，旧文案上滑、新文案从下方滑入；
 * 快速连续更新合并到最新状态，reduced-motion 下直接替换。
 */
export function FullScreenWhaleLoading({
  label,
  variant = 'fullscreen',
}: FullScreenWhaleLoadingProps): React.ReactNode {
  const statusRef = useRef<HTMLSpanElement | null>(null)
  const latestLabelRef = useRef(label)
  const [displayedLabel, setDisplayedLabel] = useState(label)

  latestLabelRef.current = label

  useEffect(() => {
    if (displayedLabel === label) return
    const element = statusRef.current
    if (!element) return
    swapStatusText(element, label, () => {
      setDisplayedLabel(latestLabelRef.current)
    })
  }, [displayedLabel, label])

  const isContained = variant === 'contained'
  const rootClassName = isContained
    ? 'full-screen-whale-loader full-screen-whale-loader--contained'
    : 'full-screen-whale-loader'

  return (
    <main
      className={rootClassName}
      data-full-screen-loading={!isContained ? 'true' : undefined}
      data-loading-variant={variant}
      data-loading-label={label}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy="true"
    >
      <div className="full-screen-whale-loader__content">
        <div className="full-screen-whale-loader__logo" aria-hidden="true">
          <img className="full-screen-whale-loader__base" src="/pidex-mark-green.svg" alt="" />
          <div className="full-screen-whale-loader__overlay" />
        </div>
        <div className="full-screen-whale-loader__status-viewport">
          <span ref={statusRef}>{displayedLabel}</span>
        </div>
      </div>
    </main>
  )
}
