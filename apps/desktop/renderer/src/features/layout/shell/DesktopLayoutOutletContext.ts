import { useOutletContext } from 'react-router-dom'
import type { DesktopInstalledSkill } from '../../../../shared/Types.js'
import type { ProviderManagementTab, ProviderManagementSection } from '../dock/RightDockState.js'
import type { MutableRefObject } from 'react'

export type ProviderManagementPanelController = {
  tab: ProviderManagementTab | null
  host: HTMLElement | null
  open: (providerId: string, section: ProviderManagementSection) => void
  close: () => void
  beforeChange: MutableRefObject<(() => Promise<boolean>) | null>
  claimProvider: (providerId: string | null) => void
}

export type DesktopLayoutOutletContextValue = {
  workspacePath: string | null
  useSkill: (skill: DesktopInstalledSkill) => void
  openSkillPreview: (skill: DesktopInstalledSkill) => void
  providerManagement?: ProviderManagementPanelController
}

export function useDesktopLayoutOutletContext(): DesktopLayoutOutletContextValue {
  return useOutletContext<DesktopLayoutOutletContextValue>()
}
