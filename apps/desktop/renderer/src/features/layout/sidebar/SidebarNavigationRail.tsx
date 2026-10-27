import { useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Ellipsis, Home, Pin, PinOff } from 'lucide-react'
import { Button } from '../../../components/ui/Button.js'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { Popover } from '../../../components/ui/floating/Popover.js'
import { AppContextMenu } from '../../../components/ui/AppContextMenu.js'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { useDesktopSettingsField } from '../../settings/UseDesktopSettings.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import { newSessionPath } from '../../session/NewSessionSurface.js'
import { canShowSidebarTooltip, type SidebarShellController } from '../SidebarShellState.js'
import { SidebarFooter } from './SidebarFooter.js'
import { getSidebarTopNavItems, type SidebarCapabilityState } from './SidebarTopNav.js'
import type { SidebarPane } from './SidebarNavigation.js'
import { SidebarRow } from './SidebarRow.js'
import { setSidebarDestinationHidden } from './SidebarCustomization.js'

type Props = {
  shell: SidebarShellController
  activePane: SidebarPane | null
  capabilityState: SidebarCapabilityState
  onOpenWhatsNew: (restoreFocusElement: HTMLElement | null) => void
  onReport: (message: string) => void
}

/** 导航轨目的地键：与 sidebarCustomization.destinationOrder 中的 id 一一对应。 */
export type SidebarRailDestinationId =
  'git' | 'automations' | 'plugins' | 'providers' | 'pets' | 'sessionGroups'

const RAIL_DESTINATION_PANES: Record<SidebarRailDestinationId, SidebarPane | null> = {
  git: 'git',
  automations: 'scheduled',
  plugins: 'plugins',
  providers: 'providers',
  pets: 'pets',
  sessionGroups: null,
}

const OTHER_RAIL_DESTINATION_IDS = new Set<SidebarRailDestinationId>([
  'git',
  'sessionGroups',
  'providers',
  'pets',
])

export function SidebarNavigationRail({
  shell,
  activePane,
  capabilityState,
  onOpenWhatsNew,
  onReport,
}: Props): ReactNode {
  const sidebarProductMode = useDesktopSettingsField((settings) => settings.sidebarProductMode)
  const sidebarTimelineEnabled = useDesktopSettingsField(
    (settings) => settings.sidebarTimelineEnabled,
  )
  const sidebarCustomization = useDesktopSettingsField((settings) => settings.sidebarCustomization)
  const setSidebarCustomization = useDesktopSettingsField(
    (settings) => settings.setSidebarCustomization,
  )
  const { t } = useLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const [tooltipId, setTooltipId] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreTriggerRef = useRef<HTMLButtonElement>(null)
  const lastChatPath = useRef(newSessionPath(sidebarProductMode))
  if (location.pathname === '/new' || location.pathname.startsWith('/threads/'))
    lastChatPath.current = `${location.pathname}${location.search}`
  const items = getSidebarTopNavItems({
    showProjects: false,
    surface: sidebarProductMode,
    capabilityState,
  })
  const destinationItems = items.filter((item) => item.view !== 'new')
  const itemByDestinationId = new Map<SidebarRailDestinationId, (typeof destinationItems)[number]>()
  for (const item of destinationItems) {
    if (item.view in RAIL_DESTINATION_PANES) {
      itemByDestinationId.set(item.view as SidebarRailDestinationId, item)
    }
  }
  const hiddenDestinationIds = new Set(
    sidebarCustomization.hiddenDestinationIds.filter(
      (id): id is SidebarRailDestinationId => typeof id === 'string',
    ),
  )
  const orderedDestinationIds = [
    ...sidebarCustomization.destinationOrder,
    ...Object.keys(RAIL_DESTINATION_PANES),
  ].filter(
    (id, index, list): id is SidebarRailDestinationId =>
      id in RAIL_DESTINATION_PANES && list.indexOf(id) === index,
  )
  const directItems = orderedDestinationIds
    .filter((id) => !hiddenDestinationIds.has(id))
    .flatMap((id) => {
      const item = itemByDestinationId.get(id)
      return item ? [item] : []
    })
  const moreItems = orderedDestinationIds.flatMap((id) => {
    const item = itemByDestinationId.get(id)
    return item ? [item] : []
  })
  const fixedItems = directItems.filter(
    (item) => !OTHER_RAIL_DESTINATION_IDS.has(item.view as SidebarRailDestinationId),
  )
  const otherItems = directItems.filter((item) =>
    OTHER_RAIL_DESTINATION_IDS.has(item.view as SidebarRailDestinationId),
  )

  const toggleDestination = (id: SidebarRailDestinationId, fromRail = false) => {
    const hidden = !hiddenDestinationIds.has(id)
    setSidebarCustomization((current) => setSidebarDestinationHidden(current, id, hidden))
    setTooltipId(null)
    if (hidden && fromRail) requestAnimationFrame(() => moreTriggerRef.current?.focus())
  }
  const destinationActions = (id: SidebarRailDestinationId, fromRail = false) => [
    {
      kind: 'item' as const,
      label: t(hiddenDestinationIds.has(id) ? '固定到侧栏' : '取消固定，收进更多'),
      icon: hiddenDestinationIds.has(id) ? (
        <Pin size={APP_ICON_SIZE} />
      ) : (
        <PinOff size={APP_ICON_SIZE} />
      ),
      onSelect: () => toggleDestination(id, fromRail),
    },
  ]

  const button = (
    id: string,
    label: string,
    icon: ReactNode,
    onClick: () => void,
    pane?: SidebarPane | null,
    selected = false,
  ): ReactNode => (
    <Tooltip
      content={t(label)}
      side="right"
      key={id}
      open={
        tooltipId === id &&
        !moreOpen &&
        canShowSidebarTooltip(shell.mode, shell.mode === 'collapsed' && pane != null)
      }
      onOpenChange={(open) =>
        setTooltipId((current) => (open ? id : current === id ? null : current))
      }
    >
      <Button
        isIconOnly
        title={t(label)}
        nativeTitle={false}
        aria-label={t(label)}
        aria-current={selected ? 'page' : undefined}
        aria-controls={pane ? 'desktop-sidebar-pane' : undefined}
        active={selected}
        data-position="sidebar"
        className="tw:flex-none"
        variant="ghost"
        size="md"
        onClick={() => {
          setTooltipId(null)
          shell.closePreview()
          onClick()
        }}
        onPointerEnter={pane ? (event) => shell.onRailItemEnter(pane, event) : undefined}
        onPointerLeave={(event) => {
          setTooltipId((current) => (current === id ? null : current))
          if (pane) shell.onRailItemLeave(event)
        }}
      >
        {icon}
      </Button>
    </Tooltip>
  )

  const destinationButton = (item: (typeof directItems)[number]): ReactNode => {
    const pane = RAIL_DESTINATION_PANES[item.view as SidebarRailDestinationId]
    const selected = pane
      ? activePane === pane
      : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
    return (
      <AppContextMenu
        key={item.view}
        layout="grid"
        includeEditActions={false}
        actions={destinationActions(item.view as SidebarRailDestinationId, true)}
        trigger={
          <span className="tw:flex">
            {button(
              item.view,
              item.label,
              item.icon,
              () => {
                navigate(item.path)
              },
              pane,
              selected,
            )}
          </span>
        }
      />
    )
  }

  return (
    <nav
      className="sidebar-navigation-rail tw:flex tw:h-full tw:flex-col tw:items-center tw:py-2"
      aria-label={t('应用导航')}
    >
      <ScrollArea
        className="sidebar-rail-destinations tw:w-full tw:min-h-0 tw:flex-1 tw:mb-3"
        contentClassName="tw:flex tw:flex-col tw:items-center tw:gap-1"
      >
        <div className="tw:flex tw:flex-col tw:items-center tw:gap-2">
          {button(
            'home',
            '首页',
            <Home size={APP_ICON_SIZE} />,
            () => {
              navigate(lastChatPath.current)
            },
            sidebarTimelineEnabled ? 'activity' : 'chats',
            activePane === 'chats' || activePane === 'activity',
          )}
          {fixedItems.map(destinationButton)}
          {moreItems.length > 0 ? (
            <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
              <Popover.Trigger asChild>
                <Button
                  isIconOnly
                  ref={moreTriggerRef}
                  title={t('更多')}
                  nativeTitle={false}
                  aria-label={t('更多')}
                  active={moreOpen}
                  data-position="sidebar"
                  className="tw:flex-none"
                  variant="ghost"
                  size="md"
                >
                  <Ellipsis size={APP_ICON_SIZE} />
                </Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  asChild
                  side="right"
                  align="start"
                  size="sm"
                  aria-label={t('更多')}
                  className="tw:p-1"
                >
                  <div className="desktop-sidebar tw:flex tw:flex-col tw:sidebar-row-gap">
                    {moreItems.map((item) => {
                      const id = item.view as SidebarRailDestinationId
                      const pinned = !hiddenDestinationIds.has(id)
                      const pinLabel = t(pinned ? '取消固定' : '固定到侧栏')
                      return (
                        <AppContextMenu
                          key={id}
                          layout="grid"
                          includeEditActions={false}
                          actions={destinationActions(id)}
                          trigger={
                            <SidebarRow
                              tabIndex={-1}
                              layout="grid"
                              leading={item.icon}
                              active={
                                location.pathname === item.path ||
                                location.pathname.startsWith(`${item.path}/`)
                              }
                              className="tw:group tw:[&>.sidebar-row-trailing]:w-auto tw:has-[:focus-visible]:bg-app-hover"
                              onClick={() => {
                                setMoreOpen(false)
                                navigate(item.path)
                                shell.closePreview()
                              }}
                              trailing={
                                <Tooltip content={pinLabel}>
                                  <Button
                                    isIconOnly
                                    variant="text"
                                    size="compact"
                                    iconSize="md"
                                    nativeTitle={false}
                                    aria-label={`${pinLabel}: ${t(item.label)}`}
                                    className={`tw:shrink-0 ${pinned ? '' : 'tw:opacity-0 tw:group-hover:opacity-100 tw:group-has-[:focus-visible]:opacity-100'}`}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      toggleDestination(id)
                                    }}
                                  >
                                    <Pin
                                      className="tw:rotate-45"
                                      size={APP_ICON_SIZE}
                                      fill={pinned ? 'currentColor' : 'none'}
                                    />
                                  </Button>
                                </Tooltip>
                              }
                            >
                              <button
                                type="button"
                                className="tw:flex tw:w-full tw:min-w-0 tw:items-center tw:gap-2 tw:bg-transparent tw:py-1 tw:text-left tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-app-accent tw:rounded-sm"
                              >
                                <span className="tw:min-w-0 tw:truncate">{t(item.label)}</span>
                              </button>
                            </SidebarRow>
                          }
                        />
                      )
                    })}
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          ) : null}
        </div>
        {otherItems.length > 0 ? (
          <>
            <div role="separator" className="tw:my-1 tw:w-6 tw:border-t tw:border-app-border" />
            <div
              role="group"
              aria-label={t('其他入口')}
              className="tw:flex tw:flex-col tw:items-center tw:gap-2"
            >
              {otherItems.map(destinationButton)}
            </div>
          </>
        ) : null}
      </ScrollArea>
      <div className="sidebar-rail-bottom tw:flex tw:w-full tw:flex-col tw:items-center tw:gap-1">
        <SidebarFooter
          compact
          onNavigate={shell.closePreview}
          onOpenWhatsNew={onOpenWhatsNew}
          onReport={onReport}
        />
      </div>
    </nav>
  )
}
