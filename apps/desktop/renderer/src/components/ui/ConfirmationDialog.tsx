import type React from 'react'
import { useRef } from 'react'
import { X } from 'lucide-react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Dialog from '@radix-ui/react-dialog'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './IconTokens.js'
import { Button } from './Button.js'

import { useDialogFocusRestore } from './UseDialogFocusRestore.js'

type ConfirmationInput = {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  maxLength?: number
}

type Props = {
  open: boolean
  title: string
  description?: React.ReactNode
  cancelLabel?: string
  actionLabel: string
  tone?: 'primary' | 'danger'
  actionDisabled?: boolean
  suppression?: {
    checked: boolean
    label: string
    onCheckedChange: (checked: boolean) => void
  }
  onCancel: () => void
  onAction: () => void
}

export function ConfirmationDialog({
  open,
  title,
  description,
  cancelLabel = '取消',
  actionLabel,
  tone = 'primary',
  actionDisabled = false,
  suppression,
  onCancel,
  onAction,
}: Props): React.ReactNode {
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

  function handleActionClick(event: React.MouseEvent<HTMLButtonElement>): void {
    event.preventDefault()
    onAction()
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel()
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <AlertDialog.Content
          className="ui-dialog-surface ui-dialog-surface--centered permission-modal confirmation-dialog tw:grid tw:w-[min(27.5rem,100%)] tw:gap-3 tw:p-5"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className="confirmation-dialog-header tw:flex tw:items-start tw:justify-between tw:gap-3">
            <AlertDialog.Title asChild>
              <h2 className="tw:m-0 tw:min-w-0 tw:flex-1 tw:text-app-text tw:type-title-sm tw:break-words tw:no-underline">
                {title}
              </h2>
            </AlertDialog.Title>
            <AlertDialog.Cancel asChild>
              <Button
                isIconOnly
                className="tw:shrink-0"
                color="ghostSecondary"
                size="toolbar"
                title="关闭对话框"
              >
                <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </Button>
            </AlertDialog.Cancel>
          </header>
          <AlertDialog.Description asChild>
            <div className="confirmation-dialog-description tw:m-0 tw:text-app-text-soft tw:type-body-sm">
              {description ?? '请确认是否继续。'}
            </div>
          </AlertDialog.Description>
          {suppression ? (
            <label className="confirmation-dialog-suppression tw:flex tw:cursor-pointer tw:items-center tw:gap-2 tw:text-app-text-soft tw:type-body-sm">
              <input
                checked={suppression.checked}
                type="checkbox"
                onChange={(event) => suppression.onCheckedChange(event.currentTarget.checked)}
              />
              <span>{suppression.label}</span>
            </label>
          ) : null}
          <div className="permission-modal-actions confirmation-dialog-actions tw:mt-2 tw:flex tw:items-center tw:justify-between tw:gap-3">
            <AlertDialog.Cancel asChild>
              <Button className="tw:min-w-19" color="secondary" size="md">
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                className="tw:min-w-19"
                color={tone === 'danger' ? 'dangerSolid' : 'primary'}
                disabled={actionDisabled}
                onClick={handleActionClick}
                size="md"
              >
                {actionLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

type InputDialogProps = Omit<Props, 'description' | 'tone'> & {
  description: React.ReactNode
  input: ConfirmationInput
  allowEmpty?: boolean
}

export function InputDialog({
  open,
  title,
  description,
  cancelLabel = '取消',
  actionLabel,
  input,
  allowEmpty = false,
  actionDisabled = false,
  onCancel,
  onAction,
}: InputDialogProps): React.ReactNode {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const submitDisabled = isInputDialogSubmitDisabled(input.value, allowEmpty, actionDisabled)

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          className="ui-dialog-surface ui-dialog-surface--centered permission-modal confirmation-dialog tw:grid tw:w-[min(27.5rem,100%)] tw:gap-3 tw:p-5"
          onCloseAutoFocus={onCloseAutoFocus}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            inputRef.current?.focus()
            inputRef.current?.select()
          }}
        >
          <form
            className="tw:contents"
            onSubmit={(event) => {
              event.preventDefault()
              if (!submitDisabled) onAction()
            }}
          >
            <header className="confirmation-dialog-header tw:flex tw:items-start tw:justify-between tw:gap-3">
              <Dialog.Title asChild>
                <h2 className="tw:m-0 tw:min-w-0 tw:flex-1 tw:text-app-text tw:type-title-sm tw:break-words tw:no-underline">
                  {title}
                </h2>
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button
                  isIconOnly
                  className="tw:shrink-0"
                  color="ghostSecondary"
                  size="toolbar"
                  title="关闭对话框"
                >
                  <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </Button>
              </Dialog.Close>
            </header>
            <Dialog.Description asChild>
              <p className="confirmation-dialog-description tw:m-0 tw:text-app-text-soft tw:type-body-sm">
                {description}
              </p>
            </Dialog.Description>
            <input
              aria-label={title}
              className="confirmation-dialog-input tw:w-full tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:py-2 tw:text-app-text tw:type-body tw:outline-none tw:transition-[border-color,box-shadow] tw:duration-[var(--cpx-sys-motion-enter)] tw:focus:border-app-accent tw:focus:ring-2 tw:focus:ring-app-accent"
              defaultValue={input.value}
              maxLength={input.maxLength}
              onInput={(event) => input.onChange(event.currentTarget.value)}
              placeholder={input.placeholder}
              ref={inputRef}
              type="text"
            />
            <div className="permission-modal-actions confirmation-dialog-actions tw:mt-2 tw:flex tw:items-center tw:justify-between tw:gap-3">
              <Dialog.Close asChild>
                <Button className="tw:min-w-19" color="secondary" size="md">
                  {cancelLabel}
                </Button>
              </Dialog.Close>
              <Button
                className="tw:min-w-19"
                color="primary"
                disabled={submitDisabled}
                size="md"
                type="submit"
              >
                {actionLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function isInputDialogSubmitDisabled(
  value: string,
  allowEmpty = false,
  actionDisabled = false,
): boolean {
  return actionDisabled || (!allowEmpty && value.trim().length === 0)
}
