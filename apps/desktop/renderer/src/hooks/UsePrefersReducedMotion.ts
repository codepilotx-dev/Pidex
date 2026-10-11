import { useContext } from 'react'
import { DesktopThemeContext } from '../features/theme/ThemeContext.js'

export function usePrefersReducedMotion(): boolean {
  // 无 Provider 时 useContext 返回 null，不能用 try/catch 包裹 hooks。
  const theme = useContext(DesktopThemeContext)
  return theme ? theme.reducedMotion : getEffectiveReducedMotion()
}

export function getEffectiveReducedMotion(): boolean {
  if (typeof document !== 'undefined') {
    const value = document.documentElement.dataset.reduceMotion
    if (value === 'on') return true
    if (value === 'off') return false
  }
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
