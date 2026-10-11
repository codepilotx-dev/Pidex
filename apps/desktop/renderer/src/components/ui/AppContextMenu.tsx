import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { ContextMenu as ContextMenu } from './floating/Menu.js'
import { Check, ChevronRight } from 'lucide-react'
import type { DesktopEditAction } from '@pidex/shared/desktop-edit-ipc'
import { cx } from '../../utils/Cx.js'
import { useFloatingFocusModality } from '../../utils/FloatingFocus.js'
import { APP_ICON_STROKE_WIDTH, APP_ICON_SIZES } from './IconTokens.js'
import { buildPopoverSizingStyle, type PopoverSizingProps } from './PopoverSizing.js'
import { type CapturedEditCommandContext, useEditCommands } from './EditCommandProvider.js'

export type AppContextMenuItemColor = 'red' | 'gray' | 'amber'

export type AppContextMenuLayout = 'flex' | 'grid'

export type AppContextMenuAction =
  | {
      kind: 'item'
      label: string
      icon?: ReactNode
      shortcut?: string
      color?: AppContextMenuItemColor
      disabled?: boolean
      checked?: boolean
      onSelect: () => void
    }
  | { kind: 'separator' }
  | {
      kind: 'sub'
      label: string
      icon?: ReactNode
      children: AppContextMenuAction[]
      layout: AppContextMenuLayout
    }

export type AppContextMenuProps = {
  trigger: ReactNode
  actions: AppContextMenuAction[]
  layout: AppContextMenuLayout
  itemSize?: '1' | '2'
  variant?: 'solid' | 'soft'
  onOpenChange?: (open: boolean) => void
  includeEditActions?: boolean
} & Omit<PopoverSizingProps, 'size'> & {
    size?: PopoverSizingProps['size']
  }

/*
 * Row layout moved from `styles/components/menu-item.scss`
 * (`.app-context-menu--flex` / `.app-context-menu--grid`). The cells keep their
 * label/leading/trailing geometry from `styles/popover.scss`; only the layout
 * dependent pieces are utilities here.
 */
const CONTEXT_ITEM_LAYOUT_CLASSNAMES: Record<AppContextMenuLayout, string> = {
  flex: 'tw:flex tw:items-center tw:gap-row-gap',
  grid: 'tw:grid tw:grid-cols-[var(--cpx-comp-menu-icon-size)_minmax(min-content,1fr)_max-content] tw:items-center tw:gap-x-row-gap',
}

const CONTEXT_LEADING_LAYOUT_CLASSNAMES: Record<AppContextMenuLayout, string> = {
  flex: 'tw:hidden',
  grid: '',
}

const CONTEXT_LABEL_LAYOUT_CLASSNAMES: Record<AppContextMenuLayout, string> = {
  flex: 'tw:min-w-0 tw:grow tw:shrink tw:basis-auto',
  grid: '',
}

const CONTEXT_TRAILING_LAYOUT_CLASSNAMES: Record<AppContextMenuLayout, string> = {
  flex: 'tw:shrink-0 tw:grow-0 tw:basis-auto tw:ml-auto',
  grid: '',
}

export function AppContextMenu({
  trigger,
  actions,
  layout,
  itemSize = '1',
  variant = 'soft',
  size = 'sm',
  onOpenChange,
  includeEditActions = true,
}: AppContextMenuProps): ReactNode {
  const editCommands = useEditCommands()
  const focusModality = useFloatingFocusModality()
  const [editContext, setEditContext] = useState<CapturedEditCommandContext | null>(null)
  const editActions = useMemo(
    () =>
      includeEditActions && editContext
        ? createEditActions(editContext, (action) => {
            void editCommands.perform(action, editContext)
          })
        : [],
    [editCommands, editContext, includeEditActions],
  )
  const mergedActions = useMemo(() => mergeActions(actions, editActions), [actions, editActions])

  function handleContextMenu(event: MouseEvent<HTMLSpanElement>): void {
    if (event.defaultPrevented) return
    const nextContext = includeEditActions ? editCommands.captureContext(event.target) : null
    const nextEditActions = nextContext
      ? createEditActions(nextContext, (action) => {
          void editCommands.perform(action, nextContext)
        })
      : []
    setEditContext(nextContext)
    if (mergeActions(actions, nextEditActions).length === 0) {
      event.preventDefault()
    }
  }

  return (
    <ContextMenu.Root
      onOpenChange={(open) => {
        onOpenChange?.(open)
      }}
    >
      <ContextMenu.Trigger
        asChild
        onContextMenu={handleContextMenu}
        {...focusModality.triggerInteractionProps}
      >
        {trigger}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          size={size}
          className={`app-context-menu-content app-context-menu-root sidebar-context-menu-content app-context-menu--${layout}`}
          collisionPadding={6}
          data-size={itemSize}
          data-variant={variant}
          onCloseAutoFocus={(event) => {
            setEditContext(null)
            focusModality.suppressFocusRingOnClose(event)
          }}
          style={buildPopoverSizingStyle({ size })}
        >
          {mergedActions.map((action, index) => renderAction(action, index, layout))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function renderAction(
  action: AppContextMenuAction,
  key: number,
  layout: AppContextMenuLayout,
): ReactNode {
  switch (action.kind) {
    case 'separator':
      return (
        <ContextMenu.Separator
          className="app-context-menu-separator sidebar-context-menu-separator"
          key={key}
        />
      )
    case 'sub':
      return (
        <ContextMenu.Sub key={key}>
          <ContextMenu.SubTrigger
            className={cx(
              'app-context-menu-sub-trigger',
              'sidebar-context-menu-sub-trigger',
              CONTEXT_ITEM_LAYOUT_CLASSNAMES[layout],
            )}
          >
            <span
              className={cx(
                'app-context-menu-leading',
                'sidebar-context-menu-leading',
                CONTEXT_LEADING_LAYOUT_CLASSNAMES[layout],
              )}
            >
              {action.icon}
            </span>
            <span
              className={cx(
                'app-context-menu-label',
                'sidebar-context-menu-label',
                CONTEXT_LABEL_LAYOUT_CLASSNAMES[layout],
              )}
            >
              {action.label}
            </span>
            <span
              className={cx(
                'app-context-menu-trailing',
                'sidebar-context-menu-trailing',
                CONTEXT_TRAILING_LAYOUT_CLASSNAMES[layout],
              )}
            >
              <ChevronRight
                className="app-context-menu-arrow sidebar-context-menu-arrow"
                size={APP_ICON_SIZES.sm}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </span>
          </ContextMenu.SubTrigger>
          <ContextMenu.Portal>
            <ContextMenu.SubContent
              size="sm"

              className={`app-context-menu-content app-context-menu-sub-content sidebar-context-menu-content app-context-menu--${action.layout}`}
              collisionPadding={6}
              sideOffset={4}
              style={buildPopoverSizingStyle({ size: 'sm' })}
            >
              {action.children.map((child, childKey) =>
                renderAction(child, childKey, action.layout),
              )}
            </ContextMenu.SubContent>
          </ContextMenu.Portal>
        </ContextMenu.Sub>
      )
    case 'item':
      return (
        <ContextMenu.Item
          key={key}
          className={cx(
            'app-context-menu-item',
            'sidebar-context-menu-item',
            CONTEXT_ITEM_LAYOUT_CLASSNAMES[layout],
          )}
          data-color={action.color}
          disabled={action.disabled}
          onSelect={action.onSelect}
        >
          <span
            className={cx(
              'app-context-menu-leading',
              'sidebar-context-menu-leading',
              CONTEXT_LEADING_LAYOUT_CLASSNAMES[layout],
            )}
          >
            {action.icon}
          </span>
          <span
            className={cx(
              'app-context-menu-label',
              'sidebar-context-menu-label',
              CONTEXT_LABEL_LAYOUT_CLASSNAMES[layout],
            )}
          >
            {action.label}
          </span>
          <span
            className={cx(
              'app-context-menu-trailing',
              'sidebar-context-menu-trailing',
              CONTEXT_TRAILING_LAYOUT_CLASSNAMES[layout],
            )}
          >
            {action.checked ? <Check size={APP_ICON_SIZES.sm} /> : null}
            {action.shortcut ? (
              <span className="app-context-menu-shortcut sidebar-context-menu-shortcut">
                {action.shortcut}
              </span>
            ) : null}
          </span>
        </ContextMenu.Item>
      )
  }
}

const EDIT_ACTION_LABELS: Record<DesktopEditAction, string> = {
  undo: '撤销',
  redo: '重做',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  delete: '删除',
  selectAll: '全选',
}

const EDIT_ACTION_SHORTCUTS: Record<DesktopEditAction, string> = {
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
  cut: 'Ctrl+X',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  delete: 'Delete',
  selectAll: 'Ctrl+A',
}

function createEditActions(
  context: CapturedEditCommandContext,
  perform: (action: DesktopEditAction) => void,
): AppContextMenuAction[] {
  const capabilities = context.getCapabilities()
  const item = (action: DesktopEditAction): AppContextMenuAction => ({
    kind: 'item',
    label: EDIT_ACTION_LABELS[action],
    shortcut: EDIT_ACTION_SHORTCUTS[action],
    disabled: !capabilities[action],
    onSelect: () => perform(action),
  })

  if (context.kind === 'selection') return [item('copy')]
  if (context.kind === 'readonly-editor') {
    return [item('copy'), item('selectAll')]
  }
  return [
    item('undo'),
    item('redo'),
    { kind: 'separator' },
    item('cut'),
    item('copy'),
    item('paste'),
    item('delete'),
    { kind: 'separator' },
    item('selectAll'),
  ]
}

function mergeActions(
  primary: AppContextMenuAction[],
  secondary: AppContextMenuAction[],
): AppContextMenuAction[] {
  const merged = [
    ...trimSeparators(primary),
    ...(hasItems(primary) && hasItems(secondary) ? [{ kind: 'separator' as const }] : []),
    ...trimSeparators(secondary),
  ]
  return merged.filter(
    (action, index) =>
      action.kind !== 'separator' || (index > 0 && merged[index - 1]?.kind !== 'separator'),
  )
}

function trimSeparators(actions: AppContextMenuAction[]): AppContextMenuAction[] {
  let start = 0
  let end = actions.length
  while (actions[start]?.kind === 'separator') start += 1
  while (actions[end - 1]?.kind === 'separator') end -= 1
  return actions.slice(start, end)
}

function hasItems(actions: AppContextMenuAction[]): boolean {
  return actions.some((action) => action.kind !== 'separator')
}
