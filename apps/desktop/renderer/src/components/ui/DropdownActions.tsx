import { Dropdown as Menu } from './floating/Dropdown.js'
import { ChevronRight } from 'lucide-react'
import type { AppContextMenuAction } from './AppContextMenu.js'
import { PopoverItem, PopoverSeparator } from './PopoverItem.js'
import { APP_ICON_SIZE } from './IconTokens.js'
import { buildPopoverSizingStyle } from './PopoverSizing.js'

/** The same action tree powers a dropdown and its context menu. */
export function DropdownActions({ actions }: { actions: readonly AppContextMenuAction[] }) {
  return actions.map((action, index) => {
    if (action.kind === 'separator') return <PopoverSeparator key={index} />
    if (action.kind === 'item')
      return (
        <PopoverItem
          key={index}
          icon={action.icon}
          disabled={action.disabled}
          withCheck={action.checked}
          selected={action.checked}
          onClick={action.onSelect}
        >
          {action.label}
        </PopoverItem>
      )
    return (
      <Menu.Sub key={index}>
        <Menu.SubTrigger className="interactive-row interactive-row--menu popover-item tw:w-full tw:min-w-0 tw:items-center tw:text-left">
          <span className="popover-item-leading">{action.icon}</span>
          <span className="popover-item-label">{action.label}</span>
          <span className="popover-item-trailing">
            <ChevronRight size={APP_ICON_SIZE} />
          </span>
        </Menu.SubTrigger>
        <Menu.Portal>
          <Menu.SubContent
            size="sm"
            sideOffset={4}
            collisionPadding={6}
            className="popover-surface popover popover-menu--grid tw:text-app-text"
            style={buildPopoverSizingStyle({ size: 'sm' })}
          >
            <div className="popover-scroll-content tw:flex tw:min-w-0 tw:flex-col tw:gap-0.5">
              <DropdownActions actions={action.children} />
            </div>
          </Menu.SubContent>
        </Menu.Portal>
      </Menu.Sub>
    )
  })
}
