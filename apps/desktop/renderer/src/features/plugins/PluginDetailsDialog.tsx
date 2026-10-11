import * as Dialog from '@radix-ui/react-dialog'
import type React from 'react'
import { useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'

import { ScrollArea } from '../../components/ui/ScrollArea.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import type { PluginCatalogItem } from './PluginCatalog.js'
import { PluginIcon } from './PluginIcon.js'
import { useLastNonNull } from '../../hooks/UsePresenceRetention.js'
import { PluginDetailsMetadata, PluginDetailsPrimaryAction } from './PluginDetailsContent.js'
import { cx } from '../../utils/Cx.js'
import {
  DETAILS_ERROR_CLASS,
  DETAILS_ICON_CLASS,
  FORCED_COLORS_SURFACE_CLASS,
} from './CatalogClassNames.js'

type Props = {
  item: PluginCatalogItem | null
  open: boolean
  busy?: boolean
  error?: string | null
  restoreFocusElement?: HTMLElement | null
  onOpenChange: (open: boolean) => void
  onPrimaryAction: (item: PluginCatalogItem, trigger: HTMLButtonElement, checked?: boolean) => void
}

export function PluginDetailsDialog({
  item: currentItem,
  open,
  busy = false,
  error,
  restoreFocusElement,
  onOpenChange,
  onPrimaryAction,
}: Props): React.ReactNode {
  const retainedItem = useLastNonNull(currentItem)
  const item = open ? currentItem : retainedItem
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  if (!item) return null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop plugin-details-dialog__backdrop tw:overflow-hidden tw:forced-colors:bg-[color:Canvas] tw:forced-colors:opacity-75" />
        <Dialog.Content
          className={cx(
            'ui-dialog-surface ui-dialog-surface--centered settings-management-dialog plugin-details-dialog tw:grid tw:w-[min(34rem,calc(100vw_-_var(--cpx-sys-space-8)))] tw:max-h-[min(42rem,calc(100vh_-_var(--cpx-sys-space-8)))] tw:min-w-0 tw:overflow-hidden tw:grid-rows-[auto_minmax(0,1fr)_auto] tw:text-app-text',
            FORCED_COLORS_SURFACE_CLASS,
          )}
          data-dialog-size="detail"
          onCloseAutoFocus={(event) => {
            if (!restoreFocusElement?.isConnected) return
            event.preventDefault()
            restoreFocusElement.focus()
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            closeButtonRef.current?.focus()
          }}
        >
          <header className="settings-management-dialog-header plugin-details-dialog__header tw:grid tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-start tw:gap-3 tw:border-b tw:border-b-app-border-subtle tw:p-5">
            <span
              aria-hidden="true"
              className={cx('plugin-details-dialog__plugin-icon', DETAILS_ICON_CLASS)}
              data-plugin-tone={item.tone}
            >
              <PluginIcon
                logoDarkSource={item.logoDarkSource}
                logoSource={item.logoSource}
                name={item.iconName}
              />
            </span>
            <div className="settings-management-dialog-heading plugin-details-dialog__heading tw:grid tw:min-w-0 tw:gap-1">
              <Dialog.Title className="plugin-details-dialog__title tw:m-0 tw:text-app-text tw:type-title-sm tw:wrap-anywhere">
                {item.name}
              </Dialog.Title>
              <Dialog.Description className="plugin-details-dialog__description tw:m-0 tw:text-app-text-soft tw:type-body-sm tw:wrap-anywhere">
                {item.description}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                isIconOnly
                color="ghostSecondary"
                ref={closeButtonRef}
                size="toolbar"
                title="关闭插件详情"
              >
                <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </Button>
            </Dialog.Close>
          </header>

          <ScrollArea className="settings-management-dialog-body plugin-details-dialog__scroll-area tw:min-h-0 tw:overscroll-contain tw:p-5">
            <PluginDetailsMetadata item={item} />

            {error ? (
              <p
                className={cx(
                  'plugin-details-dialog__error',
                  DETAILS_ERROR_CLASS,
                  'tw:forced-colors:border-double',
                )}
                role="status"
              >
                {error}
              </p>
            ) : null}
          </ScrollArea>

          <footer className="settings-management-dialog-footer plugin-details-dialog__actions tw:flex tw:flex-wrap tw:justify-end tw:gap-2 tw:border-t tw:border-t-app-border-subtle tw:px-5 tw:py-4">
            <Dialog.Close asChild>
              <Button color="secondary">关闭</Button>
            </Dialog.Close>
            <PluginDetailsPrimaryAction busy={busy} item={item} onPrimaryAction={onPrimaryAction} />
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
