import type React from 'react'
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { cx } from '../../../utils/Cx.js'
import { useWorkspaceHeaderContext } from './WorkspaceHeaderProvider.js'
import {
  selectWorkspaceHeaderItems,
  type WorkspaceHeaderItemSnapshot,
  type WorkspaceHeaderSlot,
} from './WorkspaceHeaderStore.js'

export type DesktopWorkspaceHeaderProps = {
  className?: string
  /** 仅会话滚动内容需要边界时显示 0.5px divider；首页与设置页不固定画线。 */
  divider?: boolean
  rightDockOpen: boolean
  shellControls: React.ReactNode
}

type HeaderSideWidths = {
  left: number
  right: number
}

const EMPTY_WIDTHS: HeaderSideWidths = { left: 0, right: 0 }

export function DesktopWorkspaceHeader({
  className,
  divider = false,
  rightDockOpen,
  shellControls,
}: DesktopWorkspaceHeaderProps): React.ReactNode {
  const { routeScope, store } = useWorkspaceHeaderContext()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRouteRef = useRef<HTMLDivElement>(null)
  const shellControlsRef = useRef<HTMLDivElement>(null)
  const [widths, setWidths] = useState<HeaderSideWidths>(EMPTY_WIDTHS)
  const routeItems = useMemo(
    () => selectWorkspaceHeaderItems(snapshot, routeScope),
    [routeScope, snapshot],
  )

  useLayoutEffect(() => {
    const left = leftRef.current
    const rightRoute = rightRouteRef.current
    const shell = shellControlsRef.current
    if (!left || !rightRoute || !shell) return

    const workspace = shell.closest<HTMLElement>('.desktop-workspace')
    let appliedShellWidth = ''

    const update = (): void => {
      const next = {
        left: Math.max(0, left.getBoundingClientRect().width),
        right: Math.max(0, rightRoute.getBoundingClientRect().width),
      }
      setWidths((current) =>
        current.left === next.left && current.right === next.right ? current : next,
      )

      if (workspace) {
        appliedShellWidth = `${Math.max(0, shell.getBoundingClientRect().width)}px`
        workspace.style.setProperty('--workspace-header-shell-width', appliedShellWidth)
      }
    }
    update()

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(left)
    observer?.observe(rightRoute)
    observer?.observe(shell)
    return () => {
      observer?.disconnect()
      if (
        workspace?.style.getPropertyValue('--workspace-header-shell-width') === appliedShellWidth
      ) {
        workspace.style.removeProperty('--workspace-header-shell-width')
      }
    }
  }, [])

  const centerSafeInset = Math.max(widths.left, widths.right)
  const style = {
    '--workspace-header-left-width': `${widths.left}px`,
    '--workspace-header-right-width': `${widths.right}px`,
    '--workspace-header-center-safe-inset': `${centerSafeInset}px`,
  } as React.CSSProperties

  return (
    <header
      className={cx(
        'desktop-workspace-header tw:group tw:absolute tw:inset-x-0 tw:top-0 tw:z-dock tw:h-[var(--workspace-header-height)] tw:w-full tw:min-w-0 tw:pointer-events-none',
        // `::before` 是整栏宽度的透明背板，仅在有分隔线时画 1px 下边框。
        'tw:before:absolute tw:before:inset-y-0 tw:before:left-0 tw:before:-z-local tw:before:w-full tw:before:bg-transparent tw:before:border-0 tw:before:content-[""]',
        'tw:data-[divider]:before:border-b tw:data-[divider]:before:border-solid tw:data-[divider]:before:border-app-border-subtle',
        'tw:forced-colors:data-[divider]:before:border-b-[color:CanvasText]',
        className,
      )}
      data-divider={divider || undefined}
      data-right-dock-open={rightDockOpen || undefined}
      aria-label="工作区工具栏"
      role="toolbar"
      style={style}
    >
      <div className="desktop-workspace-header-route-band tw:absolute tw:inset-y-0 tw:right-[var(--workspace-header-route-end-inset)] tw:left-0 tw:grid tw:h-full tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_max-content] tw:pointer-events-none tw:@max-[47.9375rem]/desktop-workspace:grid-cols-[max-content_minmax(0,1fr)_max-content]">
        <div
          className="desktop-workspace-header-route-left tw:flex tw:h-full tw:min-w-0 tw:max-w-full tw:items-center tw:col-start-1 tw:w-max tw:justify-self-start tw:pl-2"
          ref={leftRef}
        >
          <HeaderSlot items={routeItems} slot="left" />
        </div>
        <div className="desktop-workspace-header-center tw:absolute tw:inset-0 tw:flex tw:h-full tw:min-w-0 tw:items-center tw:justify-center tw:overflow-hidden tw:px-[var(--workspace-header-center-padding)] tw:@max-[47.9375rem]/desktop-workspace:static tw:@max-[47.9375rem]/desktop-workspace:col-start-2 tw:@max-[47.9375rem]/desktop-workspace:px-2">
          <HeaderSlot items={routeItems} slot="center" />
        </div>
        <div
          className="desktop-workspace-header-route-right tw:flex tw:h-full tw:min-w-0 tw:max-w-full tw:flex-none tw:items-center tw:col-start-2 tw:w-max tw:justify-end tw:group-data-[right-dock-open]:pr-2 tw:@max-[47.9375rem]/desktop-workspace:col-start-3"
          ref={rightRouteRef}
        >
          <HeaderSlot items={routeItems} slot="right" />
        </div>
      </div>
      <div
        className="desktop-workspace-header-shell-controls tw:absolute tw:top-0 tw:right-0 tw:flex tw:h-full tw:items-center tw:pointer-events-auto"
        ref={shellControlsRef}
      >
        {shellControls}
      </div>
    </header>
  )
}

function HeaderSlot({
  items,
  slot,
}: {
  items: readonly WorkspaceHeaderItemSnapshot[]
  slot: WorkspaceHeaderSlot
}): React.ReactNode {
  const slotItems = items.filter((item) => item.slot === slot)
  return (['start', 'center', 'end'] as const).map((align) => {
    const alignedItems = slotItems.filter((item) => item.align === align)
    if (alignedItems.length === 0) return null
    return (
      <div
        className={cx(
          'desktop-workspace-header-group tw:flex tw:h-full tw:min-w-0 tw:items-center tw:gap-1',
          'tw:data-[align=center]:mx-auto tw:data-[align=center]:justify-center',
          'tw:data-[align=end]:ml-auto tw:data-[align=end]:justify-end',
          slot === 'center' && 'tw:@max-[47.9375rem]/desktop-workspace:max-w-full',
        )}
        data-align={align}
        key={align}
      >
        {alignedItems.map((item) => (
          <div
            className="desktop-workspace-header-item tw:flex tw:h-full tw:min-w-0 tw:max-w-full tw:items-center tw:pointer-events-auto tw:text-app-text-soft tw:type-control"
            key={`${item.routeScope}:${item.id}`}
          >
            {item.node}
          </div>
        ))}
      </div>
    )
  })
}
