import { useState, type ReactNode } from 'react'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import { cx } from '../../../utils/Cx.js'

type Props = {
  kind: 'input' | 'approval'
  progress?: { deadlineMs: number; durationMs: number; nowMs?: number }
  onSnooze?: () => void
}

export function SidebarStatusPill({ kind, progress, onSnooze }: Props): ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const [startedAt] = useState(() => Date.now())
  const now = progress?.nowMs ?? startedAt
  const label = kind === 'input' ? '需要用户输入' : '等待批准'
  const interactive = onSnooze !== undefined
  const className = cx(
    'sidebar-status-pill tw:relative tw:inline-grid tw:max-w-[150px] tw:shrink-0 tw:items-center tw:overflow-hidden tw:rounded-full tw:py-0.5 tw:ps-2 tw:pe-2.5 tw:type-body-sm',
    kind === 'input'
      ? 'sidebar-session-input tw:bg-app-chart-blue/15 tw:text-app-chart-blue'
      : 'sidebar-session-approval tw:bg-app-chart-green/20 tw:text-app-chart-green',
    interactive &&
      'tw:group/status-pill tw:cursor-pointer tw:border-0 tw:text-left tw:group-hover:bg-app-text/10 tw:group-hover:text-app-text tw:focus-visible:bg-app-text/10 tw:focus-visible:text-app-text tw:focus-visible:outline-2 tw:focus-visible:outline-offset-0 tw:focus-visible:outline-app-focus',
  )
  const content = (
    <>
      {progress ? (
        <span
          aria-hidden="true"
          className={cx(
            'sidebar-status-pill-progress tw:pointer-events-none tw:absolute tw:inset-0 tw:origin-left tw:bg-app-chart-blue/25',
            interactive &&
              'tw:group-hover:bg-app-text/20 tw:group-focus-visible/status-pill:bg-app-text/20',
          )}
          style={
            reducedMotion
              ? {
                  animation: 'none',
                  transform: `scaleX(${Math.max(0, Math.min(1, (progress.deadlineMs - now) / progress.durationMs))})`,
                }
              : {
                  animationDelay: `${progress.deadlineMs - now - progress.durationMs}ms`,
                  animationDuration: `${progress.durationMs}ms`,
                  animationPlayState: progress.nowMs === undefined ? undefined : 'paused',
                }
          }
        />
      ) : null}
      <span
        className={cx(
          'tw:relative tw:col-start-1 tw:row-start-1 tw:min-w-0 tw:truncate',
          interactive && 'tw:group-hover:invisible tw:group-focus-visible/status-pill:invisible',
        )}
      >
        {label}
      </span>
      {interactive ? (
        <span className="tw:invisible tw:relative tw:col-start-1 tw:row-start-1 tw:min-w-0 tw:truncate tw:group-hover:visible tw:group-focus-visible/status-pill:visible">
          停用
        </span>
      ) : null}
    </>
  )
  return interactive ? (
    <button
      aria-label="停用自动回答"
      className={className}
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onSnooze()
      }}
    >
      {content}
    </button>
  ) : (
    <span className={className} title={label}>
      {content}
    </span>
  )
}
