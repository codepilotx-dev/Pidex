import type { SidebarProductMode } from '../../../shared/Types.js'

/**
 * 新建页 Surface 直接复用侧栏产品模式；URL 与设置保持同步，
 * URL 中的有效值优先，缺失或无效时回退到已持久化模式。
 */
export type NewSessionSurface = SidebarProductMode

export const NEW_SESSION_SURFACES: readonly NewSessionSurface[] = ['coding', 'working', 'chat']

export function isNewSessionSurface(value: string | null | undefined): value is NewSessionSurface {
  return (
    value !== null &&
    value !== undefined &&
    (NEW_SESSION_SURFACES as readonly string[]).includes(value)
  )
}

/**
 * 从 `location.search` 解析 `surface` 参数；缺失或无效时返回 null。
 * 调用方以已保存的 `sidebarProductMode` 回退，并规范化 URL。
 */
export function parseNewSessionSurface(search: string): NewSessionSurface | null {
  const value = new URLSearchParams(search).get('surface')
  return isNewSessionSurface(value) ? value : null
}

export function newSessionPath(surface: NewSessionSurface): string {
  return `/new?surface=${surface}`
}

/**
 * 只替换 `surface` 参数，保留 `visualCase` 等无关查询参数。
 * 返回的 URLSearchParams 可直接交给 `setSearchParams(..., { replace: true })`。
 */
export function normalizeNewSessionSurfaceSearch(
  search: string,
  surface: NewSessionSurface,
): URLSearchParams {
  const params = new URLSearchParams(search)
  params.set('surface', surface)
  return params
}
