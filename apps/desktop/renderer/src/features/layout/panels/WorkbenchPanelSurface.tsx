import { forwardRef } from 'react'
import type React from 'react'
import { cx } from '../../../utils/Cx.js'
import type { WorkbenchPanelTarget } from '../dock/RightDockState.js'

export function WorkbenchPanelSurface({
  target,
  header,
  children,
}: {
  target: WorkbenchPanelTarget
  header: React.ReactNode
  children: React.ReactNode
}): React.ReactNode {
  return (
    <div className="workbench-panel-surface tw:relative tw:flex tw:h-full tw:w-full tw:min-h-0 tw:min-w-0 tw:grow tw:shrink tw:basis-auto tw:flex-col tw:overflow-hidden tw:bg-app-dock">
      <div
        className={cx(
          'workbench-panel-header tw:relative tw:flex tw:h-toolbar tw:max-h-toolbar tw:min-w-0 tw:shrink-0 tw:grow-0 tw:items-center tw:overflow-hidden tw:bg-app-dock',
          target === 'right'
            ? 'right-dock-header tw:pl-2 tw:pr-[calc(var(--cpx-sys-space-8)+var(--cpx-sys-space-2)+var(--workspace-header-shell-width,0))]'
            : 'bottom-panel-header tw:border-b tw:border-app-border-subtle tw:pl-3 tw:pr-3',
        )}
      >
        {header}
      </div>
      {children}
    </div>
  )
}

export const WorkbenchPanelContent = forwardRef<
  HTMLDivElement,
  {
    target: WorkbenchPanelTarget
    children: React.ReactNode
  }
>(function WorkbenchPanelContent({ target, children }, ref): React.ReactNode {
  return (
    <div
      ref={ref}
      className="right-dock-content workbench-panel-content tw:flex tw:min-h-0 tw:min-w-0 tw:grow tw:shrink tw:basis-auto tw:overflow-hidden tw:bg-app-dock"
      data-app-shell-tab-panel-controller={target}
      tabIndex={-1}
    >
      {children}
    </div>
  )
})
