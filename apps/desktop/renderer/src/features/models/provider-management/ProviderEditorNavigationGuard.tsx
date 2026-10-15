import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useBlocker } from 'react-router-dom'
import { Button } from '../../../components/ui/Button.js'

export function ProviderEditorNavigationGuard({
  dirty,
  busy,
  allowNavigation,
  onSave,
  onLeave,
  onDiscard,
  requestLeaveRef,
}: {
  dirty: boolean
  busy: boolean
  allowNavigation: RefObject<boolean>
  onSave: () => Promise<boolean>
  onLeave?: () => void
  onDiscard?: () => void
  requestLeaveRef?: RefObject<(() => Promise<boolean>) | null>
}): ReactNode {
  const [pendingLeave, setPendingLeave] = useState(false)
  const pending = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(
    null,
  )
  function finishPending(allowed: boolean) {
    pending.current?.resolve(allowed)
    pending.current = null
    setPendingLeave(false)
  }
  useEffect(() => {
    if (!requestLeaveRef) return
    requestLeaveRef.current = () => {
      if (!dirty && !busy) return Promise.resolve(true)
      if (pending.current) return pending.current.promise
      let resolve!: (allowed: boolean) => void
      const promise = new Promise<boolean>((done) => {
        resolve = done
      })
      pending.current = { promise, resolve }
      setPendingLeave(true)
      return promise
    }
    return () => {
      requestLeaveRef.current = null
    }
  }, [requestLeaveRef, dirty, busy])
  useEffect(
    () => () => {
      pending.current?.resolve(false)
    },
    [],
  )
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
      open={blocker.state === 'blocked' || pendingLeave}
      onOpenChange={(open) => {
        if (!open && !busy && blocker.state === 'blocked') blocker.reset()
        if (!open && !busy) finishPending(false)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content className="ui-dialog-surface ui-dialog-surface--centered settings-management-dialog tw:w-[min(480px,calc(100vw_-_32px))]">
          <header className="settings-management-dialog-header">
            <div className="settings-management-dialog-heading">
              <Dialog.Title>供应商有未保存修改</Dialog.Title>
              <Dialog.Description>
                保存后离开，或放弃本次修改。密钥的独立保存操作不受影响。
              </Dialog.Description>
            </div>
          </header>
          <footer className="settings-management-dialog-footer">
            <Button
              size="md"
              color="secondary"
              disabled={busy}
              onClick={() => {
                if (blocker.state === 'blocked') blocker.reset()
                finishPending(false)
              }}
            >
              继续编辑
            </Button>
            <Button
              size="md"
              color="secondary"
              disabled={busy}
              onClick={() => {
                if (blocker.state === 'blocked') {
                  blocker.proceed()
                  onDiscard?.()
                  onLeave?.()
                  finishPending(true)
                } else {
                  onDiscard?.()
                  finishPending(true)
                }
              }}
            >
              放弃修改
            </Button>
            <Button
              size="md"
              color="primary"
              disabled={busy}
              loading={busy}
              onClick={() => {
                void onSave().then((saved) => {
                  if (saved && blocker.state === 'blocked') {
                    blocker.proceed()
                    onLeave?.()
                    finishPending(true)
                  } else if (saved) finishPending(true)
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
