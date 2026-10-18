import * as Dialog from '@radix-ui/react-dialog'
import type React from 'react'
import { useRef, useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'

import { ScrollArea } from '../../components/ui/ScrollArea.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { SETTINGS_MANAGEMENT_DIALOG_SIZE } from '../settings/SettingsManagementDialogSizing.js'
import type { PluginCatalogItem } from './PluginCatalog.js'
import { PluginProductDetailsView } from './PluginProductDetailsView.js'
import { usePluginDetails } from './UsePluginDetails.js'
import { preparePluginPrompt } from './PluginPrompt.js'
import { useNavigate } from 'react-router-dom'
import { desktopClient } from '../../services/desktop-client/index.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { useLastNonNull } from '../../hooks/UsePresenceRetention.js'
import { cx } from '../../utils/Cx.js'
import { FORCED_COLORS_SURFACE_CLASS } from './CatalogClassNames.js'

type Props = {
  workspacePath?: string | null
  onChanged?: () => void
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
  workspacePath,
  onChanged,
}: Props): React.ReactNode {
  const retainedItem = useLastNonNull(currentItem)
  const item = open ? currentItem : retainedItem
  const navigate = useNavigate()
  const selectedDetails = usePluginDetails(open ? item : null, workspacePath)
  const [pending, setPending] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => {
    setLocalError(null)
    setConfirmRemove(false)
  }, [currentItem?.id, open])
  async function run(work: () => Promise<void>) {
    setPending(true)
    setLocalError(null)
    try {
      await work()
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : '插件操作失败，请重试。')
    } finally {
      setPending(false)
    }
  }
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  if (!item) return null

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop plugin-details-dialog__backdrop tw:overflow-hidden tw:forced-colors:bg-[color:Canvas] tw:forced-colors:opacity-75" />
          <Dialog.Content
            className={cx(
              `ui-dialog-surface ui-dialog-surface--centered settings-management-dialog plugin-details-dialog tw:grid tw:min-w-0 tw:overflow-hidden tw:grid-rows-[auto_minmax(0,1fr)_auto] tw:text-app-text ${SETTINGS_MANAGEMENT_DIALOG_SIZE.pluginDetails}`,
              FORCED_COLORS_SURFACE_CLASS,
            )}
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
            <header className="tw:flex tw:justify-end tw:p-3">
              <Dialog.Title className="tw:sr-only">{item.name}</Dialog.Title>
              <Dialog.Description className="tw:sr-only">{item.description}</Dialog.Description>
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
              <PluginProductDetailsView
                item={{ ...item, workspacePath }}
                details={selectedDetails.details}
                detailsError={selectedDetails.error}
                onRetryDetails={selectedDetails.retry}
                busy={busy || pending}
                error={localError || error}
                workspacePath={workspacePath}
                onPrimaryAction={onPrimaryAction}
                onTryPrompt={(prompt) =>
                  void run(async () => {
                    await preparePluginPrompt(item, prompt)
                    onChanged?.()
                    onOpenChange(false)
                    navigate('/new')
                  })
                }
                onUninstall={item.canUninstall ? () => setConfirmRemove(true) : undefined}
              />
            </ScrollArea>

            <footer className="settings-management-dialog-footer plugin-details-dialog__actions tw:flex tw:flex-wrap tw:justify-end tw:gap-2 tw:border-t tw:border-t-app-border-subtle tw:px-5 tw:py-4">
              <Dialog.Close asChild>
                <Button size="md" color="secondary">
                  关闭
                </Button>
              </Dialog.Close>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmationDialog
        open={confirmRemove}
        title="移除插件？"
        description={`将移除 ${item.name} 的下载文件，之后可以重新安装。`}
        tone="danger"
        actionLabel="移除插件"
        actionDisabled={pending}
        onCancel={() => setConfirmRemove(false)}
        onAction={() =>
          void run(async () => {
            await desktopClient.uninstallPlugin(item.id)
            setConfirmRemove(false)
            onChanged?.()
            onOpenChange(false)
          })
        }
      />
    </>
  )
}
