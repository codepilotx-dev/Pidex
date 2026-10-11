import type { DesktopBrowserBounds } from '@pidex/shared/desktop-browser-ipc'

export function scaleDesktopBrowserBounds(
  bounds: DesktopBrowserBounds,
  scale: number,
): DesktopBrowserBounds {
  return {
    x: bounds.x * scale,
    y: bounds.y * scale,
    width: bounds.width * scale,
    height: bounds.height * scale,
  }
}
