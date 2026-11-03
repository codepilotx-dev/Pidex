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
 * The frame reserves at most three toasts' height; older toasts scroll inside. Hovering or focusing
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
import { containsRelatedTarget } from '../../utils/DomTargets.js'
import { ToastContent } from './ToastContent.js'
import { ToastDetailsDialog } from './ToastDetailsDialog.js'

/* a touch under critical: it settles with a hint of give, no wobble */
const SPRING = { type: 'spring', stiffness: 380, damping: 34, mass: 1 } as const
const GAP = 4
const PEEK = 10

export function ToastStack({
  store = toastStore,
  embedded = false,
}: {
  store?: typeof toastStore
  embedded?: boolean
} = {}): React.ReactNode {
  const toasts = useStore(store, (state) => state.toasts)
  const reducedMotion = usePrefersReducedMotion()
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [details, setDetails] = useState<Pick<ToastItem, 'message' | 'details'> | null>(null)
  const [fadeTop, setFadeTop] = useState(false)
  const [fadeBottom, setFadeBottom] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    // 删除聚焦的通知按钮不一定触发 blur，不能让旧焦点把后续通知永久展开。
    if (!containsRelatedTarget(containerRef.current, containerRef.current?.ownerDocument.activeElement ?? null)) {
      setIsFocused(false)
    }
    if (toasts.length === 0) {
      setIsHovered(false)
      store.setHovered(false)
    }
  }, [toasts, store])

  const isExpanded = (isHovered || isFocused) && toasts.length > 1
  const heightArray = toasts.map((t) => heights[t.id] ?? 52)

  let totalExpandedHeight = 0
  for (let i = 0; i < toasts.length; i++) {
    totalExpandedHeight += (heightArray[i] ?? 52) + (i < toasts.length - 1 ? GAP : 0)
  }

  const visibleHeights = heightArray.slice(0, 3)
  const viewportHeight = visibleHeights.reduce((sum, height) => sum + height, 0)
    + Math.max(0, visibleHeights.length - 1) * GAP

  const updateScrollEdges = useCallback(() => {
    const node = containerRef.current
    if (!node) return
    setFadeTop(node.scrollTop > 1)
    setFadeBottom(node.scrollTop + node.clientHeight < node.scrollHeight - 1)
  }, [])

  const handleHeightChange = useCallback((id: string, h: number) => {
    setHeights((prev) => (prev[id] === h ? prev : { ...prev, [id]: h }))
  }, [])

  useLayoutEffect(() => {
    if (!containerRef.current) return
    const isOver = isExpanded && totalExpandedHeight > containerRef.current.clientHeight
    setIsOverflowing(isOver)
    if (isExpanded) {
      containerRef.current.scrollTop =
        containerRef.current.scrollHeight - containerRef.current.clientHeight
    } else {
      containerRef.current.scrollTop = 0
    }
    updateScrollEdges()
  }, [isExpanded, isOverflowing, totalExpandedHeight, viewportHeight, toasts[0]?.id, updateScrollEdges])

  return (
    <>
    {toasts.length > 0 ? <div
      ref={containerRef}
      data-open={isExpanded || undefined}
      data-scrollable={isOverflowing || undefined}
      data-fade-top={(isOverflowing && fadeTop) || undefined}
      data-fade-bottom={(isOverflowing && fadeBottom) || undefined}
      onScroll={updateScrollEdges}
      className={`tst toast-stack-container ${embedded ? 'tw:relative' : 'tw:absolute tw:top-2 tw:left-1/2 tw:-translate-x-1/2'} tw:z-toast tw:w-[min(420px,calc(100%-1rem))] tw:max-h-[min(calc(100vh-2rem),720px)] tw:[-webkit-app-region:no-drag] ${
        isOverflowing ? 'tw:overflow-y-auto tw:overflow-x-hidden' : 'tw:overflow-visible'
      }`}
      style={{
        height: viewportHeight,
      }}
      role="region"
      aria-label="通知列表"
      onPointerOver={() => {
        setIsHovered(true)
        store.setHovered(true)
      }}
      onPointerOut={(e) => {
        if (!containsRelatedTarget(containerRef.current, e.relatedTarget)) {
          setIsHovered(false)
          store.setHovered(false)
        }
      }}
      onFocus={() => {
        setIsFocused(true)
        store.setHovered(true)
      }}
      onBlur={(e) => {
        if (!containsRelatedTarget(containerRef.current, e.relatedTarget)) {
          setIsFocused(false)
          store.setHovered(false)
        }
      }}
    >
      <div
        className="toast-stack-body tw:relative tw:w-full"
        style={{ height: isExpanded ? totalExpandedHeight : viewportHeight }}
      >
        <AnimatePresence initial={false}>
          {toasts.map((toastItem, index) => {
            const transform = calculateCardTransform(index, isExpanded, heightArray, GAP, PEEK, isExpanded ? undefined : viewportHeight)

            return (
              <ToastCardWrapper
                key={toastItem.id}
                toast={toastItem}
                index={index}
                transform={transform}
                isExpanded={isExpanded}
                reducedMotion={reducedMotion}
                onHeightChange={handleHeightChange}
                onDismiss={() => store.dismiss(toastItem.id)}
                onActivate={() => {
                  void store.activate(toastItem.id, setDetails).catch((error: unknown) => {
                    window.dispatchEvent(new CustomEvent('desktop:error', { detail: error }))
                  })
                }}
              />
            )
          })}
        </AnimatePresence>
      </div>
    </div> : null}
    <ToastDetailsDialog notice={details} onClose={() => setDetails(null)} />
    </>
  )
}

function ToastCardWrapper({
  toast,
  index,
  transform,
  isExpanded,
  reducedMotion,
  onHeightChange,
  onDismiss,
  onActivate,
}: {
  toast: ToastItem
  index: number
  transform: ToastCardTransform
  isExpanded: boolean
  reducedMotion: boolean
  onHeightChange: (id: string, height: number) => void
  onDismiss: () => void
  onActivate: () => void
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
  const icon = toast.icon === undefined
    ? isError ? <CircleX size={18} strokeWidth={2} aria-hidden="true" />
      : isStatus ? <CircleCheck size={18} strokeWidth={2} aria-hidden="true" />
        : <Info size={18} strokeWidth={2} aria-hidden="true" />
    : toast.icon

  // 折叠时后层内容对键盘隐藏，避免操作被遮挡的按钮；同时保留整卡可访问播报语义
  const isInteractive = isExpanded || front

  return (
    <motion.div
      ref={cardRef}
      className="toast-card-wrapper tw:absolute tw:top-0 tw:left-0 tw:right-0 tw:flex tw:w-full tw:justify-center"
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
          {icon != null && icon !== false ? (
            <span className="tst-icon" data-custom={toast.icon !== undefined || undefined} aria-hidden="true">{icon}</span>
          ) : null}

          {toast.onActivate || toast.details != null ? (
            <button type="button" className="tst-message" onClick={onActivate} tabIndex={isInteractive ? 0 : -1}>
              <ToastContent message={toast.message} />
            </button>
          ) : <ToastContent message={toast.message} />}

          <div className="toast-actions tw:flex tw:items-center tw:gap-1 tw:shrink-0">
            <div className="tw:flex tw:items-center tw:gap-1" inert={expired}>
              {toast.actions !== undefined ? toast.actions : [toast.action, toast.secondaryAction].map((action, index) => action ? (
                <Button
                  key={index}
                  variant="ghost"
                  size="sm"
                  shape="pill"
                  className="tst-act"
                  disabled={action.disabled || expired}
                  tabIndex={isInteractive ? 0 : -1}
                  onClick={action.onClick}
                  type="button"
                >
                  {action.label}
                </Button>
              ) : null)}
            </div>

            {toast.showCloseButton !== false ? (
              <button
                className="tst-x"
                title={isError ? '关闭错误提示' : '关闭'}
                aria-label={isError ? '关闭错误提示' : '关闭'}
                tabIndex={isInteractive ? 0 : -1}
                onClick={onDismiss}
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
