/**
 * Toast stack interaction inspired by Bencho (https://bencho.dev)
 *
 * MIT License
 * Copyright (c) 2026 Lorenzo Cabra
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * ── Toast stack ──────────────────────────────────────────
 * The newest toast in front at the bottom, earlier toasts tucked behind
 * with a sliver showing above it, a step smaller each and a subtle paper tone.
 * Point at or focus into the frame and it fans out into a list upwards;
 * move away and it gathers back down.
 *
 * ── ONE SPRING, THREE PLACES ─────────────────────────────
 * Every toast heads for its place on the same spring, a touch under
 * critical so it settles with a hint of give.
 *
 * ── HOVER & FOCUS THE WHOLE FRAME ────────────────────────
 * The frame reserves the full expanded list's size. Hovering or focusing
 * anywhere in the frame keeps the stack open across gaps between cards.
 */

import type React from 'react'
import { useStore } from 'zustand/react'
import { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CircleX, CircleCheck, Info, X } from 'lucide-react'
import {
  toastStore,
  calculateCardTransform,
  toastExpiryDelayMs,
  type ToastItem,
  type ToastCardTransform,
} from './ToastState.js'
import { usePrefersReducedMotion } from '../../hooks/UsePrefersReducedMotion.js'
import { Button } from '../ui/Button.js'
import { ToastContent } from './ToastContent.js'

/* a touch under critical: it settles with a hint of give, no wobble */
const SPRING = { type: 'spring', stiffness: 380, damping: 34, mass: 1 } as const
const GAP = 4
const PEEK = 10

export function ToastStack(): React.ReactNode {
  const toasts = useStore(toastStore, (state) => state.toasts)
  const reducedMotion = usePrefersReducedMotion()
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const isExpanded = (isHovered || isFocused) && toasts.length > 1
  const heightArray = toasts.map((t) => heights[t.id] ?? 64)

  let totalExpandedHeight = 0
  for (let i = 0; i < toasts.length; i++) {
    totalExpandedHeight += (heightArray[i] ?? 64) + (i < toasts.length - 1 ? GAP : 0)
  }

  const handleHeightChange = useCallback((id: string, h: number) => {
    setHeights((prev) => (prev[id] === h ? prev : { ...prev, [id]: h }))
  }, [])

  useLayoutEffect(() => {
    if (!containerRef.current) return
    const isOver = isExpanded && totalExpandedHeight > containerRef.current.clientHeight
    setIsOverflowing(isOver)
    if (isOver && isExpanded) {
      containerRef.current.scrollTop =
        containerRef.current.scrollHeight - containerRef.current.clientHeight
    }
  }, [isExpanded, totalExpandedHeight])

  if (toasts.length === 0) {
    return null
  }

  return (
    <div
      ref={containerRef}
      data-open={isExpanded || undefined}
      className={`tst toast-stack-container tw:absolute tw:top-2 tw:left-1/2 tw:z-toast tw:-translate-x-1/2 tw:w-[min(300px,calc(100%-1rem))] tw:max-h-[min(calc(100vh-2rem),720px)] tw:[-webkit-app-region:no-drag] ${
        isOverflowing ? 'tw:overflow-y-auto tw:overflow-x-hidden' : 'tw:overflow-visible'
      }`}
      style={{
        height: totalExpandedHeight,
      }}
      role="region"
      aria-label="通知列表"
      onPointerOver={() => {
        setIsHovered(true)
        toastStore.setHovered(true)
      }}
      onPointerOut={(e) => {
        const to = e.relatedTarget as Node | null
        if (!to || !containerRef.current?.contains(to)) {
          setIsHovered(false)
          toastStore.setHovered(false)
        }
      }}
      onFocus={() => {
        setIsFocused(true)
        toastStore.setHovered(true)
      }}
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null
        if (!to || !containerRef.current?.contains(to)) {
          setIsFocused(false)
          toastStore.setHovered(false)
        }
      }}
    >
      <div
        className="toast-stack-body tw:relative tw:w-full"
        style={{ height: totalExpandedHeight }}
      >
        <AnimatePresence initial={false}>
          {toasts.map((toastItem, index) => {
            const transform = calculateCardTransform(index, isExpanded, heightArray, GAP, PEEK)

            return (
              <ToastCardWrapper
                key={toastItem.id}
                toast={toastItem}
                index={index}
                transform={transform}
                isExpanded={isExpanded}
                reducedMotion={reducedMotion}
                onHeightChange={handleHeightChange}
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
  index,
  transform,
  isExpanded,
  reducedMotion,
  onHeightChange,
}: {
  toast: ToastItem
  index: number
  transform: ToastCardTransform
  isExpanded: boolean
  reducedMotion: boolean
  onHeightChange: (id: string, height: number) => void
}): React.ReactNode {
  const cardRef = useRef<HTMLDivElement>(null)
  const { expiresAt } = toast
  const front = index === 0

  /**
   * 带动作期限的提示到点后必须禁用动作：期限是服务端事实，
   * 不因多条通知或悬停暂停而延长，避免过期后点击才失败。
   */
  const [expired, setExpired] = useState(() => toastExpiryDelayMs(expiresAt) === 0)

  useEffect(() => {
    const delay = toastExpiryDelayMs(expiresAt)
    if (delay === undefined) return
    if (delay === 0) {
      setExpired(true)
      return
    }
    setExpired(false)
    const timer = setTimeout(() => setExpired(true), delay)
    return () => clearTimeout(timer)
  }, [expiresAt])

  useLayoutEffect(() => {
    if (cardRef.current) {
      onHeightChange(toast.id, cardRef.current.offsetHeight)
    }
  }, [toast.id, onHeightChange])

  useEffect(() => {
    if (!cardRef.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === cardRef.current) {
          onHeightChange(toast.id, cardRef.current.offsetHeight)
        }
      }
    })
    ro.observe(cardRef.current)
    return () => ro.disconnect()
  }, [toast.id, onHeightChange])

  const isError = toast.tone === 'error'
  const isStatus = toast.tone === 'status'

  // 折叠时后层内容对键盘隐藏，避免操作被遮挡的按钮；同时保留整卡可访问播报语义
  const isInteractive = isExpanded || front

  return (
    <motion.div
      ref={cardRef}
      className="toast-card-wrapper tw:absolute tw:top-0 tw:left-0 tw:right-0 tw:w-full"
      style={{
        zIndex: transform.zIndex,
        pointerEvents: transform.pointerEvents,
        transformOrigin: '50% 0',
      }}
      animate={{
        y: transform.y,
        scale: transform.scale,
        opacity: transform.opacity,
        x: 0,
      }}
      initial={
        reducedMotion
          ? false
          : {
              y: transform.y + 24,
              scale: 1,
              opacity: 0,
              x: 0,
            }
      }
      exit={
        reducedMotion
          ? { opacity: 0 }
          : {
              opacity: 0,
              scale: transform.scale,
              x: 60,
              y: transform.y,
              transition: { duration: 0.22, ease: [0.4, 0, 1, 1] },
            }
      }
      transition={reducedMotion ? { duration: 0 } : SPRING}
    >
      <div
        className="tst-toast"
        data-front={front || undefined}
        data-kind={isStatus ? 'success' : toast.tone}
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
      >
        <div className="tst-content" inert={!isInteractive}>
          <span className="tst-icon">
            {isError ? <CircleX size={18} strokeWidth={2} aria-hidden="true" />
              : isStatus ? <CircleCheck size={18} strokeWidth={2} aria-hidden="true" />
                : <Info size={18} strokeWidth={2} aria-hidden="true" />}
          </span>

          <ToastContent message={toast.message} description={toast.description} isError={isError} />

          <div className="toast-actions tw:flex tw:items-center tw:gap-1 tw:shrink-0">
            {toast.action ? (
              <Button
                variant="ghost"
                size="sm"
                shape="pill"
                className="tst-act"
                disabled={toast.action.disabled || expired}
                tabIndex={isInteractive ? 0 : -1}
                onClick={toast.action.onClick}
                type="button"
              >
                {toast.action.label}
              </Button>
            ) : null}

            {toast.secondaryAction ? (
              <Button
                variant="ghost"
                size="sm"
                shape="pill"
                className="tst-act"
                disabled={toast.secondaryAction.disabled || expired}
                tabIndex={isInteractive ? 0 : -1}
                onClick={toast.secondaryAction.onClick}
                type="button"
              >
                {toast.secondaryAction.label}
              </Button>
            ) : null}

            {toast.showCloseButton !== false ? (
              <button
                className="tst-x"
                title={isError ? '关闭错误提示' : '关闭'}
                aria-label={isError ? '关闭错误提示' : '关闭'}
                tabIndex={isInteractive ? 0 : -1}
                onClick={() => toastStore.dismiss(toast.id)}
                type="button"
              >
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
