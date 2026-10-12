import type React from 'react'
import { useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { pluginPrimaryAction, type PluginCatalogItem } from './PluginCatalog.js'

type Props = {
  item: PluginCatalogItem
  busy?: boolean
  onPrimaryAction?: (item: PluginCatalogItem, trigger: HTMLButtonElement, checked?: boolean) => void
  onOpenDetails?: () => void
}

export function PluginActionsMenu({
  item,
  busy = false,
  onPrimaryAction,
  onOpenDetails,
}: Props): React.ReactNode {
  const action = pluginPrimaryAction(item)
  const actionRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <span data-state={menuOpen ? 'open' : 'closed'} className="tw:inline-flex">
      <PopoverMenu
        align="end"
        size="md"
        open={menuOpen}
        onOpenChange={setMenuOpen}
        trigger={
          <Button
            ref={actionRef}
            isIconOnly
            color="ghostSecondary"
            size="toolbar"
            disabled={busy}
            title={`管理 ${item.name}`}
            aria-label={`管理 ${item.name}`}
          >
            <MoreHorizontal
              aria-hidden="true"
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </Button>
        }
      >
        {onOpenDetails ? (
          <PopoverItem
            onClick={() => {
              setMenuOpen(false)
              onOpenDetails()
            }}
          >
            查看详情
          </PopoverItem>
        ) : null}
        {onPrimaryAction ? (
          <PopoverItem
            disabled={action.disabled || busy}
            onClick={() => {
              setMenuOpen(false)
              if (actionRef.current)
                onPrimaryAction(
                  item,
                  actionRef.current,
                  action.kind === 'toggle-plugin' ? !action.checked : undefined,
                )
            }}
          >
            {action.label}
          </PopoverItem>
        ) : null}
      </PopoverMenu>
    </span>
  )
}
