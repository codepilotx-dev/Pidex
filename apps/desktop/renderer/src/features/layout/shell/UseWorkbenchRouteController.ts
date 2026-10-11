import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  NavigationType,
  useLocation,
  useNavigate,
  useNavigationType,
  type NavigateFunction,
} from 'react-router-dom'

export const QUICK_CHAT_PATH = '/new'

export type WorkbenchRouteController = {
  navigate: NavigateFunction
  canNavigateBack: boolean
  canNavigateForward: boolean
  navigateBack: () => void
  navigateForward: () => void
  routedSessionId: string | null
  isQuickChatPage: boolean
  isConversationRoute: boolean
  isSettingsRoute: boolean
  settingsActiveTab: string
  handleSettingsTabChange: (tab: string) => void
  handleSettingsBack: () => void
}

export type WorkbenchNavigationHistory = {
  entries: string[]
  index: number
}

export function reduceWorkbenchNavigationHistory(
  history: WorkbenchNavigationHistory,
  locationKey: string,
  navigationType: NavigationType,
): WorkbenchNavigationHistory {
  if (history.entries[history.index] === locationKey) {
    return history
  }

  if (navigationType === NavigationType.Push) {
    const entries = history.entries.slice(0, history.index + 1)
    entries.push(locationKey)
    return { entries, index: entries.length - 1 }
  }

  if (navigationType === NavigationType.Replace) {
    const entries = history.entries.slice()
    entries[history.index] = locationKey
    return { entries, index: history.index }
  }

  if (navigationType === NavigationType.Pop) {
    const index = history.entries.indexOf(locationKey)
    if (index !== -1) {
      return { entries: history.entries, index }
    }

    const entries = history.entries.slice(0, history.index + 1)
    entries.push(locationKey)
    return { entries, index: entries.length - 1 }
  }

  return history
}

export function useWorkbenchRouteController(): WorkbenchRouteController {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const navigationHistoryRef = useRef<WorkbenchNavigationHistory>({
    entries: [location.key],
    index: 0,
  })
  const navigationHistory = reduceWorkbenchNavigationHistory(
    navigationHistoryRef.current,
    location.key,
    navigationType,
  )
  navigationHistoryRef.current = navigationHistory
  const canNavigateBack = navigationHistory.index > 0
  const canNavigateForward = navigationHistory.index < navigationHistory.entries.length - 1
  const routedSessionId = useMemo(() => getRoutedSessionId(location.pathname), [location.pathname])
  const isQuickChatPage = location.pathname === QUICK_CHAT_PATH
  const isConversationRoute = routedSessionId !== null
  const isSettingsRoute = location.pathname.startsWith('/settings/')
  const fullLocationPath = `${location.pathname}${location.search}${location.hash}`
  const settingsReturnPathRef = useRef(QUICK_CHAT_PATH)
  const settingsActiveTab = /^\/settings\/([^/]+)/.exec(location.pathname)?.[1] ?? 'general'

  useEffect(() => {
    if (!isSettingsRoute) {
      settingsReturnPathRef.current = fullLocationPath
    }
  }, [fullLocationPath, isSettingsRoute])

  const handleSettingsTabChange = useCallback(
    (tab: string): void => {
      navigate(`/settings/${encodeURIComponent(tab)}`)
    },
    [navigate],
  )

  const handleSettingsBack = useCallback((): void => {
    navigate(settingsReturnPathRef.current || QUICK_CHAT_PATH)
  }, [navigate])

  const navigateBack = useCallback((): void => {
    if (navigationHistoryRef.current.index > 0) {
      navigate(-1)
    }
  }, [navigate])

  const navigateForward = useCallback((): void => {
    const history = navigationHistoryRef.current
    if (history.index < history.entries.length - 1) {
      navigate(1)
    }
  }, [navigate])

  return {
    navigate,
    canNavigateBack,
    canNavigateForward,
    navigateBack,
    navigateForward,
    routedSessionId,
    isQuickChatPage,
    isConversationRoute,
    isSettingsRoute,
    settingsActiveTab,
    handleSettingsTabChange,
    handleSettingsBack,
  }
}

export function sessionPath(sessionId: string): string {
  return `/threads/${encodeURIComponent(sessionId)}`
}

function getRoutedSessionId(pathname: string): string | null {
  const match = /^\/threads\/([^/]+)$/.exec(pathname)
  return match ? decodeURIComponent(match[1]!) : null
}
