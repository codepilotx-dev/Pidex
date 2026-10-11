import { desktopClient } from '../../services/desktop-client/index.js'
import { useEffect } from 'react'
import type { DesktopUiCommand } from '../../../shared/Types.js'

export type UseDesktopCommandsOptions = {
  onNewConversation: () => void
  onChooseWorkspace: () => void
  onRefreshWorkspace: () => void
  onOpenSettings: () => void
  onLogOut: () => void
}

function routeCommand(command: DesktopUiCommand, options: UseDesktopCommandsOptions): void {
  if (command === 'newConversation') {
    options.onNewConversation()
    return
  }
  if (command === 'chooseWorkspace') {
    options.onChooseWorkspace()
    return
  }
  if (command === 'refreshWorkspace') {
    options.onRefreshWorkspace()
    return
  }
  if (command === 'openSettings') {
    options.onOpenSettings()
    return
  }
  if (command === 'logOut') {
    options.onLogOut()
  }
}

export function useDesktopCommands(options: UseDesktopCommandsOptions): void {
  useEffect(() => {
    const unsubscribe = desktopClient.onUiCommand((command) => routeCommand(command, options))
    return () => {
      unsubscribe()
    }
  }, [options])
}
