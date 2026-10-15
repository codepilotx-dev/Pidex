import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import type { DesktopProviderModelDefinition } from '../../../../shared/Types.js'
import { Button } from '../../../components/ui/Button.js'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { useDialogFocusRestore } from '../../../components/ui/UseDialogFocusRestore.js'
import { fullErrorMessage } from '../../../utils/Errors.js'
import { editableModel, ModelEditor, normalizeEditableModel } from './ProviderEditorForm.js'
import { ProviderEditorNavigationGuard } from './ProviderEditorNavigationGuard.js'

export function ProviderModelDialog({
  model,
  creating,
  nativeApi,
  providerId,
  baseUrl,
  onSave,
  onClose,
}: {
  model: DesktopProviderModelDefinition
  creating: boolean
  nativeApi?: string
  providerId: string
  baseUrl: string
  onSave: (model: DesktopProviderModelDefinition) => Promise<void>
  onClose: () => void
}): ReactNode {
  const [draft, setDraft] = useState(() => editableModel(model))
  const initial = useRef(JSON.stringify(draft))
  const dirty = JSON.stringify(draft) !== initial.current
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const allowNavigation = useRef(false)
  const { onCloseAutoFocus } = useDialogFocusRestore(true)
  function close() {
    if (busy) return
    if (dirty) setConfirmClose(true)
    else onClose()
  }
  async function save(closeAfterSave = true): Promise<boolean> {
    if (busy) return false
    const normalized = normalizeEditableModel(draft)
    if (normalized instanceof Error || !draft.id.trim()) {
      setError(normalized instanceof Error ? normalized.message : '模型 ID 不能为空。')
      return false
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(normalized)
      allowNavigation.current = true
      if (closeAfterSave) onClose()
      return true
    } catch (error) {
      setError(fullErrorMessage(error))
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Dialog.Root
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
          <Dialog.Content
            onCloseAutoFocus={onCloseAutoFocus}
            className="ui-dialog-surface ui-dialog-surface--centered settings-management-dialog tw:w-[min(680px,calc(100vw_-_32px))] tw:max-h-[85vh] tw:flex tw:flex-col tw:overflow-hidden"
          >
            <header className="settings-management-dialog-header tw:shrink-0">
              <div className="settings-management-dialog-heading">
                <Dialog.Title>{creating ? '添加模型' : '编辑模型'}</Dialog.Title>
                <Dialog.Description>填写基本信息，需要时展开高级设置。</Dialog.Description>
              </div>
              <Button
                color="ghostSecondary"
                isIconOnly
                size="toolbar"
                aria-label="关闭模型编辑"
                onClick={close}
              >
                <X aria-hidden size={APP_ICON_SIZE} />
              </Button>
            </header>
            <div className="settings-management-dialog-body tw:min-h-0 tw:overflow-y-auto">
            <fieldset disabled={busy} className="tw:m-0 tw:grid tw:min-w-0 tw:gap-4 tw:border-0 tw:p-0">
              <ModelEditor
                providerId={providerId}
                baseUrl={baseUrl}
                model={draft}
                lockId={!creating}
                onChange={setDraft}
                {...(nativeApi ? { nativeApi } : {})}
              />
              {error ? (
                <p role="alert" className="tw:text-app-danger tw:type-body-sm">
                  {error}
                </p>
              ) : null}
            </fieldset>
            </div>
            <footer className="settings-management-dialog-footer tw:shrink-0">
              <Button size="md" color="secondary" disabled={busy} onClick={close}>
                取消
              </Button>
              <Button
                size="md"
                color="primary"
                disabled={busy}
                loading={busy}
                onClick={() => void save()}
              >
                {creating ? '添加模型' : '保存模型'}
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {dirty || busy ? (
        <ProviderEditorNavigationGuard
          dirty={dirty}
          busy={busy}
          allowNavigation={allowNavigation}
          onSave={() => save(false)}
          onLeave={onClose}
        />
      ) : null}
      <ConfirmationDialog
        open={confirmClose}
        title="放弃模型修改？"
        description="尚未保存的模型参数将被丢弃。"
        actionLabel="放弃修改"
        onAction={onClose}
        onCancel={() => setConfirmClose(false)}
      />
    </>
  )
}
