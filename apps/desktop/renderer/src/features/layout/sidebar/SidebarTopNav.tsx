import type React from 'react'
import { useEffect, useState } from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type { ProtocolCapability } from '@pidex/agent-protocol'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell,
  Blocks,
  Clock3,
  FolderKanban,
  MessagesSquare,
  Search,
  SquarePen,
  X,
} from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import type { SidebarProductMode } from '../../../../shared/Types.js'
import type { AppView } from '../../../UiTypes.js'
import { newSessionPath } from '../../session/NewSessionSurface.js'
import type { NewSessionSurface } from '../../session/NewSessionSurface.js'

import { Tooltip } from '../../../components/ui/Tooltip.js'
import { Popover as Popover } from '../../../components/ui/floating/Popover.js'
import { cx } from '../../../utils/Cx.js'
import { useDesktopSettings } from '../../settings/UseDesktopSettings.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import { SidebarRow } from './SidebarRow.js'

type SidebarNavAvailability =
  | { kind: 'always' }
  | {
      kind: 'any-capability'
      capabilities: readonly ProtocolCapability[]
    }

export type SidebarCapabilityState =
  | { status: 'unknown'; capabilities: null }
  | { status: 'ready'; capabilities: ReadonlySet<ProtocolCapability> }
  | { status: 'unavailable'; capabilities: null }

export type SidebarNavItem = {
  view: AppView
  label: string
  icon: React.ReactNode
  path: string
  availability: SidebarNavAvailability
}

export const UNKNOWN_SIDEBAR_CAPABILITY_STATE: SidebarCapabilityState = {
  status: 'unknown',
  capabilities: null,
}

export function useSidebarCapabilities(): SidebarCapabilityState {
  const [state, setState] = useState<SidebarCapabilityState>(UNKNOWN_SIDEBAR_CAPABILITY_STATE)
  useEffect(() => {
    let active = true
    void desktopClient
      .getRuntimeCapabilities()
      .then((capabilities) => {
        if (active) setState({ status: 'ready', capabilities: new Set(capabilities) })
      })
      .catch(() => {
        if (active) setState({ status: 'unavailable', capabilities: null })
      })
    return () => {
      active = false
    }
  }, [])
  return state
}

export const TOP_NAV_ITEMS: SidebarNavItem[] = [
  {
    view: 'new',
    label: '新建任务',
    icon: <SquarePen size={APP_ICON_SIZE} />,
    path: '/new',
    availability: { kind: 'always' },
  },
  {
    view: 'sessionGroups',
    label: '工作流',
    icon: <MessagesSquare size={APP_ICON_SIZE} />,
    path: '/workflows',
    availability: {
      kind: 'any-capability',
      capabilities: ['workflow.v1' as ProtocolCapability, 'session-group.v1' as ProtocolCapability],
    },
  },
  {
    view: 'automations',
    label: '已安排',
    icon: <Clock3 size={APP_ICON_SIZE} />,
    path: '/automations',
    availability: { kind: 'always' },
  },
  {
    view: 'plugins',
    label: '插件',
    icon: <Blocks size={APP_ICON_SIZE} />,
    path: '/plugins',
    availability: {
      kind: 'any-capability',
      capabilities: ['skills.manage.v1', 'mcp.manage.v1'],
    },
  },
]

export const PROJECTS_NAV_ITEM: SidebarNavItem = {
  view: 'projects',
  label: '项目',
  icon: <FolderKanban size={APP_ICON_SIZE} />,
  path: '/projects',
  availability: { kind: 'always' },
}

export function getSidebarTopNavItems({
  showProjects,
  surface,
  capabilityState,
}: {
  showProjects: boolean
  surface?: NewSessionSurface
  capabilityState: SidebarCapabilityState
}): SidebarNavItem[] {
  const newItem = surface
    ? { ...TOP_NAV_ITEMS[0]!, path: newSessionPath(surface) }
    : TOP_NAV_ITEMS[0]!
  const items = showProjects
    ? [newItem, TOP_NAV_ITEMS[1]!, PROJECTS_NAV_ITEM, ...TOP_NAV_ITEMS.slice(2)]
    : [newItem, ...TOP_NAV_ITEMS.slice(1)]

  // capability 未就绪或不可用时，仅暴露 always 入口，避免点入未接线的能力。
  if (capabilityState.status !== 'ready') {
    return items.filter((item) => item.availability.kind === 'always')
  }
  return items.filter(
    (item) =>
      item.availability.kind === 'always' ||
      item.availability.capabilities.some((capability) =>
        capabilityState.capabilities.has(capability),
      ),
  )
}

/**
 * 将最终导航数组拆成固定入口（新建对话）与可滚动入口；
 * 扁平组织模式下的“项目”仍属于可滚动分组。
 */
export function splitSidebarTopNavItems(items: readonly SidebarNavItem[]): {
  fixedItems: SidebarNavItem[]
  scrollableItems: SidebarNavItem[]
} {
  return {
    fixedItems: items.filter((item) => item.view === 'new'),
    scrollableItems: items.filter((item) => item.view !== 'new'),
  }
}

function SidebarNavItems({
  items,
  isActiveView,
  plainActive = false,
}: {
  items: readonly SidebarNavItem[]
  isActiveView: (view: AppView) => boolean
  /** 固定“新建任务”入口不显示选中底色，只保留 aria-current。 */
  plainActive?: boolean
}): React.ReactNode {
  const { t } = useLocale()
  return (
    <>
      {items.map((item) => {
        const active = isActiveView(item.view)
        return (
          <SidebarRow
            active={active && !plainActive}
            asChild
            className={cx(
              'sidebar-nav-link tw:type-row-title',
              'tw:focus-visible:outline-2 tw:focus-visible:outline-offset-0 tw:focus-visible:outline-app-focus',
              active ? 'active' : undefined,
            )}
            key={item.view}
            labelClassName={cx(
              'sidebar-item-label',
              'tw:min-w-0',
              'tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap',
            )}
            layout="flex"
            leading={item.icon}
          >
            <Link aria-current={active ? 'page' : undefined} to={item.path}>
              {t(item.label)}
            </Link>
          </SidebarRow>
        )
      })}
    </>
  )
}

type Props = {
  capabilityState?: SidebarCapabilityState
  isActiveView: (view: AppView) => boolean
  showProjects: boolean
}

export const SIDEBAR_PRODUCT_MODE_ORDER: readonly SidebarProductMode[] = [
  'coding',
  'working',
  'chat',
]

export const SIDEBAR_PRODUCT_MODE_META: Record<
  SidebarProductMode,
  { label: string; description: string }
> = {
  coding: {
    label: 'Coding',
    description: '构建、调试并发布',
  },
  working: {
    label: 'Working',
    description: '写作、分析和协作',
  },
  chat: {
    label: 'Chat',
    description: '创建、学习和探索',
  },
}

export function SidebarHeader({
  showActions = true,
  hasUnread = false,
  unreadActivityCount = 0,
  scrollOverlapping = false,
  onOpenCommandMenu,
}: {
  showActions?: boolean
  hasUnread?: boolean
  unreadActivityCount?: number
  scrollOverlapping?: boolean
  onOpenCommandMenu: () => void
}): React.ReactNode {
  const { t } = useLocale()
  const navigate = useNavigate()
  const {
    sidebarProductMode,
    sidebarTimelineEnabled,
    setSidebarTimelineEnabled,
    sidebarActivityCoachmarkDismissed,
    setSidebarActivityCoachmarkDismissed,
  } = useDesktopSettings()
  const timelineToggleLabel = t(sidebarTimelineEnabled ? '关闭活动视图' : '查看活动')
  const timelineToggleTitle = `${timelineToggleLabel} (Ctrl+Alt+U)`

  const handleNewChat = (): void => {
    navigate(newSessionPath(sidebarProductMode))
  }

  return (
    <header
      className="sidebar-header tw:mx-2 tw:my-0 tw:flex tw:h-9 tw:min-h-9 tw:shrink-0 tw:min-w-0 tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-b-transparent tw:data-[scroll-overlap=true]:border-b-app-border-subtle"
      data-scroll-overlap={scrollOverlapping ? 'true' : 'false'}
    >
      <div className="sidebar-header-left tw:flex tw:min-w-0 tw:flex-1 tw:items-center">
        <Button
          aria-label={t('新建聊天')}
          className="sidebar-new-chat-button tw:w-full tw:min-w-0 tw:justify-start tw:text-app-text tw:type-row-title tw:whitespace-nowrap"
          variant="ghost"
          size="md"
          onClick={handleNewChat}
          title={t('新建聊天')}
        >
          <SquarePen aria-hidden="true" size={APP_ICON_SIZE} />
          <span className="sidebar-new-chat-label tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap">
            {t('新聊天')}
          </span>
        </Button>
      </div>
      {showActions ? (
        <div className="sidebar-header-actions tw:flex tw:min-w-0 tw:shrink-0 tw:items-center tw:gap-1">
          <Popover.Root
            open={
              !sidebarActivityCoachmarkDismissed &&
              !sidebarTimelineEnabled &&
              unreadActivityCount >= 2
            }
            onOpenChange={(open) => {
              if (!open) setSidebarActivityCoachmarkDismissed(true)
            }}
          >
            <Popover.Anchor asChild>
              <div className="tw:inline-flex">
                <Tooltip content={timelineToggleTitle} side="bottom">
                  <Button
                    isIconOnly
                    aria-label={timelineToggleLabel}
                    aria-keyshortcuts="Control+Alt+U"
                    aria-pressed={sidebarTimelineEnabled}
                    active={sidebarTimelineEnabled}
                    className="sidebar-timeline-toggle-button tw:text-app-text-meta tw:hover:text-app-text tw:data-[active=true]:bg-app-selected tw:data-[active=true]:text-app-text"
                    color="ghost"
                    iconSize="md"
                    size="compact"
                    onClick={() => {
                      if (!sidebarActivityCoachmarkDismissed) {
                        setSidebarActivityCoachmarkDismissed(true)
                      }
                      setSidebarTimelineEnabled((v) => !v)
                    }}
                    title={timelineToggleTitle}
                  >
                    <Bell aria-hidden="true" size={APP_ICON_SIZE}>
                      {hasUnread && (
                        <circle
                          cx="18"
                          cy="4"
                          r="4.5"
                          fill="var(--cpx-sys-color-accent)"
                          stroke="none"
                        />
                      )}
                    </Bell>
                  </Button>
                </Tooltip>
              </div>
            </Popover.Anchor>
            <Popover.Portal>
              <Popover.Content
                size="md"
                align="start"
                side="right"
                sideOffset={12}
                className="sidebar-activity-coachmark tw:z-50 tw:outline-none"
              >
                <div className="tw:flex tw:flex-col tw:gap-2">
                  <div className="tw:flex tw:items-start tw:justify-between tw:gap-3">
                    <span className="tw:type-row-title tw:text-app-text">{t('查看活动')}</span>
                    <Button
                      isIconOnly
                      aria-label={t('关闭')}
                      title={t('关闭')}
                      color="ghost"
                      size="compact"
                      onClick={() => setSidebarActivityCoachmarkDismissed(true)}
                    >
                      <X size={APP_ICON_SIZES.sm} />
                    </Button>
                  </div>
                  <p className="tw:m-0 tw:type-body-sm tw:text-app-text">
                    {t('查看未读、进行中或待回复的聊天')}
                  </p>
                </div>
                <Popover.Arrow className="tw:fill-app-raised" />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Button
            isIconOnly
            aria-haspopup="dialog"
            className="sidebar-search-button tw:text-app-text-meta tw:hover:text-app-text"
            color="ghost"
            iconSize="md"
            size="compact"
            onClick={onOpenCommandMenu}
            title={t('搜索任务')}
          >
            <Search size={APP_ICON_SIZE} />
          </Button>
        </div>
      ) : null}
    </header>
  )
}

export function SidebarTopNav({
  capabilityState = UNKNOWN_SIDEBAR_CAPABILITY_STATE,
  isActiveView,
  showProjects,
}: Props): React.ReactNode {
  const { t } = useLocale()
  const { sidebarProductMode } = useDesktopSettings()
  const { scrollableItems } = splitSidebarTopNavItems(
    getSidebarTopNavItems({
      showProjects,
      surface: sidebarProductMode,
      capabilityState,
    }),
  )
  return (
    <nav
      aria-label={t('主要导航')}
      className="sidebar-top-nav tw:flex tw:flex-col tw:gap-0.5 tw:px-2"
    >
      <SidebarNavItems items={scrollableItems} isActiveView={isActiveView} />
    </nav>
  )
}

/**
 * 固定在侧栏顶部的“新建对话”入口；与可滚动导航共用相同的
 * active、键盘焦点、图标、路由和无障碍属性。
 * `scrollOverlapping` 由滚动视口的实际 scrollTop 驱动：
 * 内容滚过固定入口时显示边界分隔线，滚回顶部立即隐藏。
 */
export function SidebarNewTaskNav({
  label,
  isActiveView,
  scrollOverlapping,
}: {
  label?: string
  isActiveView: (view: AppView) => boolean
  scrollOverlapping: boolean
}): React.ReactNode {
  const { t } = useLocale()
  const { sidebarProductMode } = useDesktopSettings()
  const { fixedItems } = splitSidebarTopNavItems(
    getSidebarTopNavItems({
      showProjects: false,
      surface: sidebarProductMode,
      capabilityState: UNKNOWN_SIDEBAR_CAPABILITY_STATE,
    }),
  )
  return (
    <nav
      aria-label={t('新建对话')}
      className="sidebar-new-task-nav sidebar-top-nav tw:flex tw:flex-col tw:flex-none tw:gap-0.5 tw:border-b tw:border-b-transparent tw:px-2 tw:data-[scroll-overlap=true]:border-b-app-border-subtle"
      data-scroll-overlap={scrollOverlapping ? 'true' : 'false'}
    >
      <SidebarNavItems
        items={label ? fixedItems.map((item) => ({ ...item, label })) : fixedItems}
        isActiveView={isActiveView}
        plainActive
      />
    </nav>
  )
}
