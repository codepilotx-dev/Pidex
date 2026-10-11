import type React from 'react'
import { PanelBottom, PanelRight } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import type { WorkspaceLayout } from './RightDockState.js'

export type WorkspaceShellControlsProps = {
  workspaceLayout: WorkspaceLayout
  terminalAvailable: boolean
  terminalVisible: boolean
  showBottomPanel: boolean
  showRightPanel: boolean
  onToggleTerminal: () => void
  /** 在仅聊天与分屏之间切换。 */
  onStepWorkspaceLayout: () => void
}

/**
 * 右侧工作区入口文案与可观察布局同步：
 * chat 显示“显示标签页”，split 显示“隐藏标签页”；空面板使用现有 launcher。
 */
export function resolveWorkspaceControlPresentation(layout: WorkspaceLayout): {
  label: string
  pressed: boolean
} {
  if (layout === 'chat') {
    return { label: '显示标签页', pressed: false }
  }
  return { label: '隐藏标签页', pressed: true }
}

export function WorkspaceShellControls({
  workspaceLayout,
  terminalAvailable,
  terminalVisible,
  showBottomPanel,
  showRightPanel,
  onToggleTerminal,
  onStepWorkspaceLayout,
}: WorkspaceShellControlsProps): React.ReactNode {
  if (!showBottomPanel && !showRightPanel) return null

  const workspaceControl = resolveWorkspaceControlPresentation(workspaceLayout)

  return (
    <div className="workspace-shell-controls">
      {showBottomPanel ? (
        <Button
          isIconOnly
          aria-label={terminalVisible ? '隐藏底部面板' : '打开底部面板'}
          aria-pressed={terminalVisible}
          className="workspace-shell-control-button"
          color="ghostSecondary"
          disabled={!terminalAvailable}
          size="toolbar"
          title={
            terminalAvailable
              ? terminalVisible
                ? '隐藏底部面板'
                : '打开底部面板 (Ctrl+`)'
              : '创建任务后可使用底部面板'
          }
          onClick={onToggleTerminal}
        >
          <BottomPanelToggleIcon open={terminalVisible} />
        </Button>
      ) : null}
      {showRightPanel ? (
        <Button
          isIconOnly
          aria-label={workspaceControl.label}
          aria-pressed={workspaceControl.pressed}
          className="workspace-shell-control-button"
          color="ghostSecondary"
          size="toolbar"
          title={`${workspaceControl.label} (Ctrl+Shift+B)`}
          onClick={onStepWorkspaceLayout}
        >
          <RightPanelToggleIcon open={workspaceControl.pressed} />
        </Button>
      ) : null}
    </div>
  )
}

export function BottomPanelToggleIcon({ open }: { open: boolean }): React.ReactNode {
  return (
    <PanelBottom
      aria-hidden="true"
      className="workspace-panel-icon workspace-panel-icon--bottom"
      data-open={open}
      size={APP_ICON_SIZE}
      strokeWidth={APP_ICON_STROKE_WIDTH}
    />
  )
}

export function RightPanelToggleIcon({ open }: { open: boolean }): React.ReactNode {
  return (
    <PanelRight
      aria-hidden="true"
      className="workspace-panel-icon workspace-panel-icon--right"
      data-open={open}
      size={APP_ICON_SIZE}
      strokeWidth={APP_ICON_STROKE_WIDTH}
    />
  )
}
