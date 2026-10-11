import type React from 'react'
import { memo } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, MoveDown, MoveRight, X } from 'lucide-react'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import { AppContextMenu } from '../../../components/ui/AppContextMenu.js'
import type {
  WorkbenchPanelSnapshot,
  WorkbenchPanelTarget,
  WorkbenchTabDescriptor,
  WorkbenchTabId,
  WorkbenchTabsState,
} from '../dock/RightDockState.js'
import {
  getWorkbenchTabDefinition,
  getWorkbenchTabDisplayTitle,
} from '../tabs/WorkbenchTabRegistry.js'
import { canViewFloat, getAvailableMoveTargets } from '../dock/CompositeViews.js'
import { WorkspaceFileTree } from '../WorkspaceFileTree.js'
import type { DesktopFileEntry, DesktopWorkspace } from '../../../../shared/Types.js'

export interface SidebarDockedPanesProps {
  state: WorkbenchPanelSnapshot
  tabsById: WorkbenchTabsState['tabsById']
  workspace: DesktopWorkspace | null
  files: DesktopFileEntry[]
  onSelectTab: (tabId: WorkbenchTabId) => void
  onCloseTab: (tabId: WorkbenchTabId) => void
  onMoveTab: (
    source: WorkbenchPanelTarget,
    target: WorkbenchPanelTarget,
    tabId: WorkbenchTabId,
  ) => void
  onPopOutTab?: (source: WorkbenchPanelTarget, tabId: WorkbenchTabId) => void
  onAddComposerFiles?: (files: string[]) => void
  onOpenFile?: (file: DesktopFileEntry) => void
}

export const SidebarDockedPanes = memo(function SidebarDockedPanes({
  state,
  tabsById,
  workspace,
  files,
  onSelectTab,
  onCloseTab,
  onMoveTab,
  onPopOutTab,
  onAddComposerFiles,
  onOpenFile,
}: SidebarDockedPanesProps): React.ReactNode {
  if (!state.open || state.tabIds.length === 0) {
    return null
  }

  return (
    <div
      aria-label="侧边栏停靠视图"
      className="sidebar-docked-panes tw:grid tw:gap-1 tw:px-2 tw:py-1"
      data-sidebar-docked-open="true"
    >
      <div className="tw:flex tw:items-center tw:justify-between tw:px-1.5 tw:py-1 tw:type-caption tw:text-app-text-meta">
        <span>工作区停靠视图</span>
        <span className="tw:type-caption tw:opacity-75">{state.tabIds.length}</span>
      </div>
      {state.tabIds.map((tabId) => {
        const tab = tabsById[tabId]
        if (!tab) return null
        const definition = getWorkbenchTabDefinition(tab)
        const tabIcon = definition.getIcon?.(tab) ?? definition.icon
        const tabTitle = getWorkbenchTabDisplayTitle(tab, null)
        const active = state.activeTabId === tab.id

        return (
          <div
            key={tab.id}
            className="sidebar-docked-pane-card tw:border tw:border-app-border-subtle tw:bg-app-panel tw:overflow-hidden"
            data-active={active}
          >
            <AppContextMenu
              actions={[
                {
                  kind: 'item',
                  label: '关闭',
                  icon: <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />,
                  onSelect: () => onCloseTab(tab.id),
                },
                ...getAvailableMoveTargets('sidebar', tab.kind).map((destTarget) => ({
                  kind: 'item' as const,
                  label: `移到${destTarget === 'bottom' ? '底部面板' : '右侧栏'}`,
                  icon:
                    destTarget === 'bottom' ? (
                      <MoveDown size={APP_ICON_SIZE} />
                    ) : (
                      <MoveRight size={APP_ICON_SIZE} />
                    ),
                  onSelect: () => onMoveTab('sidebar', destTarget, tab.id),
                })),
                ...(canViewFloat(tab.kind) && onPopOutTab
                  ? [
                      { kind: 'separator' as const },
                      {
                        kind: 'item' as const,
                        label: '弹出到独立窗口',
                        icon: <ExternalLink size={APP_ICON_SIZE} />,
                        onSelect: () => onPopOutTab('sidebar', tab.id),
                      },
                    ]
                  : []),
              ]}
              layout="grid"
              trigger={
                <div
                  className="sidebar-docked-pane-header tw:flex tw:items-center tw:justify-between tw:px-2 tw:py-1.5 tw:cursor-pointer tw:hover:bg-app-hover"
                  aria-expanded={active}
                  onClick={() => onSelectTab(tab.id)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    onSelectTab(tab.id)
                  }}
                  tabIndex={0}
                >
                  <div className="tw:flex tw:items-center tw:gap-1.5 tw:min-w-0">
                    <span className="tw:text-app-text-meta tw:shrink-0">
                      {active ? (
                        <ChevronDown size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                      ) : (
                        <ChevronRight
                          size={APP_ICON_SIZES.sm}
                          strokeWidth={APP_ICON_STROKE_WIDTH}
                        />
                      )}
                    </span>
                    <span className="tw:shrink-0">{tabIcon}</span>
                    <span className="tw:truncate tw:type-control tw:text-app-text">{tabTitle}</span>
                  </div>
                  <div
                    className="tw:flex tw:items-center tw:gap-0.5"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Button
                      isIconOnly
                      aria-label="移到右侧栏"
                      color="ghostSecondary"
                      size="toolbar"
                      title="移到右侧栏"
                      onClick={() => onMoveTab('sidebar', 'right', tab.id)}
                    >
                      <MoveRight size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </Button>
                    <Button
                      isIconOnly
                      aria-label="移到底部面板"
                      color="ghostSecondary"
                      size="toolbar"
                      title="移到底部面板"
                      onClick={() => onMoveTab('sidebar', 'bottom', tab.id)}
                    >
                      <MoveDown size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </Button>
                    <Button
                      isIconOnly
                      aria-label="关闭视图"
                      color="ghostSecondary"
                      size="toolbar"
                      title="关闭视图"
                      onClick={() => onCloseTab(tab.id)}
                    >
                      <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </Button>
                  </div>
                </div>
              }
            />
            {active ? (
              <div className="sidebar-docked-pane-content tw:border-t tw:border-app-border-subtle tw:p-1 tw:max-h-[360px] tw:overflow-y-auto">
                {tab.kind === 'file-browser' ? (
                  <WorkspaceFileTree
                    files={files}
                    workspace={workspace}
                    onAddComposerFiles={onAddComposerFiles}
                    onOpenFile={onOpenFile}
                  />
                ) : (
                  <div className="tw:p-2 tw:type-body-sm tw:text-app-text-meta">
                    {tabTitle}（已停靠在侧边栏）
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
})
