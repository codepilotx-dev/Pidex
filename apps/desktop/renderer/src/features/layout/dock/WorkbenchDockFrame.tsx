import { forwardRef } from 'react'
import type React from 'react'
import { motion, type MotionValue } from 'motion/react'
import { cx } from '../../../utils/Cx.js'
import type { WorkbenchPanelTarget } from './RightDockState.js'

export interface WorkbenchDockFrameProps {
  target: WorkbenchPanelTarget
  open: boolean
  targetWidth: MotionValue<number> | number | string
  visibleWidth: MotionValue<number> | number | string
  children: React.ReactNode
  className?: string
}

/**
 * Stable App Shell frame for right and bottom workbench panels.
 *
 * `visibleWidth` follows the shell edge. `targetWidth` stays stable while the
 * panel enters/exits, but follows the same live value during pointer resize.
 */
export const WorkbenchDockFrame = forwardRef<HTMLElement, WorkbenchDockFrameProps>(
  function WorkbenchDockFrame(
    { target, open, targetWidth, visibleWidth, children, className },
    ref,
  ): React.ReactNode {
    return (
      <motion.aside
        ref={ref}
        aria-label={target === 'right' ? '右侧面板' : '底部面板'}
        aria-hidden={!open || undefined}
        className={cx(
          target === 'right'
            ? 'right-dock tw:has-[.right-dock-resize-handle:hover]:border-l-app-border-strong tw:has-[.right-dock-resize-handle:focus-visible]:border-l-app-border-strong tw:has-[.right-dock-resize-handle[data-resize-phase]]:border-l-app-border-strong tw:border-l tw:border-app-border tw:forced-colors:border-l-[CanvasText]'
            : 'bottom-panel tw:has-[.bottom-panel-resize-handle:hover]:border-t-app-border-strong tw:has-[.bottom-panel-resize-handle:focus-visible]:border-t-app-border-strong tw:has-[.bottom-panel-resize-handle[data-resize-phase]]:border-t-app-border-strong tw:border-t tw:border-app-border tw:forced-colors:border-t-[CanvasText]',
          'workbench-panel tw:relative tw:flex tw:h-full tw:w-full tw:min-h-0 tw:min-w-0 tw:flex-col tw:overflow-hidden tw:rounded-none tw:bg-app-dock tw:text-app-text tw:shadow-none',
          className,
        )}
        data-app-shell-focus-area={`${target}-panel`}
        data-workbench-panel-open={open || undefined}
        data-workbench-panel-target={target}
        style={{
          width: target === 'right' ? visibleWidth : '100%',
        }}
      >
        <motion.div
          className="workbench-dock-frame__target tw:relative tw:flex tw:h-full tw:min-h-0 tw:min-w-0 tw:flex-col tw:overflow-hidden"
          style={{
            width: target === 'right' ? targetWidth : '100%',
          }}
        >
          {children}
        </motion.div>
      </motion.aside>
    )
  },
)
