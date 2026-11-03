import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProviderDirectoryStore } from '../src/provider/pi/ProviderDirectoryStore'
import { ModelRecommendationStore } from '../src/provider/pi/ModelRecommendationStore'

const response = (body: unknown) => async () => Response.json(body)

const commonModel = (overrides: Record<string, unknown> = {}) => ({
  name: 'Common model',
  limit: { context: 128000, input: 120000, output: 8000 },
  reasoning: true,
  tool_call: true,
  modalities: { input: ['text', 'image'], output: ['text'] },
  reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
  description: 'noise description',
  family: 'noise-family',
  release_date: '2020-01-01',
  ...overrides,
})

const catalogPayload = () => ({
  models: { 'maker/example': commonModel() },
  providers: {
    vendor: {
      name: 'Vendor',
      api: 'https://vendor.example/v1',
      npm: '@ai-sdk/openai-compatible',
      env: ['VENDOR_API_KEY'],
      models: {
        example: commonModel({
          name: 'Provider model',
          canonical_model_id: 'maker/example',
          provider: 'vendor',
          description: 'noise provider description',
          cost: { input: 2, output: 3, cache_read: 0.5, cache_write: 1 },
        }),
      },
    },
  },
})

const pi = {
  vendor: {
    m: {
      id: 'm',
      name: 'Pi model',
      api: 'openai-responses',
      baseUrl: 'https://vendor.example/v1',
      contextWindow: 65536,
      maxTokens: 4096,
      reasoning: false,
      input: ['text'],
    },
  },
}

test('旧两份缓存迁移到共享文件：目录与推荐共用一份，旧文件保持原样', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-shared-migrate-'))
  const directoryPath = join(directory, 'provider-directory.json')
  const recommendationPath = join(directory, 'model-recommendations.json')
  const sharedPath = join(directory, 'shared-model-catalog.json')
  try {
    const legacyDirectory = JSON.stringify({
      owner: 'pidex-provider-directory',
      formatVersion: 1,
      pi,
      modelsDev: catalogPayload(),
    })
    const legacyRecommendation = JSON.stringify({
      owner: 'pidex',
      formatVersion: 1,
      updatedAt: 123,
      catalog: catalogPayload(),
    })
    await writeFile(directoryPath, legacyDirectory, 'utf8')
    await writeFile(recommendationPath, legacyRecommendation, 'utf8')

    const directoryStore = new ProviderDirectoryStore(directoryPath)
    const recommendations = new ModelRecommendationStore(recommendationPath)
    // 目录先加载，内部迁移并写出共享缓存；推荐共用同一份内存/文件。
    expect((await directoryStore.providers()).some((entry) => entry.id === 'vendor')).toBe(true)
    expect(await readFile(sharedPath, 'utf8')).toContain('"owner":"pidex-model-catalog"')
    const resolved = (
      await recommendations.resolve({
        providerId: 'relay',
        baseUrl: 'https://vendor.example/v1',
        modelId: 'example',
        modelType: 'chat',
      })
    ).recommended
    expect(resolved).toMatchObject({ contextWindow: 128000, cost: { input: 2, output: 3 } })
    // 旧 updatedAt 迁移保留，fingerprint 不抖动。
    expect(await recommendations.version()).toBe(123)
    expect(await readFile(directoryPath, 'utf8')).toBe(legacyDirectory)
    expect(await readFile(recommendationPath, 'utf8')).toBe(legacyRecommendation)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('写入前裁剪：只保存消费字段，供应商层仅存差异且可完整重建', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-shared-trim-'))
  const path = join(directory, 'provider-directory.json')
  const sharedPath = join(directory, 'shared-model-catalog.json')
  try {
    const store = new ProviderDirectoryStore(path, async (url) =>
      Response.json(String(url).startsWith('https://pi.dev/') ? pi : catalogPayload()),
    )
    await store.refresh()
    const persisted = await readFile(sharedPath, 'utf8')
    // 噪音字段不落盘。
    for (const noise of ['noise description', 'noise-family', 'release_date', 'family'])
      expect(persisted).not.toContain(noise)
    const document = JSON.parse(persisted)
    expect(document.models['maker/example']).toMatchObject({
      name: 'Common model',
      limit: { context: 128000, input: 120000, output: 8000 },
      reasoning: true,
      tool_call: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
      reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
    })
    // 供应商层只存相对公共事实的差异 + 显式存在且相同的字段名。
    const delta = document.providers.vendor.models.example
    expect(delta.ref).toBe('maker/example')
    expect(delta.inherited).toEqual(expect.arrayContaining(['limit', 'modalities', 'reasoning']))
    expect(delta.diff).toMatchObject({
      name: 'Provider model',
      canonical_model_id: 'maker/example',
      cost: { input: 2, output: 3, cache_read: 0.5, cache_write: 1 },
    })
    // 重建后的目录与推荐都拿到完整字段。
    const entries = await store.providers()
    expect(entries.find((entry) => entry.id === 'vendor')?.models.m).toMatchObject({
      contextWindow: 65536,
    })
    const restarted = new ModelRecommendationStore(join(directory, 'model-recommendations.json'))
    const recommended = (
      await restarted.resolve({
        providerId: 'relay',
        baseUrl: 'https://vendor.example/v1',
        modelId: 'example',
        modelType: 'chat',
      })
    ).recommended
    expect(recommended).toMatchObject({
      contextWindow: 128000,
      maxInputTokens: 120000,
      maxTokens: 8000,
      reasoning: true,
      tools: true,
      cost: { input: 2, output: 3 },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('刷新失败保留最近一次完整缓存，不写部分结果', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-shared-failure-'))
  const path = join(directory, 'provider-directory.json')
  const sharedPath = join(directory, 'shared-model-catalog.json')
  let failure = ''
  const store = new ProviderDirectoryStore(path, async (url) => {
    const source = String(url).startsWith('https://pi.dev/') ? 'Pi' : 'models.dev'
    if (source === failure) return new Response(null, { status: 503 })
    return Response.json(source === 'Pi' ? pi : catalogPayload())
  })
  try {
    await store.refresh()
    const directoryBefore = await readFile(path, 'utf8')
    const sharedBefore = await readFile(sharedPath, 'utf8')
    const entries = await store.providers()
    for (const source of ['Pi', 'models.dev']) {
      failure = source
      await expect(store.refresh()).rejects.toThrow(source)
      expect(await readFile(path, 'utf8')).toBe(directoryBefore)
      expect(await readFile(sharedPath, 'utf8')).toBe(sharedBefore)
      expect(await store.providers()).toEqual(entries)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('别名歧义在迁移后仍不合并', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-shared-ambiguous-'))
  const path = join(directory, 'model-recommendations.json')
  try {
    await writeFile(
      path,
      JSON.stringify({
        owner: 'pidex',
        formatVersion: 1,
        updatedAt: 7,
        catalog: {
          models: {
            'a/example': { name: 'A', limit: { context: 32000, output: 1000 } },
            'b/example': { name: 'B', limit: { context: 64000, output: 2000 } },
          },
          providers: {},
        },
      }),
      'utf8',
    )
    const store = new ModelRecommendationStore(path)
    expect(
      (await store.resolve({ providerId: 'relay', modelId: 'example', modelType: 'chat' })).status,
    ).toBe('ambiguous')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
