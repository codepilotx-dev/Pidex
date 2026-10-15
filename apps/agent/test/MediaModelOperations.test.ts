import { ModelHealthService } from '../src/provider/ModelHealthService'
import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import type { Api, Model as PiModel } from '@earendil-works/pi-ai'
import { Model, Provider } from '@pidex/model-schema'
import type { EncryptedCredentialRepository } from '../src/auth/EncryptedCredentialRepository'
import { PiModelService } from '../src/provider/pi/PiModelService'
import {
  parsePiProviderCatalog,
  serializePiProviderDefinition,
} from '../src/provider/pi/PiProviderConfig'
import type { ModelOperationOptions } from '../src/provider/pi/PiModelOperations'
import { prepareMediaInput } from '../src/provider/pi/MediaInput'
import { prepareAttachmentUpload } from '../src/subagent/AttachmentService'

const repository = {
  list: () => [],
  get: () => Effect.succeed(null),
  getActiveBinding: () => null,
  getById: () => Effect.succeed(null),
} as unknown as EncryptedCredentialRepository
const ref = (id: string): Model.Ref => ({
  providerID: Provider.ID.make('relay'),
  id: Model.ID.make(id),
})
const service = () =>
  new PiModelService(repository, {
    config: {
      providers: {
        relay: {
          kind: 'custom',
          auth: 'none',
          base_url: 'https://api.example/v1',
          endpoints: {
            'openai-embeddings': 'https://vectors.example/v1',
            'jina-rerank': 'https://rank.example/v1',
          },
          models: {
            embed: { api: 'openai-completions', modelType: 'embedding', tools: false },
            rank: { api: 'openai-completions', modelType: 'rerank' },
          },
        },
      },
    },
  })

test('嵌入与重排走独立端点，向量按输入索引恢复并校验响应', async () => {
  const models = service()
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    expect(init?.redirect).toBe('error')
    if (String(url).startsWith('https://vectors.example')) {
      expect(body.input).toEqual(['first', 'second'])
      return Response.json({
        data: [
          { index: 1, embedding: [3, 4] },
          { index: 0, embedding: [1, 2] },
        ],
        usage: { prompt_tokens: 2 },
      })
    }
    expect(body.top_n).toBe(1)
    return Response.json({ results: [{ index: 1, relevance_score: 0.95 }] })
  }) as NonNullable<ModelOperationOptions['fetch']>
  expect(await models.embed(ref('embed'), ['first', 'second'], 2, { fetch: fetcher })).toEqual({
    vectors: [
      [1, 2],
      [3, 4],
    ],
    inputTokens: 2,
  })
  expect(
    await models.rerank(ref('rank'), 'query', ['first', 'second'], 1, { fetch: fetcher }),
  ).toEqual({ results: [{ index: 1, score: 0.95 }], inputTokens: 0 })
  await expect(models.embed(ref('rank'), ['wrong'], undefined, { fetch: fetcher })).rejects.toThrow(
    '类型',
  )
  await expect(
    models.embed(ref('embed'), ['first'], undefined, {
      fetch: (async () =>
        Response.json({ data: [{ index: 0, embedding: ['bad'] }] })) as NonNullable<
        ModelOperationOptions['fetch']
      >,
    }),
  ).rejects.toThrow('格式')
  models.dispose()
})

test('用户添加的内置端点可保存，默认端点仍需显式声明地址', () => {
  const saved = serializePiProviderDefinition({
    kind: 'builtin',
    id: 'google',
    enabled: true,
    allowModels: [],
    denyModels: [],
    models: [],
    protocol: 'anthropic-messages',
    endpoints: {
      'anthropic-messages': 'https://relay.example/anthropic',
      'openai-embeddings': 'https://relay.example/v1',
    },
  })
  expect(parsePiProviderCatalog({ providers: { google: saved.value } }).issues).toEqual([])
  expect(() =>
    serializePiProviderDefinition({
      kind: 'builtin',
      id: 'google',
      enabled: true,
      allowModels: [],
      denyModels: [],
      models: [],
      protocol: 'anthropic-messages',
    }),
  ).toThrow()
})

test('媒体请求映射为真实协议部件；不支持协议拒绝，不能静默丢弃媒体', () => {
  const model = {
    api: 'google-generative-ai',
    input: ['text', 'audio', 'video'],
  } as unknown as PiModel<Api>
  const request = prepareMediaInput(model, {
    messages: [
      {
        role: 'user',
        content: 'describe',
        timestamp: 1,
        media: [{ kind: 'video', mimeType: 'video/mp4', data: 'Zml4dHVyZQ==' }],
      } as any,
    ],
  })
  const content = request.context.messages[0]!.content as Array<{ text: string }>
  expect(request.applyPayload({ contents: [{ role: 'user', parts: content }] })).toEqual({
    contents: [
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'describe' },
          { inlineData: { mimeType: 'video/mp4', data: 'Zml4dHVyZQ==' } },
        ],
      },
    ],
  })
  expect(() => request.applyPayload({})).toThrow('未能映射')
  const signal = new AbortController().signal
  expect(
    (request.applyPayload({ contents: [{ parts: content }], signal }) as { signal: AbortSignal })
      .signal,
  ).toBe(signal)
  expect(() =>
    prepareMediaInput(
      { ...model, api: 'anthropic-messages' },
      {
        messages: [
          {
            role: 'user',
            content: '',
            timestamp: 1,
            media: [{ kind: 'audio', mimeType: 'audio/wav', data: '' }],
          } as any,
        ],
      },
    ),
  ).toThrow('协议不支持')
})

test('音视频上传校验文件头，不把任意二进制作为媒体保存', () => {
  const wav = new TextEncoder().encode('RIFF1234WAVEfixture')
  expect(
    prepareAttachmentUpload({ kind: 'audio', name: 'clip.wav', mimeType: 'audio/wav', data: wav })
      .data,
  ).toEqual(wav)
  expect(() =>
    prepareAttachmentUpload({
      kind: 'audio',
      name: 'clip.wav',
      mimeType: 'audio/wav',
      data: new Uint8Array([1, 2, 3]),
    }),
  ).toThrow('MIME')
  expect(() =>
    prepareAttachmentUpload({
      kind: 'video',
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      data: 'base64',
    }),
  ).toThrow('二进制')
})

test('原生 Gemini SDK 的最终 payload hook 包含视频数据，无需修改 SDK', async () => {
  const models = new PiModelService(repository)
  const native = models.pi
    .getProvider('google')!
    .getModels()
    .find((model) => model.api === 'google-generative-ai')!
  const model = { ...native, input: [...native.input, 'video'] as typeof native.input }
  const prepared = prepareMediaInput(model, {
    messages: [
      {
        role: 'user',
        content: 'describe',
        timestamp: 1,
        media: [{ kind: 'video', mimeType: 'video/mp4', data: 'Zml4dHVyZQ==' }],
      } as any,
    ],
  })
  let sent: unknown
  await models.pi.completeSimple(model, prepared.context, {
    apiKey: 'fixture-key',
    maxRetries: 0,
    onPayload: (payload) => {
      sent = prepared.applyPayload(payload)
      throw new Error('Stop before network')
    },
  })
  expect(JSON.stringify(sent)).toContain('inlineData')
  expect(JSON.stringify(sent)).toContain('video/mp4')
  expect(JSON.stringify(sent)).not.toContain('pidex-media:')
  models.dispose()
})


test('非聊天模型的健康测试走嵌入和重排接口', async () => {
  const calls: string[] = []
  const models = {
    getPiModel: async (model: Model.Ref) => ({ modelType: model.id === 'embed' ? 'embedding' : 'rerank' }),
    embed: async () => { calls.push('embed'); return { vectors: [[1]], inputTokens: 1 } },
    rerank: async () => { calls.push('rerank'); return { results: [{ index: 0, score: 1 }], inputTokens: 1 } },
    pi: { completeSimple: () => { throw new Error('Must not send a chat request') } },
  } as unknown as PiModelService
  const health = new ModelHealthService(models, async () => {})
  expect((await health.probe(ref('embed'))).ok).toBe(true)
  expect((await health.probe(ref('rank'))).ok).toBe(true)
  expect(calls).toEqual(['embed', 'rerank'])
  await health.dispose()
})

test('自定义 Gemini 的音视频与工具开关进入目录，非聊天模型不会伪装成聊天能力', async () => {
  const models = new PiModelService(repository, { config: { providers: { relay: {
    kind: 'custom', auth: 'none', base_url: 'https://generativelanguage.googleapis.com/v1beta',
    models: { chat: { api: 'google-generative-ai', input: ['text', 'audio', 'video'], tools: false, max_input_tokens: 12345 },
      embed: { api: 'openai-completions', modelType: 'embedding' } },
  } } } })
  const catalog = await models.models()
  expect(catalog.find((model) => model.id === 'chat')).toMatchObject({ capabilities: { tools: false, input: ['text', 'audio', 'video'] }, limit: { input: 12345 } })
  expect(catalog.find((model) => model.id === 'embed')).toMatchObject({ modelType: 'embedding', capabilities: { tools: false, output: ['embedding'] }, variants: [] })
  models.dispose()
})
