import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Effect } from 'effect'
import { normalizeContext } from '@earendil-works/pi-ai'
import { removeFixturePaths } from './FixtureCleanup'
import type { EncryptedCredentialRepository } from '../src/auth/EncryptedCredentialRepository'
import { withPiBuiltinProviderOverrides } from '../src/provider/pi/PiBuiltinProviderOverrides'
import {
  discoverOpenAIModels,
  createPiCustomProvider,
  parsePiProviderCatalog,
  PiModelService,
  PiModelsFileStore,
  PiProviderConfigValidationError,
  resolveDeepSeekProtocol,
  serializePiProviderDefinition,
  validateCustomProviderBaseUrl,
} from '../src/provider/pi'

const roots: string[] = []
afterEach(async () => {
  await removeFixturePaths(roots.splice(0))
})

const repository = {
  list: () => [],
  get: () => Effect.succeed(null),
  getActiveBinding: () => null,
  getById: () => Effect.succeed(null),
} as unknown as EncryptedCredentialRepository

describe('Pi provider v2 config', () => {
  test('最大输入 Token 在配置与运行时模型中保留，旧模型不添加限制', () => {
    const saved = serializePiProviderDefinition({ kind: 'custom', id: 'input-limit', name: 'Input limit', enabled: true,
      baseUrl: 'https://example.com/v1', auth: 'none', env: [], allowInsecureHttp: false, headers: {},
      models: [{ id: 'limited', api: 'openai-completions', maxInputTokens: 128000 }, { id: 'unlimited', api: 'openai-completions' }] })
    const parsed = parsePiProviderCatalog({ providers: { 'input-limit': saved.value } })
    expect(parsed.issues).toEqual([])
    const config = parsed.providers['input-limit']!
    if (config.kind !== 'custom') throw new Error('Missing fixture provider')
    expect(config.models.limited?.maxInputTokens).toBe(128000)
    const runtime = createPiCustomProvider('input-limit', config).getModels() as readonly { id: string; maxInputTokens?: number }[]
    expect(runtime[0]?.maxInputTokens).toBe(128000)
    expect(runtime[1]?.maxInputTokens).toBeUndefined()
    expect(() => serializePiProviderDefinition({ kind: 'builtin', id: 'google', enabled: true,
      allowModels: [], denyModels: [], models: [{ id: 'native', enabled: true, maxInputTokens: -1 }] })).toThrow()
  })

  test('内置提供商切换已支持协议，目录保留完整端点列表与原生认证', async () => {
    const saved = serializePiProviderDefinition({ kind: 'builtin', id: 'google', enabled: true,
      allowModels: [], denyModels: [], models: [], protocol: 'openai-completions',
      baseUrl: 'https://compatible.example/v1', endpoints: { 'openai-completions': 'https://compatible.example/v1' },
    })
    const service = new PiModelService(repository, { config: { providers: { google: saved.value } } })
    const provider = (await service.list()).find((item) => item.id === 'google')!
    expect(Object.keys(provider.source.endpoints ?? {})).toEqual(['google-generative-ai', 'openai-completions'])
    expect(provider.source.defaultApi).toBe('openai-completions')
    expect(provider.auth.apiKey).toBe(true)
    const model = service.pi.getProvider('google')!.getModels()[0]!
    expect(model.api).toBe('openai-completions')
    expect(model.baseUrl).toBe('https://compatible.example/v1')
    expect(model.compat).toBeUndefined()
    expect(() => serializePiProviderDefinition({ kind: 'builtin', id: 'google', enabled: true,
      allowModels: [], denyModels: [], models: [], protocol: 'anthropic-messages' })).toThrow()
    service.dispose()
  })

  test('混合协议模型使用各自的端点地址', () => {
    const parsed = parsePiProviderCatalog({ providers: { relay: {
      kind: 'custom', base_url: 'https://fallback.example/v1',
      endpoints: { 'openai-responses': 'https://responses.example/v1', 'anthropic-messages': 'https://messages.example' },
      models: { chat: { api: 'openai-responses' }, claude: { api: 'anthropic-messages' } },
    } } })
    const config = parsed.providers.relay
    if (!config || config.kind !== 'custom') throw new Error('Missing fixture provider')
    expect(createPiCustomProvider('relay', config).getModels().map((model) => model.baseUrl))
      .toEqual(['https://responses.example/v1', 'https://messages.example'])
  })
  test('协议端点保留各自地址且拒绝不安全地址', () => {
    const config = { kind: 'builtin' as const, id: 'deepseek', enabled: true, allowModels: [], denyModels: [], models: [],
      endpoints: { 'anthropic-messages': 'https://gateway.example/anthropic', 'openai-responses': 'https://gateway.example/v1' } }
    const saved = serializePiProviderDefinition(config)
    expect(saved.value.endpoints).toEqual(config.endpoints)
    expect(parsePiProviderCatalog({ providers: { deepseek: saved.value } }).providers.deepseek?.endpoints).toEqual(config.endpoints)
    expect(() => serializePiProviderDefinition({ ...config, endpoints: { 'openai-responses': 'http://remote.example/v1' } })).toThrow()
  })

  test('round-trips builtin endpoint and partial model overrides without replacing native defaults', async () => {
    const serialized = serializePiProviderDefinition({
      kind: 'builtin',
      id: 'google',
      enabled: true,
      allowModels: [],
      denyModels: [],
      baseUrl: 'https://gateway.example/v1',
      models: [
        { id: 'gemini-2.5-pro', enabled: true, name: 'Renamed', maxTokens: 12345, maxInputTokens: 100000 },
        { id: 'private-model', enabled: true, contextWindow: 65536 },
      ],
    })
    const parsed = parsePiProviderCatalog({ providers: { google: serialized.value } })
    expect(parsed.issues).toEqual([])
    expect(parsed.providers.google).toMatchObject({
      kind: 'builtin',
      baseUrl: 'https://gateway.example/v1',
    })
    const service = new PiModelService(repository, {
      env: { GEMINI_API_KEY: 'fixture-key' },
      config: { providers: { google: serialized.value } },
    })
    const known = await service.getPiModel({
      providerID: 'google' as never,
      id: 'gemini-2.5-pro' as never,
    })
    expect(known.api).toBe('google-generative-ai')
    expect(known.baseUrl).toBe('https://gateway.example/v1')
    expect(known.name).toBe('Renamed')
    expect(known.maxTokens).toBe(12345)
    expect(known.reasoning).toBe(true)
    const source = service.pi.getProvider('google')!
    let sent: typeof known | undefined
    const overrides = withPiBuiltinProviderOverrides(
      {
        ...source,
        streamSimple: (model) => {
          sent = model
          return {} as ReturnType<typeof source.streamSimple>
        },
      },
      {
        kind: 'builtin',
        enabled: true,
        allowModels: [],
        denyModels: [],
        baseUrl: 'https://override.example/v1',
        models: { 'gemini-2.5-pro': { enabled: true, cost: { input: 99 } } },
      },
    )
    const costOverride = overrides.getModels().find((model) => model.id === known.id)!
    expect(costOverride.cost).toEqual({ ...known.cost, input: 99 })
    overrides.streamSimple(
      { ...costOverride, baseUrl: 'https://oauth.example/v1' },
      normalizeContext({ messages: [] }),
    )
    expect(sent?.baseUrl).toBe('https://override.example/v1')
    const added = await service.getPiModel({
      providerID: 'google' as never,
      id: 'private-model' as never,
    })
    expect(added.api).toBe('google-generative-ai')
    expect(added.contextWindow).toBe(65536)
    expect(
      (await service.providerDefinitions()).find((provider) => provider.id === 'google'),
    ).toMatchObject({
      baseUrl: 'https://gateway.example/v1',
      models: [
        { id: 'gemini-2.5-pro', enabled: true, name: 'Renamed', maxTokens: 12345, maxInputTokens: 100000 },
        { id: 'private-model', enabled: true, contextWindow: 65536 },
      ],
    })
    expect(() =>
      serializePiProviderDefinition({
        kind: 'builtin',
        id: 'google',
        enabled: true,
        allowModels: [],
        denyModels: [],
        baseUrl: 'http://remote.example',
        models: [],
      }),
    ).toThrow(PiProviderConfigValidationError)
    expect(
      parsePiProviderCatalog({
        providers: {
          google: {
            kind: 'builtin',
            models: { private: { headers: { Authorization: 'fixture' } } },
          },
        },
      }).issues[0]?.code,
    ).toBe('SENSITIVE_HEADER')
    await service.dispose()
  })
  test('serializes camelCase RPC definitions into canonical TOML fields', () => {
    const serialized = serializePiProviderDefinition({
      kind: 'custom',
      id: 'local',
      name: 'Local',
      enabled: true,
      baseUrl: 'http://localhost:11434/v1',
      auth: 'none',
      env: [],
      allowInsecureHttp: false,
      headers: { 'X-Client': 'Pidex' },
      models: [
        {
          id: 'chat',
          api: 'openai-completions',
          contextWindow: 65_536,
          cost: { input: 1 },
        },
      ],
    })

    expect(serialized.providerID).toBe('local')
    expect(serialized.value).toMatchObject({
      kind: 'custom',
      base_url: 'http://localhost:11434/v1',
      allow_insecure_http: false,
      models: {
        chat: {
          api: 'openai-completions',
          context_window: 65_536,
          max_tokens: 8_192,
          cost: { input: 1, output: 0, cache_read: 0, cache_write: 0 },
        },
      },
    })
  })

  test('registers mixed-API custom providers with safe defaults', async () => {
    const service = new PiModelService(repository, {
      env: {},
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
              responses: { api: 'openai-responses' },
              claude: { api: 'anthropic-messages', input: ['text', 'image'] },
            },
          },
        },
      },
    })

    expect((await service.list()).some((provider) => String(provider.id) === 'local')).toBe(true)
    const models = await service.models('local' as never)
    expect(models.map((model) => String(model.id))).toEqual(['chat', 'responses', 'claude'])
    expect(models[0]?.limit).toEqual({ context: 32_768, output: 8_192 })
    expect(models[2]?.capabilities.input).toEqual(['text', 'image'])
    expect((await service.configIssues()).length).toBe(0)
  })

  test('rejects sensitive headers, built-in overrides, and unsafe remote HTTP', () => {
    expect(() => validateCustomProviderBaseUrl('http://gateway.example/v1', false)).toThrow(
      'allow_insecure_http',
    )
    expect(validateCustomProviderBaseUrl('http://gateway.example/v1', true)).toBe(
      'http://gateway.example/v1',
    )

    const parsed = parsePiProviderCatalog({
      schemaVersion: 2,
      providers: {
        openai: {
          kind: 'custom',
          base_url: 'https://example.com/v1',
          auth: 'none',
          models: { test: { api: 'openai-responses' } },
        },
        unsafe: {
          kind: 'custom',
          base_url: 'https://example.com/v1',
          auth: 'none',
          headers: { Authorization: 'secret' },
          models: { test: { api: 'openai-responses' } },
        },
      },
    })

    expect(parsed.providers).toEqual({})
    expect(parsed.issues.map((entry) => entry.code)).toEqual([
      'BUILTIN_OVERRIDE',
      'SENSITIVE_HEADER',
    ])
  })

  test('discovers Codex catalogs without accepting invalid response envelopes', async () => {
    const models = await discoverOpenAIModels({
      baseUrl: 'https://example.com/v1',
      fetch: async () => Response.json({ models: [
        { slug: 'codex-model', display_name: 'Codex model' },
        { slug: 'fallback-name' },
        { slug: '' },
        { slug: 123 },
        null,
      ] }),
    })
    expect(models).toEqual([
      { id: 'codex-model', name: 'Codex model' },
      { id: 'fallback-name', name: 'fallback-name' },
    ])
    await expect(discoverOpenAIModels({
      baseUrl: 'https://example.com/v1',
      fetch: async () => Response.json({ error: 'invalid credentials' }),
    })).rejects.toThrow('invalid OpenAI catalog')
  })

  test('discovers a bounded OpenAI model list without following redirects', async () => {
    const calls: RequestInit[] = []
    const models = await discoverOpenAIModels({
      baseUrl: 'https://example.com/v1',
      apiKey: 'not-returned',
      fetch: async (_input, init) => {
        calls.push(init ?? {})
        return Response.json({
          data: [{ id: 'zeta' }, { id: 'alpha', name: 'Alpha' }, { id: 'alpha' }],
        })
      },
    })

    expect(models).toEqual([
      { id: 'alpha', name: 'alpha' },
      { id: 'zeta', name: 'zeta' },
    ])
    expect(calls[0]?.redirect).toBe('error')
    expect(JSON.stringify(models)).not.toContain('not-returned')

    await expect(
      discoverOpenAIModels({
        baseUrl: 'https://example.com/v1',
        fetch: async () =>
          new Response('{}', {
            headers: { 'content-length': String(1024 * 1024 + 1) },
          }),
      }),
    ).rejects.toThrow('exceeds 1 MiB')
  })
})

describe('DeepSeek protocol config', () => {
  test('keeps legacy builtin configs on Chat Completions and round-trips every protocol', () => {
    const legacy = parsePiProviderCatalog({
      schemaVersion: 2,
      providers: {
        deepseek: {
          kind: 'builtin',
          enabled: true,
          allow_models: [],
          deny_models: [],
        },
      },
    })

    expect(legacy.issues).toEqual([])
    expect(resolveDeepSeekProtocol(legacy)).toBe('openai-completions')

    for (const protocol of [
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
    ] as const) {
      const serialized = serializePiProviderDefinition({
        kind: 'builtin',
        id: 'deepseek',
        enabled: true,
        allowModels: [],
        denyModels: [],
        models: [{ id: 'deepseek-v4-pro', enabled: false }],
        protocol,
      })

      // key-path 写入只覆盖 DeepSeek 自己的 provider 对象。
      expect(Object.keys(serialized.value).sort()).toEqual([
        'allow_models',
        'deny_models',
        'enabled',
        'kind',
        'models',
        'protocol',
      ])
      const parsed = parsePiProviderCatalog({
        schemaVersion: 2,
        providers: { deepseek: serialized.value },
      })
      expect(parsed.issues).toEqual([])
      expect(parsed.providers.deepseek).toMatchObject({
        protocol,
        models: { 'deepseek-v4-pro': { enabled: false } },
      })
      expect(resolveDeepSeekProtocol(parsed)).toBe(protocol)
    }
  })

  test('accepts supported builtin protocols and rejects unsupported protocols', () => {
    const parsed = parsePiProviderCatalog({
      schemaVersion: 2,
      providers: {
        deepseek: { kind: 'builtin', enabled: true, protocol: 'openai-beta-fim' },
        anthropic: {
          kind: 'builtin',
          enabled: true,
          protocol: 'anthropic-messages',
        },
      },
    })

    expect(parsed.providers.anthropic).toMatchObject({ protocol: 'anthropic-messages' })
    expect(parsed.issues).toEqual([
      {
        providerID: 'deepseek',
        path: 'model_providers.deepseek',
        code: 'INVALID_PROVIDER',
      },
    ])
    // 被拒绝的 DeepSeek 配置不改变正在运行的协议。
    expect(resolveDeepSeekProtocol(parsed)).toBeUndefined()
    expect(() =>
      serializePiProviderDefinition({
        kind: 'builtin',
        id: 'anthropic',
        enabled: true,
        allowModels: [],
        denyModels: [],
        models: [],
        protocol: 'openai-responses',
      }),
    ).toThrow(PiProviderConfigValidationError)
  })
})

describe('PiModelsFileStore', () => {
  test('uses its own UTF-8 cache and refuses to overwrite future formats', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-pi-model-store-'))
    roots.push(root)
    const legacyPath = join(root, 'models.cache.json')
    const cachePath = join(root, 'pi-models.cache.json')
    await writeFile(legacyPath, 'legacy-model-cache', 'utf8')
    const store = new PiModelsFileStore(cachePath)
    await store.write('dynamic', {
      checkedAt: 1,
      models: [
        {
          id: 'model',
          name: 'Model',
          provider: 'dynamic',
          api: 'openai-completions',
          baseUrl: 'https://example.com/v1',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32_768,
          maxTokens: 8_192,
        },
      ],
    })

    expect((await store.read('dynamic'))?.models[0]?.id).toBe('model')
    expect(await readFile(legacyPath, 'utf8')).toBe('legacy-model-cache')
    expect(await readFile(cachePath, 'utf8')).toContain('"owner": "pidex"')

    await writeFile(
      cachePath,
      JSON.stringify({
        owner: 'pidex',
        formatVersion: 99,
        providers: {},
      }),
      'utf8',
    )
    await expect(store.write('another', { models: [] })).rejects.toThrow('unsupported format')
    expect(JSON.parse(await readFile(cachePath, 'utf8')).formatVersion).toBe(99)
  })
})
