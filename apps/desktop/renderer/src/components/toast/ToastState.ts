import type React from 'react'

export type ToastTone = 'error' | 'status' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void | Promise<void>
  disabled?: boolean
}

export interface ToastItem {
  id: string
  appearance?: 'action'
  tone: ToastTone
  message: React.ReactNode
  textKey: string
  timestamp: number
  duration: number
  onDismiss?: () => void
  action?: ToastAction
  secondaryAction?: ToastAction
  showCloseButton?: boolean
}

export interface ShowToastOptions {
  id?: string
  appearance?: 'action'
  tone?: ToastTone
  message: React.ReactNode
  duration?: number
  onDismiss?: () => void
  action?: ToastAction
  secondaryAction?: ToastAction
  showCloseButton?: boolean
  dedupeKey?: string
}

export const MAX_TOASTS = 5
export const DEFAULT_DURATION_MS = 5000
export const DEDUPE_WINDOW_MS = 1000

export interface ToastStoreState {
  toasts: ToastItem[]
  isHovered: boolean
}

export interface ToastCardTransform {
  y: number
  scale: number
  zIndex: number
  opacity: number
  pointerEvents: 'auto' | 'none'
}

/**
 * 计算 Toast 卡片在层叠或展开状态下的视觉定位与缩放
 * @param index 卡片在队列中的索引（0 为最新一条）
 * @param isExpanded 是否处于展开状态（例如鼠标悬停）
 * @param heights 各卡片的测量高度数组
 * @param gap 展开时的卡片垂直间距，默认 8px
 * @param headerHeight 展开状态下顶部偏移高度，默认 0px
 */
export function calculateCardTransform(
  index: number,
  isExpanded: boolean,
  heights: number[] = [],
  gap = 8,
  headerHeight = 0,
): ToastCardTransform {
  if (!isExpanded) {
    if (index === 0) {
      return { y: 0, scale: 1, zIndex: 50, opacity: 1, pointerEvents: 'auto' }
    }
    if (index === 1) {
      return { y: 10, scale: 0.95, zIndex: 49, opacity: 0.9, pointerEvents: 'auto' }
    }
    if (index === 2) {
      return { y: 20, scale: 0.9, zIndex: 48, opacity: 0.75, pointerEvents: 'auto' }
    }
    return {
      y: 20,
      scale: 0.85,
      zIndex: Math.max(1, 47 - index),
      opacity: 0,
      pointerEvents: 'none',
    }
  }

  // 展开状态：计算前置卡片高度累加
  let y = headerHeight
  for (let i = 0; i < index; i++) {
    const cardHeight = heights[i] ?? 44
    y += cardHeight + gap
  }

  return {
    y,
    scale: 1,
    zIndex: Math.max(1, 50 - index),
    opacity: 1,
    pointerEvents: 'auto',
  }
}

export function createToastStore(options?: {
  defaultDurationMs?: number
  maxToasts?: number
  dedupeWindowMs?: number
}) {
  const defaultDuration = options?.defaultDurationMs ?? DEFAULT_DURATION_MS
  const maxToasts = options?.maxToasts ?? MAX_TOASTS
  const dedupeWindow = options?.dedupeWindowMs ?? DEDUPE_WINDOW_MS

  let state: ToastStoreState = {
    toasts: [],
    isHovered: false,
  }

  const listeners = new Set<() => void>()
  let dismissTimer: ReturnType<typeof setTimeout> | null = null

  function notify(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  function clearTimer(): void {
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer)
      dismissTimer = null
    }
  }

  function syncTimer(): void {
    clearTimer()
    // 规则 1：当存活的 Toast 数量 > 1 时，立即取消/冻结自动消失
    if (state.toasts.length > 1) {
      return
    }

    // 规则 2：当存活的 Toast 仅剩 1 条时，在非悬停状态下启动 5 秒倒计时
    if (state.toasts.length === 1 && !state.isHovered) {
      const singleToast = state.toasts[0]
      if (!singleToast) return
      const duration = singleToast.duration || defaultDuration
      dismissTimer = setTimeout(() => {
        dismiss(singleToast.id)
      }, duration)
    }
  }

  function show(toastOptions: ShowToastOptions): string {
    const tone = toastOptions.tone ?? 'error'
    const textKey =
      toastOptions.dedupeKey ??
      (typeof toastOptions.message === 'string'
        ? toastOptions.message
        : String(toastOptions.id ?? ''))
    const now = Date.now()

    // 规则 3：相同内容去重（短时间窗口内更新现有条目，不重复入栈）
    if (textKey) {
      const existingIndex = state.toasts.findIndex(
        (t) => t.tone === tone && t.textKey === textKey && now - t.timestamp < dedupeWindow,
      )
      if (existingIndex >= 0) {
        const updated = [...state.toasts]
        const existing = updated[existingIndex]!
        updated[existingIndex] = {
          ...existing,
          timestamp: now,
          message: toastOptions.message,
          appearance: toastOptions.appearance,
          action: toastOptions.action,
          secondaryAction: toastOptions.secondaryAction,
        }
        state = { ...state, toasts: updated }
        notify()
        syncTimer()
        return existing.id
      }
    }

    const id = toastOptions.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const existingByIdIndex = state.toasts.findIndex((t) => t.id === id)
    const newItem: ToastItem = {
      id,
      appearance: toastOptions.appearance,
      tone,
      message: toastOptions.message,
      textKey,
      timestamp: now,
      duration: toastOptions.duration ?? defaultDuration,
      onDismiss: toastOptions.onDismiss,
      action: toastOptions.action,
      secondaryAction: toastOptions.secondaryAction,
      showCloseButton: toastOptions.showCloseButton ?? true,
    }

    let nextToasts: ToastItem[]
    if (existingByIdIndex >= 0) {
      nextToasts = [...state.toasts]
      nextToasts[existingByIdIndex] = newItem
    } else {
      nextToasts = [newItem, ...state.toasts]
      // 规则 4：最多保留 maxToasts 条（默认 5 条）
      if (nextToasts.length > maxToasts) {
        const removed = nextToasts.pop()
        removed?.onDismiss?.()
      }
    }

    state = { ...state, toasts: nextToasts }
    notify()
    syncTimer()
    return id
  }

  function dismiss(id: string): void {
    const item = state.toasts.find((t) => t.id === id)
    if (!item) return
    item.onDismiss?.()
    state = {
      ...state,
      toasts: state.toasts.filter((t) => t.id !== id),
    }
    notify()
    syncTimer()
  }

  function dismissAll(): void {
    const current = [...state.toasts]
    state = { ...state, toasts: [] }
    for (const item of current) {
      item.onDismiss?.()
    }
    notify()
    syncTimer()
  }

  function setHovered(hovered: boolean): void {
    if (state.isHovered === hovered) return
    state = { ...state, isHovered: hovered }
    notify()
    syncTimer()
  }

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    show,
    dismiss,
    dismissAll,
    setHovered,
    _clearTimer: clearTimer,
  }
}

export const toastStore = createToastStore()

export const toast = {
  show: (options: ShowToastOptions) => toastStore.show(options),
  error: (message: React.ReactNode, options?: Omit<ShowToastOptions, 'message' | 'tone'>) =>
    toastStore.show({ tone: 'error', message, ...options }),
  status: (message: React.ReactNode, options?: Omit<ShowToastOptions, 'message' | 'tone'>) =>
    toastStore.show({ tone: 'status', message, ...options }),
  notice: (message: React.ReactNode, options?: Omit<ShowToastOptions, 'message' | 'tone'>) =>
    toastStore.show({ tone: 'status', message, ...options }),
  dismiss: (id: string) => toastStore.dismiss(id),
  dismissAll: () => toastStore.dismissAll(),
}
