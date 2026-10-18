import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModels } from '@earendil-works/pi-ai'
import { Effect } from 'effect'
import { removeFixturePaths } from './FixtureCleanup'
import type { ProviderCredentialRepository } from '../src/auth/ProviderCredentialRepository'
import { ConfigService } from '../src/config/ConfigService'
import { ModelSyncService } from '../src/provider/ModelSyncService'
import { PiModelService } from '../src/provider/pi'
import type { ProviderModelFetch } from '../src/provider/pi'

const roots: string[] = []
const fixtures: Fixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.dispose()
  await removeFixturePaths(roots.splice(0))
})

const repository = {
  list: () => [],
  get: () => Effect.succeed(null),
  getActiveBinding: () => null,
} as unknown as ProviderCredentialRepository

interface Fixture {
  readonly root: string
  readonly configPath: string
  readonly config: ConfigService
  readonly piModels: PiModelService
  readonly sync: ModelSyncService
  readonly writes: Array<Parameters<ConfigService['batchWrite']>[0]>
  readonly snapshotProvider: (providerId: string) => Record<string, unknown>
  readonly dispose: () => Promise<void>
}

const customProvider = (overrides: Record<string, unknown> = {}) => ({
  kind: 'custom',
  name: 'Gateway',
  enabled: true,
  base_url: 'https://gateway.example/v1',
  auth: 'none',
  env: [],
  allow_insecure_http: false,
  headers: {},
  models: {},
  ...overrides,
})

const startRuntime = async (root: string, configPath: string, env: Record<string, string> = {}) => {
  const config = new ConfigService(configPath)
  await config.initialize()
  const piModels = new PiModelService(repository, {
    models: createModels({
      authContext: {
        env: async (name) => env[name] ?? process.env[name],
        fileExists: async () => false,
      },
    }),
    env,
    config: () => {
      const snapshot = config.snapshot()
      const catalog =
        snapshot.model_catalog && typeof snapshot.model_catalog === 'object'
          ? (snapshot.model_catalog as Record<string, unknown>)
          : {}
      return {
        ...(typeof catalog.schema_version === 'number'
          ? { schemaVersion: catalog.schema_version }
          : {}),
        providers:
          snapshot.model_providers && typeof snapshot.model_providers === 'object'
            ? (snapshot.model_providers as Record<string, unknown>)
            : {},
      }
    },
  })
  const writes: Array<Parameters<ConfigService['batchWrite']>[0]> = []
  const original = config.batchWrite.bind(config)
  config.batchWrite = (async (input) => {
    writes.push(structuredClone(input))
    return original(input)
  }) as ConfigService['batchWrite']
  const sync = new ModelSyncService(piModels, config)
  return {
    config,
    piModels,
    sync,
    writes,
    dispose: async () => {
      await piModels.dispose()
      await config.dispose()
    },
  }
}

const createFixture = async (
  providers: Record<string, unknown>,
  env: Record<string, string> = {},
): Promise<Fixture> => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-model-sync-'))
  roots.push(root)
  const configPath = join(root, 'config.json')
  await writeFile(
    configPath,
    `${JSON.stringify(
      { schema_version: 1, model_catalog: { schema_version: 2 }, model_providers: providers },
      null,
      2,
    )}\n`,
    'utf8',
  )
  const runtime = await startRuntime(root, configPath, env)
  const fixture: Fixture = {
    root,
    configPath,
    ...runtime,
    snapshotProvider: (providerId) => {
      const snapshot = runtime.config.snapshot()
      const configured =
        snapshot.model_providers && typeof snapshot.model_providers === 'object'
          ? (snapshot.model_providers as Record<string, Record<string, unknown>>)
          : {}
      return structuredClone(configured[providerId] ?? {})
    },
  }
  fixtures.push(fixture)
  return fixture
}

/** Re-opens the same config file with brand-new services (process restart). */
const restartFixture = async (fixture: Fixture): Promise<Fixture> => {
  await fixture.dispose()
  fixtures.splice(fixtures.indexOf(fixture), 1)
  const runtime = await startRuntime(fixture.root, fixture.configPath)
  const restarted: Fixture = {
    root: fixture.root,
    configPath: fixture.configPath,
    ...runtime,
    snapshotProvider: (providerId) => {
      const snapshot = runtime.config.snapshot()
      const configured =
        snapshot.model_providers && typeof snapshot.model_providers === 'object'
          ? (snapshot.model_providers as Record<string, Record<string, unknown>>)
          : {}
      return structuredClone(configured[providerId] ?? {})
    },
  }
  fixtures.push(restarted)
  return restarted
}

const openaiFetch =
  (ids: readonly string[], requests?: URL[]): ProviderModelFetch =>
  async (input) => {
    if (requests) requests.push(input instanceof URL ? input : new URL(String(input)))
    return Response.json({ data: ids.map((id) => ({ id })) })
  }

const customConfig = async (fixture: Fixture, providerId: string) => {
  const provider = (await fixture.piModels.catalogConfig()).providers[providerId]
  if (provider?.kind !== 'custom') throw new Error(`Missing custom provider ${providerId}`)
  return provider
}

describe('ModelSyncService', () => {
  test('首次同步只建立基线，不改动已有模型并返回协议形状候选', async () => {
    const manual = { api: 'openai-completions', name: 'Hand made' }
    const fixture = await createFixture({
      gateway: customProvider({ models: { manual } }),
    })
    const before = fixture.snapshotProvider('gateway')
    const result = await fixture.sync.sync('gateway', { fetch: openaiFetch(['beta', 'alpha']) })

    expect(result).toMatchObject({
      providerId: 'gateway',
      api: 'openai-completions',
      baselineCreated: true,
      removedModelIds: [],
      totalFetched: 2,
    })
    expect(result.fetchedAt).toBeGreaterThan(0)
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['alpha', 'beta'])
    expect(result.candidates[0]).toEqual({
      id: 'alpha',
      name: 'alpha',
      api: 'openai-completions',
      enabled: false,
      contextWindow: 32_768,
      maxTokens: 8_192,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })

    const saved = fixture.snapshotProvider('gateway')
    expect(saved.models).toEqual(before.models)
    expect(saved.model_sync).toEqual({
      fetched_at: result.fetchedAt,
      api: 'openai-completions',
      models: ['alpha', 'beta'],
    })
    expect((await customConfig(fixture, 'gateway')).modelSync?.models).toEqual(['alpha', 'beta'])
  })

  test('下架删除只覆盖基线与当前模型的交集，手工模型和保留模型原始字段不变', async () => {
    const seed = customProvider({
      custom_future_key: { keep: true },
      models: {
        a: {
          api: 'openai-completions',
          name: 'Custom A',
          group: '常用',
          enabled: false,
          context_window: 64_000,
          max_tokens: 4_096,
          headers: { 'X-Model': 'kept' },
        },
        b: { api: 'openai-completions' },
        manual: { api: 'openai-completions', name: 'Hand made' },
      },
      model_sync: { fetched_at: 1_000, api: 'openai-completions', models: ['a', 'b', 'c'] },
    })
    const fixture = await createFixture({ gateway: seed })
    const before = fixture.snapshotProvider('gateway')
    const result = await fixture.sync.sync('gateway', { fetch: openaiFetch(['a', 'x']) })

    expect(result).toMatchObject({
      baselineCreated: false,
      removedModelIds: ['b'],
      totalFetched: 2,
    })
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['x'])

    const writtenModels = fixture.writes[0]?.edits[0]?.value as Record<string, unknown>
    const expectedModels = structuredClone(before.models as Record<string, unknown>)
    delete expectedModels.b
    expect(writtenModels).toEqual(expectedModels)
    expect(writtenModels.a).toEqual((before.models as Record<string, unknown>).a)
    expect(writtenModels.manual).toEqual((before.models as Record<string, unknown>).manual)

    const saved = fixture.snapshotProvider('gateway')
    expect(Object.keys(saved.models as Record<string, unknown>).sort()).toEqual(['a', 'manual'])
    expect(saved.custom_future_key).toEqual({ keep: true })
    expect(saved.model_sync).toEqual({
      fetched_at: result.fetchedAt,
      api: 'openai-completions',
      models: ['a', 'x'],
    })
    expect(result.candidates.map((candidate) => candidate.enabled)).toEqual([false])
  })

  test('上游失败或空列表时不写入任何配置', async () => {
    const fixture = await createFixture({
      gateway: customProvider({ models: { alpha: { api: 'openai-completions' } } }),
    })
    const before = fixture.snapshotProvider('gateway')
    await expect(
      fixture.sync.sync('gateway', { fetch: async () => Response.json({ data: [] }) }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', status: 502 })
    await expect(
      fixture.sync.sync('gateway', {
        fetch: async () => new Response('upstream failure', { status: 503 }),
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', status: 502 })
    expect(fixture.writes).toEqual([])
    expect(fixture.snapshotProvider('gateway')).toEqual(before)
  })

  test('同步可以删除到零模型，重启后仍能读取基线与供应商', async () => {
    const fixture = await createFixture({
      gateway: customProvider({
        models: { a: { api: 'openai-completions' }, b: { api: 'openai-completions' } },
        model_sync: { fetched_at: 1, api: 'openai-completions', models: ['a', 'b'] },
      }),
    })
    const result = await fixture.sync.sync('gateway', { fetch: openaiFetch(['fresh']) })
    expect(result.removedModelIds).toEqual(['a', 'b'])
    expect(result.baselineCreated).toBe(false)
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['fresh'])
    const saved = fixture.snapshotProvider('gateway')
    expect(saved.models).toEqual({})
    expect(saved.model_sync).toEqual({
      fetched_at: result.fetchedAt,
      api: 'openai-completions',
      models: ['fresh'],
    })

    const restarted = await restartFixture(fixture)
    const summary = await restarted.piModels.modelSyncSummary('gateway')
    expect(summary).toMatchObject({ api: 'openai-completions', modelCount: 1 })
    expect(
      (await restarted.piModels.list()).some((provider) => String(provider.id) === 'gateway'),
    ).toBe(true)
    expect((await restarted.piModels.models('gateway' as never)).length).toBe(0)
    const afterRestart = await restarted.sync.sync('gateway', {
      fetch: openaiFetch(['fresh', 'next']),
    })
    expect(afterRestart.removedModelIds).toEqual([])
    expect(afterRestart.candidates.map((candidate) => candidate.id)).toEqual(['fresh', 'next'])
  })

  test('重启后持久化基线仍能驱动下架删除', async () => {
    const fixture = await createFixture({
      gateway: customProvider({
        models: { a: { api: 'openai-completions' }, b: { api: 'openai-completions' } },
      }),
    })
    const created = await fixture.sync.sync('gateway', { fetch: openaiFetch(['a', 'b']) })
    expect(created.baselineCreated).toBe(true)
    expect(fixture.writes).toHaveLength(1)

    const restarted = await restartFixture(fixture)
    const result = await restarted.sync.sync('gateway', { fetch: openaiFetch(['a']) })
    expect(result.baselineCreated).toBe(false)
    expect(result.removedModelIds).toEqual(['b'])
    expect(restarted.snapshotProvider('gateway').model_sync).toMatchObject({
      api: 'openai-completions',
      models: ['a'],
    })
  })

  test('同步后的普通配置保存不会清空基线，定义接口也不泄露基线', async () => {
    const fixture = await createFixture({
      gateway: customProvider({ models: { alpha: { api: 'openai-completions' } } }),
    })
    await fixture.sync.sync('gateway', { fetch: openaiFetch(['alpha', 'beta']) })
    const baseline = fixture.snapshotProvider('gateway').model_sync

    // provider/update 风格：只重写模型与配置字段，不携带 model_sync。
    await fixture.config.batchWrite({
      edits: [
        { keyPath: ['model_providers', 'gateway', 'name'], value: 'Gateway updated' },
        {
          keyPath: ['model_providers', 'gateway', 'models'],
          value: { alpha: { api: 'openai-completions', name: 'Alpha renamed' } },
        },
      ],
    })

    expect(fixture.snapshotProvider('gateway').model_sync).toEqual(baseline)
    expect((await customConfig(fixture, 'gateway')).modelSync?.models).toEqual(['alpha', 'beta'])
    const definition = (await fixture.piModels.providerDefinitions()).find(
      (provider) => provider.id === 'gateway',
    )
    expect(definition).toBeDefined()
    expect(definition).not.toHaveProperty('modelSync')
    expect(await fixture.piModels.modelSyncSummary('gateway')).toMatchObject({ modelCount: 2 })
    expect(await fixture.piModels.modelSyncSummary('missing')).toBeUndefined()
  })

  test('已保存 Provider 使用活动凭据与端点地址，缺失凭据时安全失败', async () => {
    const provider = customProvider({
      auth: 'api-key',
      env: ['FIXTURE_KEY'],
      headers: { 'X-Client': 'Pidex' },
      endpoints: { 'openai-completions': 'https://proxy.example/openai' },
      models: { alpha: { api: 'openai-completions' } },
    })
    const fixture = await createFixture({ gateway: provider }, { FIXTURE_KEY: 'fixture-key' })
    const requests: Array<{ url: URL; headers: Headers }> = []
    const result = await fixture.sync.sync('gateway', {
      fetch: async (input, init) => {
        requests.push({
          url: input instanceof URL ? input : new URL(String(input)),
          headers: new Headers(init?.headers),
        })
        return Response.json({ data: [{ id: 'alpha' }] })
      },
    })
    expect(result.api).toBe('openai-completions')
    expect(requests[0]?.url.href).toBe('https://proxy.example/openai/models')
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer fixture-key')
    expect(requests[0]?.headers.get('x-client')).toBe('Pidex')

    const missing = await createFixture({ gateway: provider })
    await expect(
      missing.sync.sync('gateway', { fetch: openaiFetch(['alpha']) }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(missing.writes).toEqual([])
  })

  test('无聊天模型时回退到基线协议，只有 Embedding 时要求先添加聊天模型', async () => {
    const fixture = await createFixture({
      gateway: customProvider({
        endpoints: { 'anthropic-messages': 'https://gateway.example/anthropic' },
        model_sync: { fetched_at: 5, api: 'anthropic-messages', models: ['claude'] },
      }),
    })
    const requests: URL[] = []
    const result = await fixture.sync.sync('gateway', {
      fetch: async (input) => {
        requests.push(input instanceof URL ? input : new URL(String(input)))
        return Response.json({ data: [{ id: 'claude', display_name: 'Claude' }], has_more: false })
      },
    })
    expect(result.api).toBe('anthropic-messages')
    expect(requests[0]?.href.startsWith('https://gateway.example/anthropic/v1/models')).toBe(true)
    expect(result.candidates).toEqual([
      {
        id: 'claude',
        name: 'Claude',
        api: 'anthropic-messages',
        enabled: false,
        contextWindow: 32_768,
        maxTokens: 8_192,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ])

    const embeddings = await createFixture({
      gateway: customProvider({
        models: { embed: { api: 'openai-completions', modelType: 'embedding' } },
      }),
    })
    await expect(
      embeddings.sync.sync('gateway', { fetch: openaiFetch(['alpha']) }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(await embeddings.piModels.modelSyncSummary('gateway')).toBeUndefined()
  })

  test('拒绝不存在的 Provider 与内置 Provider', async () => {
    const fixture = await createFixture({
      deepseek: { kind: 'builtin', enabled: true },
    })
    await expect(
      fixture.sync.sync('missing', { fetch: openaiFetch(['alpha']) }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND', status: 404 })
    await expect(
      fixture.sync.sync('deepseek', { fetch: openaiFetch(['alpha']) }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
    await expect(
      fixture.sync.discoverSaved('deepseek', 'openai-completions'),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  test('discoverSaved 按指定协议读取已保存 Provider 且不写入配置', async () => {
    const fixture = await createFixture({
      gateway: customProvider({
        endpoints: { 'openai-responses': 'https://proxy.example/v1/responses' },
        models: { alpha: { api: 'openai-completions' } },
      }),
    })
    const requests: URL[] = []
    const models = await fixture.sync.discoverSaved('gateway', 'openai-responses', {
      fetch: openaiFetch(['alpha', 'beta'], requests),
    })
    expect(requests[0]?.href).toBe('https://proxy.example/v1/models')
    expect(models.map((model) => model.id)).toEqual(['alpha', 'beta'])
    expect(models[0]).toMatchObject({ enabled: true, api: 'openai-responses' })
    expect(fixture.writes).toEqual([])
    expect(fixture.snapshotProvider('gateway').model_sync).toBeUndefined()
  })

  test('discoverDraft 使用草稿地址、瞬时密钥且不落盘', async () => {
    const fixture = await createFixture({})
    const before = structuredClone(fixture.config.snapshot())
    const requests: Array<{ url: URL; headers: Headers }> = []
    const discovered = await fixture.sync.discoverDraft({
      api: 'openai-completions',
      draft: {
        baseUrl: 'https://draft.example/v1/chat/completions',
        headers: { 'X-Client': 'Pidex' },
        auth: 'api-key',
        apiKey: 'transient-secret',
      },
      fetch: async (input, init) => {
        requests.push({
          url: input instanceof URL ? input : new URL(String(input)),
          headers: new Headers(init?.headers),
        })
        return Response.json({ data: [{ id: 'draft-model' }] })
      },
    })
    expect(requests[0]?.url.href).toBe('https://draft.example/v1/models')
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer transient-secret')
    expect(requests[0]?.headers.get('x-client')).toBe('Pidex')
    expect(discovered.models).toEqual([
      {
        id: 'draft-model',
        name: 'draft-model',
        api: 'openai-completions',
        enabled: true,
        contextWindow: 32_768,
        maxTokens: 8_192,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ])
    expect(discovered.fetchedAt).toBeGreaterThan(0)
    expect(JSON.stringify(discovered)).not.toContain('transient-secret')
    expect(fixture.writes).toEqual([])
    expect(fixture.config.snapshot()).toEqual(before)
    expect(
      await fixture.sync.discoverDraft({
        api: 'openai-completions',
        draft: { baseUrl: 'https://draft.example/v1', auth: 'none' },
        fetch: async () => Response.json({ data: [{ id: 'x' }] }),
      }),
    ).toMatchObject({ models: [{ id: 'x', enabled: true }] })
  })

  test('discoverDraft 复用已保存凭据并校验地址与请求头安全性', async () => {
    const fixture = await createFixture(
      {
        gateway: customProvider({
          auth: 'api-key',
          env: ['FIXTURE_KEY'],
          models: {},
        }),
      },
      { FIXTURE_KEY: 'fixture-key' },
    )
    const requests: Array<{ url: URL; headers: Headers }> = []
    const result = await fixture.sync.discoverDraft({
      api: 'openai-completions',
      providerId: 'gateway',
      draft: {
        baseUrl: 'https://draft.example/v1',
        endpoints: { 'openai-completions': 'https://draft.example/api/chat/completions' },
        auth: 'api-key',
      },
      fetch: async (input, init) => {
        requests.push({
          url: input instanceof URL ? input : new URL(String(input)),
          headers: new Headers(init?.headers),
        })
        return Response.json({ data: [{ id: 'saved-auth' }] })
      },
    })
    expect(requests[0]?.url.href).toBe('https://draft.example/api/models')
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer fixture-key')
    expect(result.models[0]?.id).toBe('saved-auth')

    await expect(
      fixture.sync.discoverDraft({
        api: 'openai-completions',
        draft: { baseUrl: 'http://remote.example/v1', auth: 'none' },
        fetch: openaiFetch(['x']),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(
      fixture.sync.discoverDraft({
        api: 'openai-completions',
        draft: {
          baseUrl: 'https://draft.example/v1',
          auth: 'none',
          headers: { Authorization: 'Bearer secret' },
        },
        fetch: openaiFetch(['x']),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(
      fixture.sync.discoverDraft({
        api: 'openai-completions',
        draft: { baseUrl: 'https://draft.example/v1', auth: 'api-key' },
        fetch: openaiFetch(['x']),
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })
})
