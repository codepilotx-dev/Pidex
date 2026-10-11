import { describe, expect, test } from 'bun:test'
import { Model, type Credential } from '@pidex/model-schema'
import { Effect } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EncryptedCredentialRepository } from '../src/auth/EncryptedCredentialRepository'
import {
  EncryptedCredentialStore,
  PiModelService,
  type PiModelCatalogConfig,
} from '../src/provider/pi'

type Stored = {
  id: string
  integrationID: string
  methodID: string | null
  label: string
  value: Credential.Value
}

const repository = (initial: Stored[] = []) => {
  const values = new Map(initial.map((value) => [value.integrationID, value]))
  return {
    values,
    adapter: {
      list: () =>
        [...values.values()].map(({ value: _value, ...summary }) => ({
          ...summary,
          keyVersion: 1,
          createdAt: 1,
          updatedAt: 1,
        })),
      get: <T>(integrationID: string) =>
        Effect.succeed(
          (values.get(integrationID) ?? null) as {
            id: string
            integrationID: string
            kind: 'api-key' | 'oauth'
            methodID: string | null
            label: string
            value: T
          } | null,
        ),
      set: (input: { integrationID: string; methodID?: string; label?: string; value: unknown }) =>
        Effect.sync(() => {
          const current = values.get(input.integrationID)
          const next: Stored = {
            id: current?.id ?? `cred_${input.integrationID}`,
            integrationID: input.integrationID,
            methodID: input.methodID ?? null,
            label: input.label ?? 'default',
            value: input.value as Credential.Value,
          }
          values.set(input.integrationID, next)
          return { ...next, keyVersion: 1, createdAt: 1, updatedAt: 1 }
        }),
      upsertOAuth: (input: {
        providerID: string
        methodID: string
        label?: string
        value: Credential.Value
      }) =>
        Effect.sync(() => {
          const current = values.get(input.providerID)
          const next: Stored = {
            id: current?.id ?? `cred_${input.providerID}`,
            integrationID: input.providerID,
            methodID: input.methodID,
            label: input.label ?? current?.label ?? 'OAuth',
            value: input.value,
          }
          values.set(input.providerID, next)
          return { ...next, keyVersion: 1, createdAt: 1, updatedAt: 1 }
        }),
      remove: (integrationID: string) => Effect.sync(() => values.delete(integrationID)),
    } as unknown as EncryptedCredentialRepository,
  }
}

describe('EncryptedCredentialStore', () => {
  test('converts encrypted Pidex credentials without exposing secrets in list', async () => {
    const key = 'sk-not-in-metadata'
    const fake = repository([
      {
        id: 'cred_openai',
        integrationID: 'openai',
        methodID: null,
        label: 'default',
        value: { type: 'key', key },
      },
    ])
    const store = new EncryptedCredentialStore(fake.adapter)

    expect(await store.read('openai')).toEqual({ type: 'api_key', key })
    expect(await store.list()).toEqual([{ providerId: 'openai', type: 'api_key' }])
    expect(JSON.stringify(await store.list())).not.toContain(key)
  })

  test('serializes OAuth refreshes per provider and preserves method metadata', async () => {
    const fake = repository([
      {
        id: 'cred_anthropic',
        integrationID: 'anthropic',
        methodID: 'oauth-default',
        label: 'account',
        value: {
          type: 'oauth',
          methodID: 'oauth-default' as never,
          refresh: 'r0',
          access: 'a0',
          expires: 1,
        },
      },
    ])
    const store = new EncryptedCredentialStore(fake.adapter)
    const seen: string[] = []

    await Promise.all([
      store.modify('anthropic', async (current) => {
        seen.push(current?.type === 'oauth' ? current.access : 'missing')
        await Bun.sleep(5)
        return { type: 'oauth', refresh: 'r1', access: 'a1', expires: 2 }
      }),
      store.modify('anthropic', async (current) => {
        seen.push(current?.type === 'oauth' ? current.access : 'missing')
        return { type: 'oauth', refresh: 'r2', access: 'a2', expires: 3 }
      }),
    ])

    expect(seen).toEqual(['a0', 'a1'])
    expect(fake.values.get('anthropic')?.methodID).toBe('oauth-default')
    expect(fake.values.get('anthropic')?.value).toMatchObject({ type: 'oauth', access: 'a2' })
  })
})

describe('PiModelService DeepSeek protocol', () => {
  const deepSeekRepository = () =>
    repository([
      {
        id: 'cred_deepseek',
        integrationID: 'deepseek',
        methodID: null,
        label: 'DeepSeek',
        value: { type: 'key', key: 'sk-deepseek-secret' },
      },
    ])

  const deepSeekConfig = (protocol?: string) => ({
    schemaVersion: 2,
    providers: {
      deepseek: {
        kind: 'builtin',
        enabled: true,
        allow_models: [],
        deny_models: [],
        models: {},
        ...(protocol ? { protocol } : {}),
      },
    },
  })

  const deepSeekRef = () => ({
    providerID: 'deepseek' as never,
    id: 'deepseek-v4-pro' as never,
  })

  test('rebuilds every DeepSeek model on the selected protocol', async () => {
    const fake = deepSeekRepository()
    const service = new PiModelService(fake.adapter, {
      config: deepSeekConfig('anthropic-messages'),
      env: {},
    })

    try {
      await service.list()
      const models = service.pi.getModels('deepseek')
      expect(models.map((model) => model.id)).toContain('deepseek-v4-pro')
      for (const model of models) {
        expect(model.api).toBe('anthropic-messages')
        expect(model.baseUrl).toBe('https://api.deepseek.com/anthropic')
        // openai-completions 的 compat 不能带到 Anthropic 协议上。
        expect(model.compat).toBeUndefined()
      }
      const pro = models.find((model) => model.id === 'deepseek-v4-pro')
      expect(pro).toMatchObject({
        provider: 'deepseek',
        reasoning: true,
        contextWindow: 1_000_000,
      })
      expect(await service.isAuthConfigured('deepseek')).toBe(true)
      expect(await service.getPiModel(deepSeekRef() as never)).toBe(pro!)
      expect((await service.list()).find((provider) => provider.id === 'deepseek')).toMatchObject({
        source: {
          kind: 'builtin',
          apis: ['anthropic-messages'],
          baseUrl: 'https://api.deepseek.com/anthropic',
        },
      })
    } finally {
      await service.dispose()
    }
  })

  test('uses OpenAI Responses without leaking completions compat', async () => {
    const fake = deepSeekRepository()
    const service = new PiModelService(fake.adapter, {
      config: deepSeekConfig('openai-responses'),
      env: {},
    })

    try {
      await service.list()
      const models = service.pi.getModels('deepseek')
      expect(models.length).toBeGreaterThan(0)
      for (const model of models) {
        expect(model.api).toBe('openai-responses')
        expect(model.baseUrl).toBe('https://api.deepseek.com')
        expect(model.compat).toBeUndefined()
      }
      expect(service.pi.getProvider('deepseek')?.baseUrl).toBe('https://api.deepseek.com')
    } finally {
      await service.dispose()
    }
  })

  test('keeps the running model until the next resolution and restores the default', async () => {
    const fake = deepSeekRepository()
    let config: PiModelCatalogConfig = deepSeekConfig()
    const service = new PiModelService(fake.adapter, {
      config: () => config,
      env: {},
    })

    try {
      const before = await service.getPiModel(deepSeekRef() as never)
      expect(before.api).toBe('openai-completions')
      expect(before.compat).toBeDefined()

      config = deepSeekConfig('anthropic-messages') as PiModelCatalogConfig
      await service.reload()
      // 已经开始的请求继续使用原来的协议与端点。
      expect(before.api).toBe('openai-completions')
      expect(before.baseUrl).toBe('https://api.deepseek.com')
      expect(before.compat).toBeDefined()
      const switched = await service.getPiModel(deepSeekRef() as never)
      expect(switched.api).toBe('anthropic-messages')
      expect(switched.baseUrl).toBe('https://api.deepseek.com/anthropic')

      config = deepSeekConfig() as PiModelCatalogConfig
      await service.reload()
      const restored = await service.getPiModel(deepSeekRef() as never)
      expect(restored.api).toBe('openai-completions')
      expect(restored.baseUrl).toBe('https://api.deepseek.com')
      expect(restored.compat).toBeDefined()
    } finally {
      await service.dispose()
    }
  })

  test('ignores a rejected protocol and keeps the running provider', async () => {
    const fake = deepSeekRepository()
    let config: PiModelCatalogConfig = deepSeekConfig('anthropic-messages') as PiModelCatalogConfig
    const service = new PiModelService(fake.adapter, {
      config: () => config,
      env: {},
    })

    try {
      expect((await service.configIssues()).length).toBe(0)
      config = deepSeekConfig('openai-beta-fim') as PiModelCatalogConfig
      await service.reload()

      expect(await service.configIssues()).toEqual([
        {
          providerID: 'deepseek',
          path: 'model_providers.deepseek',
          code: 'INVALID_PROVIDER',
        },
      ])
      expect(service.pi.getProvider('deepseek')?.baseUrl).toBe('https://api.deepseek.com/anthropic')
      expect(
        service.pi.getModels('deepseek').every((model) => model.api === 'anthropic-messages'),
      ).toBe(true)
    } finally {
      await service.dispose()
    }
  })
})

describe('PiModelService', () => {
  test('reload advances catalog revision and re-evaluates OAuth model availability', async () => {
    const fake = repository()
    const service = new PiModelService(fake.adapter, { env: {} })
    const beforeRevision = service.catalogRevision()

    expect((await service.models('openai-codex' as never)).some((model) => model.enabled)).toBe(
      false,
    )
    fake.values.set('openai-codex', {
      id: 'cred_openai_codex',
      integrationID: 'openai-codex',
      methodID: 'openai-codex:oauth',
      label: 'OAuth',
      value: {
        type: 'oauth',
        methodID: 'openai-codex:oauth' as never,
        refresh: 'oauth-refresh-secret',
        access: 'oauth-access-secret',
        expires: Date.now() + 60_000,
      },
    })

    await service.reload()

    expect(service.catalogRevision()).toBeGreaterThan(beforeRevision)
    expect((await service.models('openai-codex' as never)).some((model) => model.enabled)).toBe(
      true,
    )
  })

  test('reports configured API key, OAuth, environment, and auth-free providers', async () => {
    const fake = repository([
      {
        id: 'cred_deepseek',
        integrationID: 'deepseek',
        methodID: null,
        label: 'DeepSeek',
        value: { type: 'key', key: 'sk-deepseek-secret' },
      },
      {
        id: 'cred_openai_codex',
        integrationID: 'openai-codex',
        methodID: null,
        label: 'OpenAI Codex',
        value: {
          type: 'oauth',
          methodID: 'oauth-default' as never,
          refresh: 'oauth-refresh-secret',
          access: 'oauth-access-secret',
          expires: Date.now() + 60_000,
        },
      },
    ])
    const service = new PiModelService(fake.adapter, {
      env: { OPENAI_API_KEY: 'sk-openai-environment-secret' },
      config: {
        schemaVersion: 2,
        providers: {
          local: {
            kind: 'custom',
            name: 'Local',
            enabled: true,
            base_url: 'http://127.0.0.1:11434/v1',
            auth: 'none',
            env: [],
            allow_insecure_http: false,
            models: {
              chat: { api: 'openai-completions' },
            },
          },
        },
      },
    })

    expect(await service.isAuthConfigured('deepseek')).toBe(true)
    expect(await service.isAuthConfigured('openai-codex')).toBe(true)
    expect(await service.isAuthConfigured('openai')).toBe(true)
    expect(await service.isAuthConfigured('local')).toBe(true)
    expect(await service.isAuthConfigured('anthropic')).toBe(false)
    expect(await service.isAuthConfigured('missing')).toBe(false)
  })

  test('maps Pi models to the existing RPC-facing model schema', async () => {
    const key = 'sk-model-secret'
    const fake = repository([
      {
        id: 'cred_openai',
        integrationID: 'openai',
        methodID: null,
        label: 'default',
        value: { type: 'key', key },
      },
    ])
    const service = new PiModelService(fake.adapter, {
      config: {
        providers: {
          openai: {
            kind: 'builtin',
            enabled: true,
            allow_models: [],
            deny_models: [],
          },
        },
      },
      env: {},
    })
    const piModel = service.pi
      .getModels('openai')
      .find((candidate) => candidate.id === 'gpt-6-astra')
    expect(piModel).toBeDefined()
    expect(piModel?.cost).toMatchObject({ input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 })
    expect(piModel?.maxTokens).toBe(128_000)
    expect(piModel?.input).toContain('image')

    const resolved = await service.resolve({
      providerID: piModel!.provider as never,
      id: Model.ID.make(piModel!.id),
    })

    expect(String(resolved.providerID)).toBe('openai')
    expect(resolved.api.type).toBe('pi')
    expect(resolved.capabilities.tools).toBe(true)
    expect(resolved.enabled).toBe(true)
    expect(JSON.stringify(resolved)).not.toContain(key)
  })

  test('maps Pi reasoning levels to existing model variants and resolves a selected level', async () => {
    const fake = repository([
      {
        id: 'cred_openai',
        integrationID: 'openai',
        methodID: null,
        label: 'default',
        value: { type: 'key', key: 'sk-test' },
      },
    ])
    const service = new PiModelService(fake.adapter, {
      config: {
        providers: {
          openai: {
            kind: 'builtin',
            enabled: true,
            allow_models: [],
            deny_models: [],
          },
        },
      },
      env: {},
    })
    const piModel = service.pi.getModels('openai').find((candidate) => candidate.reasoning)
    expect(piModel).toBeDefined()

    const info = await service.resolve({
      providerID: piModel!.provider as never,
      id: Model.ID.make(piModel!.id),
      variant: Model.VariantID.make('medium'),
    })

    expect(info.variants.map((variant) => String(variant.id))).toContain('medium')
    expect(info.variant).toBe('medium')
    expect(
      await service.getPiModel({
        providerID: piModel!.provider as never,
        id: Model.ID.make(piModel!.id),
        variant: Model.VariantID.make('medium'),
      }),
    ).toBe(piModel!)
  })

  test('loads Pi native providers and preserves custom-provider precedence', async () => {
    const fake = repository([
      {
        id: 'cred_custom_shadow',
        integrationID: 'custom-shadow',
        methodID: null,
        label: 'default',
        value: { type: 'key', key: 'sk-custom-secret' },
      },
    ])
    const service = new PiModelService(fake.adapter, {
      config: {
        schemaVersion: 2,
        providers: {
          'custom-shadow': {
            kind: 'custom',
            name: 'User Shadow',
            enabled: true,
            base_url: 'https://user-shadow.example/v1',
            auth: 'api-key',
            env: [],
            models: { local: { api: 'openai-completions' } },
          },
        },
      },
      env: {},
    })

    try {
      const providers = await service.list()
      // Pi native builtin providers
      expect(
        providers.some(
          (provider) =>
            provider.source.kind === 'builtin' && provider.catalogOrigin === 'pi-bundled',
        ),
      ).toBe(true)
      // Custom provider
      const custom = providers.find((provider) => provider.id === 'custom-shadow')
      expect(custom).toMatchObject({
        name: 'User Shadow',
        source: { kind: 'custom' },
        catalogOrigin: 'user',
        availability: { status: 'ready' },
      })

      const models = await service.models()
      expect(
        models.some(
          (model) => model.providerID === 'custom-shadow' && model.id === 'local' && model.enabled,
        ),
      ).toBe(true)

      const initialRevision = service.catalogRevision()
      await service.refresh(false)
      expect(service.catalogRevision()).toBeGreaterThan(initialRevision)

      expect(await service.isAuthConfigured('custom-shadow')).toBe(true)
    } finally {
      await service.dispose()
    }
  })
})
