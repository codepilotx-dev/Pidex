import { useCallback, useEffect, useState } from 'react'

export const SIDEBAR_WIDTH_STORAGE_KEY = 'layout.sidebarWidth'
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'layout.sidebarCollapsed'
export const SIDEBAR_MIN_WIDTH = 240
export const SIDEBAR_MAX_WIDTH = 520
export const DEFAULT_SIDEBAR_WIDTH = 340

export function clampSidebarWidth(value: number): number {
  const maxAvailable =
    typeof window !== 'undefined'
      ? Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - 240)
      : SIDEBAR_MAX_WIDTH
  const max = Math.min(SIDEBAR_MAX_WIDTH, maxAvailable)
  return Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)))
}

export function readStoredSidebarWidth(defaultWidth = DEFAULT_SIDEBAR_WIDTH): number {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
  } catch {
    return clampSidebarWidth(defaultWidth)
  }
  if (!raw) return clampSidebarWidth(defaultWidth)
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) {
    return clampSidebarWidth(defaultWidth)
  }
  return clampSidebarWidth(parsed)
}

export function readStoredSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export type UseDesktopLayoutResult = {
  sidebarCollapsed: boolean
  sidebarWidth: number
  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarWidth: (width: number) => void
  toggleSidebarCollapsed: () => void
}

export function useDesktopLayout(defaultWidth = DEFAULT_SIDEBAR_WIDTH): UseDesktopLayoutResult {
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => readStoredSidebarCollapsed())
  const [sidebarWidth, setSidebarWidthState] = useState(() => readStoredSidebarWidth(defaultWidth))

  useEffect(() => {
    setSidebarWidthState(readStoredSidebarWidth(defaultWidth))
  }, [defaultWidth])

  const setSidebarWidth = useCallback((nextWidth: number): void => {
    const clamped = clampSidebarWidth(nextWidth)
    setSidebarWidthState(clamped)
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped))
    } catch {
      /* localStorage full or disabled; keep the in-memory width. */
    }
  }, [])

  const setSidebarCollapsed = useCallback((collapsed: boolean): void => {
    setSidebarCollapsedState(collapsed)
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false')
    } catch {
      /* localStorage full or disabled; keep the in-memory state. */
    }
  }, [])

  const toggleSidebarCollapsed = useCallback((): void => {
    setSidebarCollapsedState((current) => {
      const next = !current
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? 'true' : 'false')
      } catch {
        /* localStorage full or disabled; keep the in-memory state. */
      }
      return next
    })
  }, [])

  return {
    sidebarCollapsed,
    sidebarWidth,
    setSidebarCollapsed,
    setSidebarWidth,
    toggleSidebarCollapsed,
  }
}
