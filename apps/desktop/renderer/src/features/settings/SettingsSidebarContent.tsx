import type React from 'react'
import { SettingsNav } from './SettingsNav.js'

type Props = {
  activeTab: string
  workspacePath?: string | null
  onBack: () => void
  onTabChange: (tabId: string) => void
}

export function SettingsSidebarContent({
  activeTab,
  workspacePath = null,
  onBack,
  onTabChange,
}: Props): React.ReactNode {
  return (
    <div className="sidebar-layout settings-sidebar-layout tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-hidden tw:bg-app-chrome tw:py-2">
      <SettingsNav
        activeTab={activeTab}
        workspacePath={workspacePath}
        onBack={onBack}
        onTabChange={onTabChange}
      />
    </div>
  )
}
