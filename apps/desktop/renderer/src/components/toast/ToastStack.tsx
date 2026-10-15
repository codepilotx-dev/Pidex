import type React from 'react'
import { useSyncExternalStore, useState, useRef, useLayoutEffect, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CheckCheck, CircleAlert, X } from 'lucide-react'
import { toastStore, calculateCardTransform, type ToastItem } from './ToastState.js'
import { usePrefersReducedMotion } from '../../hooks/UsePrefersReducedMotion.js'
import { Button } from '../ui/Button.js'

import { Toast } from '../ui/Toast.js'
import { ToastContent } from './ToastContent.js'

export function ToastStack(): React.ReactNode {
  const state = useSyncExternalStore(toastStore.subscribe, toastStore.getState, toastStore.getState)
  const reducedMotion = usePrefersReducedMotion()
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [isBtnHovered, setIsBtnHovered] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const isExpanded = state.isHovered && state.toasts.length > 1
  const heightArray = state.toasts.map((t) => heights[t.id] ?? 40)

  let totalExpandedHeight = 0
  for (let i = 0; i < state.toasts.length; i++) {
    totalExpandedHeight += (heightArray[i] ?? 40) + (i < state.toasts.length - 1 ? 8 : 0)
  }

  // 折叠状态下高度：顶部卡片高度 + 24px 露出余量
  const collapsedHeight = (heightArray[0] ?? 40) + 24

  const topToastId = state.toasts[0]?.id
  const topToastHeight = topToastId ? (heights[topToastId] ?? 40) : 40

  if (state.toasts.length === 0) {
    return null
  }

  return (
    <div
      ref={containerRef}
      className={`toast-stack-container tw:absolute tw:top-2 tw:left-1/2 tw:z-toast tw:-translate-x-1/2 tw:w-[min(420px,calc(100%-1rem))] tw:transition-all ${
        isExpanded
          ? 'tw:pointer-events-auto tw:overflow-visible tw:py-0.5 tw:px-0.5'
          : 'tw:pointer-events-none tw:overflow-visible'
      }`}
      style={isExpanded ? undefined : { height: collapsedHeight }}
      onMouseEnter={() => toastStore.setHovered(true)}
      onMouseLeave={() => {
        toastStore.setHovered(false)
        setIsBtnHovered(false)
      }}
    >
      {/* 始终与最顶层消息垂直居中对齐的 companion 徽章按钮（当存在多条消息时显示） */}
      <div
        className="toast-stack-badge-anchor tw:absolute tw:left-[calc(100%+8px)] tw:top-0 tw:flex tw:items-center tw:pointer-events-none tw:z-toast tw:transition-[height] tw:duration-150"
        style={{ height: topToastHeight }}
      >
        <AnimatePresence>
          {state.toasts.length > 1 ? (
            <motion.button
              type="button"
              title="全部标记为已读"
              aria-label="全部标记为已读"
              initial={reducedMotion ? false : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reducedMotion ? undefined : { opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              className="toast-stack-badge-btn tw:pointer-events-auto tw:h-10 tw:min-w-10 tw:px-2.5 tw:rounded-[var(--cpx-sys-radius-xl)] tw:border tw:border-app-border-subtle tw:bg-app-glass tw:backdrop-blur-[18px] tw:shadow-lg tw:flex tw:items-center tw:justify-center tw:cursor-pointer tw:select-none tw:hover:border-app-border tw:hover:bg-app-hover tw:transition-colors tw:[-webkit-app-region:no-drag] tw:before:absolute tw:before:-left-2 tw:before:top-0 tw:before:w-2 tw:before:h-full tw:before:content-['']"
              onClick={(e) => {
                e.stopPropagation()
                toastStore.dismissAll()
              }}
              onMouseEnter={() => {
                setIsBtnHovered(true)
                toastStore.setHovered(true)
              }}
              onMouseLeave={() => {
                setIsBtnHovered(false)
              }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isBtnHovered ? (
                  <motion.span
                    key="check"
                    initial={reducedMotion ? false : { opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reducedMotion ? undefined : { opacity: 0, scale: 0.7 }}
                    transition={{ duration: 0.12 }}
                    className="tw:flex tw:items-center tw:justify-center tw:text-app-text"
                  >
                    <CheckCheck className="tw:w-4 tw:h-4" />
                  </motion.span>
                ) : (
                  <motion.span
                    key="count"
                    initial={reducedMotion ? false : { opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reducedMotion ? undefined : { opacity: 0, scale: 0.7 }}
                    transition={{ duration: 0.12 }}
                    className="tw:type-label tw:text-app-text"
                  >
                    {state.toasts.length}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          ) : null}
        </AnimatePresence>
      </div>

      {/* 卡片列表 */}
      <div
        className="toast-stack-body tw:relative tw:w-full"
        style={{ height: totalExpandedHeight }}
      >
        <AnimatePresence initial={false}>
          {state.toasts.map((toast, index) => {
            const transform = calculateCardTransform(index, isExpanded, heightArray, 8, 0)

            return (
              <ToastCardWrapper
                key={toast.id}
                toast={toast}
                transform={transform}
                isExpanded={isExpanded}
                reducedMotion={reducedMotion}
                onHeightChange={(h) => {
                  setHeights((prev) => (prev[toast.id] === h ? prev : { ...prev, [toast.id]: h }))
                }}
              />
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}

function ToastCardWrapper({
  toast,
  transform,
  isExpanded,
  reducedMotion,
  onHeightChange,
}: {
  toast: ToastItem
  transform: ReturnType<typeof calculateCardTransform>
  isExpanded: boolean
  reducedMotion: boolean
  onHeightChange: (height: number) => void
}): React.ReactNode {
  const cardRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (cardRef.current) {
      onHeightChange(cardRef.current.offsetHeight)
    }
  })

  useEffect(() => {
    if (!cardRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === cardRef.current) {
          onHeightChange(cardRef.current.offsetHeight)
        }
      }
    })
    ro.observe(cardRef.current)
    return () => ro.disconnect()
  }, [onHeightChange])

  const isError = toast.tone === 'error'

  return (
    <motion.div
      ref={cardRef}
      className="toast-card-wrapper tw:absolute tw:left-0 tw:right-0 tw:w-full tw:flex tw:justify-center"
      style={{
        zIndex: transform.zIndex,
        pointerEvents: transform.pointerEvents,
      }}
      onMouseEnter={() => toastStore.setHovered(true)}
      animate={{
        y: transform.y,
        scale: transform.scale,
        opacity: transform.opacity,
      }}
      initial={
        reducedMotion
          ? false
          : {
              y: transform.y - 8,
              scale: 0.95,
              opacity: 0,
            }
      }
      exit={
        reducedMotion
          ? undefined
          : {
              opacity: 0,
              scale: 0.9,
              y: transform.y - 8,
              transition: { duration: 0.15 },
            }
      }
      transition={reducedMotion ? { duration: 0 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <Toast
        appearance={toast.appearance}
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        className={`toast-card tw:justify-between tw:max-h-[min(70vh,520px)] ${toast.appearance === 'action' ? 'tw:w-fit tw:max-w-full tw:mx-auto' : 'tw:w-full'}`}
      >
        {isError ? (
          <CircleAlert aria-hidden="true" className="tw:mt-1 tw:size-4 tw:shrink-0 tw:self-start tw:text-app-danger-fg" />
        ) : null}
        <ToastContent message={toast.message} isError={isError} />

        <div className="toast-actions tw:flex tw:items-center tw:gap-1.5 tw:shrink-0 tw:self-start">
          {toast.action ? (
            <Button
              variant={toast.appearance === 'action' ? 'secondary' : 'ghost'}
              size={toast.appearance === 'action' ? 'sm' : 'compact'}
              disabled={toast.action.disabled}
              onClick={toast.action.onClick}
              type="button"
            >
              {toast.action.label}
            </Button>
          ) : null}

          {toast.secondaryAction ? (
            <Button
              variant={toast.appearance === 'action' ? 'primary' : 'ghost'}
              size={toast.appearance === 'action' ? 'sm' : 'compact'}
              disabled={toast.secondaryAction.disabled}
              onClick={toast.secondaryAction.onClick}
              type="button"
            >
              {toast.secondaryAction.label}
            </Button>
          ) : null}

          {toast.showCloseButton !== false ? (
            <Button
              isIconOnly
              color="ghostSecondary"
              size={toast.appearance === 'action' ? 'sm' : 'compact'}
              title={isError ? '关闭错误提示' : '关闭'}
              aria-label={isError ? '关闭错误提示' : '关闭'}
              onClick={() => toastStore.dismiss(toast.id)}
              type="button"
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </Toast>
    </motion.div>
  )
}
