import type { DesktopPageZoomAction, DesktopPageZoomState } from '@pidex/shared/desktop-window-ipc'

export const MIN_PAGE_ZOOM_PERCENT = 50
export const MAX_PAGE_ZOOM_PERCENT = 200
export const PAGE_ZOOM_STEP_PERCENT = 10
export const DEFAULT_PAGE_ZOOM_PERCENT = 100

export function normalizePageZoomPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PAGE_ZOOM_PERCENT
  }
  return Math.min(
    MAX_PAGE_ZOOM_PERCENT,
    Math.max(
      MIN_PAGE_ZOOM_PERCENT,
      Math.round(value / PAGE_ZOOM_STEP_PERCENT) * PAGE_ZOOM_STEP_PERCENT,
    ),
  )
}

export function nextPageZoomPercent(current: number, action: DesktopPageZoomAction): number {
  if (action === 'reset') return DEFAULT_PAGE_ZOOM_PERCENT
  return normalizePageZoomPercent(
    current + (action === 'in' ? PAGE_ZOOM_STEP_PERCENT : -PAGE_ZOOM_STEP_PERCENT),
  )
}

export function pageZoomState(percent: number): DesktopPageZoomState {
  return {
    percent,
    canZoomIn: percent < MAX_PAGE_ZOOM_PERCENT,
    canZoomOut: percent > MIN_PAGE_ZOOM_PERCENT,
  }
}

export function resolvePageZoomShortcut(
  input: Pick<Electron.Input, 'alt' | 'code' | 'control' | 'key' | 'meta' | 'type'>,
): DesktopPageZoomAction | null {
  if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return null
  if (input.code === 'NumpadAdd') return 'in'
  if (input.code === 'NumpadSubtract') return 'out'
  if (input.code === 'Numpad0') return 'reset'
  if (input.key === '+' || input.key === '=') return 'in'
  if (input.key === '-') return 'out'
  if (input.key === '0') return 'reset'
  return null
}
