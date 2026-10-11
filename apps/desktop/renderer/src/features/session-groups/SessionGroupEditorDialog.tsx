import { useRef } from 'react'
import { X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../../components/ui/Button.js'

import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { useDialogFocusRestore } from '../../components/ui/UseDialogFocusRestore.js'

type SessionGroupEditorDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  name: string
  description: string
  saving: boolean
  error?: string | null
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}

export function SessionGroupEditorDialog({
  open,
  mode,
  name,
  description,
  saving,
  error,
  onNameChange,
  onDescriptionChange,
  onCancel,
  onSubmit,
}: SessionGroupEditorDialogProps): React.ReactNode {
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const submitDisabled = saving || name.trim().length === 0
  const creating = mode === 'create'

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onCancel()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          className="ui-dialog-surface ui-dialog-surface--centered permission-modal confirmation-dialog tw:grid tw:w-[min(30rem,100%)] tw:gap-3 tw:p-5"
          onCloseAutoFocus={onCloseAutoFocus}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            nameInputRef.current?.focus()
            nameInputRef.current?.select()
          }}
        >
          <form
            className="tw:grid tw:gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!submitDisabled) onSubmit()
            }}
          >
            <header className="confirmation-dialog-header tw:flex tw:items-start tw:justify-between tw:gap-3">
              <div className="tw:min-w-0 tw:flex-1">
                <Dialog.Title className="tw:type-title-sm tw:text-app-text">
                  {creating ? '新建工作流' : '编辑工作流'}
                </Dialog.Title>
                <Dialog.Description className="tw:type-body-sm tw:mt-1 tw:text-app-text-soft">
                  {creating ? '为相关任务建立一个共享上下文。' : '修改工作流的名称和说明。'}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild disabled={saving}>
                <Button isIconOnly color="ghostSecondary" size="toolbar" title="关闭对话框">
                  <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </Button>
              </Dialog.Close>
            </header>

            <label className="tw:type-control tw:grid tw:gap-1.5 tw:text-app-text">
              名称
              <input
                className="tw:type-control tw:w-full tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:py-2 tw:text-app-text tw:outline-none tw:focus:border-app-accent tw:focus:ring-2 tw:focus:ring-app-accent"
                maxLength={120}
                onChange={(event) => onNameChange(event.currentTarget.value)}
                placeholder="例如：登录流程修复"
                ref={nameInputRef}
                value={name}
              />
            </label>
            <label className="tw:type-control tw:grid tw:gap-1.5 tw:text-app-text">
              说明
              <textarea
                className="tw:type-control tw:min-h-24 tw:w-full tw:resize-y tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:py-2 tw:text-app-text tw:outline-none tw:focus:border-app-accent tw:focus:ring-2 tw:focus:ring-app-accent"
                maxLength={4000}
                onChange={(event) => onDescriptionChange(event.currentTarget.value)}
                placeholder="说明这个工作流要共同解决的问题（可选）"
                value={description}
              />
            </label>

            {error ? (
              <p className="tw:type-body-sm tw:m-0 tw:text-app-danger" role="alert">
                {error}
              </p>
            ) : null}

            <div className="permission-modal-actions confirmation-dialog-actions tw:mt-1 tw:flex tw:items-center tw:justify-between tw:gap-3">
              <Dialog.Close asChild disabled={saving}>
                <Button className="tw:min-w-19" color="secondary">
                  取消
                </Button>
              </Dialog.Close>
              <Button
                className="tw:min-w-19"
                color="primary"
                disabled={submitDisabled}
                type="submit"
              >
                {saving ? '保存中…' : creating ? '新建' : '保存'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
