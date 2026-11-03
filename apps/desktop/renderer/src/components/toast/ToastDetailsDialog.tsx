import type React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../ui/Button.js'
import { useDialogFocusRestore } from '../ui/UseDialogFocusRestore.js'
import type { ToastItem } from './ToastState.js'

export function ToastDetailsDialog({ notice, onClose }: {
  notice: Pick<ToastItem, 'message' | 'details'> | null
  onClose: () => void
}): React.ReactNode {
  const { onCloseAutoFocus } = useDialogFocusRestore(notice !== null)
  return (
    <Dialog.Root open={notice !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          className="ui-dialog-surface ui-dialog-surface--centered permission-modal tw:grid tw:w-[min(36rem,calc(100vw-2rem))] tw:max-h-[calc(100vh-2rem)] tw:grid-rows-[auto_minmax(0,1fr)_auto] tw:gap-4 tw:p-5"
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <Dialog.Title className="tw:m-0 tw:type-title-sm tw:text-app-text">{notice?.message}</Dialog.Title>
          <div className="tw:min-h-0 tw:overflow-y-auto tw:whitespace-pre-wrap tw:wrap-anywhere tw:type-body tw:text-app-text-soft">
            {notice?.details}
          </div>
          <footer className="tw:flex tw:justify-end">
            <Dialog.Close asChild><Button>关闭</Button></Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
