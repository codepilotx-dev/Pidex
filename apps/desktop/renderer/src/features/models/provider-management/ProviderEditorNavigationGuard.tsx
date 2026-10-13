import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, type ReactNode, type RefObject } from 'react'
import { useBlocker } from 'react-router-dom'
import { Button } from '../../../components/ui/Button.js'

export function ProviderEditorNavigationGuard({
  dirty,
  busy,
  allowNavigation,
  onSave,
}: {
  dirty: boolean
  busy: boolean
  allowNavigation: RefObject<boolean>
  onSave: () => Promise<boolean>
}): ReactNode {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !allowNavigation.current &&
      (dirty || busy) &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  )

  useEffect(() => {
    if (!dirty && !busy) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty, busy])

  return (
    <Dialog.Root
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && !busy && blocker.state === 'blocked') blocker.reset()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content className="ui-dialog-surface ui-dialog-surface--centered settings-management-dialog tw:w-[min(480px,calc(100vw_-_32px))]">
          <header className="settings-management-dialog-header">
            <Dialog.Title>供应商有未保存修改</Dialog.Title>
            <Dialog.Description>
              保存后离开，或放弃本次修改。密钥的独立保存操作不受影响。
            </Dialog.Description>
          </header>
          <footer className="settings-management-dialog-footer">
            <Button
              color="secondary"
              disabled={busy}
              onClick={() => {
                if (blocker.state === 'blocked') blocker.reset()
              }}
            >
              继续编辑
            </Button>
            <Button
              color="secondary"
              disabled={busy}
              onClick={() => {
                if (blocker.state === 'blocked') blocker.proceed()
              }}
            >
              放弃修改
            </Button>
            <Button
              color="primary"
              disabled={busy}
              loading={busy}
              onClick={() => {
                void onSave().then((saved) => {
                  if (saved && blocker.state === 'blocked') blocker.proceed()
                })
              }}
            >
              保存后离开
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
