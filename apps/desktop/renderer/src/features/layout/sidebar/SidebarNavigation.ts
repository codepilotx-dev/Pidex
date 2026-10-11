export const SIDEBAR_RAIL_WIDTH = 52
export const MODERN_SIDEBAR_DEFAULT_WIDTH = 340
export const MODERN_SIDEBAR_MIN_WIDTH = 290

export type SidebarPane = 'chats' | 'activity' | 'scheduled' | 'plugins' | 'settings'

export function sidebarPaneForRoute(pathname: string, activity: boolean): SidebarPane | null {
  if (pathname.startsWith('/settings/')) return 'settings'
  if (pathname === '/automations') return 'scheduled'
  if (pathname === '/plugins' || pathname.startsWith('/plugins/')) return 'plugins'
  if (pathname === '/projects' || pathname.startsWith('/projects/'))
    return activity ? 'activity' : 'chats'
  if (pathname === '/new' || pathname.startsWith('/threads/'))
    return activity ? 'activity' : 'chats'
  return null
}
