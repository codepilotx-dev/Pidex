import { describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fixture from './fixtures/models-dev-catalog.json'
import { ModelRecommendationIndex, applyRecommendation } from '../src/provider/pi/ModelRecommendations'
import { ModelRecommendationStore } from '../src/provider/pi/ModelRecommendationStore'

const row = (context: number, extra = {}) => ({
  name: 'Example',
  limit: { context, input: context - 1000, output: 4000 },
  reasoning: true,
  tool_call: false,
  modalities: { input: ['text', 'image'] },
  reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
  ...extra,
})
const catalog = (context = 128000) => ({
  models: { 'maker/example': row(context) },
  providers: {
    vendor: {
      api: 'https://vendor.example/v1',
      models: {
        example: row(context, {
          canonical_model_id: 'maker/example',
          cost: { input: 2, output: 3 },
        }),
      },
    },
  },
})
const input = { providerId: 'relay', modelId: 'example', modelType: 'chat' as const }
const response = (body: unknown) => async () => Response.json(body)

describe('models.dev recommendations', () => {
  test('启动更新一次，每五分钟刷新，重复启动不重复定时，退出清理定时器', () => {
    const store = new ModelRecommendationStore()
    const refresh = spyOn(store, 'refresh').mockResolvedValue({ updatedAt: 1 })
    const interval = spyOn(globalThis, 'setInterval')
    const clear = spyOn(globalThis, 'clearInterval')
    try {
      store.startAutoRefresh()
      store.startAutoRefresh()
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(interval).toHaveBeenCalledTimes(1)
      expect(interval.mock.calls[0]![1]).toBe(300000)
      const tick = interval.mock.calls[0]![0] as () => void
      tick()
      expect(refresh).toHaveBeenCalledTimes(2)
      store.dispose()
      expect(clear).toHaveBeenCalledTimes(1)
    } finally {
      store.dispose()
      refresh.mockRestore()
      interval.mockRestore()
      clear.mockRestore()
    }
  })

  test('真实组合接口 fixture：聊天、embedding、reranking 独立映射', () => {
    const index = new ModelRecommendationIndex(fixture)
    expect(index.resolve({ ...input, modelId: 'tencent/hy3' }).recommended).toMatchObject({
      contextWindow: 256000,
      maxInputTokens: 192000,
      maxTokens: 128000,
    })
    const embedding = index.resolve({ ...input, modelId: 'baai/bge-m3', modelType: 'embedding' })
    expect(embedding.status).toBe('matched')
    expect(embedding.recommended.contextWindow).toBe(8192)
    expect(embedding.recommended.maxTokens).toBeUndefined()
    expect(
      index.resolve({ ...input, modelId: 'baai/bge-reranker-v2-m3', modelType: 'rerank' }).status,
    ).toBe('matched')
    expect(index.resolve({ ...input, modelId: 'baai/bge-m3' }).status).toBe('unmatched')
  })

  test('canonical、前缀、大小写、显式别名和推理后缀；不改真实 ID，不进行模糊匹配', () => {
    const payload = catalog()
    Object.assign(payload.models['maker/example'], { aliases: ['old-example'] })
    Object.assign(payload.providers, { official: { models: { example: row(128000) } } })
    const index = new ModelRecommendationIndex(payload)
    for (const modelId of [
      'maker/example',
      'example',
      'proxy/EXAMPLE',
      'example(high)',
      'old-example',
    ])
      expect(index.resolve({ ...input, modelId }).status).toBe('matched')
    for (const modelId of ['example-preview', 'example(random)', 'ample'])
      expect(index.resolve({ ...input, modelId }).status).toBe('unmatched')
    expect(input.modelId).toBe('example')
  })

  test('剥离日期、网关标记与量化后缀后仍精确命中；相似但不同的名字不猜', () => {
    const index = new ModelRecommendationIndex({
      models: {
        'anthropic/claude-sonnet-4-5': row(200000),
        'openai/gpt-4o': row(128000),
        'meta-llama/llama-3.3-70b-instruct': row(131072),
        'qwen/qwen2.5-7b-instruct': row(32768),
      },
      providers: {},
    })
    for (const modelId of [
      'claude-sonnet-4-5-20250929',
      'gpt-4o-2024-08-06',
      'meta-llama/llama-3.3-70b-instruct:free',
      'qwen2.5-7b-instruct-q4_k_m',
    ])
      expect(index.resolve({ ...input, modelId }).status).toBe('matched')
    // 相似但确实是另一个模型的名字不能被当成同一个。
    for (const modelId of ['claude-sonnet-4', 'gpt-4o-mini', 'qwen2.5-14b-instruct'])
      expect(index.resolve({ ...input, modelId }).status).toBe('unmatched')
  })

  test('推荐值只覆盖未固定字段，固定字段保留保存值', () => {
    const model = {
      name: '自定义名字',
      contextWindow: 8_192,
      maxTokens: 4_096,
      reasoning: false,
      tools: true,
      input: ['text' as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }
    const recommended = {
      name: '推荐名字',
      contextWindow: 200_000,
      maxTokens: 64_000,
      reasoning: true,
      tools: false,
      input: ['text' as const, 'image' as const],
      cost: { input: 3, output: 15 },
    }
    const merged = applyRecommendation(model, recommended, [])
    expect(merged).toMatchObject({
      name: '推荐名字',
      contextWindow: 200_000,
      maxTokens: 64_000,
      reasoning: true,
      tools: false,
      input: ['text', 'image'],
      cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    })
    const pinned = applyRecommendation(model, recommended, ['contextWindow', 'imageInput'])
    expect(pinned.contextWindow).toBe(8_192)
    expect(pinned.maxTokens).toBe(64_000)
    expect(pinned.input).toEqual(['text'])
  })

  test('没有推荐时原样返回', () => {
    const model = {
      name: 'x',
      contextWindow: 1,
      maxTokens: 1,
      reasoning: false,
      tools: true,
      input: [] as ('text' | 'image' | 'audio' | 'video')[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }
    expect(applyRecommendation(model, undefined)).toBe(model)
    expect(applyRecommendation(model, {})).toBe(model)
  })

  test('canonical 冲突不猜测，供应商未确认不套价格，地址匹配可叠加差异', () => {
    const payload = catalog()
    const index = new ModelRecommendationIndex(payload)
    expect(index.resolve(input).recommended.cost).toBeUndefined()
    expect(
      index.resolve({ ...input, baseUrl: 'https://vendor.example/v1/' }).recommended.cost,
    ).toEqual({ input: 2, output: 3 })
    Object.assign(payload.models, { 'other/example': row(64000) })
    expect(
      new ModelRecommendationIndex(payload).resolve({ ...input, modelId: 'proxy/example' }).status,
    ).toBe('ambiguous')
  })

  test('缺少通用值采用多数值、数值平票取小值，能力平票保持未知', () => {
    const payload = {
      models: {},
      providers: {
        a: { models: { example: row(128000) } },
        b: { models: { example: row(64000, { tool_call: true }) } },
      },
    }
    const result = new ModelRecommendationIndex(payload).resolve(input).recommended
    expect(result.contextWindow).toBe(64000)
    expect(result.tools).toBeUndefined()
  })

  test('手动刷新写入共享缓存、重启读缓存、失败保留及未知格式拒绝覆盖', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pidex-recommendations-'))
    const path = join(directory, 'recommendations.json')
    const shared = join(directory, 'shared-model-catalog.json')
    try {
      let calls = 0
      const store = new ModelRecommendationStore(path, async () => {
        calls++
        return Response.json(catalog())
      })
      expect((await store.resolve(input)).status).toBe('no-cache')
      expect(calls).toBe(0)
      await store.refresh()
      expect(calls).toBe(1)
      // models.dev 只落到共享缓存，不再单独写第二份推荐文件。
      const before = await readFile(shared, 'utf8')
      expect(before).toContain('"owner":"pidex-model-catalog"')
      await expect(readFile(path, 'utf8')).rejects.toThrow()
      const restarted = new ModelRecommendationStore(path, response({ invalid: true }))
      expect((await restarted.resolve(input)).recommended.contextWindow).toBe(128000)
      await expect(restarted.refresh()).rejects.toThrow()
      expect(await readFile(shared, 'utf8')).toBe(before)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('旧推荐缓存只读兼容，未知 owner 文件原样保留', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pidex-recommendations-legacy-'))
    const path = join(directory, 'model-recommendations.json')
    const shared = join(directory, 'shared-model-catalog.json')
    try {
      const legacy = { owner: 'pidex', formatVersion: 1, updatedAt: 42, catalog: catalog() }
      await writeFile(path, JSON.stringify(legacy), 'utf8')
      const store = new ModelRecommendationStore(path, response(catalog()))
      expect((await store.resolve(input)).recommended.contextWindow).toBe(128000)
      expect(await store.version()).toBe(42)
      expect(await readFile(shared, 'utf8')).toContain('"owner":"pidex-model-catalog"')
      expect(await readFile(path, 'utf8')).toBe(JSON.stringify(legacy))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }

    const fresh = await mkdtemp(join(tmpdir(), 'pidex-recommendations-foreign-'))
    const foreignShared = join(fresh, 'shared-model-catalog.json')
    try {
      await writeFile(foreignShared, '{"owner":"someone-else"}', 'utf8')
      await expect(
        new ModelRecommendationStore(join(fresh, 'model-recommendations.json'), response(catalog())).refresh(),
      ).rejects.toThrow()
      expect(await readFile(foreignShared, 'utf8')).toBe('{"owner":"someone-else"}')
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })
})
