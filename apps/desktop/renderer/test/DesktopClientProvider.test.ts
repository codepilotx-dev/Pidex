import { describe, expect, test } from 'bun:test'
import { createDesktopClient } from '../src/services/desktop-client/index.js'
import {
  catalogProviderToDesktop,
  desktopProviderExecutionError,
  isExecutableDesktopProvider,
} from '../src/services/desktop-client/ProviderAdapters.js'
import {
  PROVIDER_LOGO_BRANDS,
  modelsDevLogoURL,
  providerLogoBrandID,
} from '../src/services/desktop-client/ProviderLogoBrands.js'

const provider = {
  provider: {
    id: 'minimax-cn-coding-plan',
    name: 'MiniMax Token Plan (minimaxi.com)',
    source: {
      type: 'pi',
      kind: 'custom',
      apis: ['anthropic-messages'],
      baseUrl: 'https://api.minimaxi.com/anthropic/v1',
    },
    auth: { apiKey: true, oauth: false },
    config: {
      kind: 'custom',
      id: 'minimax-cn-coding-plan',
      name: 'MiniMax Token Plan (minimaxi.com)',
      enabled: true,
      baseUrl: 'https://api.minimaxi.com/anthropic/v1',
      auth: 'api-key',
      env: ['MINIMAX_API_KEY'],
      allowInsecureHttp: false,
      headers: {},
      models: [
        {
          id: 'MiniMax-M3',
          api: 'anthropic-messages',
          enabled: true,
        },
      ],
    },
  },
  models: [
    {
      id: 'MiniMax-M3',
      providerID: 'minimax-cn-coding-plan',
      name: 'MiniMax-M3',
      family: 'minimax',
      api: {
        id: 'MiniMax-M3',
        type: 'pi',
        name: 'anthropic-messages',
        baseUrl: 'https://api.minimaxi.com/anthropic/v1',
      },
      capabilities: { tools: true, input: ['text'], output: ['text'] },
      variants: [{ id: 'off' }, { id: 'medium' }, { id: 'high' }],
      time: { released: 0 },
      cost: [],
      status: 'active',
      enabled: true,
      limit: { context: 204_800, output: 131_072 },
    },
  ],
}

describe('desktop provider client', () => {
  test('preserves provider origin and availability while filtering unavailable providers', () => {
    const ready = catalogProviderToDesktop({
      provider: {
        ...provider.provider,
        source: {
          ...provider.provider.source,
          kind: 'builtin',
        },
        catalogOrigin: 'pi-bundled',
        availability: { status: 'ready' },
      },
      models: provider.models,
    } as never)
    const unavailable = {
      ...ready,
      availability: {
        status: 'unavailable' as const,
        reason: 'unsupported-protocol' as const,
      },
    }

    expect(ready).toMatchObject({
      providerKind: 'builtin',
      catalogOrigin: 'pi-bundled',
      availability: { status: 'ready' },
      logoURL: 'https://models.dev/logos/minimax-cn-coding-plan.svg',
    })
    expect(isExecutableDesktopProvider(ready)).toBe(true)
    expect(isExecutableDesktopProvider(unavailable)).toBe(false)
    expect(desktopProviderExecutionError(unavailable)).toContain('协议或 Endpoint')
    expect(desktopProviderExecutionError({ ...ready, enabled: false })).toContain('已禁用')
    expect(
      desktopProviderExecutionError({
        ...ready,
        defaultModels: [],
        modelCount: 0,
      }),
    ).toContain('暂无可用模型')
    expect(desktopProviderExecutionError(ready)).toBeNull()
  })

  describe('models.dev 在线图标 URL', () => {
    test.each(Object.entries(PROVIDER_LOGO_BRANDS))(
      '同品牌入口统一解析为 %s 图标',
      (brandID, providerIDs) => {
        for (const providerID of providerIDs) {
          expect(providerLogoBrandID(providerID)).toBe(brandID)
          expect(modelsDevLogoURL(providerID)).toBe(`https://models.dev/logos/${brandID}.svg`)
          expect(builtinLogoURL(providerID)).toBe(`https://models.dev/logos/${brandID}.svg`)
        }
      },
    )

    test('同一个 Provider ID 只归属一个品牌', () => {
      const brandByProviderID = new Map<string, string>()
      for (const [brandID, providerIDs] of Object.entries(PROVIDER_LOGO_BRANDS)) {
        for (const providerID of providerIDs) {
          expect({
            providerID,
            resolved: providerLogoBrandID(providerID),
          }).toEqual({ providerID, resolved: brandID })
          brandByProviderID.set(providerID, brandID)
        }
      }
      expect(brandByProviderID.size).toBe(Object.values(PROVIDER_LOGO_BRANDS).flat().length)
    })

    test.each([
      'anthropic',
      'deepseek',
      'github-copilot',
      'mistral',
      'nvidia',
      'openrouter',
      'xai',
    ])('独立品牌 %s 保留自身图标', (providerID) => {
      expect(modelsDevLogoURL(providerID)).toBe(`https://models.dev/logos/${providerID}.svg`)
    })

    test.each([
      ['google-vertex', 'google'],
      ['opencode-go', 'opencode'],
    ])('同产品线但独立成图：%s 不折叠到 %s', (providerID, parentBrandID) => {
      expect(modelsDevLogoURL(providerID)).toBe(`https://models.dev/logos/${providerID}.svg`)
      expect(modelsDevLogoURL(parentBrandID)).toBe(`https://models.dev/logos/${parentBrandID}.svg`)
      expect(modelsDevLogoURL(providerID)).not.toBe(modelsDevLogoURL(parentBrandID))
      expect(builtinLogoURL(providerID)).toBe(`https://models.dev/logos/${providerID}.svg`)
    })

    test.each([
      'azure-openai',
      'kimi-coding-plan',
      'minimax-cn-coding-plan',
      'moonshotai-token-plan',
      'openai-compatible',
      'zai-coding',
    ])('不按名称或后缀推断品牌，未知 ID %s 使用自身地址', (providerID) => {
      expect(modelsDevLogoURL(providerID)).toBe(`https://models.dev/logos/${providerID}.svg`)
      expect(builtinLogoURL(providerID)).toBe(`https://models.dev/logos/${providerID}.svg`)
    })

    test('对含特殊字符的 providerID 安全进行 encodeURIComponent', () => {
      const providerID = 'prov/中文 id & ?=+#'

      expect(modelsDevLogoURL(providerID)).toBe(
        `https://models.dev/logos/${encodeURIComponent(providerID)}.svg`,
      )
      expect(builtinLogoURL(providerID)).toBe(
        `https://models.dev/logos/${encodeURIComponent(providerID)}.svg`,
      )
      expect(builtinLogoURL(providerID)?.startsWith('https://models.dev/logos/')).toBe(true)
      expect(builtinLogoURL(providerID)?.endsWith('.svg')).toBe(true)
    })

    test('用户自定义提供商不生成 URL 并回退到默认图标', () => {
      const custom = catalogProviderToDesktop({
        provider: {
          ...provider.provider,
          source: {
            ...provider.provider.source,
            kind: 'custom',
          },
          catalogOrigin: 'user',
        },
        models: provider.models,
      } as never)

      expect(custom.logoURL).toBeUndefined()
    })
  })

  test('仅支持 OAuth 的 provider 未认证时不会被 adapter 视为已配置', () => {
    expect(
      catalogProviderToDesktop({
        provider: {
          ...provider.provider,
          auth: { apiKey: false, oauth: true },
        },
        models: provider.models,
      } as never).apiKeyConfigured,
    ).toBe(false)
  })

  test('读取并切换 Provider 凭据仓库时生成幂等操作 ID', async () => {
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      requests.push({ method: body.method, params: body.params })
      if (body.method === 'initialize') {
        return rpc(body.id, initializedResult(['rpc.typed.v1', 'provider.auth.pi.v1']))
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'provider/credential/store/read') {
        expect(body.params).toEqual({})
        return rpc(body.id, {
          store: 'encrypted',
          portable: false,
          credentialCount: 2,
          migrationRequired: true,
        })
      }
      if (body.method === 'provider/credential/store/update') {
        expect(body.params).toEqual({
          store: 'auth-json',
          operationId: expect.any(String),
        })
        return rpc(body.id, {
          store: 'auth-json',
          portable: true,
          credentialCount: 2,
          migrationRequired: false,
          migratedCredentials: 2,
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const client = createDesktopClient({ fetch: fetcher })
    expect(await client.readProviderCredentialStore()).toMatchObject({
      store: 'encrypted',
      migrationRequired: true,
    })
    expect(await client.updateProviderCredentialStore('auth-json')).toMatchObject({
      store: 'auth-json',
      migratedCredentials: 2,
    })
    expect(requests.map((request) => request.method)).toEqual(
      expect.arrayContaining([
        'provider/credential/store/read',
        'provider/credential/store/update',
      ]),
    )
  })

  test('分页目录启动只加载 provider 摘要和当前 provider 首页', async () => {
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      requests.push({ method: body.method, params: body.params })
      if (body.method === 'initialize') {
        return rpc(body.id, initializedResult(['rpc.typed.v1', 'model.catalog.paged.v1']))
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'provider/list') {
        return rpc(body.id, {
          providers: [
            {
              ...provider.provider,
              authConfigured: true,
            },
          ],
          issues: [],
          defaultModel: { providerID: provider.provider.id, id: 'MiniMax-M3', variant: 'medium' },
          reviewerModel: null,
          catalogVersion: 7,
        })
      }
      if (body.method === 'model/list') {
        expect(body.params).toEqual({
          providerId: provider.provider.id,
          enabled: true,
          limit: 100,
        })
        return rpc(body.id, {
          providers: [provider],
          defaultModel: { providerID: provider.provider.id, id: 'MiniMax-M3', variant: 'medium' },
          reviewerModel: null,
          catalogVersion: 7,
          total: 1,
        })
      }
      if (body.method === 'provider/credential/list') {
        return rpc(body.id, {
          credentials: [credential()],
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const client = createDesktopClient({ fetch: fetcher })
    const [state, providers] = await Promise.all([
      client.getModelProviderState(),
      client.listModelProviders(),
    ])

    expect(state.model).toBe('MiniMax-M3')
    expect(state.variant).toBe('medium')
    expect(state.modelMetadata?.['MiniMax-M3']?.variants).toEqual(['off', 'medium', 'high'])
    expect(providers).toHaveLength(1)
    expect(requests.filter((request) => request.method === 'provider/list')).toHaveLength(1)
    expect(requests.filter((request) => request.method === 'model/list')).toHaveLength(1)
    expect(
      requests.some(
        (request) =>
          request.method === 'model/list' && Object.keys(request.params ?? {}).length === 0,
      ),
    ).toBe(false)
  })

  test('完整预加载会遍历 provider 的全部模型分页', async () => {
    const modelRequests: Array<Record<string, unknown>> = []
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') {
        return rpc(body.id, initializedResult(['rpc.typed.v1', 'model.catalog.paged.v1']))
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'provider/list') {
        return rpc(body.id, {
          providers: [{ ...provider.provider, authConfigured: true, modelCount: 2 }],
          issues: [],
          defaultModel: null,
          reviewerModel: null,
          catalogVersion: 9,
        })
      }
      if (body.method === 'model/list') {
        modelRequests.push(body.params)
        const secondPage = body.params.cursor === 'page-2'
        const modelID = secondPage ? 'MiniMax-M2' : 'MiniMax-M3'
        return rpc(body.id, {
          providers: [
            {
              ...provider,
              models: [
                {
                  ...provider.models[0],
                  id: modelID,
                  name: modelID,
                  api: { ...provider.models[0]!.api, id: modelID },
                },
              ],
            },
          ],
          defaultModel: null,
          reviewerModel: null,
          catalogVersion: 9,
          total: 2,
          ...(secondPage ? {} : { nextCursor: 'page-2' }),
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const client = createDesktopClient({ fetch: fetcher })
    await client.listModelProviders()
    const result = await client.fetchProviderModels({
      providerID: provider.provider.id,
      all: true,
    })

    expect(modelRequests).toEqual([
      { providerId: provider.provider.id, enabled: true, limit: 100 },
      { providerId: provider.provider.id, enabled: true, limit: 100, cursor: 'page-2' },
    ])
    expect(result.models).toEqual(['MiniMax-M3', 'MiniMax-M2'])
    expect(result.nextCursor).toBeUndefined()
  })

  test('provider 摘要使用 Agent 认证状态且仅按需加载当前 provider 模型', async () => {
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
    const codexProvider = {
      ...provider.provider,
      id: 'openai-codex',
      name: 'OpenAI Codex',
      auth: { apiKey: false, oauth: true },
      config: {
        kind: 'builtin',
        id: 'openai-codex',
        enabled: true,
        allowModels: [],
        denyModels: [],
        models: [],
      },
    }
    const deepseekProvider = {
      ...provider.provider,
      id: 'deepseek',
      name: 'DeepSeek',
      auth: { apiKey: true, oauth: false },
      config: {
        ...provider.provider.config,
        id: 'deepseek',
        name: 'DeepSeek',
        env: ['DEEPSEEK_API_KEY'],
        models: [
          {
            id: 'deepseek-chat',
            api: 'openai-completions',
            enabled: true,
          },
        ],
      },
    }
    const modelPage = (
      providerInfo: typeof codexProvider | typeof deepseekProvider,
      modelID: string,
    ) => ({
      provider: providerInfo,
      models: [
        {
          ...provider.models[0],
          id: modelID,
          providerID: providerInfo.id,
          name: modelID,
          api: {
            ...provider.models[0]!.api,
            id: modelID,
            name: providerInfo.id === 'openai-codex' ? 'openai-responses' : 'openai-completions',
          },
        },
      ],
    })
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      requests.push({ method: body.method, params: body.params })
      if (body.method === 'initialize') {
        return rpc(body.id, initializedResult(['rpc.typed.v1', 'model.catalog.paged.v1']))
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'provider/list') {
        return rpc(body.id, {
          providers: [
            { ...codexProvider, authConfigured: true, modelCount: 1 },
            { ...deepseekProvider, authConfigured: true, modelCount: 1 },
          ],
          issues: [],
          defaultModel: { providerID: 'openai-codex', id: 'gpt-5' },
          reviewerModel: null,
          catalogVersion: 8,
        })
      }
      if (body.method === 'model/list') {
        const selectedProvider =
          body.params.providerId === 'deepseek' ? deepseekProvider : codexProvider
        const modelID = selectedProvider.id === 'deepseek' ? 'deepseek-chat' : 'gpt-5'
        return rpc(body.id, {
          providers: [modelPage(selectedProvider, modelID)],
          defaultModel: { providerID: 'openai-codex', id: 'gpt-5' },
          reviewerModel: null,
          catalogVersion: 8,
          total: 1,
        })
      }
      if (body.method === 'provider/credential/list') {
        return rpc(body.id, { credentials: [] })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const client = createDesktopClient({ fetch: fetcher })
    const [state, providers] = await Promise.all([
      client.getModelProviderState(),
      client.listModelProviders(),
    ])

    expect(state).toMatchObject({
      selectedProviderID: 'openai-codex',
      model: 'gpt-5',
      apiKeyConfigured: true,
    })
    expect(
      providers.map((item) => ({
        providerID: item.providerID,
        apiKeyConfigured: item.apiKeyConfigured,
        executable: isExecutableDesktopProvider(item),
      })),
    ).toEqual([
      { providerID: 'openai-codex', apiKeyConfigured: true, executable: true },
      { providerID: 'deepseek', apiKeyConfigured: true, executable: true },
    ])
    expect(requests.filter((request) => request.method === 'model/list')).toEqual([
      {
        method: 'model/list',
        params: {
          providerId: 'openai-codex',
          enabled: true,
          limit: 100,
        },
      },
    ])

    expect(await client.getModelProviderState('deepseek')).toMatchObject({
      selectedProviderID: 'deepseek',
      model: 'deepseek-chat',
      apiKeyConfigured: true,
      apiKeySource: 'environment',
    })
  })

  test('resolveFirstAvailableModel 只返回启用模型并跳过没有启用模型的 Provider', async () => {
    const providerInfo = (id: string, enabled: boolean) => ({
      ...provider.provider,
      id,
      name: id,
      disabled: !enabled,
      config: { ...provider.provider.config, id, name: id, enabled },
    })
    const modelInfo = (id: string, providerID: string, enabled: boolean) => ({
      ...provider.models[0]!,
      id,
      providerID,
      name: id,
      enabled,
      api: { ...provider.models[0]!.api, id, name: 'openai-completions' },
    })
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') return rpc(body.id, initializedResult())
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'provider/list') {
        return rpc(body.id, {
          providers: [
            { ...providerInfo('provider-a', true), authConfigured: true, modelCount: 1 },
            { ...providerInfo('provider-b', false), authConfigured: true, modelCount: 1 },
            { ...providerInfo('provider-c', true), authConfigured: true, modelCount: 1 },
          ],
          issues: [],
          defaultModel: null,
          reviewerModel: null,
          catalogVersion: 3,
        })
      }
      if (body.method === 'model/list') {
        return rpc(body.id, {
          providers: [
            {
              provider: providerInfo('provider-a', true),
              models: [modelInfo('a-disabled', 'provider-a', false)],
            },
            {
              provider: providerInfo('provider-c', true),
              models: [modelInfo('c-enabled', 'provider-c', true)],
            },
          ],
          defaultModel: null,
          reviewerModel: null,
          catalogVersion: 3,
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const client = createDesktopClient({ fetch: fetcher })
    expect(await client.resolveFirstAvailableModel()).toEqual({
      providerID: 'provider-c',
      id: 'c-enabled',
    })
  })

  test('手动刷新使用 model/refresh 并清理 Provider、模型与凭据缓存', async () => {
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      requests.push({ method: body.method, params: body.params })
      if (body.method === 'initialize') {
        return rpc(body.id, initializedResult(['rpc.typed.v1', 'model.catalog.paged.v1']))
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'provider/list') {
        return rpc(body.id, {
          providers: [{ ...provider.provider, authConfigured: true, modelCount: 1 }],
          issues: [],
          defaultModel: { providerID: provider.provider.id, id: 'MiniMax-M3' },
          reviewerModel: null,
          catalogVersion: 7,
        })
      }
      if (body.method === 'model/list') {
        return rpc(body.id, {
          providers: [provider],
          defaultModel: { providerID: provider.provider.id, id: 'MiniMax-M3' },
          reviewerModel: null,
          catalogVersion: 7,
          total: 1,
        })
      }
      if (body.method === 'model/refresh') {
        expect(body.params).toEqual({ operationId: expect.any(String) })
        return rpc(body.id, {
          providers: [provider],
          defaultModel: { providerID: provider.provider.id, id: 'MiniMax-M3' },
          reviewerModel: null,
          catalogVersion: 8,
        })
      }
      if (body.method === 'provider/credential/list') {
        return rpc(body.id, { credentials: [credential()] })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })

    await client.getModelProviderState()
    await client.listModelProviders()
    await client.refreshModelProviders()
    await client.getModelProviderState()
    await client.listModelProviders()

    expect(requests.filter((request) => request.method === 'model/refresh')).toHaveLength(1)
    expect(requests.filter((request) => request.method === 'provider/list')).toHaveLength(2)
    expect(requests.filter((request) => request.method === 'model/list')).toHaveLength(2)
    expect(
      requests.filter((request) => request.method === 'provider/credential/list'),
    ).toHaveLength(2)
  })

  test('凭据更新事件会清理 provider 目录缓存并通知工作台刷新', async () => {
    let authConfigured = false
    let providerListRequests = 0
    const source = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      close: () => {},
    }
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') return rpc(body.id, initializedResult())
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'provider/list') {
        providerListRequests += 1
        return rpc(body.id, {
          providers: [
            {
              ...provider.provider,
              authConfigured,
            },
          ],
          issues: [],
          defaultModel: null,
          reviewerModel: null,
          catalogVersion: providerListRequests,
        })
      }
      if (body.method === 'event/subscribe') {
        return rpc(body.id, {
          subscriptionId: 'subscription-1',
          highWatermarks: [{ streamId: 'global', sequence: 0 }],
        })
      }
      if (body.method === 'event/ack') {
        return rpc(body.id, {
          subscriptionId: body.params.subscriptionId,
          acknowledged: body.params.positions,
        })
      }
      if (body.method === 'event/unsubscribe') {
        return rpc(body.id, { ok: true })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }
    const eventTarget = new EventTarget()
    let refreshEvents = 0
    eventTarget.addEventListener('desktop:model-provider-changed', () => {
      refreshEvents += 1
    })
    const globalObject = globalThis as typeof globalThis & {
      window?: Window
    }
    const previousWindow = globalObject.window
    globalObject.window = eventTarget as Window
    let unsubscribe = () => {}
    try {
      const client = createDesktopClient({
        fetch: fetcher,
        window: eventTarget as Window,
        eventSourceFactory: () => source as unknown as EventSource,
      })
      expect((await client.listModelProviders())[0]?.apiKeyConfigured).toBe(false)
      unsubscribe = client.onSessionStoreChange(() => {})
      for (let index = 0; index < 20 && !source.onmessage; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      authConfigured = true
      source.onmessage?.({
        data: JSON.stringify({
          jsonrpc: '2.0',
          method: 'event/next',
          params: {
            subscriptionId: 'subscription-1',
            event: {
              eventId: 'event-1',
              streamId: 'global',
              type: 'provider/credential/updated',
              version: 1,
              occurredAt: Date.now(),
              durability: 'live',
              sequence: null,
              afterSequence: 0,
              payload: { providerId: provider.provider.id },
            },
          },
        }),
      } as MessageEvent)
      for (let index = 0; index < 20 && refreshEvents === 0; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      expect(refreshEvents).toBe(1)
      expect((await client.listModelProviders())[0]?.apiKeyConfigured).toBe(true)
      expect(providerListRequests).toBe(2)
    } finally {
      unsubscribe()
      if (previousWindow) globalObject.window = previousWindow
      else delete globalObject.window
    }
  })

  test('环境变量凭据使 Pi 已启用模型保持可发送状态', async () => {
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') {
        return rpc(body.id, initializedResult(['rpc.typed.v1', 'model.catalog.paged.v1']))
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'provider/list') {
        return rpc(body.id, {
          providers: [
            {
              ...provider.provider,
              authConfigured: true,
            },
          ],
          issues: [],
          defaultModel: { providerID: provider.provider.id, id: 'MiniMax-M3' },
          reviewerModel: null,
          catalogVersion: 7,
        })
      }
      if (body.method === 'model/list') {
        return rpc(body.id, {
          providers: [provider],
          defaultModel: { providerID: provider.provider.id, id: 'MiniMax-M3' },
          reviewerModel: null,
          catalogVersion: 7,
          total: 1,
        })
      }
      if (body.method === 'provider/credential/list') {
        return rpc(body.id, { credentials: [] })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const state = await createDesktopClient({ fetch: fetcher }).getModelProviderState()

    expect(state).toMatchObject({
      model: 'MiniMax-M3',
      modelConfigured: true,
      apiKeyConfigured: true,
      apiKeySource: 'environment',
      provider: { apiKeyConfigured: true },
    })
  })

  test('删除 API 密钥后重新读取凭据，并返回真实未配置状态', async () => {
    const methods: string[] = []
    let credentials = [credential()]
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      methods.push(body.method)
      if (body.method === 'initialize') {
        return rpc(body.id, initializedResult())
      }
      if (body.method === 'initialized') {
        return new Response(null, { status: 204 })
      }
      if (body.method === 'model/list') {
        const models = credentials.length > 0 ? provider.models : []
        return rpc(body.id, {
          providers: [{ ...provider, models }],
          defaultModel:
            credentials.length > 0
              ? {
                  providerID: 'minimax-cn-coding-plan',
                  id: 'MiniMax-M3',
                }
              : null,
          reviewerModel: null,
          catalogVersion: 1,
        })
      }
      if (body.method === 'provider/list') {
        return rpc(body.id, {
          providers: [
            {
              ...provider.provider,
              authConfigured: credentials.length > 0,
            },
          ],
          issues: [],
          defaultModel:
            credentials.length > 0
              ? {
                  providerID: 'minimax-cn-coding-plan',
                  id: 'MiniMax-M3',
                }
              : null,
          reviewerModel: null,
          catalogVersion: 1,
        })
      }
      if (body.method === 'provider/credential/list') {
        return rpc(body.id, {
          credentials,
        })
      }
      if (body.method === 'provider/credential/delete') {
        expect(body.params).toEqual({
          credentialId: 'credential-1',
          operationId: expect.any(String),
        })
        credentials = []
        return rpc(body.id, { credentials })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const state = await createDesktopClient({ fetch: fetcher }).deleteProviderApiKey(
      'minimax-cn-coding-plan',
    )

    expect(state.apiKeyConfigured).toBe(false)
    expect(state.apiKeySource).toBeNull()
    expect(
      methods.filter((method) => method === 'provider/credential/list').length,
    ).toBeGreaterThanOrEqual(2)
    expect(methods).toContain('provider/credential/delete')
  })

  test('通过只读 source catalog 加载用量来源且不触发计费查询', async () => {
    const methods: string[] = []
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      methods.push(body.method)
      if (body.method === 'initialize') {
        return rpc(body.id, initializedResult())
      }
      if (body.method === 'initialized') {
        return new Response(null, { status: 204 })
      }
      if (body.method === 'usage/source/list') {
        expect(body.params).toEqual({})
        return rpc(body.id, {
          sources: [
            {
              sourceId: 'deepseek',
              canonicalProviderId: 'deepseek',
              providerIds: ['deepseek'],
              displayName: 'DeepSeek 余额',
              scope: 'api-key',
              stability: 'official',
              availability: 'queryable',
              capabilities: ['balance'],
              queryPolicy: 'cached',
              connection: {
                kind: 'provider-key',
                credentialId: 'credential-deepseek',
                maskedValue: '••••test',
                disconnectible: false,
              },
              connectionMethod: { kind: 'provider-credential' },
            },
          ],
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const result = await createDesktopClient({ fetch: fetcher }).listUsageSources()

    expect(result.sources.map((source) => source.sourceId)).toEqual(['deepseek'])
    expect(methods).toContain('usage/source/list')
    expect(methods).not.toContain('usage/provider/query')
  })

  test('uses Pi provider CRUD, discovery and generic AuthSession RPCs', async () => {
    const methods: string[] = []
    const session = {
      id: 'auth-1',
      target: { kind: 'provider', providerId: 'openai' },
      status: 'waiting',
      prompt: {
        id: 'prompt-1',
        type: 'manual_code',
        message: '输入授权码',
      },
      notices: [
        { type: 'auth_url', url: 'https://example.com/authorize' },
        {
          type: 'device_code',
          userCode: 'ABCD',
          verificationUri: 'https://example.com/device',
        },
        { type: 'progress', message: '等待授权' },
      ],
      createdAt: 1,
      expiresAt: 2,
    }
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      methods.push(body.method)
      if (body.method === 'initialize') {
        expect(body.params.capabilities).toEqual(
          expect.arrayContaining(['provider.config.pi.v1', 'provider.auth.pi.v1']),
        )
        return rpc(body.id, initializedResult())
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'provider/create') {
        expect(body.params.definition.kind).toBe('custom')
        return rpc(body.id, { providerId: 'local', catalogVersion: 2 })
      }
      if (body.method === 'provider/model/discover') {
        return rpc(body.id, {
          models: [{ id: 'llama-3.1', api: 'openai-completions' }],
        })
      }
      if (body.method.startsWith('auth/session/')) {
        return rpc(body.id, {
          session:
            body.method === 'auth/session/cancel' ? { ...session, status: 'cancelled' } : session,
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })
    await client.createProvider({
      kind: 'custom',
      id: 'local',
      name: 'Local',
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434/v1',
      auth: 'none',
      env: [],
      allowInsecureHttp: false,
      headers: {},
      models: [{ id: 'llama-3.1', api: 'openai-completions' }],
    } as never)
    expect(await client.discoverProviderModels('local', 'openai-completions')).toEqual([
      { id: 'llama-3.1', api: 'openai-completions' },
    ])
    const started = await client.startAuthSession({
      kind: 'provider',
      providerId: 'openai',
    } as never)
    expect(started.prompt?.type).toBe('manual_code')
    expect(started.notices.map((notice) => notice.type)).toEqual([
      'auth_url',
      'device_code',
      'progress',
    ])
    await client.respondAuthSession('auth-1', 'prompt-1', 'code')
    await client.getAuthSessionStatus('auth-1')
    expect((await client.cancelAuthSession('auth-1')).status).toBe('cancelled')
    expect(methods).toEqual(
      expect.arrayContaining([
        'provider/create',
        'provider/model/discover',
        'auth/session/start',
        'auth/session/respond',
        'auth/session/status',
        'auth/session/cancel',
      ]),
    )
  })

  test('模型健康 RPC 通过 typed RPC 调用并受 capability 门禁', async () => {
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
    const runSnapshot = {
      runId: 'run-1',
      status: 'running',
      startedAt: 1000,
      counts: {
        total: 2,
        queued: 1,
        running: 1,
        healthy: 0,
        failed: 0,
        cancelled: 0,
      },
      excludedProviders: [],
      items: [
        { model: { providerID: 'minimax-cn-coding-plan', id: 'MiniMax-M3' }, status: 'queued' },
        {
          model: { providerID: 'minimax-cn-coding-plan', id: 'MiniMax-M3' },
          status: 'running',
          startedAt: 1000,
        },
      ],
    }
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      requests.push({ method: body.method, params: body.params })
      if (body.method === 'initialize') {
        expect(body.params.capabilities).toContain('model.health.v1')
        return rpc(body.id, initializedResult(['rpc.typed.v1', 'model.health.v1']))
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'model/health/preview') {
        expect(body.params).toEqual({})
        return rpc(body.id, {
          totalRequests: 2,
          excludedProviders: [],
        })
      }
      if (body.method === 'model/health/start') {
        expect(body.params.operationId).toEqual('op-1')
        return rpc(body.id, { run: runSnapshot })
      }
      if (body.method === 'model/health/read') {
        expect(body.params).toEqual({ runId: 'run-1' })
        return rpc(body.id, { run: null })
      }
      if (body.method === 'model/health/cancel') {
        expect(body.params).toEqual({ runId: 'run-1', operationId: 'op-1' })
        return rpc(body.id, {
          run: {
            ...runSnapshot,
            status: 'cancelled',
            completedAt: 1500,
          },
        })
      }
      if (body.method === 'provider/test') {
        expect(body.params).toEqual({
          providerId: 'minimax-cn-coding-plan',
          model: { providerID: 'minimax-cn-coding-plan', id: 'MiniMax-M3' },
        })
        return rpc(body.id, {
          providerId: 'minimax-cn-coding-plan',
          model: { providerID: 'minimax-cn-coding-plan', id: 'MiniMax-M3' },
          status: 'reachable',
          testedAt: 1000,
          latencyMs: 42,
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })

    expect(await client.previewModelHealth()).toEqual({
      totalRequests: 2,
      excludedProviders: [],
    })
    expect(await client.startModelHealth('op-1')).toEqual({ run: runSnapshot })
    expect(await client.readModelHealth('run-1')).toEqual({ run: null })
    expect(await client.cancelModelHealth('run-1', 'op-1')).toMatchObject({
      run: { status: 'cancelled' },
    })
    expect(
      await client.testModelProvider('minimax-cn-coding-plan', {
        providerID: 'minimax-cn-coding-plan',
        id: 'MiniMax-M3',
      }),
    ).toMatchObject({
      status: 'reachable',
      latencyMs: 42,
    })

    expect(requests).toEqual(
      expect.arrayContaining([
        { method: 'model/health/preview', params: {} },
        { method: 'model/health/start', params: { operationId: 'op-1' } },
        { method: 'model/health/read', params: { runId: 'run-1' } },
        { method: 'model/health/cancel', params: { runId: 'run-1', operationId: 'op-1' } },
        {
          method: 'provider/test',
          params: {
            providerId: 'minimax-cn-coding-plan',
            model: { providerID: 'minimax-cn-coding-plan', id: 'MiniMax-M3' },
          },
        },
      ]),
    )
  })

  test('declares the side-chat capability before calling its RPC methods', async () => {
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      requests.push({ method: body.method, params: body.params })
      if (body.method === 'initialize') {
        expect(body.params.capabilities).toContain('thread.side-chat.v1')
        return rpc(body.id, initializedResult(['rpc.typed.v1', 'thread.side-chat.v1']))
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'thread/side-chat/create') {
        return rpc(body.id, {
          sideChat: {
            threadId: 'side-chat-1',
            sourceThreadId: 'thread-1',
            inheritedThroughTurnId: 'turn-1',
            createdAt: 1,
          },
        })
      }
      if (body.method === 'thread/side-chat/discard') {
        return rpc(body.id, { ok: true })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })

    await client.createSideChat({ sourceThreadId: 'thread-1' })
    await client.discardSideChat({ threadId: 'side-chat-1' })

    expect(requests).toEqual(
      expect.arrayContaining([
        {
          method: 'thread/side-chat/create',
          params: {
            sourceThreadId: 'thread-1',
            operationId: expect.any(String),
          },
        },
        {
          method: 'thread/side-chat/discard',
          params: {
            threadId: 'side-chat-1',
            operationId: expect.any(String),
          },
        },
      ]),
    )
  })
})

function builtinLogoURL(providerID: string): string | undefined {
  return catalogProviderToDesktop({
    provider: {
      ...provider.provider,
      id: providerID,
      source: {
        ...provider.provider.source,
        kind: 'builtin',
      },
      catalogOrigin: 'pi-bundled',
    },
    models: provider.models,
  } as never).logoURL
}

function rpc(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  })
}

function credential() {
  return {
    id: 'credential-1',
    providerId: 'minimax-cn-coding-plan',
    kind: 'api-key',
    label: 'API Key',
    maskedValue: '••••test',
    enabled: true,
    active: true,
    order: 0,
    health: { status: 'untested' },
    createdAt: 1,
    updatedAt: 1,
  }
}

function initializedResult(capabilities: string[] = ['rpc.typed.v1']) {
  return {
    protocol: 'thread-rpc-v4',
    serverInfo: { name: 'test-agent', version: '1.0.0' },
    capabilities,
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 8,
      maxStreamsPerSubscription: 8,
      maxPendingRequests: 32,
    },
    connectionId: 'test-connection',
  }
}
