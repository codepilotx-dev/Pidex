import { useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Ellipsis, Home } from 'lucide-react'
import { Button } from '../../../components/ui/Button.js'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { PopoverItem } from '../../../components/ui/PopoverItem.js'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { useDesktopSettings } from '../../settings/UseDesktopSettings.js'
import { useLocale } from '../../i18n/LocaleProvider.js'
import { newSessionPath } from '../../session/NewSessionSurface.js'
import { canShowSidebarTooltip, type SidebarShellController } from '../SidebarShellState.js'
import { SidebarFooter } from './SidebarFooter.js'
import { getSidebarTopNavItems, type SidebarCapabilityState } from './SidebarTopNav.js'
import { sidebarPaneForRoute, type SidebarPane } from './SidebarNavigation.js'

type Props = {
  shell: SidebarShellController
  activePane: SidebarPane | null
  capabilityState: SidebarCapabilityState
  onOpenWhatsNew: (restoreFocusElement: HTMLElement | null) => void
  onReport: (message: string) => void
  onPinPanel: () => void
}

/** 导航轨目的地键：与 sidebarCustomization.destinationOrder 中的 id 一一对应。 */
export type SidebarRailDestinationId = 'automations' | 'plugins' | 'sessionGroups'

const RAIL_DESTINATION_PANES: Record<SidebarRailDestinationId, SidebarPane | null> = {
  automations: 'scheduled',
  plugins: 'plugins',
  sessionGroups: null,
}

export function SidebarNavigationRail({
  shell,
  activePane,
  capabilityState,
  onOpenWhatsNew,
  onReport,
  onPinPanel,
}: Props): ReactNode {
  const { sidebarProductMode, sidebarTimelineEnabled, sidebarCustomization } = useDesktopSettings()
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
  const moreItems = orderedDestinationIds
    .filter((id) => hiddenDestinationIds.has(id))
    .flatMap((id) => {
      const item = itemByDestinationId.get(id)
      return item ? [item] : []
    })

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
      open={tooltipId === id && !moreOpen && canShowSidebarTooltip(shell.mode, false)}
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
        className="sidebar-rail-button tw:flex-none tw:data-[active=true]:bg-app-selected tw:data-[active=true]:text-app-text"
        variant="ghost"
        size="md"
        onClick={onClick}
        onPointerEnter={pane ? (event) => shell.onRailItemEnter(pane, event) : undefined}
        onPointerLeave={pane ? (event) => shell.onRailItemLeave(event) : undefined}
      >
        {icon}
      </Button>
    </Tooltip>
  )

  return (
    <nav
      className="sidebar-navigation-rail tw:flex tw:h-full tw:flex-col tw:items-center tw:py-2"
      aria-label={t('应用导航')}
    >
      <ScrollArea
        className="sidebar-rail-destinations tw:w-full tw:min-h-0 tw:flex-1 tw:mb-3"
        contentClassName="tw:flex tw:flex-col tw:items-center tw:gap-1"
      >
        {button(
          'home',
          '首页',
          <Home size={APP_ICON_SIZE} />,
          () => {
            navigate(lastChatPath.current)
            onPinPanel()
          },
          sidebarTimelineEnabled ? 'activity' : 'chats',
          activePane === 'chats' || activePane === 'activity',
        )}
        {directItems.map((item) => {
          const pane = RAIL_DESTINATION_PANES[item.view as SidebarRailDestinationId]
          const selected = pane
            ? activePane === pane
            : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
          return button(
            item.view,
            item.label,
            item.icon,
            () => {
              navigate(item.path)
              if (pane) onPinPanel()
            },
            pane,
            selected,
          )
        })}
        {moreItems.length > 0 ? (
          <PopoverMenu
            align="start"
            open={moreOpen}
            side="right"
            size="sm"

            onOpenChange={setMoreOpen}
            trigger={
              <Button
                isIconOnly
                ref={moreTriggerRef}
                title={t('更多')}
                nativeTitle={false}
                aria-label={t('更多')}
                active={moreOpen}
                className="sidebar-rail-button tw:flex-none tw:data-[active=true]:bg-app-selected tw:data-[active=true]:text-app-text"
                variant="ghost"
                size="md"
              >
                <Ellipsis size={APP_ICON_SIZE} />
              </Button>
            }
          >
            {moreItems.map((item) => (
              <PopoverItem
                active={
                  location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
                }
                icon={item.icon}
                key={item.view}
                onClick={() => {
                  setMoreOpen(false)
                  navigate(item.path)
                }}
              >
                {t(item.label)}
              </PopoverItem>
            ))}
          </PopoverMenu>
        ) : null}
      </ScrollArea>
      <div className="sidebar-rail-bottom tw:flex tw:w-full tw:flex-col tw:items-center tw:gap-1">
        <SidebarFooter
          compact
          onNavigate={onPinPanel}
          onOpenWhatsNew={onOpenWhatsNew}
          onReport={onReport}
        />
      </div>
    </nav>
  )
}
