export const WINDOWS_TITLE_BAR_HEIGHT = 36
export const WINDOWS_TITLE_BAR_TRANSPARENT = '#00000000'

export function createWindowsTitleBarOverlay(symbolColor: string): {
  color: string
  symbolColor: string
  height: number
} {
  return {
    color: WINDOWS_TITLE_BAR_TRANSPARENT,
    symbolColor,
    height: WINDOWS_TITLE_BAR_HEIGHT,
  }
}
