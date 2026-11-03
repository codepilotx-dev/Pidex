export const SIDEBAR_RAIL_WIDTH = 52
export const MODERN_SIDEBAR_DEFAULT_WIDTH = 340
export const MODERN_SIDEBAR_MIN_WIDTH = 290

export type SidebarPane =
  'git' | 'chats' | 'activity' | 'scheduled' | 'plugins' | 'providers' | 'pets' | 'settings'

export function sidebarPaneForRoute(pathname: string, activity: boolean): SidebarPane | null {
  if (pathname.startsWith('/settings/')) return 'settings'
  if (pathname === '/automations') return 'scheduled'
  if (pathname === '/plugins' || pathname.startsWith('/plugins/')) return 'plugins'
  if (pathname === '/providers' || pathname.startsWith('/providers/')) return 'providers'
  if (pathname === '/git') return 'git'
  if (pathname === '/pets') return 'pets'
  if (pathname === '/projects' || pathname.startsWith('/projects/'))
    return activity ? 'activity' : 'chats'
  if (pathname === '/new' || pathname.startsWith('/threads/'))
    return activity ? 'activity' : 'chats'
  return null
}
