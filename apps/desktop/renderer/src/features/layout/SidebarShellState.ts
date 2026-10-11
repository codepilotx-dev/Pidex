import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { SidebarPane } from './sidebar/SidebarNavigation.js'

export const SIDEBAR_PREVIEW_ENTER_DELAY = 100
export const SIDEBAR_PREVIEW_SWITCH_DELAY = 300
export const SIDEBAR_PREVIEW_LEAVE_DELAY = 100
export const SIDEBAR_PREVIEW_SAFE_TIMEOUT = 1000
/** 预览固定为展开时，先播放一段短 settle 再进入常规展开动画。 */
export const SIDEBAR_PREVIEW_SETTLE_DURATION = 0.12
export const SIDEBAR_PREVIEW_ENTER_DURATION = 0.3
export const SIDEBAR_PREVIEW_EXIT_DURATION = 0.2

/** 触发悬停预览所需的最小窗口宽度。 */
export const SIDEBAR_PREVIEW_MIN_WINDOW_WIDTH = 768

const previewHoldRegistry = new Set<string>()

/**
 * 菜单、HoverCard、弹窗与拖放期间注册保持，避免指针移向浮层时预览提前关闭。
 */
export function registerSidebarPreviewHold(id: string): () => void {
  previewHoldRegistry.add(id)
  return () => {
    previewHoldRegistry.delete(id)
  }
}

export function isSidebarPreviewHeld(): boolean {
  return previewHoldRegistry.size > 0
}

export function isPreviewHoverSupported(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.innerWidth >= SIDEBAR_PREVIEW_MIN_WINDOW_WIDTH &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  )
}

function sign(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): number {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
}

/** 指针从导航轨斜向移向预览面板时，用轨迹三角判断是否仍在“意图区域”内。 */
export function isPointInTriangle(
  pt: { x: number; y: number },
  v1: { x: number; y: number },
  v2: { x: number; y: number },
  v3: { x: number; y: number },
): boolean {
  const d1 = sign(pt, v1, v2)
  const d2 = sign(pt, v2, v3)
  const d3 = sign(pt, v3, v1)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

export type SidebarShellMode = 'docked' | 'collapsed' | 'preview'

export type SidebarEscapeAction = 'none' | 'settings-back'

export function resolveSidebarEscapeAction({
  defaultPrevented,
  isDialogOpen,
  isSettingsRoute,
  isTextEntry,
}: {
  defaultPrevented: boolean
  isDialogOpen: boolean
  isSettingsRoute: boolean
  isTextEntry: boolean
  mode: SidebarShellMode
}): SidebarEscapeAction {
  if (defaultPrevented) return 'none'
  if (!isSettingsRoute || isDialogOpen || isTextEntry) return 'none'
  return 'settings-back'
}

/**
 * Escape 关闭预览的判断：已被菜单/对话框处理（defaultPrevented）
 * 或存在保持注册时，不再继续传播关闭。
 */
export function shouldCloseSidebarPreviewOnEscape({
  defaultPrevented,
  held,
}: {
  defaultPrevented: boolean
  held: boolean
}): boolean {
  return !defaultPrevented && !held
}

export function canShowSidebarTooltip(mode: SidebarShellMode, previewPending: boolean): boolean {
  return mode !== 'preview' && !previewPending
}

export function deriveSidebarShellMode({
  collapsed,
  previewOpen,
  paneAvailable,
}: {
  collapsed: boolean
  previewOpen: boolean
  paneAvailable: boolean
}): SidebarShellMode {
  if (!paneAvailable) return 'collapsed'
  return collapsed && previewOpen ? 'preview' : collapsed ? 'collapsed' : 'docked'
}

export type SidebarShellController = {
  appBodyRef: RefObject<HTMLDivElement | null>
  mode: SidebarShellMode
  pane: SidebarPane | null
  previewPane: SidebarPane | null
  dockedVisible: boolean
  onFloatingResizeChange: (resizing: boolean) => void
  onRailItemEnter: (pane: SidebarPane, event?: { clientX: number; clientY: number }) => void
  onRailItemLeave: (event?: { clientX: number; clientY: number }) => void
  onPreviewPanelEnter: () => void
  onPreviewPanelLeave: () => void
  closePreview: () => void
  pin: () => void
  toggle: () => void
}

export function useSidebarShellController({
  desktopCollapsed,
  setDesktopCollapsed,
  railWidth,
  activePane,
}: {
  desktopCollapsed: boolean
  setDesktopCollapsed: (collapsed: boolean) => void
  railWidth?: number
  activePane?: SidebarPane | null
}): SidebarShellController {
  const appBodyRef = useRef<HTMLDivElement>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewPane, setPreviewPane] = useState<SidebarPane | null>(null)
  const [floatingResizing, setFloatingResizing] = useState(false)
  const previewOpenRef = useRef(previewOpen)
  const previewPaneRef = useRef(previewPane)
  const collapsedRef = useRef(desktopCollapsed)
  const paneAvailable = activePane != null
  const paneAvailableRef = useRef(paneAvailable)

  previewOpenRef.current = previewOpen
  previewPaneRef.current = previewPane
  collapsedRef.current = desktopCollapsed
  paneAvailableRef.current = paneAvailable

  const dockedVisible = !desktopCollapsed && paneAvailable
  const mode = deriveSidebarShellMode({
    collapsed: desktopCollapsed,
    previewOpen,
    paneAvailable,
  })

  const updatePreviewOpen = useCallback((open: boolean): void => {
    previewOpenRef.current = open
    setPreviewOpen(open)
  }, [])

  const enterTimerRef = useRef<number | null>(null)
  const switchTimerRef = useRef<number | null>(null)
  const leaveTimerRef = useRef<number | null>(null)
  const safeTimeoutTimerRef = useRef<number | null>(null)
  const safeTriangleOriginRef = useRef<{ x: number; y: number } | null>(null)

  const clearAllPreviewTimers = useCallback(() => {
    if (enterTimerRef.current !== null) {
      window.clearTimeout(enterTimerRef.current)
      enterTimerRef.current = null
    }
    if (switchTimerRef.current !== null) {
      window.clearTimeout(switchTimerRef.current)
      switchTimerRef.current = null
    }
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
    if (safeTimeoutTimerRef.current !== null) {
      window.clearTimeout(safeTimeoutTimerRef.current)
      safeTimeoutTimerRef.current = null
    }
  }, [])

  const closePreview = useCallback(() => {
    clearAllPreviewTimers()
    safeTriangleOriginRef.current = null
    updatePreviewOpen(false)
    setPreviewPane(null)
  }, [clearAllPreviewTimers, updatePreviewOpen])

  const onRailItemEnter = useCallback(
    (pane: SidebarPane, event?: { clientX: number; clientY: number }) => {
      if (!isPreviewHoverSupported()) return
      if (!collapsedRef.current || !paneAvailableRef.current) return

      if (leaveTimerRef.current !== null) {
        window.clearTimeout(leaveTimerRef.current)
        leaveTimerRef.current = null
      }
      safeTriangleOriginRef.current = null

      if (previewOpenRef.current) {
        if (previewPaneRef.current === pane) {
          if (switchTimerRef.current !== null) {
            window.clearTimeout(switchTimerRef.current)
            switchTimerRef.current = null
          }
          return
        }
        if (switchTimerRef.current !== null) {
          window.clearTimeout(switchTimerRef.current)
        }
        switchTimerRef.current = window.setTimeout(() => {
          switchTimerRef.current = null
          setPreviewPane(pane)
        }, SIDEBAR_PREVIEW_SWITCH_DELAY)
        return
      }

      if (enterTimerRef.current !== null) {
        window.clearTimeout(enterTimerRef.current)
      }
      enterTimerRef.current = window.setTimeout(() => {
        enterTimerRef.current = null
        setPreviewPane(pane)
        updatePreviewOpen(true)
      }, SIDEBAR_PREVIEW_ENTER_DELAY)
    },
    [updatePreviewOpen],
  )

  const onRailItemLeave = useCallback(
    (event?: { clientX: number; clientY: number }) => {
      if (enterTimerRef.current !== null) {
        window.clearTimeout(enterTimerRef.current)
        enterTimerRef.current = null
      }
      if (switchTimerRef.current !== null) {
        window.clearTimeout(switchTimerRef.current)
        switchTimerRef.current = null
      }
      if (!previewOpenRef.current) return
      if (isSidebarPreviewHeld()) return

      if (event) {
        safeTriangleOriginRef.current = { x: event.clientX, y: event.clientY }
        if (safeTimeoutTimerRef.current !== null) {
          window.clearTimeout(safeTimeoutTimerRef.current)
        }
        safeTimeoutTimerRef.current = window.setTimeout(() => {
          safeTimeoutTimerRef.current = null
          safeTriangleOriginRef.current = null
          if (!isSidebarPreviewHeld() && previewOpenRef.current) {
            closePreview()
          }
        }, SIDEBAR_PREVIEW_SAFE_TIMEOUT)
      }

      if (leaveTimerRef.current !== null) {
        window.clearTimeout(leaveTimerRef.current)
      }
      leaveTimerRef.current = window.setTimeout(() => {
        leaveTimerRef.current = null
        if (!safeTriangleOriginRef.current && !isSidebarPreviewHeld()) {
          closePreview()
        }
      }, SIDEBAR_PREVIEW_LEAVE_DELAY)
    },
    [closePreview],
  )

  const onPreviewPanelEnter = useCallback(() => {
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
    if (safeTimeoutTimerRef.current !== null) {
      window.clearTimeout(safeTimeoutTimerRef.current)
      safeTimeoutTimerRef.current = null
    }
    safeTriangleOriginRef.current = null
  }, [])

  const onPreviewPanelLeave = useCallback(() => {
    if (isSidebarPreviewHeld()) return
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current)
    }
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null
      if (!isSidebarPreviewHeld()) {
        closePreview()
      }
    }, SIDEBAR_PREVIEW_LEAVE_DELAY)
  }, [closePreview])

  useEffect(() => {
    if (!previewOpen) return
    const onWindowPointerMove = (e: PointerEvent): void => {
      const origin = safeTriangleOriginRef.current
      if (!origin) return
      const pt = { x: e.clientX, y: e.clientY }
      const inTriangle = isPointInTriangle(
        pt,
        origin,
        { x: railWidth + 10, y: 0 },
        { x: railWidth + 10, y: window.innerHeight },
      )
      if (inTriangle) {
        if (leaveTimerRef.current !== null) {
          window.clearTimeout(leaveTimerRef.current)
          leaveTimerRef.current = null
        }
        return
      }
      safeTriangleOriginRef.current = null
      if (e.clientX < railWidth && !isSidebarPreviewHeld()) {
        closePreview()
      }
    }
    window.addEventListener('pointermove', onWindowPointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', onWindowPointerMove)
  }, [previewOpen, railWidth, closePreview])

  useEffect(() => {
    if (!previewOpen) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (
        !shouldCloseSidebarPreviewOnEscape({
          defaultPrevented: e.defaultPrevented,
          held: isSidebarPreviewHeld(),
        })
      ) {
        return
      }
      closePreview()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [previewOpen, closePreview])

  useEffect(() => {
    return () => {
      clearAllPreviewTimers()
    }
  }, [clearAllPreviewTimers])

  useEffect(() => {
    if (!paneAvailable) {
      updatePreviewOpen(false)
      setPreviewPane(null)
    }
  }, [paneAvailable, updatePreviewOpen])

  const onFloatingResizeChange = useCallback(
    (resizing: boolean): void => {
      setFloatingResizing(resizing)
      if (resizing && previewOpenRef.current) updatePreviewOpen(true)
    },
    [updatePreviewOpen],
  )

  const pin = useCallback((): void => {
    clearAllPreviewTimers()
    updatePreviewOpen(false)
    setPreviewPane(null)
    setDesktopCollapsed(false)
  }, [clearAllPreviewTimers, setDesktopCollapsed, updatePreviewOpen])

  const toggle = useCallback((): void => {
    clearAllPreviewTimers()
    if (collapsedRef.current) {
      updatePreviewOpen(false)
      setPreviewPane(null)
      setDesktopCollapsed(false)
      return
    }
    updatePreviewOpen(false)
    setPreviewPane(null)
    setDesktopCollapsed(true)
  }, [clearAllPreviewTimers, setDesktopCollapsed, updatePreviewOpen])

  return {
    appBodyRef,
    mode,
    pane: mode === 'preview' ? (previewPane ?? activePane ?? null) : (activePane ?? null),
    previewPane,
    dockedVisible,
    onFloatingResizeChange,
    onRailItemEnter,
    onRailItemLeave,
    onPreviewPanelEnter,
    onPreviewPanelLeave,
    closePreview,
    pin,
    toggle,
  }
}
