import type React from 'react'
import type { WorkspaceLayout } from '../dock/RightDockState.js'
import { ToastStack } from '../../../components/toast/ToastStack.js'
import { SIDEBAR_RAIL_WIDTH } from '../sidebar/SidebarNavigation.js'

export interface WorkbenchShellViewProps {
  menuBar: React.ReactNode
  rail?: React.ReactNode
  primarySidebar: React.ReactNode
  workspaceHeader: React.ReactNode
  mainContent: React.ReactNode
  auxiliaryPanel?: React.ReactNode
  bottomPanel?: React.ReactNode
  appBodyRef?: React.Ref<HTMLDivElement>
  workspaceRef?: React.Ref<HTMLDivElement>
  workspaceStyle?: React.CSSProperties
  primarySidebarVisible: boolean
  auxiliaryPanelVisible: boolean
  bottomPanelVisible: boolean
  workspaceLayout: WorkspaceLayout
  resizeActive: boolean
  /**
   * 右侧工作区内的任意用户操作（点击、键盘、滚动）都会触发该回调，用于清除
   * 当前会话的未读标记。仅作用于工作区，不包含左侧会话侧栏。
   */
  onWorkspaceInteraction?: () => void
}

/**
 * 主 Chat 与右侧工作区始终占据固定的 React 树位置：布局切换只改变几何与可见性，
 * 不卸载宿主，也不在容器之间搬运组件。
 */
export function WorkbenchShellView({
  menuBar,
  rail,
  primarySidebar,
  workspaceHeader,
  mainContent,
  auxiliaryPanel,
  bottomPanel,
  appBodyRef,
  workspaceRef,
  workspaceStyle,
  primarySidebarVisible,
  auxiliaryPanelVisible,
  bottomPanelVisible,
  workspaceLayout,
  resizeActive,
  onWorkspaceInteraction,
}: WorkbenchShellViewProps): React.ReactNode {
  return (
    <div
      className="app-shell tw:flex tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-hidden tw:bg-app-titlebar tw:text-app-text"
      data-primary-sidebar-visible={primarySidebarVisible}
      data-auxiliary-panel-visible={auxiliaryPanelVisible}
      data-bottom-panel-visible={bottomPanelVisible}
      data-resize-active={resizeActive}
      data-workspace-layout={workspaceLayout}
    >
      <div className="desktop-menubar tw:h-chrome tw:shrink-0 tw:bg-app-titlebar">{menuBar}</div>
      <div
        className="app-body tw:[&:has(.desktop-sidebar.is-docked.is-resizing)_.desktop-main]:border-l-app-border-strong tw:[&:has(.desktop-sidebar.is-docked_.sidebar-resizer:hover)_.desktop-main]:border-l-app-border-strong tw:[&:has(.desktop-sidebar.is-docked_.sidebar-resizer:focus-visible)_.desktop-main]:border-l-app-border-strong tw:relative tw:flex tw:min-h-0 tw:flex-1 tw:overflow-hidden tw:bg-app-titlebar"
        ref={appBodyRef}
      >
        {rail ? (
          <div
            className="desktop-sidebar-rail-slot tw:relative tw:flex tw:h-full tw:shrink-0 tw:w-[var(--sidebar-rail-width,52px)] tw:justify-center tw:bg-app-sidebar"
            data-sidebar-layout="modern"
            style={{ '--sidebar-rail-width': `${SIDEBAR_RAIL_WIDTH}px` } as React.CSSProperties}
          >
            {rail}
          </div>
        ) : null}
        <ToastStack />
        <div className="desktop-workbench-sheet tw:relative tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:items-stretch tw:overflow-hidden tw:rounded-container tw:bg-app-main tw:mr-2 tw:mb-2">
          {primarySidebar}
          <section className="desktop-main tw:relative tw:flex tw:min-h-0 tw:w-full tw:min-w-0 tw:flex-1 tw:items-stretch tw:justify-start tw:overflow-hidden tw:border-l tw:border-app-border-subtle tw:bg-app-main">
            <div className="desktop-main-stage tw:flex tw:h-full tw:min-h-0 tw:w-full tw:min-w-0 tw:flex-1 tw:flex-col tw:items-center tw:justify-start tw:overflow-hidden tw:bg-app-main">
              <div
                className="desktop-workspace tw:@container/desktop-workspace tw:relative tw:flex tw:h-full tw:w-full tw:min-w-0 tw:min-h-0 tw:flex-col tw:overflow-hidden tw:bg-app-main"
                ref={workspaceRef}
                style={workspaceStyle}
                onPointerDownCapture={onWorkspaceInteraction}
                onKeyDownCapture={onWorkspaceInteraction}
                onWheelCapture={onWorkspaceInteraction}
              >
                {workspaceHeader}
                <div className="desktop-workspace__upper tw:relative tw:flex tw:h-0 tw:w-full tw:min-w-0 tw:min-h-0 tw:flex-auto tw:items-stretch">
                  {mainContent}
                  {auxiliaryPanel}
                </div>
                {bottomPanel}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
