import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { ExternalLink, MoveDown, MoveRight, PanelLeft, Pin, Plus, X } from 'lucide-react'
import { AppContextMenu } from '../../../components/ui/AppContextMenu.js'
import { Button } from '../../../components/ui/Button.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import { PopoverRadioGroup, PopoverRadioItem } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { cx } from '../../../utils/Cx.js'
import { canViewFloat, getAvailableMoveTargets } from '../dock/CompositeViews.js'
import type {
  WorkbenchPanelSnapshot,
  WorkbenchPanelTarget,
  WorkbenchTabDescriptor,
  WorkbenchTabId,
  WorkbenchTabsState,
} from '../dock/RightDockState.js'
import {
  createLauncherTab,
  getWorkbenchLauncherDefinitions,
  getWorkbenchLauncherPresentation,
  getWorkbenchTabDefinition,
  getWorkbenchTabDisplayTitle,
} from './WorkbenchTabRegistry.js'

export type WorkbenchTabStripProps = {
  target: WorkbenchPanelTarget
  state: WorkbenchPanelSnapshot
  tabsById: WorkbenchTabsState['tabsById']
  terminalDisplayPath: string | null
  onClosePanel?: () => void
  onCloseTab: (tabId: WorkbenchTabId) => void
  onCloseOtherTabs: (tabId: WorkbenchTabId) => void
  onCloseTabsToRight: (tabId: WorkbenchTabId) => void
  onOpenTab: (tab: WorkbenchTabDescriptor) => void
  onCreateSideChat: () => void
  onCreateTerminal?: () => void
  sideChatAvailable: boolean
  onSelectTab: (tabId: WorkbenchTabId) => void
  onMoveTab: (
    source: WorkbenchPanelTarget,
    target: WorkbenchPanelTarget,
    tabId: WorkbenchTabId,
    index?: number,
  ) => void
  onReorderTab: (target: WorkbenchPanelTarget, tabId: WorkbenchTabId, index: number) => void
  onPinTab: (tabId: WorkbenchTabId) => void
  onPopOutTab?: (source: WorkbenchPanelTarget, tabId: WorkbenchTabId) => void
}

export function WorkbenchTabStrip({
  target,
  state,
  tabsById,
  terminalDisplayPath,
  onClosePanel,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onOpenTab,
  onCreateSideChat,
  onCreateTerminal,
  sideChatAvailable,
  onSelectTab,
  onMoveTab,
  onReorderTab,
  onPinTab,
  onPopOutTab,
}: WorkbenchTabStripProps): React.ReactNode {
  const tabRefs = useRef(new Map<WorkbenchTabId, HTMLButtonElement>())
  const [menuOpen, setMenuOpen] = useState(false)
  const providerManagementOnly = state.tabIds.some(
    (id) => tabsById[id]?.kind === 'provider-management',
  )
  const launchers = useMemo(
    () =>
      getWorkbenchLauncherDefinitions().filter(
        (definition) => definition.kind !== 'side-chat' || sideChatAvailable,
      ),
    [sideChatAvailable],
  )
  const stripTabCount = state.tabIds.length

  useEffect(() => {
    const activeTabId = state.activeTabId
    if (!activeTabId) return
    tabRefs.current.get(activeTabId)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    })
  }, [state.activeTabId])

  // 标签栏在布局切换时保持同一实例，横向 scrollLeft 由浏览器自然保留。
  const focusAt = (index: number): void => {
    const tabId = state.tabIds[index]
    if (!tabId) return
    onSelectTab(tabId)
    requestAnimationFrame(() => tabRefs.current.get(tabId)?.focus())
  }

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
    tabId: WorkbenchTabId,
  ): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusAt((index - 1 + stripTabCount) % stripTabCount)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusAt((index + 1) % stripTabCount)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(stripTabCount - 1)
    } else if (event.key === 'Delete') {
      event.preventDefault()
      onCloseTab(tabId)
    }
  }

  return (
    <div className="right-dock-tabs-header tw:flex tw:min-w-0 tw:h-full tw:grow tw:shrink tw:basis-auto tw:items-center tw:overflow-hidden">
      <div className="right-dock-tabs-viewport tw:relative tw:flex tw:min-w-0 tw:h-full tw:grow tw:shrink tw:basis-auto tw:items-center tw:overflow-x-auto tw:overflow-y-hidden tw:scroll-px-1">
        <div
          aria-label={target === 'right' ? '右侧面板标签' : '底部面板标签'}
          className="right-dock-tab-list tw:flex tw:h-full tw:w-full tw:min-w-full tw:grow tw:shrink-0 tw:basis-auto tw:items-center tw:gap-1"
          role="tablist"
        >
          {state.tabIds.map((tabId, index) => {
            const tab = tabsById[tabId]
            if (!tab) return null
            const definition = getWorkbenchTabDefinition(tab)
            const tabIcon = definition.getIcon?.(tab) ?? definition.icon
            const tabTitle = getWorkbenchTabDisplayTitle(tab, terminalDisplayPath)
            const active = state.activeTabId === tab.id
            const canCloseRight = index < stripTabCount - 1
            const hasDivider =
              !active && canCloseRight && state.tabIds[index + 1] !== state.activeTabId
            return (
              <Fragment key={tab.id}>
                <AppContextMenu
                  actions={[
                    ...(tab.kind === 'file-preview' && tab.preview
                      ? [
                          {
                            kind: 'item' as const,
                            label: '固定预览',
                            icon: <Pin size={APP_ICON_SIZE} />,
                            onSelect: () => onPinTab(tab.id),
                          },
                        ]
                      : []),
                    {
                      kind: 'item',
                      label: '关闭',
                      onSelect: () => onCloseTab(tab.id),
                    },
                    {
                      kind: 'item',
                      label: '关闭其他标签',
                      disabled: state.tabIds.length <= 1,
                      onSelect: () => onCloseOtherTabs(tab.id),
                    },
                    {
                      kind: 'item',
                      label: '关闭右侧标签',
                      disabled: !canCloseRight,
                      onSelect: () => onCloseTabsToRight(tab.id),
                    },
                    ...(getAvailableMoveTargets(target, tab.kind).length > 0
                      ? [
                          { kind: 'separator' as const },
                          ...getAvailableMoveTargets(target, tab.kind).map((destTarget) => ({
                            kind: 'item' as const,
                            label: `移到${destTarget === 'sidebar' ? '侧边栏' : destTarget === 'bottom' ? '底部面板' : '右侧面板'}`,
                            icon:
                              destTarget === 'sidebar' ? (
                                <PanelLeft size={APP_ICON_SIZE} />
                              ) : destTarget === 'bottom' ? (
                                <MoveDown size={APP_ICON_SIZE} />
                              ) : (
                                <MoveRight size={APP_ICON_SIZE} />
                              ),
                            onSelect: () => onMoveTab(target, destTarget, tab.id),
                          })),
                        ]
                      : []),
                    ...(canViewFloat(tab.kind) && onPopOutTab
                      ? [
                          { kind: 'separator' as const },
                          {
                            kind: 'item' as const,
                            label: '弹出到独立窗口',
                            icon: <ExternalLink size={APP_ICON_SIZE} />,
                            onSelect: () => onPopOutTab(target, tab.id),
                          },
                        ]
                      : []),
                  ]}
                  layout="grid"
                  trigger={
                    <div
                      className={cx(
                        'right-dock-tab-wrap tw:group tw:relative tw:flex tw:h-7 tw:min-w-22.5 tw:max-w-39 tw:flex-[1_1_156px] tw:items-center tw:overflow-hidden tw:rounded-lg tw:border tw:border-transparent tw:px-2 tw:py-1 tw:shadow-none tw:transition-[background-color,border-color,color] tw:duration-state tw:ease-standard tw:[&.dragging]:opacity-50',
                        active
                          ? 'active tw:bg-app-selected tw:text-app-text'
                          : 'tw:text-app-text-meta tw:hover:bg-app-hover tw:hover:text-app-text-soft tw:focus-within:bg-app-hover tw:focus-within:text-app-text-soft',
                        hasDivider && 'has-divider',
                      )}
                      data-panel-tab={tab.id}
                      draggable={!providerManagementOnly}
                      onDragEnd={(event) => event.currentTarget.classList.remove('dragging')}
                      onDragOver={(event) => event.preventDefault()}
                      onDragStart={(event) => {
                        event.currentTarget.classList.add('dragging')
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData(
                          'application/x-pidex-workbench-tab',
                          JSON.stringify({ source: target, tabId: tab.id }),
                        )
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        const payload = readTabDragPayload(event)
                        if (!payload) return
                        const sourceTab = tabsById[payload.tabId]
                        if (target === 'bottom' && sourceTab?.kind !== 'terminal') return
                        if (payload.source === target) {
                          onReorderTab(target, payload.tabId, index)
                        } else {
                          onMoveTab(payload.source, target, payload.tabId, index)
                        }
                      }}
                    >
                      <button
                        ref={(element) => {
                          if (element) tabRefs.current.set(tab.id, element)
                          else tabRefs.current.delete(tab.id)
                        }}
                        aria-controls={`workbench-panel-${target}-${domId(tab.id)}`}
                        aria-selected={active}
                        className={cx(
                          'right-dock-tab tw:pr-5 tw:relative tw:inline-flex tw:min-w-0 tw:grow tw:shrink tw:basis-auto tw:items-center tw:gap-2 tw:overflow-hidden tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:whitespace-nowrap tw:type-control tw:focus-visible:outline-app-accent/72',
                          active && 'active',
                          tab.kind === 'file-preview' && tab.preview && 'preview tw:italic',
                        )}
                        id={`workbench-tab-${target}-${domId(tab.id)}`}
                        role="tab"
                        tabIndex={active ? 0 : -1}
                        title={tabTitle}
                        type="button"
                        onClick={() => onSelectTab(tab.id)}
                        onDoubleClick={() => {
                          if (tab.kind === 'file-preview' && tab.preview) {
                            onPinTab(tab.id)
                          }
                        }}
                        onKeyDown={(event) => handleTabKeyDown(event, index, tab.id)}
                        onMouseDown={(event) => {
                          if (event.button === 1) event.preventDefault()
                        }}
                        onAuxClick={(event) => {
                          if (event.button !== 1) return
                          event.preventDefault()
                          event.stopPropagation()
                          onCloseTab(tab.id)
                        }}
                      >
                        <span className="right-dock-tab-icon tw:inline-flex tw:size-icon tw:items-center tw:justify-center tw:[&>svg]:size-icon">
                          {tabIcon}
                        </span>
                        <span className="right-dock-tab-title tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:whitespace-nowrap">
                          {tabTitle}
                        </span>
                      </button>
                      <Button
                        isIconOnly
                        className={cx(
                          'right-dock-tab-close tw:absolute tw:right-1 tw:top-1/2 tw:-translate-y-1/2 tw:z-local tw:inline-flex tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:text-app-text-meta tw:transition-[background-color,color,opacity] tw:duration-feedback tw:ease-standard tw:group-hover:opacity-100 tw:group-hover:pointer-events-auto tw:group-focus-within:opacity-100 tw:group-focus-within:pointer-events-auto tw:focus-visible:pointer-events-auto tw:focus-visible:bg-app-hover tw:focus-visible:text-app-text tw:focus-visible:opacity-100 tw:focus-visible:outline-app-accent/72',
                          active
                            ? 'tw:pointer-events-auto tw:opacity-100'
                            : 'tw:pointer-events-none tw:opacity-0',
                        )}
                        color="ghost"
                        size="iconMd"
                        title={`关闭 ${tabTitle}`}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          onCloseTab(tab.id)
                        }}
                      >
                        <X size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                      </Button>
                    </div>
                  }
                  size="md"
                />
              </Fragment>
            )
          })}
          {target === 'bottom' ? (
            <Button
              isIconOnly
              className="right-dock-add-button tw:hover:shadow-none tw:focus-visible:outline-app-accent/72"
              color="ghostSecondary"
              size="toolbar"
              title="新建终端"
              onClick={onCreateTerminal}
            >
              <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Button>
          ) : state.tabIds.length > 0 && !providerManagementOnly ? (
            <PopoverMenu
              align="end"
              avoidCollisions={false}
              className="popover-right-dock-add popover-menu--grid tw:block"
              collisionPadding={6}
              open={menuOpen}
              side="bottom"
              sideOffset={4}
              size="sm"
              trigger={
                <Button
                  isIconOnly
                  className="right-dock-add-button tw:hover:shadow-none tw:focus-visible:outline-app-accent/72"
                  color="ghostSecondary"
                  size="toolbar"
                  title="添加标签"
                >
                  <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </Button>
              }
              onOpenChange={setMenuOpen}
            >
              <PopoverRadioGroup
                value={
                  launchers.find(
                    (definition) => createLauncherTab(definition.kind)?.id === state.activeTabId,
                  )?.kind ?? ''
                }
                onValueChange={(kind) => {
                  const definition = launchers.find((item) => item.kind === kind)
                  if (!definition) return
                  if (definition.kind === 'side-chat') {
                    onCreateSideChat()
                    setMenuOpen(false)
                    return
                  }
                  const candidate = createLauncherTab(definition.kind)
                  if (!candidate) return
                  if (state.tabIds.includes(candidate.id)) {
                    onSelectTab(candidate.id)
                  } else {
                    onOpenTab(candidate)
                  }
                  setMenuOpen(false)
                }}
              >
                {launchers.map((definition) => {
                  const presentation = getWorkbenchLauncherPresentation(definition)
                  return (
                    <PopoverRadioItem
                      icon={presentation.icon}
                      key={definition.kind}
                      shortcut={presentation.shortcut}
                      value={definition.kind}
                    >
                      {presentation.label}
                    </PopoverRadioItem>
                  )
                })}
              </PopoverRadioGroup>
            </PopoverMenu>
          ) : null}
          <span
            aria-hidden="true"
            className="right-dock-tab-empty tw:h-full tw:min-w-3 tw:grow tw:shrink-0 tw:basis-3"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              const payload = readTabDragPayload(event)
              if (payload && payload.source !== target) {
                const sourceTab = tabsById[payload.tabId]
                if (target === 'bottom' && sourceTab?.kind !== 'terminal') return
                onMoveTab(payload.source, target, payload.tabId)
              }
            }}
          />
        </div>
      </div>
      {target === 'bottom' && onClosePanel ? (
        <Button
          isIconOnly
          className="bottom-panel-close tw:ml-1 tw:focus-visible:outline-app-accent/72"
          color="ghostSecondary"
          size="toolbar"
          title="关闭底部面板"
          onClick={onClosePanel}
        >
          <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </Button>
      ) : null}
    </div>
  )
}

function readTabDragPayload(event: React.DragEvent): {
  source: WorkbenchPanelTarget
  tabId: WorkbenchTabId
} | null {
  const raw = event.dataTransfer.getData('application/x-pidex-workbench-tab')
  try {
    const value = JSON.parse(raw) as {
      source?: unknown
      tabId?: unknown
    }
    if (
      (value.source === 'right' || value.source === 'bottom' || value.source === 'sidebar') &&
      typeof value.tabId === 'string'
    ) {
      return {
        source: value.source,
        tabId: value.tabId as WorkbenchTabId,
      }
    }
  } catch {
    /* Ignore unrelated drag payloads. */
  }
  return null
}

export function workbenchTabDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function domId(value: string): string {
  return workbenchTabDomId(value)
}
