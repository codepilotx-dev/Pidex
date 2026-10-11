import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import * as Dialog from '@radix-ui/react-dialog'
import { KeyRound, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useId, useState } from 'react'
import type {
  DesktopApiKeySummary,
  DesktopModelProviderSummary,
  ModelProviderID,
} from '../../../shared/Types.js'
import { Button } from '../../components/ui/Button.js'

import { Input } from '../../components/ui/Input.js'
import { SettingsDropdown } from '../settings/SettingsDropdown.js'
import { useDialogFocusRestore } from '../../components/ui/UseDialogFocusRestore.js'
import { useLastNonNull } from '../../hooks/UsePresenceRetention.js'
import { cx } from '../../utils/Cx.js'

export type ApiKeyEditorValue = {
  providerId: ModelProviderID
  label: string
  key?: string
}

export type ApiKeyEditorFormProps = {
  apiKey?: DesktopApiKeySummary | null
  busy?: boolean
  className?: string
  /** 固定 Provider 场景隐藏 Provider 下拉（首次配置内联使用）。 */
  hideProvider?: boolean
  initialProviderId: ModelProviderID
  providers: DesktopModelProviderSummary[]
  submitLabel?: string
  /** 每次变更时重置名称与密钥输入（例如 Dialog 重新打开）。 */
  resetSignal?: unknown
  /** 未编辑时名称输入框的默认值。 */
  defaultLabel?: string
  autoFocusLabel?: boolean
  onCancel?: () => void
  onSubmit: (value: ApiKeyEditorValue) => Promise<boolean>
}

export function ApiKeyEditorForm({
  apiKey: currentApiKey = null,
  busy = false,
  className,
  hideProvider = false,
  initialProviderId,
  providers,
  submitLabel,
  resetSignal,
  defaultLabel = '',
  autoFocusLabel = false,
  onCancel,
  onSubmit,
}: ApiKeyEditorFormProps): React.ReactNode {
  const [providerId, setProviderId] = useState<ModelProviderID>(initialProviderId)
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const editing = Boolean(currentApiKey)

  useEffect(() => {
    const fallbackProviderId = providers.some(
      (provider) => provider.providerID === initialProviderId,
    )
      ? initialProviderId
      : providers[0]?.providerID
    if (fallbackProviderId) {
      setProviderId(currentApiKey?.providerId ?? fallbackProviderId)
    }
    setLabel(currentApiKey?.label ?? defaultLabel)
    setSecret('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentApiKey, defaultLabel, initialProviderId, providers, resetSignal])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const normalizedLabel = label.trim()
    const normalizedSecret = secret.trim()
    if (!normalizedLabel || (!editing && !normalizedSecret)) return
    const saved = await onSubmit({
      providerId: currentApiKey?.providerId ?? providerId,
      label: normalizedLabel,
      ...(normalizedSecret ? { key: normalizedSecret } : {}),
    })
    if (!saved) return
    setSecret('')
  }

  const canSubmit = label.trim().length > 0 && (editing || secret.trim().length > 0)
  const providerName = providers.find(
    (provider) => provider.providerID === currentApiKey?.providerId,
  )?.displayName

  return (
    <form
      className={cx('model-center-key-dialog-form tw:grid', className)}
      onSubmit={(event) => void handleSubmit(event)}
    >
      <div className="settings-management-dialog-card model-center-key-dialog-fields tw:m-5 tw:gap-0">
        {!hideProvider ? (
          <label className="settings-management-dialog-row model-center-field tw:grid tw:min-w-0 tw:gap-2 tw:text-app-text tw:type-body tw:[&>span:first-child]:type-row-title tw:[&_input]:w-full">
            <span>Provider</span>
            {editing ? (
              <div className="model-center-key-dialog-provider tw:flex tw:min-h-9 tw:items-center tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-3 tw:text-app-text-soft">
                {providerName ?? currentApiKey?.providerId}
              </div>
            ) : (
              <SettingsDropdown
                ariaLabel="Provider"
                searchable
                searchPlaceholder="搜索 Provider"
                size="lg"
                value={providerId}
                options={providers.map((provider) => ({
                  value: provider.providerID,
                  label: provider.displayName,
                  detail: provider.providerID,
                }))}
                onChange={(value) => setProviderId(value as ModelProviderID)}
              />
            )}
          </label>
        ) : null}
        <label className="settings-management-dialog-row model-center-field tw:grid tw:min-w-0 tw:gap-2 tw:text-app-text tw:type-body tw:[&>span:first-child]:type-row-title tw:[&_input]:w-full">
          <span>名称</span>
          <Input
            autoFocus={autoFocusLabel}
            maxLength={80}
            placeholder="例如：个人主账号"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="settings-management-dialog-row model-center-field tw:grid tw:min-w-0 tw:gap-2 tw:text-app-text tw:type-body tw:[&>span:first-child]:type-row-title tw:[&_input]:w-full">
          <span>{editing ? '更换 Key（可选）' : 'API Key'}</span>
          <Input
            autoComplete="off"
            placeholder={editing ? '留空则保留现有 Key' : '粘贴 API Key'}
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
          {editing ? (
            <small className="tw:col-start-2 tw:max-[720px]:col-start-1">
              输入新 Key 后，健康状态会重置为“未测试”。
            </small>
          ) : null}
        </label>
      </div>

      <footer className="settings-management-dialog-footer model-center-key-dialog-actions tw:flex-wrap">
        {onCancel ? (
          <Button color="secondary" onClick={onCancel}>
            取消
          </Button>
        ) : null}
        <Button color="primary" disabled={!canSubmit} loading={busy} type="submit">
          {submitLabel ?? (editing ? '保存更改' : '安全保存')}
        </Button>
      </footer>
    </form>
  )
}

export type ApiKeyEditorDialogProps = {
  open: boolean
  providers: DesktopModelProviderSummary[]
  initialProviderId: ModelProviderID
  apiKey?: DesktopApiKeySummary | null
  busy?: boolean
  restoreFocusElement?: HTMLElement | null
  onOpenChange: (open: boolean) => void
  onSubmit: (value: ApiKeyEditorValue) => Promise<boolean>
}

export function ApiKeyEditorDialog({
  open,
  providers,
  initialProviderId,
  apiKey: currentApiKey = null,
  busy = false,
  restoreFocusElement,
  onOpenChange,
  onSubmit,
}: ApiKeyEditorDialogProps): React.ReactNode {
  const retainedApiKey = useLastNonNull(currentApiKey)
  const apiKey = open ? currentApiKey : retainedApiKey
  const titleId = useId()
  const descriptionId = useId()
  const editing = Boolean(apiKey)
  const { onCloseAutoFocus } = useDialogFocusRestore(open, restoreFocusElement)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          className="ui-dialog-surface ui-dialog-surface--centered settings-management-dialog model-center-key-dialog tw:w-[min(520px,calc(100vw_-_48px))] tw:max-h-[min(720px,calc(100vh_-_48px))] tw:overflow-x-hidden"
          data-dialog-size="credential"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className="settings-management-dialog-header model-center-key-dialog-header tw:flex tw:items-start tw:justify-between tw:gap-4 tw:border-b tw:border-b-app-border-subtle tw:p-5">
            <div className="settings-management-dialog-heading model-center-key-dialog-heading tw:flex tw:min-w-0 tw:items-start tw:gap-3">
              <span className="model-center-key-dialog-icon tw:inline-flex tw:size-9 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-md tw:bg-app-editor tw:text-app-text-soft tw:[&_svg]:size-icon-lg">
                <KeyRound size={APP_ICON_SIZE} aria-hidden />
              </span>
              <div>
                <Dialog.Title id={titleId} className="tw:type-weight-label">
                  {editing ? '编辑 API Key' : '新增 API Key'}
                </Dialog.Title>
                <Dialog.Description
                  id={descriptionId}
                  className="tw:mt-1 tw:[line-height:var(--cpx-sys-line-height-tight)]"
                >
                  {editing
                    ? '修改名称，或输入新 Key 完成安全更换。旧密钥不会回填。'
                    : '密钥保存后只显示名称和尾号，页面不会再次展示明文。'}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <Button isIconOnly color="ghostSecondary" size="toolbar" title="关闭">
                <X size={APP_ICON_SIZE} aria-hidden />
              </Button>
            </Dialog.Close>
          </header>
          <ApiKeyEditorForm
            apiKey={apiKey}
            busy={busy}
            autoFocusLabel
            initialProviderId={initialProviderId}
            providers={providers}
            resetSignal={open}
            submitLabel={editing ? '保存更改' : '安全保存'}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
