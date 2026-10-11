import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useEverOpened } from '../../hooks/UsePresenceRetention.js'
import { useAutomationController, type AutomationController } from './UseAutomationController.js'

export const AutomationControllerContext = createContext<AutomationController | null>(null)

export function AutomationControllerProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}): ReactNode {
  const location = useLocation()
  const selectedId =
    location.pathname === '/automations'
      ? new URLSearchParams(location.search).get('automationId')
      : null
  const activated = useEverOpened(enabled)
  const controller = useAutomationController(selectedId, activated)
  useEffect(() => {
    if (location.pathname !== '/automations') controller.cancelDraft()
  }, [location.pathname, controller.cancelDraft])
  return (
    <AutomationControllerContext.Provider value={controller}>
      {children}
    </AutomationControllerContext.Provider>
  )
}

export function useSharedAutomationController(): AutomationController {
  const controller = useContext(AutomationControllerContext)
  if (!controller) throw new Error('已安排面板需要共享自动化控制器')
  return controller
}
