import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Effect } from 'effect'
import { removeFixturePaths } from './FixtureCleanup'
import type { EncryptedCredentialRepository } from '../src/auth/EncryptedCredentialRepository'
import {
  discoverOpenAIModels,
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

  test('rejects unknown protocols and protocol overrides on other builtin providers', () => {
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

    expect(parsed.providers).toEqual({})
    expect(parsed.issues).toEqual([
      {
        providerID: 'deepseek',
        path: 'model_providers.deepseek',
        code: 'INVALID_PROVIDER',
      },
      {
        providerID: 'anthropic',
        path: 'model_providers.anthropic',
        code: 'BUILTIN_OVERRIDE',
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
