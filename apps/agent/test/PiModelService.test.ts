import { describe, expect, spyOn, test } from 'bun:test'
import { Model, Provider, type Credential } from '@pidex/model-schema'
import { Effect } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EncryptedCredentialRepository } from '../src/auth/EncryptedCredentialRepository'
import { ProviderDirectoryStore } from '../src/provider/pi/ProviderDirectoryStore'
import { normalizeContext } from '@earendil-works/pi-ai'
import { ModelSyncService } from '../src/provider/ModelSyncService'
import type { ConfigService } from '../src/config/ConfigService'
import {
  EncryptedCredentialStore,
  PiModelService,
  type PiModelCatalogConfig,
} from '../src/provider/pi'

test('catalog refresh identifies failed providers without logging upstream secrets', async () => {
  const logs: unknown[] = []
  const service = new PiModelService(repository().adapter, {
    logger: { warn: (event, fields) => { logs.push({ event, ...fields }) } },
  })
  const refresh = spyOn(service.pi, 'refresh').mockResolvedValue({
    aborted: false,
    errors: new Map([
      ['openai', new Error('Model discovery failed with HTTP 401 private-secret')],
      ['google', new Error('fetch failed private-secret')],
      ['custom', new Error('Model discovery returned an invalid OpenAI catalog')],
    ]),
  })
  try {
    await expect(service.refresh(true, 'google')).rejects.toMatchObject({
      refreshFailures: ['openai：凭据鉴权失败（HTTP 401）', 'google：网络连接失败', 'custom：模型列表响应格式无效'],
    })
    expect(logs).toHaveLength(3)
    expect(JSON.stringify(logs)).not.toContain('private-secret')
    expect(logs[0]).toMatchObject({ provider: 'openai', category: 'authentication' })
  } finally {
    refresh.mockRestore()
    await service.dispose()
  }
})

test('scoped catalog refresh never requests other providers and directory reload stays offline', async () => {
  const service = new PiModelService(repository().adapter)
  const refresh = spyOn(service.pi, 'refresh').mockImplementation(async (options) => ({
    aborted: false,
    errors: new Map(options?.providers?.includes('xiaomi-token-plan-cn')
      ? [['xiaomi-token-plan-cn', new Error('Model discovery failed with HTTP 401')]]
      : []),
  }))
  try {
    await service.refresh(true, 'google')
    expect(refresh).toHaveBeenLastCalledWith({ allowNetwork: true, force: true, providers: ['google'] })
    await service.reload()
    expect(refresh).toHaveBeenLastCalledWith({ allowNetwork: false })
    await expect(service.refresh(true, 'missing-provider')).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(refresh).toHaveBeenCalledTimes(2)
  } finally {
    refresh.mockRestore()
    await service.dispose()
  }
})

test('directory refresh downloads both upstreams without requesting provider models and preserves data on failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-provider-directory-'))
  const path = join(directory, 'catalog.json')
  let failed = false
  const requests: string[] = []
  const directoryStore = new ProviderDirectoryStore(path, async (url, init) => {
    requests.push(String(url))
    expect(init?.headers).toBeUndefined()
    if (failed) return Response.json({ invalid: true })
    if (String(url).startsWith('https://pi.dev/')) return Response.json({ google: {
      example: { id: 'example', name: 'Example', api: 'google-generative-ai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', contextWindow: 32768, maxTokens: 8192, input: ['text'], reasoning: false },
    } })
    return Response.json({
      models: { example: { name: 'Example' } },
      providers: {
        google: { name: 'Google updated', models: {} },
        'directory-only': { name: 'New directory supplier', models: {} },
        local: { name: 'Upstream local name', models: {} },
      },
    })
  })
  const config = { schemaVersion: 2, providers: { local: {
    kind: 'custom', name: 'My supplier', enabled: true, auth: 'none',
    base_url: 'https://local.example/v1', models: {},
  } } }
  const service = new PiModelService(repository().adapter, { config, directory: directoryStore })
  const refresh = spyOn(service.pi, 'refresh').mockImplementation(async (options) => {
    expect(options?.allowNetwork).toBe(false)
    return { aborted: false, errors: new Map() }
  })
  try {
    await service.refreshDirectory()
    const providers = await service.list()
    expect(providers.find((p) => p.id === 'google')?.name).toBe('Google updated')
    expect((await service.models(Provider.ID.make('google'))).some((model) => model.id === 'example')).toBe(false)
    expect(providers.find((p) => p.id === 'local')?.name).toBe('My supplier')
    expect(providers.find((p) => p.id === 'directory-only')).toMatchObject({
      name: 'New directory supplier',
      availability: { status: 'unavailable', reason: 'missing-api' },
    })
    expect(service.pi.getProviders().some((p) => p.id === 'directory-only')).toBe(false)
    expect((await new ProviderDirectoryStore(path).providers()).some((p) => p.id === 'directory-only')).toBe(true)
    failed = true
    const revision = service.catalogRevision()
    await expect(service.refreshDirectory()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(await service.list()).toEqual(providers)
    expect(service.catalogRevision()).toBe(revision)
    expect(requests.every((url) => url === 'https://models.dev/catalog.json?type=all' || url === 'https://pi.dev/api/models?pi-version=0.99.2')).toBe(true)
  } finally {
    refresh.mockRestore()
    await service.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test('directory aliases deduplicate without hiding manual providers and compatible suppliers execute through Pi', async () => {
  const hits: string[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    hits.push(new URL(request.url).pathname)
    expect(request.headers.get('authorization')).toBe('Bearer directory-test-key')
    const chunk = (delta: object, finish: string | null) => `data: ${JSON.stringify({
      id: 'chat-test', object: 'chat.completion.chunk', created: 1, model: 'm',
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`
    return new Response(`${chunk({ content: 'OK' }, null)}${chunk({}, 'stop')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  } })
  const baseUrl = `${server.url}v1`
  const directory = new ProviderDirectoryStore(undefined, async (url) => Response.json(
    String(url).startsWith('https://pi.dev/') ? { 'vendor-a': { m: {
      id: 'm', name: 'Pi m', api: 'openai-completions', baseUrl,
      contextWindow: 32768, maxTokens: 8192, input: ['text'], reasoning: false,
    } } } : { models: { m: { name: 'm' } }, providers: {
      'vendor-a': { name: 'Vendor A', api: baseUrl, npm: '@ai-sdk/openai-compatible', models: { m: {} } },
      'vendor-b': { name: 'Same vendor with another name', api: `${baseUrl}/`, npm: '@ai-sdk/openai-compatible', models: { m: {} } },
      separate: { name: 'Different product', api: `${baseUrl}/coding`, npm: '@ai-sdk/openai-compatible', models: { m: {} } },
      unknown: { name: 'Choose protocol', api: baseUrl, npm: 'unsupported-sdk', models: {} },
      manual: { name: 'Upstream name', api: baseUrl, npm: '@ai-sdk/openai-compatible', models: {} },
    } },
  ))
  const fake = repository([{ id: 'cred_vendor-a', integrationID: 'vendor-a', methodID: null, label: 'default', value: { type: 'key', key: 'directory-test-key' } }])
  const config: { schemaVersion: number; providers: Record<string, unknown> } = { schemaVersion: 2, providers: { manual: {
    kind: 'custom', name: 'My manual provider', base_url: baseUrl, auth: 'none', models: {},
  } } }
  const service = new PiModelService(fake.adapter, { directory, config, env: {} })
  try {
    await service.refreshDirectory()
    expect(hits).toEqual([])
    const providers = await service.list()
    expect(providers.some((p) => p.id === 'vendor-a')).toBe(true)
    expect(providers.some((p) => p.id === 'vendor-b')).toBe(false)
    expect(providers.some((p) => p.id === 'separate')).toBe(true)
    expect(providers.find((p) => p.id === 'manual')).toMatchObject({ name: 'My manual provider', catalogOrigin: 'user' })
    expect(service.pi.getModels('vendor-a')).toHaveLength(0)
    const writes: unknown[] = []
    const sync = new ModelSyncService(service, {
      read: async () => ({ layers: [{ kind: 'user', version: 'fixture' }] }),
      snapshot: () => ({ model_providers: config.providers }),
      batchWrite: async (input: Parameters<ConfigService['batchWrite']>[0]) => {
        writes.push(input)
        for (const edit of input.edits) {
          const id = edit.keyPath[1]!
          const value = (config.providers[id] ??= {}) as Record<string, unknown>
          value[edit.keyPath[2]!] = edit.value
        }
        return {} as never
      },
    } as unknown as ConfigService)
    await expect(sync.sync('vendor-a', { fetch: async () => new Response(null, { status: 503 }) })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(writes).toEqual([])
    const synced = await sync.sync('vendor-a', { fetch: async (url) => {
      expect(String(url)).toBe(`${baseUrl}/models`)
      return Response.json({ data: [{ id: 'm' }] })
    } })
    expect(synced.candidates[0]).toMatchObject({ id: 'm', enabled: false })
    expect(config.providers['vendor-a']).toMatchObject({ kind: 'custom', directory_source: 'pi-remote', models: {} })
    await service.reload()
    config.providers['vendor-a'] = {
      kind: 'custom', directory_source: 'pi-remote', name: 'My saved vendor',
      base_url: baseUrl, auth: 'api-key', env: [],
      models: { m: { api: 'openai-completions', enabled: true } },
    }
    await service.reload()
    expect((await service.list()).find((p) => p.id === 'vendor-a')?.catalogOrigin).toBe('pi-remote')
    const model = await service.getPiModel(Model.Ref.make({ providerID: Provider.ID.make('vendor-a'), id: Model.ID.make('m') }))
    expect(model.api).toBe('openai-completions')
    expect((await service.pi.getAuth('vendor-a'))?.auth.apiKey).toBe('directory-test-key')
    const response = await service.pi.completeSimple(model, normalizeContext({ messages: [{ role: 'user', content: 'Reply OK', timestamp: 1 }] }), { maxTokens: 8 })
    expect(response.stopReason).not.toBe('error')
    expect(hits).toEqual(['/v1/chat/completions'])
    // Existing credentials keep both configured aliases visible; no identity is merged.
    fake.values.set('vendor-b', { id: 'cred_vendor-b', integrationID: 'vendor-b', methodID: null, label: 'default', value: { type: 'key', key: 'another-fixture-key' } })
    expect((await service.list()).some((p) => p.id === 'vendor-b')).toBe(true)
  } finally { await service.dispose(); server.stop(true) }
})

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
      await service.reload()
      expect(service.catalogRevision()).toBeGreaterThan(initialRevision)

      expect(await service.isAuthConfigured('custom-shadow')).toBe(true)
    } finally {
      await service.dispose()
    }
  })
})
