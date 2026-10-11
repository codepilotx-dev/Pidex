import type React from 'react'
import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../../../components/ui/Button.js'
import { FullScreenWhaleLoading } from '../../../components/ui/FullScreenWhaleLoading.js'
import { useDialogFocusRestore } from '../../../components/ui/UseDialogFocusRestore.js'
import type { DesktopModelProviderSummary } from '../../../../shared/Types.js'
import { isExecutableDesktopProvider } from '../../../services/desktop-client/ProviderAdapters.js'
import type { ProviderManagementSnapshot } from '../../provider-management/Types.js'
import { providerManagementStore } from '../../provider-management/ProviderManagementStore.js'
import { useProviderManagementSnapshot } from '../../provider-management/UseProviderManagementSnapshot.js'
import { useDesktopSettings } from '../../settings/UseDesktopSettings.js'

export type ModelSetupGateDecision = 'loading' | 'recovery' | 'setup' | 'workbench'

/**
 * 跨 Provider 判断是否存在可用任务模型：当前 Provider 已连接且有模型，
 * 或其他 Provider 已启用、可执行且认证可用。避免当前 Provider 不可用时误判为需要重新配置。
 */
export function hasUsableTaskModel(
  state: {
    apiKeyConfigured: boolean
    models: readonly string[]
  },
  providers: readonly DesktopModelProviderSummary[] = [],
): boolean {
  if (state.apiKeyConfigured === true && state.models.length > 0) return true
  return providers.some(
    (provider) => provider.apiKeyConfigured === true && isExecutableDesktopProvider(provider),
  )
}

export function resolveModelSetupGate(
  snapshot: Pick<
    ProviderManagementSnapshot,
    'loaded' | 'configurationError' | 'currentProviderState' | 'providers'
  >,
  settings: {
    settingsLoaded: boolean
    firstUseSetupCompleted: 0 | 1 | undefined
  },
): ModelSetupGateDecision {
  if (!snapshot.loaded || !settings.settingsLoaded) return 'loading'
  if (snapshot.configurationError || !snapshot.currentProviderState) return 'recovery'
  if (settings.firstUseSetupCompleted === 0) return 'setup'
  if (settings.firstUseSetupCompleted === 1) return 'workbench'
  return hasUsableTaskModel(snapshot.currentProviderState, snapshot.providers)
    ? 'workbench'
    : 'setup'
}

export function RequireConfiguredModel(): React.ReactNode {
  const snapshot = useProviderManagementSnapshot()
  const settings = useDesktopSettings()
  const decision = resolveModelSetupGate(snapshot, settings)
  const [setupDialogDismissed, setSetupDialogDismissed] = useState(false)

  useEffect(() => {
    if (
      !settings.settingsLoaded ||
      !snapshot.loaded ||
      snapshot.configurationError ||
      !snapshot.currentProviderState ||
      settings.firstUseSetupCompleted !== undefined
    )
      return
    const inferred = hasUsableTaskModel(snapshot.currentProviderState, snapshot.providers) ? 1 : 0
    void settings.saveFirstUseSetupCompleted(inferred).catch(() => undefined)
  }, [
    settings.firstUseSetupCompleted,
    settings.saveFirstUseSetupCompleted,
    settings.settingsLoaded,
    snapshot.configurationError,
    snapshot.currentProviderState,
    snapshot.providers,
    snapshot.loaded,
  ])

  useEffect(() => {
    if (decision !== 'setup' && setupDialogDismissed) {
      setSetupDialogDismissed(false)
    }
  }, [decision, setupDialogDismissed])

  if (decision === 'loading') {
    return (
      <SetupBootState
        label={resolveModelSetupLoadingLabel(snapshot.loaded, settings.settingsLoaded)}
      />
    )
  }
  if (decision === 'recovery') {
    return (
      <SetupRecoveryState
        message={snapshot.configurationError ?? snapshot.error}
        onRetry={() => void providerManagementStore.refresh()}
      />
    )
  }
  return (
    <>
      <Outlet />
      {decision === 'setup' ? (
        <ModelSetupGuideDialog
          open={!setupDialogDismissed}
          onOpenChange={(open) => setSetupDialogDismissed(!open)}
        />
      ) : null}
    </>
  )
}

function ModelSetupGuideDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.ReactNode {
  const navigate = useNavigate()
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop" />
        <Dialog.Content
          className="ui-dialog-surface ui-dialog-surface--centered tw:grid tw:w-[min(26rem,calc(100vw-2rem))] tw:gap-4 tw:p-6"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className="tw:flex tw:flex-col tw:gap-1.5">
            <Dialog.Title asChild>
              <h2 className="tw:type-title-md tw:m-0 tw:text-app-text">先配置一个模型</h2>
            </Dialog.Title>
            <Dialog.Description asChild>
              <p className="tw:type-body-sm tw:m-0 tw:text-app-text-soft">
                配置模型后即可开始编写代码、分析项目或执行自动化任务。
              </p>
            </Dialog.Description>
          </header>
          <div className="tw:mt-2 tw:flex tw:items-center tw:justify-end tw:gap-3">
            <Dialog.Close asChild>
              <Button color="secondary" onClick={() => onOpenChange(false)}>
                稍后
              </Button>
            </Dialog.Close>
            <Button
              color="primary"
              onClick={() => {
                onOpenChange(false)
                navigate('/setup')
              }}
            >
              前往模型设置
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function resolveModelSetupLoadingLabel(
  providerLoaded: boolean,
  settingsLoaded: boolean,
): string {
  if (!providerLoaded) return '正在读取模型配置…'
  if (!settingsLoaded) return '正在读取桌面设置…'
  return '正在准备模型设置…'
}

export function SetupBootState({ label }: { label: string }): React.ReactNode {
  return <FullScreenWhaleLoading label={label} />
}

export function SetupRecoveryState({
  message,
  onRetry,
}: {
  message: string | null
  onRetry: () => void
}): React.ReactNode {
  return (
    <main
      className="tw:grid tw:h-screen tw:w-full tw:place-content-center tw:justify-items-center tw:gap-5 tw:bg-app-canvas tw:p-8 tw:text-center"
      data-startup-surface-ready="true"
    >
      <div className="tw:max-w-md">
        <h1 className="tw:type-title-md tw:m-0 tw:text-app-text">本地 Agent 暂时不可用</h1>
        <p className="tw:mt-2 tw:mb-0 tw:text-app-text-soft">
          {message || '无法读取供应商配置。请确认 Agent 已启动，然后重试。'}
        </p>
      </div>
      <Button color="secondary" onClick={onRetry}>
        重试
      </Button>
    </main>
  )
}
