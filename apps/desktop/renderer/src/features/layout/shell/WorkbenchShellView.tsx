import type React from 'react'
import type { WorkspaceLayout } from '../dock/RightDockState.js'
import { ToastStack } from '../../../components/toast/ToastStack.js'

export interface WorkbenchShellViewProps {
  menuBar: React.ReactNode
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
}

/**
 * 主 Chat 与右侧工作区始终占据固定的 React 树位置：布局切换只改变几何与可见性，
 * 不卸载宿主，也不在容器之间搬运组件。
 */
export function WorkbenchShellView({
  menuBar,
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
}: WorkbenchShellViewProps): React.ReactNode {
  return (
    <div
      className="app-shell tw:flex tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-hidden tw:bg-app-underlay tw:text-app-text"
      data-primary-sidebar-visible={primarySidebarVisible}
      data-auxiliary-panel-visible={auxiliaryPanelVisible}
      data-bottom-panel-visible={bottomPanelVisible}
      data-resize-active={resizeActive}
      data-workspace-layout={workspaceLayout}
    >
      <div className="desktop-menubar tw:h-chrome tw:shrink-0 tw:bg-app-titlebar">{menuBar}</div>
      <div
        className="app-body tw:[&:has(.desktop-sidebar.is-docked.is-resizing)_.desktop-main]:border-l-app-border-strong tw:[&:has(.desktop-sidebar.is-docked_.sidebar-resizer:hover)_.desktop-main]:border-l-app-border-strong tw:[&:has(.desktop-sidebar.is-docked_.sidebar-resizer:focus-visible)_.desktop-main]:border-l-app-border-strong tw:relative tw:flex tw:min-h-0 tw:flex-1 tw:overflow-hidden tw:bg-app-underlay"
        ref={appBodyRef}
      >
        {primarySidebar}
        <section className="desktop-main tw:relative tw:flex tw:min-h-0 tw:w-full tw:min-w-0 tw:flex-1 tw:items-stretch tw:justify-start tw:overflow-hidden tw:border-l tw:border-app-border tw:bg-app-main">
          <ToastStack />
          <div className="desktop-main-stage tw:flex tw:h-full tw:min-h-0 tw:w-full tw:min-w-0 tw:flex-1 tw:flex-col tw:items-center tw:justify-start tw:overflow-hidden tw:bg-app-main">
            <div
              className="desktop-workspace tw:@container/desktop-workspace tw:relative tw:flex tw:h-full tw:w-full tw:min-w-0 tw:min-h-0 tw:flex-col tw:overflow-hidden tw:bg-app-main"
              ref={workspaceRef}
              style={workspaceStyle}
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
  )
}
