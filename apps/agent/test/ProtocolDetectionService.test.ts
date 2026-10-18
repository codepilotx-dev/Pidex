import { describe, expect, test } from 'bun:test'
import type {
  Api,
  AssistantMessage,
  Model as PiModel,
  SimpleStreamOptions,
  TranscriptContext,
} from '@earendil-works/pi-ai'
import { Model, Provider } from '@pidex/model-schema'
import {
  PROTOCOL_DETECTION_BATCH_LIMIT,
  PROTOCOL_DETECTION_CONCURRENCY,
  ProtocolDetectionService,
} from '../src/provider/ProtocolDetectionService'
import {
  PiTransientProbe,
  TRANSIENT_PROBE_PROVIDER_ID,
  type TransientProbeStream,
} from '../src/provider/PiTransientProbe'
import {
  PROTOCOL_DETECTION_APIS,
  TRANSIENT_NO_AUTH_API_KEY,
  normalizeProtocolBaseUrl,
} from '../src/provider/ProviderProtocolUrl'
import type { PiModelService, PiProviderDefinitionInput } from '../src/provider/pi'
import type { CustomProviderApi } from '../src/provider/pi/PiProviderConfig'

type StreamHandler = (
  model: PiModel<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions,
) => TransientProbeStream

type ProbeCall = {
  model: PiModel<Api>
  context: TranscriptContext
  options: SimpleStreamOptions
}

const assistant = (overrides: Partial<AssistantMessage> = {}): AssistantMessage =>
  ({ stopReason: 'stop', ...overrides }) as AssistantMessage

const okStream = (): TransientProbeStream => ({ result: async () => assistant() })

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const modelInfo = (
  id: string,
  apiName: string,
  overrides: Partial<Model.Info> = {},
): Model.Info => ({
  id: Model.ID.make(id),
  providerID: Provider.ID.make('demo'),
  name: id,
  api: { id: Model.ID.make(id), type: 'pi', name: apiName, baseUrl: 'https://api.example.com/v1' },
  capabilities: { tools: true, input: ['text'], output: ['text'] },
  variants: [],
  time: { released: 0 },
  cost: [],
  status: 'active',
  enabled: true,
  limit: { context: 32_768, output: 8_192 },
  ...overrides,
})

const customDefinition = (
  models: ReadonlyArray<{
    id: string
    api: CustomProviderApi
    enabled?: boolean
    modelType?: 'chat' | 'embedding' | 'rerank'
  }>,
): PiProviderDefinitionInput => ({
  kind: 'custom',
  id: 'demo',
  name: 'Demo',
  enabled: true,
  baseUrl: 'https://api.example.com/v1',
  auth: 'api-key',
  env: [],
  allowInsecureHttp: false,
  headers: {},
  models: models.map((model) => ({
    id: model.id,
    api: model.api,
    ...(model.enabled !== undefined ? { enabled: model.enabled } : {}),
    ...(model.modelType !== undefined ? { modelType: model.modelType } : {}),
  })),
})

type HarnessOptions = {
  readonly providers?: ReadonlyArray<{ id: string; disabled?: boolean }>
  readonly definitions?: readonly PiProviderDefinitionInput[]
  readonly models?: (providerID: Provider.ID) => Promise<readonly Model.Info[]>
  readonly catalog?: unknown
  readonly auth?: (providerID: string) => Promise<unknown>
  readonly stream?: StreamHandler
  readonly requestTimeoutMs?: number
}

const makeHarness = (options: HarnessOptions = {}) => {
  const calls: ProbeCall[] = []
  const mutations: string[] = []
  const piModels = {
    list: async () =>
      (options.providers ?? [{ id: 'demo' }]).map((provider) => ({
        id: Provider.ID.make(provider.id),
        ...(provider.disabled ? { disabled: true } : {}),
      })),
    models: async (providerID: Provider.ID) =>
      options.models ? await options.models(providerID) : [],
    providerDefinitions: async () => options.definitions ?? [],
    catalogConfig: async () => options.catalog ?? { schemaVersion: 2, providers: {}, issues: [] },
    pi: {
      getAuth: async (providerID: string) =>
        options.auth ? await options.auth(providerID) : undefined,
      // Any mutation of the global registry would be a draft leak.
      setProvider: () => {
        mutations.push('setProvider')
      },
      deleteProvider: () => {
        mutations.push('deleteProvider')
      },
    },
  } as unknown as PiModelService
  const probe = new PiTransientProbe({
    streamSimple: (model, context, streamOptions) => {
      calls.push({ model, context, options: streamOptions })
      return (options.stream ?? (() => okStream()))(model, context, streamOptions)
    },
  })
  const service = new ProtocolDetectionService(piModels, {
    probe,
    ...(options.requestTimeoutMs !== undefined
      ? { requestTimeoutMs: options.requestTimeoutMs }
      : {}),
  })
  return { service, calls, mutations }
}

const singleInput = (
  draft: Parameters<ProtocolDetectionService['detect']>[0]['draft'],
  extra: Partial<Parameters<ProtocolDetectionService['detect']>[0]> = {},
): Parameters<ProtocolDetectionService['detect']>[0] => ({
  draft,
  batch: false,
  ...extra,
})

describe('ProviderProtocolUrl 规范化', () => {
  test('openai-completions 去除完整 /chat/completions 接口地址', () => {
    expect(
      normalizeProtocolBaseUrl(
        'openai-completions',
        'https://api.example.com/v1/chat/completions',
        false,
      ),
    ).toBe('https://api.example.com/v1')
    expect(normalizeProtocolBaseUrl('openai-completions', 'https://api.example.com', false)).toBe(
      'https://api.example.com',
    )
    expect(
      normalizeProtocolBaseUrl('openai-completions', 'https://api.example.com/v1/', false),
    ).toBe('https://api.example.com/v1')
  })

  test('openai-responses 去除完整 /responses 接口地址', () => {
    expect(
      normalizeProtocolBaseUrl('openai-responses', 'https://api.example.com/v1/responses', false),
    ).toBe('https://api.example.com/v1')
    expect(normalizeProtocolBaseUrl('openai-responses', 'https://api.example.com/v1', false)).toBe(
      'https://api.example.com/v1',
    )
  })

  test('anthropic-messages 去除 /v1/messages 或 /messages 且保留更早路径', () => {
    expect(
      normalizeProtocolBaseUrl(
        'anthropic-messages',
        'https://api.example.com/anthropic/v1/messages',
        false,
      ),
    ).toBe('https://api.example.com/anthropic')
    expect(
      normalizeProtocolBaseUrl('anthropic-messages', 'https://api.example.com/messages', false),
    ).toBe('https://api.example.com')
    expect(
      normalizeProtocolBaseUrl('anthropic-messages', 'https://api.example.com/anthropic', false),
    ).toBe('https://api.example.com/anthropic')
  })

  test('google-generative-ai 去除 /models/<id>:generateContent 且保留版本路径', () => {
    expect(
      normalizeProtocolBaseUrl(
        'google-generative-ai',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
        false,
      ),
    ).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(
      normalizeProtocolBaseUrl(
        'google-generative-ai',
        'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-pro:streamGenerateContent?alt=sse',
        false,
      ),
    ).toBe('https://generativelanguage.googleapis.com/v1')
    expect(
      normalizeProtocolBaseUrl(
        'google-generative-ai',
        'https://generativelanguage.googleapis.com/v1beta',
        false,
      ),
    ).toBe('https://generativelanguage.googleapis.com/v1beta')
  })

  test('拒绝非 HTTP(S)、凭据、片段与未允许的远端明文 HTTP', () => {
    expect(() =>
      normalizeProtocolBaseUrl('openai-completions', 'ftp://example.com', false),
    ).toThrow()
    expect(() =>
      normalizeProtocolBaseUrl('openai-completions', 'https://user:pass@example.com', false),
    ).toThrow()
    expect(() =>
      normalizeProtocolBaseUrl('openai-completions', 'https://example.com/#frag', false),
    ).toThrow()
    expect(() =>
      normalizeProtocolBaseUrl('openai-completions', 'http://example.com', false),
    ).toThrow()
    expect(normalizeProtocolBaseUrl('openai-completions', 'http://example.com', true)).toBe(
      'http://example.com',
    )
    // Loopback plaintext stays allowed without the insecure opt-in.
    expect(normalizeProtocolBaseUrl('openai-completions', 'http://127.0.0.1:8080', false)).toBe(
      'http://127.0.0.1:8080',
    )
  })
})

describe('ProtocolDetectionService', () => {
  test('单模型模式对四种协议各发起一次请求并返回成功矩阵', async () => {
    const { service, calls } = makeHarness()
    const result = await service.detect(
      singleInput(
        { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'sk-draft-secret' },
        { model: 'gpt-test' },
      ),
    )

    expect(result.mode).toBe('single')
    expect(result.protocols).toEqual([...PROTOCOL_DETECTION_APIS])
    expect(result.models).toHaveLength(1)
    expect(String(result.models[0]?.model)).toBe('gpt-test')
    expect(result.totalModels).toBe(1)
    expect(result.skippedModels).toBe(0)
    const cells = result.models[0]!.cells
    expect(cells.map((cell) => cell.protocol)).toEqual([...PROTOCOL_DETECTION_APIS])
    for (const cell of cells) {
      expect(cell.status).toBe('success')
      expect(typeof cell.latencyMs).toBe('number')
    }
    expect(calls).toHaveLength(4)
    expect(calls.map((call) => call.model.api).sort()).toEqual([...PROTOCOL_DETECTION_APIS].sort())
    for (const call of calls) {
      expect(call.model.provider).toBe(TRANSIENT_PROBE_PROVIDER_ID)
      expect(call.model.id).toBe('gpt-test')
      expect(call.options.maxTokens).toBe(8)
      expect(call.options.maxRetries).toBe(0)
      expect(call.options.apiKey).toBe('sk-draft-secret')
      expect(call.options.signal).toBeDefined()
    }
    // Transient credentials never reach the wire result.
    expect(JSON.stringify(result)).not.toContain('sk-draft-secret')
  })

  test('端点覆盖优先于根地址，并按协议规范化接口地址', async () => {
    const { service, calls } = makeHarness()
    await service.detect(
      singleInput(
        {
          baseUrl: 'https://root.example.com',
          endpoints: {
            'openai-completions': 'https://chat.example.com/v1/chat/completions',
            'anthropic-messages': 'https://anthropic.example.com/v1/messages',
          },
          auth: 'api-key',
          apiKey: 'k',
        },
        { model: 'm' },
      ),
    )
    const byProtocol = new Map(calls.map((call) => [call.model.api, call.model.baseUrl]))
    expect(byProtocol.get('openai-completions')).toBe('https://chat.example.com/v1')
    expect(byProtocol.get('anthropic-messages')).toBe('https://anthropic.example.com')
    expect(byProtocol.get('openai-responses')).toBe('https://root.example.com')
    expect(byProtocol.get('google-generative-ai')).toBe('https://root.example.com')
  })

  test('不安全 URL 与敏感请求头被拒绝且不发起任何请求', async () => {
    const { service, calls } = makeHarness()
    await expect(
      service.detect(
        singleInput(
          {
            baseUrl: 'https://api.example.com',
            auth: 'api-key',
            headers: { authorization: 'Bearer secret' },
            apiKey: 'k',
          },
          { model: 'gpt-test' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
    await expect(
      service.detect(
        singleInput({ baseUrl: 'ftp://api.example.com', auth: 'none' }, { model: 'm' }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(
      service.detect(
        singleInput({ baseUrl: 'http://remote.example.com', auth: 'none' }, { model: 'm' }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(calls).toHaveLength(0)
  })

  test('允许开启 allowInsecureHttp 后的远端明文 HTTP 草稿', async () => {
    const { service, calls } = makeHarness()
    const result = await service.detect(
      singleInput(
        {
          baseUrl: 'http://remote.example.com/v1',
          auth: 'api-key',
          apiKey: 'k',
          allowInsecureHttp: true,
        },
        { model: 'm' },
      ),
    )
    expect(result.models[0]?.cells.every((cell) => cell.status === 'success')).toBe(true)
    expect(calls.every((call) => call.model.baseUrl === 'http://remote.example.com/v1')).toBe(true)
  })

  test('四协议失败分类与部分失败结果保留', async () => {
    const { service } = makeHarness({
      stream: (model) => {
        if (model.api === 'openai-completions') return okStream()
        if (model.api === 'openai-responses') {
          return {
            result: async () => {
              throw new TypeError('fetch failed')
            },
          }
        }
        if (model.api === 'anthropic-messages') {
          return {
            result: async () => {
              throw Object.assign(new Error(`401 Unauthorized Bearer sk-leak`), { status: 401 })
            },
          }
        }
        return {
          result: async () =>
            assistant({ stopReason: 'error', errorMessage: 'rate limit exceeded 429 raw body' }),
        }
      },
    })
    const result = await service.detect(
      singleInput(
        { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'k' },
        { model: 'm' },
      ),
    )
    const cells = result.models[0]!.cells
    const byProtocol = new Map(cells.map((cell) => [cell.protocol, cell]))
    expect(byProtocol.get('openai-completions')?.status).toBe('success')
    expect(byProtocol.get('openai-responses')).toMatchObject({
      status: 'failed',
      category: 'network',
    })
    expect(byProtocol.get('anthropic-messages')).toMatchObject({
      status: 'failed',
      category: 'authentication',
    })
    expect(byProtocol.get('google-generative-ai')).toMatchObject({
      status: 'failed',
      category: 'rate-limit',
    })
    for (const cell of cells) {
      if (cell.status !== 'failed') continue
      expect(cell.message).toBeTruthy()
      expect(cell.message).not.toContain('sk-leak')
      expect(cell.message).not.toContain('429')
      expect(cell.message).not.toContain('fetch failed')
      expect(cell.message).not.toContain('Unauthorized')
      expect(cell.message!.length).toBeLessThanOrEqual(1024)
    }
  })

  test('请求超时归类为 timeout 且不阻塞其他协议', async () => {
    const { service } = makeHarness({
      requestTimeoutMs: 25,
      stream: (model, _context, options) =>
        model.api === 'openai-completions'
          ? okStream()
          : {
              result: () =>
                new Promise<AssistantMessage>((resolve) => {
                  options.signal?.addEventListener('abort', () =>
                    resolve(assistant({ stopReason: 'aborted' })),
                  )
                }),
            },
    })
    const startedAt = Date.now()
    // Bun's AbortSignal.timeout does not keep the event loop alive on its own;
    // a real request is socket-backed, so keep the test loop busy until abort.
    const keepAlive = setInterval(() => {}, 5)
    let result: Awaited<ReturnType<ProtocolDetectionService['detect']>>
    try {
      result = await service.detect(
        singleInput(
          { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'k' },
          { model: 'm' },
        ),
      )
    } finally {
      clearInterval(keepAlive)
    }
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    const cells = result.models[0]!.cells
    expect(cells.find((cell) => cell.protocol === 'openai-completions')?.status).toBe('success')
    for (const cell of cells.filter((entry) => entry.protocol !== 'openai-completions')) {
      expect(cell).toMatchObject({ status: 'failed', category: 'timeout' })
      expect(cell.message).toBe('模型请求超时，请稍后重试')
    }
  })

  test('无凭据且 auth=api-key 时直接归类为配置失败且不发请求', async () => {
    const { service, calls } = makeHarness()
    const result = await service.detect(
      singleInput({ baseUrl: 'https://api.example.com/v1', auth: 'api-key' }, { model: 'm' }),
    )
    expect(calls).toHaveLength(0)
    for (const cell of result.models[0]!.cells) {
      expect(cell).toMatchObject({
        status: 'failed',
        category: 'configuration',
        message: '模型或 Provider 配置不可用',
      })
    }
  })

  test('auth=none 时使用适配器占位 Key 让无认证端点仍可被探测', async () => {
    const { service, calls } = makeHarness()
    const result = await service.detect(
      singleInput({ baseUrl: 'http://127.0.0.1:8080/v1', auth: 'none' }, { model: 'local-model' }),
    )
    expect(result.models[0]?.cells.every((cell) => cell.status === 'success')).toBe(true)
    expect(calls).toHaveLength(4)
    expect(calls.every((call) => call.options.apiKey === TRANSIENT_NO_AUTH_API_KEY)).toBe(true)
  })

  test('providerId 凭据的 Key 与 headers 被复用，草稿 Key 优先且不会泄漏', async () => {
    const auth = async () => ({
      auth: { apiKey: 'active-key', headers: { 'x-tenant': 'tenant-1' } },
    })
    const withCredential = makeHarness({ auth })
    await withCredential.service.detect(
      singleInput(
        {
          baseUrl: 'https://api.example.com/v1',
          auth: 'api-key',
          headers: { 'x-client': 'client-1' },
        },
        { providerId: 'demo', model: 'm' },
      ),
    )
    for (const call of withCredential.calls) {
      expect(call.options.apiKey).toBe('active-key')
      expect(call.model.headers).toEqual({ 'x-tenant': 'tenant-1', 'x-client': 'client-1' })
    }

    const withDraftKey = makeHarness({ auth })
    const result = await withDraftKey.service.detect(
      singleInput(
        { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'draft-key' },
        { providerId: 'demo', model: 'm' },
      ),
    )
    expect(withDraftKey.calls.every((call) => call.options.apiKey === 'draft-key')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('draft-key')
    expect(JSON.stringify(result)).not.toContain('active-key')
  })

  test('单模型未指定模型时按协议匹配已保存模型，否则回退第一个', async () => {
    const { service, calls } = makeHarness({
      definitions: [
        customDefinition([
          { id: 'gpt-model', api: 'openai-completions' },
          { id: 'claude-model', api: 'anthropic-messages' },
        ]),
      ],
    })
    const result = await service.detect(
      singleInput(
        { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'k' },
        { providerId: 'demo' },
      ),
    )
    const byProtocol = new Map(calls.map((call) => [call.model.api, call.model.id]))
    expect(byProtocol.get('openai-completions')).toBe('gpt-model')
    expect(byProtocol.get('anthropic-messages')).toBe('claude-model')
    expect(byProtocol.get('openai-responses')).toBe('gpt-model')
    expect(byProtocol.get('google-generative-ai')).toBe('gpt-model')
    expect(String(result.models[0]?.model)).toBe('gpt-model')
  })

  test('没有已保存模型时回退 model_sync 基线模型', async () => {
    const { service, calls } = makeHarness({
      catalog: {
        schemaVersion: 2,
        providers: { demo: { modelSync: { models: ['baseline-model', 'second-model'] } } },
        issues: [],
      },
    })
    const result = await service.detect(
      singleInput(
        { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'k' },
        { providerId: 'demo' },
      ),
    )
    expect(String(result.models[0]?.model)).toBe('baseline-model')
    expect(calls).toHaveLength(4)
    expect(calls.every((call) => call.model.id === 'baseline-model')).toBe(true)
  })

  test('没有任何模型候选时给出明确提示且不发请求', async () => {
    const { service, calls } = makeHarness()
    await expect(
      service.detect(
        singleInput(
          { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'k' },
          { providerId: 'demo' },
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: '请输入试用模型或先为供应商添加模型',
      status: 400,
    })
    expect(calls).toHaveLength(0)
  })

  test('批量模式截断到 30 个模型并统计跳过数量', async () => {
    const models = Array.from({ length: 35 }, (_, index) => ({
      id: `m${index}`,
      api: 'openai-completions' as const,
    }))
    const { service, calls } = makeHarness({ definitions: [customDefinition(models)] })
    const result = await service.detect({
      draft: { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'k' },
      providerId: 'demo',
      batch: true,
    })
    expect(result.mode).toBe('batch')
    expect(PROTOCOL_DETECTION_BATCH_LIMIT).toBe(30)
    expect(result.totalModels).toBe(35)
    expect(result.skippedModels).toBe(5)
    expect(result.models).toHaveLength(30)
    expect(String(result.models[0]?.model)).toBe('m0')
    expect(calls).toHaveLength(30 * PROTOCOL_DETECTION_APIS.length)
  })

  test('批量模式全局在飞请求不超过 8 且部分失败仍保留结果', async () => {
    const models = Array.from({ length: 30 }, (_, index) => ({
      id: `m${index}`,
      api: 'openai-completions' as const,
    }))
    let inFlight = 0
    let peak = 0
    const { service } = makeHarness({
      definitions: [customDefinition(models)],
      stream: (model) => ({
        result: async () => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          await wait(5)
          inFlight -= 1
          return model.api === 'anthropic-messages'
            ? assistant({ stopReason: 'error', errorMessage: '500 provider unavailable' })
            : assistant()
        },
      }),
    })
    const result = await service.detect({
      draft: { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'k' },
      providerId: 'demo',
      batch: true,
    })
    expect(peak).toBeLessThanOrEqual(PROTOCOL_DETECTION_CONCURRENCY)
    expect(peak).toBe(PROTOCOL_DETECTION_CONCURRENCY)
    expect(result.models).toHaveLength(30)
    for (const model of result.models) {
      expect(model.cells).toHaveLength(4)
      expect(model.cells.filter((cell) => cell.status === 'failed')).toHaveLength(1)
      expect(model.cells.find((cell) => cell.protocol === 'anthropic-messages')?.status).toBe(
        'failed',
      )
    }
  })

  test('批量模式排除 Embedding 与 Rerank 模型', async () => {
    const { service, calls } = makeHarness({
      definitions: [
        customDefinition([
          { id: 'chat-a', api: 'openai-completions' },
          { id: 'chat-b', api: 'openai-completions', enabled: false },
          { id: 'embed', api: 'openai-completions', modelType: 'embedding' },
          { id: 'rerank', api: 'openai-completions', modelType: 'rerank' },
        ]),
      ],
    })
    const result = await service.detect({
      draft: { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'k' },
      providerId: 'demo',
      batch: true,
    })
    expect(result.totalModels).toBe(1)
    expect(result.models.map((model) => String(model.model))).toEqual(['chat-a'])
    expect(calls).toHaveLength(4)
  })

  test('内置供应商批量模式按运行时聊天模型过滤并排除 Embedding/Rerank', async () => {
    const { service, calls } = makeHarness({
      definitions: [],
      models: async () => [
        modelInfo('chat-model', 'openai-completions'),
        modelInfo('disabled-model', 'openai-completions', { enabled: false }),
        modelInfo('embed-model', 'openai-completions', { modelType: 'embedding' }),
        modelInfo('rerank-model', 'openai-completions', { modelType: 'rerank' }),
      ],
    })
    const result = await service.detect({
      draft: { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'k' },
      providerId: 'demo',
      batch: true,
    })
    expect(result.totalModels).toBe(1)
    expect(result.models.map((model) => String(model.model))).toEqual(['chat-model'])
    expect(calls).toHaveLength(4)
  })

  test('批量模式需要 providerId 且供应商必须存在', async () => {
    const { service } = makeHarness({ providers: [{ id: 'demo' }] })
    await expect(
      service.detect({
        draft: { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'k' },
        batch: true,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(
      service.detect({
        draft: { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'k' },
        providerId: 'missing',
        batch: true,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND', status: 404 })
  })

  test('草稿探测不写入配置、不修改全局模型注册表', async () => {
    const { service, calls, mutations } = makeHarness({
      definitions: [customDefinition([{ id: 'gpt-model', api: 'openai-completions' }])],
    })
    await service.detect(
      singleInput(
        { baseUrl: 'https://api.example.com/v1', auth: 'api-key', apiKey: 'k' },
        { providerId: 'demo' },
      ),
    )
    expect(mutations).toEqual([])
    expect(calls.every((call) => call.model.provider === 'demo')).toBe(true)
  })

  test('真实适配器端到端：四协议检测与 HTTP 401 分类', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname !== '/v1/chat/completions') {
          return new Response('not found', { status: 404 })
        }
        if (request.headers.get('authorization') !== 'Bearer good-key') {
          return new Response(
            JSON.stringify({ error: { message: 'Incorrect API key provided' } }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }
        const chunk = (delta: object, finish: string | null) =>
          `data: ${JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'm',
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`
        return new Response(
          `${chunk({ content: 'OK' }, null)}${chunk({}, 'stop')}data: [DONE]\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        )
      },
    })
    try {
      const service = new ProtocolDetectionService({} as unknown as PiModelService, {
        requestTimeoutMs: 5_000,
      })
      const success = await service.detect(
        singleInput(
          {
            baseUrl: `http://127.0.0.1:${server.port}/v1/chat/completions`,
            auth: 'api-key',
            apiKey: 'good-key',
          },
          { model: 'm' },
        ),
      )
      const successCells = new Map(success.models[0]!.cells.map((cell) => [cell.protocol, cell]))
      expect(successCells.get('openai-completions')).toMatchObject({ status: 'success' })
      expect(successCells.get('openai-completions')!.latencyMs).toBeGreaterThanOrEqual(0)

      const unauthorized = await service.detect(
        singleInput(
          {
            baseUrl: `http://127.0.0.1:${server.port}/v1`,
            auth: 'api-key',
            apiKey: 'bad-key',
          },
          { model: 'm' },
        ),
      )
      expect(
        unauthorized.models[0]!.cells.find((cell) => cell.protocol === 'openai-completions'),
      ).toMatchObject({ status: 'failed', category: 'authentication', message: '凭据鉴权失败' })
    } finally {
      server.stop(true)
    }
  })
})
