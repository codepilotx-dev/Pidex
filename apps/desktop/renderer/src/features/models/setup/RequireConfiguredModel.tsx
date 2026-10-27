import type React from 'react'
import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../../../components/ui/Button.js'
import { FullScreenWhaleLoading } from '../../../components/ui/FullScreenWhaleLoading.js'
import { useDialogFocusRestore } from '../../../components/ui/UseDialogFocusRestore.js'
import type { DesktopModelProviderSummary } from '../../../../shared/Types.js'
import { isExecutableDesktopProvider } from '../../../services/desktop-client/ProviderAdapters.js'
import type { ProviderConfigurationState } from '../../provider-management/Types.js'
import { providerManagementStore } from '../../provider-management/ProviderManagementStore.js'
import {
  useProviderManagementStore,
  useShallow,
} from '../../provider-management/UseProviderManagementStore.js'
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
  configuration: Pick<
    ProviderConfigurationState,
    'loaded' | 'configurationError' | 'currentProviderState' | 'providers'
  >,
  settings: {
    settingsLoaded: boolean
    firstUseSetupCompleted: 0 | 1 | undefined
  },
): ModelSetupGateDecision {
  if (!configuration.loaded || !settings.settingsLoaded) return 'loading'
  if (configuration.configurationError || !configuration.currentProviderState) return 'recovery'
  if (settings.firstUseSetupCompleted === 0) return 'setup'
  if (settings.firstUseSetupCompleted === 1) return 'workbench'
  return hasUsableTaskModel(configuration.currentProviderState, configuration.providers)
    ? 'workbench'
    : 'setup'
}

export function RequireConfiguredModel(): React.ReactNode {
  const configuration = useProviderManagementStore(
    useShallow((state) => ({
      loaded: state.configuration.loaded,
      error: state.configuration.error,
      configurationError: state.configuration.configurationError,
      currentProviderState: state.configuration.currentProviderState,
      providers: state.configuration.providers,
    })),
  )
  const settings = useDesktopSettings()
  const decision = resolveModelSetupGate(configuration, settings)
  const [setupDialogDismissed, setSetupDialogDismissed] = useState(false)

  useEffect(() => {
    if (
      !settings.settingsLoaded ||
      !configuration.loaded ||
      configuration.configurationError ||
      !configuration.currentProviderState ||
      settings.firstUseSetupCompleted !== undefined
    )
      return
    const inferred = hasUsableTaskModel(configuration.currentProviderState, configuration.providers)
      ? 1
      : 0
    void settings.saveFirstUseSetupCompleted(inferred).catch(() => undefined)
  }, [
    settings.firstUseSetupCompleted,
    settings.saveFirstUseSetupCompleted,
    settings.settingsLoaded,
    configuration.configurationError,
    configuration.currentProviderState,
    configuration.providers,
    configuration.loaded,
  ])

  useEffect(() => {
    if (decision !== 'setup' && setupDialogDismissed) {
      setSetupDialogDismissed(false)
    }
  }, [decision, setupDialogDismissed])

  if (decision === 'loading') {
    return (
      <SetupBootState
        label={resolveModelSetupLoadingLabel(configuration.loaded, settings.settingsLoaded)}
      />
    )
  }
  if (decision === 'recovery') {
    return (
      <SetupRecoveryState
        message={configuration.configurationError ?? configuration.error}
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
              <Button size="md" color="secondary" onClick={() => onOpenChange(false)}>
                稍后
              </Button>
            </Dialog.Close>
            <Button
              size="md"
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
