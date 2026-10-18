import { describe, expect, test } from 'bun:test'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

const draft = {
  baseUrl: 'https://relay.example.com/v1',
  auth: 'api-key',
  apiKey: 'sk-test-only',
}

const providerTestResult = {
  providerId: 'relay',
  model: { providerID: 'relay', id: 'trial-model' },
  status: 'reachable',
  testedAt: 1_000,
  latencyMs: 42,
}

const detectResult = {
  mode: 'single',
  protocols: [
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
    'google-generative-ai',
  ],
  models: [
    {
      model: 'trial-model',
      cells: [
        { protocol: 'openai-completions', status: 'success', latencyMs: 42 },
        {
          protocol: 'openai-responses',
          status: 'failed',
          category: 'authentication',
          message: '认证失败',
        },
      ],
    },
  ],
  totalModels: 1,
  skippedModels: 0,
}

const syncResult = {
  providerId: 'relay',
  api: 'openai-completions',
  fetchedAt: 1_000,
  candidates: [{ id: 'new-model', api: 'openai-completions', enabled: false }],
  removedModelIds: ['old-model'],
  baselineCreated: false,
  totalFetched: 3,
  catalogVersion: 9,
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

function rpc(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  })
}

function createRpcFetcher(
  capabilities: string[],
  handlers: Record<string, (params: Record<string, unknown>) => unknown>,
) {
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
  const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
    if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
    const body = JSON.parse(String(init?.body))
    requests.push({ method: body.method, params: body.params })
    if (body.method === 'initialize') {
      expect(body.params.capabilities).toEqual(
        expect.arrayContaining([
          'provider.modelSync.v1',
          'provider.protocolDetection.v1',
          'provider.config.pi.v1',
        ]),
      )
      return rpc(body.id, initializedResult(capabilities))
    }
    if (body.method === 'initialized') return new Response(null, { status: 204 })
    const handler = handlers[body.method]
    if (!handler) throw new Error(`Unhandled RPC method: ${body.method}`)
    return rpc(body.id, handler(body.params))
  }
  return { fetcher, requests }
}

describe('desktop provider model sync and protocol detection', () => {
  test('缺少 capability 时 sync/detect 以 AGENT_OPERATION_UNSUPPORTED 拒绝调用', async () => {
    const { fetcher } = createRpcFetcher(['rpc.typed.v1'], {})
    const client = createDesktopClient({ fetch: fetcher })

    await expect(client.syncProviderModels('relay')).rejects.toThrow('AGENT_OPERATION_UNSUPPORTED')
    await expect(client.detectProviderProtocols({ draft, model: 'trial-model' })).rejects.toThrow(
      'AGENT_OPERATION_UNSUPPORTED',
    )
  })

  test('sync 透传 providerId 并返回基线/候选/下架结果', async () => {
    const { fetcher, requests } = createRpcFetcher(['rpc.typed.v1', 'provider.modelSync.v1'], {
      'provider/model/sync': () => syncResult,
    })
    const client = createDesktopClient({ fetch: fetcher })

    expect(await client.syncProviderModels('relay')).toEqual(syncResult)
    expect(requests).toContainEqual({
      method: 'provider/model/sync',
      params: { providerId: 'relay' },
    })
  })

  test('detect 透传草稿、试用模型与批量标记并返回四协议矩阵', async () => {
    const { fetcher, requests } = createRpcFetcher(
      ['rpc.typed.v1', 'provider.protocolDetection.v1'],
      { 'provider/protocol/detect': () => detectResult },
    )
    const client = createDesktopClient({ fetch: fetcher })
    const params = {
      draft,
      providerId: 'relay',
      model: 'trial-model',
      batch: true,
    }

    expect(await client.detectProviderProtocols(params)).toEqual(detectResult)
    expect(requests).toContainEqual({ method: 'provider/protocol/detect', params })
  })

  test('discover 支持保存前 draft 获取与可选 providerId', async () => {
    const { fetcher, requests } = createRpcFetcher(['rpc.typed.v1', 'provider.config.pi.v1'], {
      'provider/model/discover': () => ({
        models: [{ id: 'remote-only', api: 'openai-completions', enabled: false }],
      }),
    })
    const client = createDesktopClient({ fetch: fetcher })

    expect(
      await client.discoverProviderModels({
        api: 'openai-completions',
        draft,
      }),
    ).toEqual([{ id: 'remote-only', api: 'openai-completions', enabled: false }])
    expect(requests).toContainEqual({
      method: 'provider/model/discover',
      params: { api: 'openai-completions', draft },
    })

    await client.discoverProviderModels({ providerId: 'relay', api: 'anthropic-messages' })
    expect(requests).toContainEqual({
      method: 'provider/model/discover',
      params: { api: 'anthropic-messages', providerId: 'relay' },
    })
  })

  test('testProviderDraft 用草稿构造显式模型，providerId 可选', async () => {
    const { fetcher, requests } = createRpcFetcher(['rpc.typed.v1'], {
      'provider/test': () => providerTestResult,
    })
    const client = createDesktopClient({ fetch: fetcher })

    expect(
      await client.testProviderDraft({
        modelId: 'trial-model',
        api: 'openai-completions',
        draft,
      }),
    ).toEqual(providerTestResult)
    expect(requests).toContainEqual({
      method: 'provider/test',
      params: {
        model: { providerID: 'draft', id: 'trial-model' },
        api: 'openai-completions',
        draft,
      },
    })

    await client.testProviderDraft({
      providerId: 'relay',
      modelId: 'trial-model',
      api: 'openai-completions',
      draft,
    })
    expect(requests).toContainEqual({
      method: 'provider/test',
      params: {
        model: { providerID: 'relay', id: 'trial-model' },
        api: 'openai-completions',
        draft,
        providerId: 'relay',
      },
    })
  })
})

describe('browser mock provider model sync and protocol detection', () => {
  const createOfflineClient = () =>
    createDesktopClient({
      fetch: async () => {
        throw new Error('浏览器 mock 模式没有 Agent 连接。')
      },
    })

  test('sync 首次建基线返回候选，第二次模拟上游下架', async () => {
    const client = createOfflineClient()

    const first = await client.syncProviderModels('mock')
    expect(first).toMatchObject({
      providerId: 'mock',
      api: 'openai-completions',
      baselineCreated: true,
      removedModelIds: [],
      totalFetched: 2,
    })
    expect(first.candidates.map((model) => model.id)).toEqual([
      'mock-sync-model',
      'mock-sync-model-2',
    ])
    expect(first.fetchedAt).toBeNumber()

    const second = await client.syncProviderModels('mock')
    expect(second).toMatchObject({
      baselineCreated: false,
      candidates: [],
      removedModelIds: ['mock-sync-model-retired'],
      totalFetched: 1,
    })
  })

  test('detect 返回四协议矩阵并按单模型/批量切换', async () => {
    const client = createOfflineClient()

    const single = await client.detectProviderProtocols({ draft, model: 'trial-model' })
    expect(single.mode).toBe('single')
    expect(single.protocols).toEqual([
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
      'google-generative-ai',
    ])
    expect(single.models.map((model) => model.model)).toEqual(['trial-model'])
    expect(single.models[0]?.cells.map((cell) => cell.status)).toEqual([
      'success',
      'failed',
      'failed',
      'failed',
    ])
    expect(single.models[0]?.cells[1]?.category).toBe('authentication')
    expect(single.models[0]?.cells[2]?.category).toBe('timeout')
    expect(single.models[0]?.cells[0]?.latencyMs).toBeNumber()
    expect(single.totalModels).toBe(1)
    expect(single.skippedModels).toBe(0)

    const batch = await client.detectProviderProtocols({ draft, batch: true })
    expect(batch.mode).toBe('batch')
    expect(batch.models).toHaveLength(2)
    expect(batch.totalModels).toBe(2)
    expect(batch.skippedModels).toBe(1)
  })

  test('testProviderDraft 返回可达或不可达的确定性结果', async () => {
    const client = createOfflineClient()

    expect(
      await client.testProviderDraft({
        modelId: 'trial-model',
        api: 'openai-completions',
        draft,
      }),
    ).toMatchObject({ status: 'reachable', latencyMs: 18 })

    expect(
      await client.testProviderDraft({
        modelId: 'trial-model-unavailable',
        api: 'openai-completions',
        draft,
      }),
    ).toMatchObject({ status: 'unavailable', category: 'configuration' })
  })

  test('discover 返回确定性的上游候选列表', async () => {
    const client = createOfflineClient()

    expect(await client.discoverProviderModels({ api: 'anthropic-messages' })).toEqual([
      { id: 'mock-sync-model', name: 'Mock Sync Model', api: 'anthropic-messages', enabled: false },
      { id: 'mock-sync-model-2', api: 'anthropic-messages', enabled: false },
    ])
  })
})
