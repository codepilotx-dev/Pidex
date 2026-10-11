import type { DesktopSystemFontsResult } from '../../../shared/Types.js'

/**
 * System font enumeration through the typed preload bridge. The result is
 * cached for the current renderer lifetime; the first open of a font dropdown
 * triggers the fetch inside the user gesture that opened it.
 */

let cachedResult: Promise<DesktopSystemFontsResult> | null = null

export function listSystemFonts(): Promise<DesktopSystemFontsResult> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ ok: false, error: 'unsupported' })
  }
  const bridge = window.DesktopBridge
  if (!bridge?.listSystemFonts) {
    return Promise.resolve({ ok: false, error: 'unsupported' })
  }
  if (!cachedResult) {
    cachedResult = bridge.listSystemFonts().catch(() => ({ ok: false, error: 'failed' }) as const)
  }
  return cachedResult
}

export function getCachedSystemFontsPromise(): Promise<DesktopSystemFontsResult> | null {
  return cachedResult
}

/** Test hook: clear the renderer-lifetime cache. */
export function resetSystemFontsCache(): void {
  cachedResult = null
}

export type FontMeasureContext = {
  font: string
  measureText(text: string): { width: number }
}

export function isMonospaceFamily(
  family: string,
  createContext: (family: string) => FontMeasureContext | null = createFontMeasureContext,
): boolean {
  const context = createContext(family)
  if (!context) return true
  const narrow = context.measureText('iiiiiiiiii').width
  const wide = context.measureText('mmmmmmmmmm').width
  return Math.abs(wide - narrow) < 0.5
}

function createFontMeasureContext(family: string): FontMeasureContext | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return null
  context.font = `16px "${escapeCssFamily(family)}"`
  return context
}

function escapeCssFamily(family: string): string {
  return family.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
