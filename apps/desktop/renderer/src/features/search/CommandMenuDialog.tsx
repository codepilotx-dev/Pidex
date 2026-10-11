import type React from 'react'
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import { FileSearch, FolderOpen, Search, SquarePen } from 'lucide-react'
import type { DesktopSessionCatalogStatus } from '../../../shared/Types.js'
import { useDialogFocusRestore } from '../../components/ui/UseDialogFocusRestore.js'
import { Spinner } from '../../components/ui/Spinner.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import type { SessionListItem } from '../../UiTypes.js'
import type { CommandMenuTask } from './CommandMenuModel.js'
import {
  commandMenuActionStore,
  filterCommandMenuActions,
  type CommandMenuActionGroup,
  type CommandMenuActionSnapshot,
} from './CommandMenuActionStore.js'
import { useCommandMenuController } from './UseCommandMenuController.js'

export type CommandMenuDialogProps = {
  open: boolean
  sessions: readonly SessionListItem[]
  pendingPermissionSessionIds?: ReadonlySet<string>
  catalogStatus: DesktopSessionCatalogStatus
  hasWorkspace: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  onOpenChange: (open: boolean) => void
  onSelectTask: (task: CommandMenuTask) => void
  onCreateTask: () => void
  onOpenFolder: () => void
  onSearchFiles: () => void
}

type Recommendation = {
  id: 'new-task' | 'open-folder' | 'search-files'
  label: string
  description?: string
  shortcut: string
  icon: React.ReactNode
  disabled?: boolean
  action: () => void
}

export function CommandMenuDialog({
  open,
  sessions,
  pendingPermissionSessionIds,
  catalogStatus,
  hasWorkspace,
  inputRef,
  onOpenChange,
  onSelectTask,
  onCreateTask,
  onOpenFolder,
  onSearchFiles,
}: CommandMenuDialogProps): React.ReactNode {
  const internalInputRef = useRef<HTMLInputElement | null>(null)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const setInputRef = useCallback(
    (element: HTMLInputElement | null): void => {
      internalInputRef.current = element
      if (inputRef) inputRef.current = element
    },
    [inputRef],
  )
  const { query, setQuery, tasks } = useCommandMenuController({
    sessions,
    pendingPermissionSessionIds,
    onSelectTask,
  })
  const registeredActions = useSyncExternalStore(
    commandMenuActionStore.subscribe,
    commandMenuActionStore.getSnapshot,
    commandMenuActionStore.getServerSnapshot,
  )
  const actions = useMemo(
    () => filterCommandMenuActions(registeredActions, query),
    [query, registeredActions],
  )
  const showRecommendations = query.trim().length === 0
  const recommendations: Recommendation[] = [
    {
      id: 'new-task',
      label: '新建对话',
      shortcut: 'Ctrl+N',
      icon: <SquarePen aria-hidden="true" size={APP_ICON_SIZE} />,
      action: onCreateTask,
    },
    {
      id: 'open-folder',
      label: '打开文件夹',
      shortcut: 'Ctrl+O',
      icon: <FolderOpen aria-hidden="true" size={APP_ICON_SIZE} />,
      action: onOpenFolder,
    },
    {
      id: 'search-files',
      label: '搜索文件',
      description: hasWorkspace ? undefined : '请先打开文件夹',
      shortcut: 'Ctrl+P',
      icon: <FileSearch aria-hidden="true" size={APP_ICON_SIZE} />,
      disabled: !hasWorkspace,
      action: onSearchFiles,
    },
  ]

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop command-menu-backdrop tw:fixed tw:inset-0 tw:z-modal tw:flex tw:items-center tw:justify-center tw:bg-app-scrim tw:backdrop-blur-none tw:@max-[560px]:px-2" />
        <Dialog.Content
          aria-describedby="command-menu-description"
          className="ui-dialog-surface ui-dialog-surface--centered command-menu-dialog tw:w-[min(520px,92vw)] tw:max-h-[calc(100vh-clamp(6rem,16vh,10rem))] tw:overflow-hidden tw:rounded-none tw:border tw:border-app-border-subtle tw:bg-app-raised tw:shadow-none tw:text-app-text tw:outline-none tw:[-webkit-app-region:no-drag] tw:forced-colors:border-[CanvasText] tw:@max-[560px]:w-full"
          onCloseAutoFocus={onCloseAutoFocus}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            internalInputRef.current?.focus()
            internalInputRef.current?.select()
          }}
        >
          <Dialog.Title className="tw:sr-only">任务命令菜单</Dialog.Title>
          <Dialog.Description className="tw:sr-only" id="command-menu-description">
            搜索最近任务，或执行常用操作。
          </Dialog.Description>
          <Command
            className="command-menu tw:flex tw:min-h-0 tw:flex-col"
            label="搜索任务"
            shouldFilter={false}
            vimBindings={false}
          >
            <div className="command-menu-search tw:flex tw:min-h-8 tw:flex-none tw:items-center tw:gap-2 tw:border-b tw:border-app-border-subtle tw:px-3 tw:text-app-text-soft tw:focus-within:shadow-[var(--cpx-sys-focus-ring-inset)] tw:forced-colors:focus-within:shadow-none tw:forced-colors:focus-within:outline-offset-[-2px] tw:forced-colors:focus-within:[outline:2px_solid_Highlight]">
              <Search
                aria-hidden="true"
                className="command-menu-search-icon tw:flex-none"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
              <input
                aria-keyshortcuts="Control+K Control+Shift+P"
                aria-label="搜索任务"
                className="command-menu-input tw:min-h-8 tw:min-w-0 tw:flex-1 tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text tw:type-body tw:outline-none tw:placeholder:text-app-text-meta tw:forced-colors:focus:outline-offset-[-2px] tw:forced-colors:focus:[outline:2px_solid_Highlight]"
                defaultValue={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="搜索任务"
                ref={setInputRef}
                type="search"
              />
            </div>
            <Command.List className="command-menu-list tw:max-h-110 tw:min-h-0 tw:overflow-x-hidden tw:overflow-y-auto tw:overscroll-contain tw:p-2 tw:scroll-py-2">
              <CommandMenuTaskGroup
                catalogStatus={catalogStatus}
                query={query}
                tasks={tasks}
                onSelectTask={onSelectTask}
              />
              <CommandMenuActionGroups
                actions={actions}
                onSelect={(action) => {
                  onOpenChange(false)
                  queueMicrotask(() => {
                    void Promise.resolve(action.execute()).catch(reportCommandActionError)
                  })
                }}
              />
              {showRecommendations ? (
                <Command.Group
                  className="command-menu-group tw:[&:not(:first-child)]:mt-2 tw:[&_[cmdk-group-heading]]:px-2 tw:[&_[cmdk-group-heading]]:py-1 tw:[&_[cmdk-group-heading]]:type-label tw:[&_[cmdk-group-heading]]:text-app-text-meta"
                  heading="推荐"
                >
                  {recommendations.map((recommendation) => (
                    <Command.Item
                      className="command-menu-item command-menu-recommendation tw:grid-cols-[var(--cpx-sys-space-4)_minmax(0,1fr)_auto] tw:grid tw:min-h-7 tw:w-full tw:min-w-0 tw:cursor-default tw:select-none tw:items-center tw:gap-2 tw:rounded-md tw:border-0 tw:bg-transparent tw:p-2 tw:text-left tw:text-app-text tw:type-body tw:outline-none tw:data-[selected=true]:bg-app-selected tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)] tw:data-[disabled=true]:text-app-text-disabled tw:data-[disabled=true]:opacity-68 tw:forced-colors:data-[selected=true]:outline-offset-[-2px] tw:forced-colors:data-[selected=true]:[outline:2px_solid_Highlight] tw:forced-colors:focus-visible:shadow-none tw:forced-colors:focus-visible:outline-offset-[-2px] tw:forced-colors:focus-visible:[outline:2px_solid_Highlight]"
                      disabled={recommendation.disabled}
                      key={recommendation.id}
                      onSelect={() => {
                        if (!recommendation.disabled) {
                          recommendation.action()
                        }
                      }}
                      value={`recommendation:${recommendation.id}`}
                    >
                      <span className="command-menu-item-status tw:inline-flex tw:size-4 tw:items-center tw:justify-center tw:text-app-text-soft command-menu-item-icon tw:text-current">
                        {recommendation.icon}
                      </span>
                      <span className="command-menu-item-copy tw:grid tw:min-w-0">
                        <span className="command-menu-item-title tw:truncate tw:text-current">
                          {recommendation.label}
                        </span>
                        {recommendation.description ? (
                          <span className="command-menu-item-description tw:truncate tw:type-caption tw:text-app-text-meta">
                            {recommendation.description}
                          </span>
                        ) : null}
                      </span>
                      <kbd className="command-menu-shortcut tw:min-w-max tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-surface-control)_72%,transparent)] tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-meta tw:forced-colors:border-[CanvasText]">
                        {recommendation.shortcut}
                      </kbd>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const commandGroupLabels: Record<CommandMenuActionGroup, string> = {
  'workspace-actions': '工作区操作',
  'task-transfer': '任务移交',
}

function CommandMenuActionGroups({
  actions,
  onSelect,
}: {
  actions: readonly CommandMenuActionSnapshot[]
  onSelect: (action: CommandMenuActionSnapshot) => void
}): React.ReactNode {
  return (Object.keys(commandGroupLabels) as CommandMenuActionGroup[]).map((group) => {
    const groupActions = actions.filter((action) => action.group === group)
    if (groupActions.length === 0) return null
    return (
      <Command.Group
        className="command-menu-group tw:[&:not(:first-child)]:mt-2 tw:[&_[cmdk-group-heading]]:px-2 tw:[&_[cmdk-group-heading]]:py-1 tw:[&_[cmdk-group-heading]]:type-label tw:[&_[cmdk-group-heading]]:text-app-text-meta"
        heading={commandGroupLabels[group]}
        key={group}
      >
        {groupActions.map((action) => {
          const disabled = action.availability !== 'available'
          const description = action.disabledReason ?? action.description
          return (
            <Command.Item
              className="command-menu-item command-menu-recommendation tw:grid-cols-[var(--cpx-sys-space-4)_minmax(0,1fr)_auto] tw:grid tw:min-h-7 tw:w-full tw:min-w-0 tw:cursor-default tw:select-none tw:items-center tw:gap-2 tw:rounded-md tw:border-0 tw:bg-transparent tw:p-2 tw:text-left tw:text-app-text tw:type-body tw:outline-none tw:data-[selected=true]:bg-app-selected tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)] tw:data-[disabled=true]:text-app-text-disabled tw:data-[disabled=true]:opacity-68 tw:forced-colors:data-[selected=true]:outline-offset-[-2px] tw:forced-colors:data-[selected=true]:[outline:2px_solid_Highlight] tw:forced-colors:focus-visible:shadow-none tw:forced-colors:focus-visible:outline-offset-[-2px] tw:forced-colors:focus-visible:[outline:2px_solid_Highlight]"
              disabled={disabled}
              key={action.id}
              onSelect={() => {
                if (!disabled) onSelect(action)
              }}
              value={`action:${action.id}`}
            >
              <span className="command-menu-item-status tw:inline-flex tw:size-4 tw:items-center tw:justify-center tw:text-app-text-soft command-menu-item-icon tw:text-current">
                {action.availability === 'loading' ? (
                  <Spinner className="command-menu-spinner tw:flex-none" />
                ) : (
                  action.icon
                )}
              </span>
              <span className="command-menu-item-copy tw:grid tw:min-w-0">
                <span className="command-menu-item-title tw:truncate tw:text-current">
                  {action.label}
                </span>
                {description ? (
                  <span className="command-menu-item-description tw:truncate tw:type-caption tw:text-app-text-meta">
                    {description}
                  </span>
                ) : null}
              </span>
            </Command.Item>
          )
        })}
      </Command.Group>
    )
  })
}

function reportCommandActionError(cause: unknown): void {
  if (typeof window === 'undefined') return
  const detail = cause instanceof Error ? cause.message : '命令执行失败，请重试。'
  window.dispatchEvent(new CustomEvent('desktop:error', { detail }))
}

export function CommandMenuTaskGroup({
  catalogStatus,
  query,
  tasks,
  onSelectTask,
}: {
  catalogStatus: DesktopSessionCatalogStatus
  query: string
  tasks: readonly CommandMenuTask[]
  onSelectTask: (task: CommandMenuTask) => void
}): React.ReactNode {
  const emptyLabel = query.trim() ? '没有找到匹配的任务' : '暂无任务'

  return (
    <Command.Group
      className="command-menu-group tw:[&:not(:first-child)]:mt-2 tw:[&_[cmdk-group-heading]]:px-2 tw:[&_[cmdk-group-heading]]:py-1 tw:[&_[cmdk-group-heading]]:type-label tw:[&_[cmdk-group-heading]]:text-app-text-meta"
      heading="任务"
    >
      {catalogStatus.state === 'loading' ? (
        <CommandMenuStatus busy>正在加载任务目录…</CommandMenuStatus>
      ) : tasks.length === 0 ? (
        <CommandMenuStatus>{emptyLabel}</CommandMenuStatus>
      ) : (
        tasks.map((task) => (
          <Command.Item
            className="command-menu-item command-menu-task tw:grid tw:min-h-7 tw:w-full tw:min-w-0 tw:cursor-default tw:grid-cols-[var(--cpx-sys-space-4)_minmax(0,1fr)_auto] tw:select-none tw:items-center tw:gap-2 tw:rounded-md tw:border-0 tw:bg-transparent tw:p-2 tw:text-left tw:text-app-text tw:type-body tw:outline-none tw:data-[selected=true]:bg-app-selected tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)] tw:data-[disabled=true]:text-app-text-disabled tw:data-[disabled=true]:opacity-68 tw:forced-colors:data-[selected=true]:outline-offset-[-2px] tw:forced-colors:data-[selected=true]:[outline:2px_solid_Highlight] tw:forced-colors:focus-visible:shadow-none tw:forced-colors:focus-visible:outline-offset-[-2px] tw:forced-colors:focus-visible:[outline:2px_solid_Highlight]"
            key={task.id}
            onSelect={() => onSelectTask(task)}
            value={`task:${task.id}`}
          >
            <TaskStatus task={task} />
            <span className="command-menu-item-copy tw:grid tw:min-w-0">
              <span className="command-menu-item-title tw:truncate tw:text-current">
                {task.title}
              </span>
            </span>
            <span className="command-menu-workspace tw:max-w-36 tw:truncate tw:type-caption tw:text-app-text-meta tw:@max-[560px]:max-w-24">
              {task.workspaceName}
            </span>
            <kbd className="command-menu-shortcut tw:min-w-max tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-surface-control)_72%,transparent)] tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-meta tw:forced-colors:border-[CanvasText]">
              {task.shortcutLabel}
            </kbd>
          </Command.Item>
        ))
      )}
    </Command.Group>
  )
}

function CommandMenuStatus({
  busy = false,
  children,
}: {
  busy?: boolean
  children: React.ReactNode
}): React.ReactNode {
  return (
    <Command.Item
      aria-busy={busy || undefined}
      className="command-menu-status tw:flex tw:min-h-[calc(var(--cpx-sys-space-7)+var(--cpx-sys-space-2))] tw:items-center tw:justify-center tw:gap-2 tw:p-3 tw:text-center tw:type-body-sm tw:text-app-text-meta"
      disabled
      value="command-menu-status"
    >
      {busy ? <Spinner className="command-menu-spinner tw:flex-none" /> : null}
      <span>{children}</span>
    </Command.Item>
  )
}

function TaskStatus({ task }: { task: CommandMenuTask }): React.ReactNode {
  if (task.visualState === 'needs-input' || task.visualState === 'running') {
    return (
      <span
        aria-label={task.visualState === 'needs-input' ? '任务正在等待输入' : '任务正在运行'}
        className="command-menu-item-status tw:inline-flex tw:size-4 tw:items-center tw:justify-center tw:text-app-text-soft"
        role="img"
      >
        <Spinner className="command-menu-spinner tw:flex-none" />
      </span>
    )
  }
  if (task.visualState === 'unread') {
    return (
      <span
        aria-label="任务有待整理更新"
        className="command-menu-item-status tw:inline-flex tw:size-4 tw:items-center tw:justify-center tw:text-app-text-soft"
        role="img"
      >
        <span
          aria-hidden="true"
          className="command-menu-unread-dot tw:size-1.5 tw:rounded-full tw:bg-app-accent tw:forced-colors:bg-[Highlight]"
        />
      </span>
    )
  }
  return (
    <span
      aria-hidden="true"
      className="command-menu-item-status tw:inline-flex tw:size-4 tw:items-center tw:justify-center tw:text-app-text-soft"
    />
  )
}
