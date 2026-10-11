import type React from 'react'
import { memo, useSyncExternalStore } from 'react'
import type { WorkbenchTabId, WorkbenchTabsState } from '../dock/RightDockState.js'
import {
  getWorkbenchTabDefinition,
  getWorkbenchTabDisplayTitle,
  type WorkbenchTabRenderContext,
} from '../tabs/WorkbenchTabRegistry.js'
import { auxiliaryWindowService } from './AuxiliaryWindowService.js'
import { AuxiliaryWindowPortal } from './AuxiliaryWindowPortal.js'
import { WorkbenchTabErrorBoundary } from '../panels/WorkbenchPanelStates.js'

export interface AuxiliaryWindowsHostProps {
  floatingTabIds?: readonly WorkbenchTabId[]
  tabsById: WorkbenchTabsState['tabsById']
  panelContext: WorkbenchTabRenderContext
  onDockBack: (tabId: WorkbenchTabId) => void
}

export const AuxiliaryWindowsHost = memo(function AuxiliaryWindowsHost({
  floatingTabIds = [],
  tabsById,
  panelContext,
  onDockBack,
}: AuxiliaryWindowsHostProps): React.ReactNode {
  // 订阅辅助窗口服务状态变动
  useSyncExternalStore(auxiliaryWindowService.subscribe.bind(auxiliaryWindowService), () =>
    auxiliaryWindowService.getFloatingTabIds().join(','),
  )

  if (!floatingTabIds || floatingTabIds.length === 0) {
    return null
  }

  return (
    <>
      {floatingTabIds.map((tabId) => {
        const tab = tabsById[tabId]
        if (!tab) return null
        let entry = auxiliaryWindowService.getEntry(tabId)
        if (!entry || entry.window.closed) {
          const title = getWorkbenchTabDisplayTitle(tab, null)
          const newEntry = auxiliaryWindowService.open(tabId, title)
          if (!newEntry) return null
          entry = newEntry
        }

        const definition = getWorkbenchTabDefinition(tab)
        const icon = definition.getIcon?.(tab) ?? definition.icon
        const title = getWorkbenchTabDisplayTitle(tab, null)

        return (
          <AuxiliaryWindowPortal
            key={tab.id}
            entry={entry}
            icon={icon}
            title={title}
            onDockBack={() => onDockBack(tab.id)}
          >
            <div className="workbench-tab-panel tw:h-full tw:w-full tw:flex tw:flex-col tw:overflow-hidden">
              <WorkbenchTabErrorBoundary tabId={tab.id}>
                {definition.render(tab, panelContext)}
              </WorkbenchTabErrorBoundary>
            </div>
          </AuxiliaryWindowPortal>
        )
      })}
    </>
  )
})
