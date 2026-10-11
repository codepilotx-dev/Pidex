import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopPageZoomAction, DesktopPageZoomState } from '@pidex/shared/desktop-window-ipc'
import { Minus, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { usePrefersReducedMotion } from '../hooks/UsePrefersReducedMotion.js'
import { enterTween, exitTween, motionTransition } from '../features/motion/MotionTransitions.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './ui/IconTokens.js'
import { Button } from './ui/Button.js'

import { Toast, ToastDivider } from './ui/Toast.js'

const HIDE_DELAY_MS = 2_000

export function PageZoomCapsule(): React.ReactNode {
  const bridge = window.DesktopBridge
  const reducedMotion = usePrefersReducedMotion()
  const [state, setState] = useState<DesktopPageZoomState | null>(null)
  const [visible, setVisible] = useState(false)
  const hideTimerRef = useRef<number | null>(null)
  const hoveredRef = useRef(false)
  const focusedRef = useRef(false)

  const clearHideTimer = useCallback((): void => {
    if (hideTimerRef.current === null) return
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
  }, [])

  const scheduleHide = useCallback((): void => {
    clearHideTimer()
    if (hoveredRef.current || focusedRef.current) return
    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false)
      hideTimerRef.current = null
    }, HIDE_DELAY_MS)
  }, [clearHideTimer])

  useEffect(() => {
    if (!bridge?.getPageZoom || !bridge.onPageZoomChanged) return
    let mounted = true
    let changed = false
    const unsubscribe = bridge.onPageZoomChanged((next) => {
      changed = true
      setState(next)
      setVisible(true)
      scheduleHide()
    })
    void bridge.getPageZoom().then((next) => {
      if (mounted && !changed) setState(next)
    })
    return () => {
      mounted = false
      unsubscribe()
      clearHideTimer()
    }
  }, [bridge, clearHideTimer, scheduleHide])

  if (!bridge?.changePageZoom || !state) return null

  const changeZoom = (action: DesktopPageZoomAction): void => {
    void bridge.changePageZoom(action)
  }

  const resumeHide = (): void => {
    scheduleHide()
  }

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="page-zoom-capsule"
          exit={{
            opacity: 0,
            y: -4,
            transition: motionTransition(reducedMotion, exitTween),
          }}
          initial={reducedMotion ? false : { opacity: 0, y: -4 }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              focusedRef.current = false
              resumeHide()
            }
          }}
          onFocus={() => {
            focusedRef.current = true
            clearHideTimer()
          }}
          onPointerEnter={() => {
            hoveredRef.current = true
            clearHideTimer()
          }}
          onPointerLeave={() => {
            hoveredRef.current = false
            resumeHide()
          }}
          transition={motionTransition(reducedMotion, enterTween)}
        >
          <Toast>
            <output aria-live="polite" className="tw:contents">
              <strong>{state.percent}%</strong>
              <Button
                isIconOnly
                color="ghostSecondary"
                disabled={!state.canZoomOut}
                onClick={() => changeZoom('out')}
                size="toolbar"
                title="缩小页面"
              >
                <Minus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </Button>
              <Button
                isIconOnly
                color="ghostSecondary"
                disabled={!state.canZoomIn}
                onClick={() => changeZoom('in')}
                size="toolbar"
                title="放大页面"
              >
                <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </Button>
              <ToastDivider />
              <Button
                color="ghostSecondary"
                disabled={state.percent === 100}
                onClick={() => changeZoom('reset')}
                size="toolbarLabel"
              >
                重置
              </Button>
            </output>
          </Toast>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
