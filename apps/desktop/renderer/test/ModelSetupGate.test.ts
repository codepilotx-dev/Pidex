import { describe, expect, test } from 'bun:test'
import { resolveModelSetupGate } from '../src/features/models/setup/RequireConfiguredModel.js'

const settings = (firstUseSetupCompleted: 0 | 1 | undefined, settingsLoaded = true) => ({
  firstUseSetupCompleted,
  settingsLoaded,
})

const providerSnapshot = (usable: boolean) => ({
  loaded: true,
  configurationError: null,
  providers: [],
  currentProviderState: {
    apiKeyConfigured: usable,
    models: usable ? ['usable-model'] : [],
  } as never,
})

const configuredModelSnapshot = {
  loaded: true,
  configurationError: null,
  providers: [],
  currentProviderState: { apiKeyConfigured: true, models: ['usable-model'] } as never,
}

describe('first-use model setup gate', () => {
  test('waits for both settings and provider state before routing', () => {
    expect(
      resolveModelSetupGate(
        {
          loaded: false,
          configurationError: null,
          providers: [],
          currentProviderState: null,
        },
        settings(undefined),
      ),
    ).toBe('loading')
    expect(resolveModelSetupGate(providerSnapshot(true), settings(undefined, false))).toBe(
      'loading',
    )
  })

  test('keeps Agent configuration failures in recovery', () => {
    expect(
      resolveModelSetupGate(
        {
          loaded: true,
          configurationError: '供应商配置状态暂时无法读取',
          providers: [],
          currentProviderState: configuredModelSnapshot.currentProviderState,
        },
        settings(1),
      ),
    ).toBe('recovery')
    expect(
      resolveModelSetupGate(
        {
          loaded: true,
          configurationError: null,
          providers: [],
          currentProviderState: null,
        },
        settings(0),
      ),
    ).toBe('recovery')
  })

  test('explicit zero always opens the full setup guide', () => {
    expect(resolveModelSetupGate(providerSnapshot(false), settings(0))).toBe('setup')
    expect(resolveModelSetupGate(providerSnapshot(true), settings(0))).toBe('setup')
  })

  test('explicit one always opens the workbench', () => {
    expect(resolveModelSetupGate(providerSnapshot(false), settings(1))).toBe('workbench')
    expect(resolveModelSetupGate(providerSnapshot(true), settings(1))).toBe('workbench')
  })

  test('legacy settings infer the one-time value from any usable task model', () => {
    expect(resolveModelSetupGate(providerSnapshot(false), settings(undefined))).toBe('setup')
    expect(resolveModelSetupGate(providerSnapshot(true), settings(undefined))).toBe('workbench')
  })

  test('another configured provider keeps the workbench reachable', () => {
    const crossProvider = {
      loaded: true,
      configurationError: null,
      currentProviderState: { apiKeyConfigured: false, models: [] } as never,
      providers: [
        {
          providerID: 'other-provider',
          enabled: true,
          apiKeyConfigured: true,
          modelCount: 1,
          defaultModels: ['other-model'],
        } as never,
      ],
    }
    expect(resolveModelSetupGate(crossProvider, settings(undefined))).toBe('workbench')

    // 其他 Provider 未认证或不可执行时仍然要求完成配置。
    expect(
      resolveModelSetupGate(
        {
          ...crossProvider,
          providers: [{ ...crossProvider.providers[0], apiKeyConfigured: false } as never],
        },
        settings(undefined),
      ),
    ).toBe('setup')
    expect(
      resolveModelSetupGate(
        {
          ...crossProvider,
          providers: [{ ...crossProvider.providers[0], enabled: false } as never],
        },
        settings(undefined),
      ),
    ).toBe('setup')
  })
})
