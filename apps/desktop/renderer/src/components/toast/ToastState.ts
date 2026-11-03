import type React from 'react'
import { createStore } from 'zustand/vanilla'
import { toUserErrorMessage } from '../../utils/Errors.js'

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
  details?: React.ReactNode
  onActivate?: () => void | Promise<void>
  /** undefined 使用状态图标，null 隐藏图标。 */
  icon?: React.ReactNode
  actions?: React.ReactNode
  textKey: string
  timestamp: number
  duration: number
  /**
   * 动作的硬截止时间戳。期限是服务端事实，不随「多条冻结」或悬停暂停而延长；
   * 到点后卡片必须禁用动作，避免期限过后点击才失败。
   */
  expiresAt?: number
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
  details?: React.ReactNode
  onActivate?: () => void | Promise<void>
  /** undefined 使用状态图标，null 隐藏图标。 */
  icon?: React.ReactNode
  actions?: React.ReactNode
  duration?: number
  expiresAt?: number
  onDismiss?: () => void
  action?: ToastAction
  secondaryAction?: ToastAction
  showCloseButton?: boolean
  dedupeKey?: string
}

export const MAX_TOASTS = 5
export const DEFAULT_DURATION_MS = 5000
export const DEDUPE_WINDOW_MS = 1000

/**
 * 动作型 Toast 的剩余有效期：`undefined` 表示不受期限约束，`0` 表示已经过期。
 */
export function toastExpiryDelayMs(expiresAt?: number, now = Date.now()): number | undefined {
  if (expiresAt === undefined) return undefined
  return Math.max(0, expiresAt - now)
}

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
 *
 * 布局规则（Bencho 纸片堆叠效果）：
 * 1. 位于顶部中央，最新通知在最前、最下方（index 0），旧通知向上排列。
 * 2. 通知框架始终预留完整展开高度；折叠、展开时最新通知保持位置，其他通知向上展开。
 * 3. 最多保留 5 条，折叠露出最多 3 张（index 0, 1, 2）。
 * 4. 折叠时后层内容不可点击（pointerEvents none）。
 *
 * @param index 卡片在队列中的索引（0 为最新一条）
 * @param isExpanded 是否处于展开状态（例如鼠标悬停或键盘聚焦）
 * @param heights 各卡片的测量高度数组
 * @param gap 展开时的卡片垂直间距，默认 8px
 * @param peek 折叠状态下各层卡片向上露出的高度，默认 14px
 * @param frameHeight 折叠时使用可视区域高度，避免隐藏通知把前景卡片向下推
 */
export function calculateCardTransform(
  index: number,
  isExpanded: boolean,
  heights: number[] = [],
  gap = 8,
  peek = 14,
  frameHeight?: number,
): ToastCardTransform {
  const count = Math.max(heights.length, index + 1)
  const defaultHeight = 44

  // 计算完整展开状态下的总高度
  let totalHeight = 0
  for (let i = 0; i < count; i++) {
    totalHeight += (heights[i] ?? defaultHeight) + (i < count - 1 ? gap : 0)
  }

  // index 0（最新通知）在容器最底部的 y 坐标（折叠和展开时位置完全相同！）
  const frontHeight = heights[0] ?? defaultHeight
  const frontY = (frameHeight ?? totalHeight) - frontHeight

  if (!isExpanded) {
    if (index === 0) {
      return { y: frontY, scale: 1, zIndex: 50, opacity: 1, pointerEvents: 'auto' }
    }
    if (index === 1) {
      return { y: frontY - peek, scale: 0.95, zIndex: 49, opacity: 1, pointerEvents: 'none' }
    }
    if (index === 2) {
      return { y: frontY - 2 * peek, scale: 0.9, zIndex: 48, opacity: 1, pointerEvents: 'none' }
    }
    return {
      y: frontY - 2 * peek,
      scale: 0.85,
      zIndex: Math.max(1, 47 - index),
      opacity: 0,
      pointerEvents: 'none',
    }
  }

  // 展开状态：旧通知向上排列，index 0 在最底部，index (count - 1) 在最顶部 (y = 0)
  let y = frontY
  for (let i = 1; i <= index; i++) {
    const cardHeight = heights[i] ?? defaultHeight
    y -= cardHeight + gap
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

  const store = createStore<ToastStoreState>()(() => ({
    toasts: [],
    isHovered: false,
  }))

  const getState = (): ToastStoreState => store.getState()

  function clearTimer(): void {
    // 自动消失计时器已移除，所有通知改为用户手动逐条关闭；保留空实现以兼容调用方
  }

  function show(toastOptions: ShowToastOptions): string {
    const tone = toastOptions.tone ?? 'error'
    const original = toastOptions.message
    const summary = tone === 'error' && typeof original === 'string' ? toUserErrorMessage(original) : original
    const needsSummary = typeof summary === 'string' && (summary.includes('\n') || summary.length > 80)
    const message = needsSummary
      ? tone === 'error' ? '操作失败，点击查看详情' : '操作结果已更新，点击查看详情'
      : summary
    const details = toastOptions.details !== undefined ? toastOptions.details
      : original !== message ? original : undefined
    const textKey =
      toastOptions.dedupeKey ??
      (typeof toastOptions.message === 'string'
        ? toastOptions.message
        : String(toastOptions.id ?? ''))
    const now = Date.now()
    const state = getState()

    // 规则 1：相同内容去重（短时间窗口内更新现有条目，不重复入栈）
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
          message,
          details,
          onActivate: toastOptions.onActivate,
          icon: toastOptions.icon,
          actions: toastOptions.actions,
          appearance: toastOptions.appearance,
          expiresAt: toastOptions.expiresAt,
          action: toastOptions.action,
          secondaryAction: toastOptions.secondaryAction,
          onDismiss: toastOptions.onDismiss ?? existing.onDismiss,
          showCloseButton: toastOptions.showCloseButton ?? existing.showCloseButton,
        }
        store.setState({ toasts: updated })
        return existing.id
      }
    }

    const id = toastOptions.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const existingByIdIndex = state.toasts.findIndex((t) => t.id === id)
    const newItem: ToastItem = {
      id,
      appearance: toastOptions.appearance,
      tone,
      message,
      details,
      onActivate: toastOptions.onActivate,
      icon: toastOptions.icon,
      actions: toastOptions.actions,
      textKey,
      timestamp: now,
      duration: toastOptions.duration ?? defaultDuration,
      expiresAt: toastOptions.expiresAt,
      onDismiss: toastOptions.onDismiss,
      action: toastOptions.action,
      secondaryAction: toastOptions.secondaryAction,
      showCloseButton: toastOptions.showCloseButton ?? true,
    }

    let nextToasts: ToastItem[]
    const removedList: ToastItem[] = []
    if (existingByIdIndex >= 0) {
      nextToasts = [...state.toasts]
      nextToasts[existingByIdIndex] = newItem
    } else {
      nextToasts = [newItem, ...state.toasts]
      // 规则 2：最多保留 maxToasts 条（默认 5 条），超出上限时淘汰最旧的一条
      while (nextToasts.length > maxToasts) {
        const removed = nextToasts.pop()
        if (removed) removedList.push(removed)
      }
    }

    store.setState({ toasts: nextToasts })
    for (const removed of removedList) {
      removed.onDismiss?.()
    }
    return id
  }

  function dismiss(id: string): void {
    const state = getState()
    const item = state.toasts.find((t) => t.id === id)
    if (!item) return
    store.setState({ toasts: state.toasts.filter((t) => t.id !== id) })
    item.onDismiss?.()
  }

  async function activate(id: string, openDetails: (notice: Pick<ToastItem, 'message' | 'details'>) => void): Promise<void> {
    const item = getState().toasts.find((toast) => toast.id === id)
    if (!item) return
    if (item.onActivate) await item.onActivate()
    else if (item.details != null) openDetails({ message: item.message, details: item.details })
    else return
    dismiss(id)
  }

  function dismissAll(): void {
    const state = getState()
    const current = [...state.toasts]
    store.setState({ toasts: [] })
    for (const item of current) {
      item.onDismiss?.()
    }
  }

  function setHovered(hovered: boolean): void {
    if (getState().isHovered === hovered) return
    store.setState({ isHovered: hovered })
  }

  return {
    getState,
    getInitialState: store.getInitialState,
    setState: store.setState,
    subscribe: store.subscribe,
    show,
    dismiss,
    activate,
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
