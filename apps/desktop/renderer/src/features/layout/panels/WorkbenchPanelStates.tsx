import { Component, Fragment } from 'react'
import type React from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '../../../components/ui/Button.js'
import { Spinner } from '../../../components/ui/Spinner.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import { cx } from '../../../utils/Cx.js'
import type { WorkbenchTabId } from '../dock/RightDockState.js'

export type WorkbenchPanelViewState =
  | { status: 'loading'; label: string }
  | { status: 'empty'; title: string; description?: string }
  | { status: 'unavailable'; title: string; description: string }
  | {
      status: 'error'
      code?: string
      message: string
      retryable: boolean
    }
  | { status: 'too-large'; title: string; description: string }
  | { status: 'ready' }

type StateSurfaceProps = {
  title: string
  description?: string
  icon?: React.ReactNode
  role?: 'alert' | 'status'
  children?: React.ReactNode
  tone?: 'default' | 'warning'
}

function WorkbenchPanelStateSurface({
  title,
  description,
  icon,
  role = 'status',
  children,
  tone = 'default',
}: StateSurfaceProps): React.ReactNode {
  return (
    <div
      className="workbench-panel-state tw:m-auto tw:grid tw:w-[min(22.5rem,calc(100%-2.5rem))] tw:justify-items-center tw:gap-2 tw:p-5 tw:text-center tw:text-app-text-soft"
      data-tone={tone}
      role={role}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className={cx(
            'workbench-panel-state__icon tw:grid tw:size-9 tw:place-items-center tw:rounded-full tw:bg-app-hover tw:[&>svg]:size-icon-lg',
            tone === 'warning' ? 'tw:text-app-warning' : 'tw:text-app-text-meta',
          )}
        >
          {icon}
        </span>
      ) : null}
      <strong className="tw:text-app-text tw:type-row-title">{title}</strong>
      {description ? (
        <span className="tw:max-w-full tw:wrap-anywhere tw:type-body-sm">{description}</span>
      ) : null}
      {children ? (
        <div className="workbench-panel-state__actions tw:mt-1 tw:flex tw:min-h-7 tw:items-center tw:justify-center tw:gap-2">
          {children}
        </div>
      ) : null}
    </div>
  )
}

export function WorkbenchPanelLoading({ label }: { label: string }): React.ReactNode {
  return (
    <WorkbenchPanelStateSurface title={label}>
      <Spinner className="workbench-panel-state__spinner tw:text-app-text" />
    </WorkbenchPanelStateSurface>
  )
}

export function WorkbenchPanelEmpty({
  title,
  description,
  children,
}: Pick<StateSurfaceProps, 'title' | 'description' | 'children'>): React.ReactNode {
  return (
    <WorkbenchPanelStateSurface title={title} description={description}>
      {children}
    </WorkbenchPanelStateSurface>
  )
}

export function WorkbenchPanelUnavailable({
  title,
  description,
}: Pick<StateSurfaceProps, 'title' | 'description'>): React.ReactNode {
  return (
    <WorkbenchPanelStateSurface
      title={title}
      description={description}
      icon={<AlertTriangle size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
      tone="warning"
    />
  )
}

export function WorkbenchPanelError({
  title = '此标签无法显示',
  code,
  message,
  retryable,
  onRetry,
}: {
  title?: string
  code?: string
  message: string
  retryable: boolean
  onRetry?: () => void
}): React.ReactNode {
  return (
    <WorkbenchPanelStateSurface
      title={title}
      description={code ? `${message}（${code}）` : message}
      icon={<AlertTriangle size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
      role="alert"
      tone="warning"
    >
      {retryable && onRetry ? (
        <Button color="secondary" size="compact" onClick={onRetry}>
          <RotateCcw size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
          重试
        </Button>
      ) : null}
    </WorkbenchPanelStateSurface>
  )
}

export function WorkbenchPanelTooLarge({
  title,
  description,
}: Pick<StateSurfaceProps, 'title' | 'description'>): React.ReactNode {
  return <WorkbenchPanelStateSurface title={title} description={description} />
}

export function WorkbenchPanelWarning({
  title,
  description,
  children,
}: Pick<StateSurfaceProps, 'title' | 'description' | 'children'>): React.ReactNode {
  return (
    <WorkbenchPanelStateSurface
      title={title}
      description={description}
      icon={<AlertTriangle size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
      tone="warning"
    >
      {children}
    </WorkbenchPanelStateSurface>
  )
}

export type WorkbenchLauncherAction = {
  disabled?: boolean
  id: string
  icon: React.ReactNode
  label: string
  shortcut?: string
  onSelect: () => void
  reason?: string
}

export function WorkbenchPanelLauncher({
  actions,
}: {
  actions: readonly WorkbenchLauncherAction[]
}): React.ReactNode {
  return (
    <div
      aria-label="可用面板标签"
      className="right-panel-tabs-empty-state tw:flex tw:h-full tw:w-full tw:min-h-0 tw:flex-col tw:justify-center tw:overflow-x-hidden tw:overflow-y-auto tw:bg-app-dock tw:p-2 tw:select-none"
    >
      <div className="right-panel-tabs-empty-state__actions tw:mx-auto tw:grid tw:w-full tw:max-w-144 tw:gap-1">
        {actions.map((action) => (
          <button
            className="right-panel-tabs-empty-state__item tw:grid tw:min-h-10 tw:w-full tw:grid-cols-[var(--cpx-sys-space-6)_minmax(0,1fr)_auto] tw:items-center tw:gap-3 tw:rounded-md tw:border-0 tw:bg-transparent tw:py-2 tw:px-3 tw:text-left tw:text-app-text tw:transition-colors tw:duration-state tw:ease-standard tw:hover:bg-app-hover tw:hover:text-app-text tw:focus-visible:outline-1 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus tw:disabled:text-app-text-disabled"
            disabled={action.disabled}
            key={action.id}
            title={action.reason}
            onClick={action.onSelect}
            type="button"
          >
            <span className="right-panel-tabs-empty-state__icon tw:inline-flex tw:items-center tw:justify-center tw:text-app-text-meta">
              {action.icon}
            </span>
            <strong className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:type-row-title">
              {action.label}
            </strong>
            {action.shortcut ? (
              <kbd className="tw:rounded-full tw:bg-app-selected tw:px-2 tw:py-1 tw:type-meta tw:text-app-text-meta tw:whitespace-nowrap">
                {action.shortcut}
              </kbd>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  )
}

type WorkbenchTabErrorBoundaryProps = {
  tabId: WorkbenchTabId
  children: React.ReactNode
}

type WorkbenchTabErrorBoundaryState = {
  error: Error | null
  retryKey: number
}

export class WorkbenchTabErrorBoundary extends Component<
  WorkbenchTabErrorBoundaryProps,
  WorkbenchTabErrorBoundaryState
> {
  state: WorkbenchTabErrorBoundaryState = { error: null, retryKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<WorkbenchTabErrorBoundaryState> {
    return { error }
  }

  componentDidUpdate(previous: WorkbenchTabErrorBoundaryProps): void {
    if (previous.tabId !== this.props.tabId && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): React.ReactNode {
    if (!this.state.error) {
      return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>
    }
    return (
      <WorkbenchPanelError
        message={this.state.error.message}
        retryable
        onRetry={() =>
          this.setState((state) => ({
            error: null,
            retryKey: state.retryKey + 1,
          }))
        }
      />
    )
  }
}
