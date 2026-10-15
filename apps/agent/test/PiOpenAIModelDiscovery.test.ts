import { expect, test } from 'bun:test'
import { createModels, createProvider, type ModelsStoreEntry } from '@earendil-works/pi-ai'
import { Effect } from 'effect'
import type { ProviderCredentialRepository } from '../src/auth/ProviderCredentialRepository'
import { createPiDeepSeekProvider } from '../src/provider/pi/PiDeepSeekProvider'
import { PiModelService } from '../src/provider/pi/PiModelService'
import { piProviderApiStreams } from '../src/provider/pi/PiProviderApis'
import { withPiOpenAIModelDiscovery } from '../src/provider/pi/PiOpenAIModelDiscovery'

test('static OpenAI catalogs discover remote models, preserve metadata and cache, and skip disabled providers', async () => {
  let requests = 0
  let fail = false
  let enabled = true
  let baseUrl: string | undefined
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      requests++
      expect(new URL(request.url).pathname).toBe(baseUrl ? '/override/models' : '/v1/models')
      expect(request.headers.get('authorization')).toBe('Bearer fixture-key')
      return fail
        ? new Response('unavailable', { status: 503 })
        : Response.json({ data: [{ id: 'known' }, { id: 'remote-only' }] })
    },
  })
  const values = new Map<string, ModelsStoreEntry>()
  const modelsStore = {
    read: async (id: string) => values.get(id),
    write: async (id: string, value: ModelsStoreEntry) => {
      values.set(id, value)
    },
    delete: async (id: string) => {
      values.delete(id)
    },
  }
  const provider = () =>
    createProvider({
      id: 'nvidia',
      name: 'NVIDIA',
      baseUrl: `${server.url}v1`,
      auth: {
        apiKey: { name: 'fixture', resolve: async () => ({ auth: { apiKey: 'fixture-key' } }) },
      },
      models: [
        {
          id: 'known',
          name: 'Known model',
          provider: 'nvidia',
          baseUrl: `${server.url}v1`,
          api: 'openai-completions',
          contextWindow: 131072,
          maxTokens: 65536,
          reasoning: true,
          input: ['text', 'image'],
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
      ],
      api: piProviderApiStreams['openai-completions'](),
    })
  const repository = {
    list: () => [],
    get: () => Effect.succeed(null),
  } as unknown as ProviderCredentialRepository
  const runtime = () => {
    const models = createModels({ modelsStore })
    models.setProvider(provider())
    return new PiModelService(repository, {
      models,
      config: () => ({
        schemaVersion: 2,
        providers: {
          nvidia: { kind: 'builtin', enabled, ...(baseUrl ? { base_url: baseUrl } : {}) },
        },
      }),
    })
  }
  const service = runtime()
  const restored = runtime()
  const protocolOverride = createPiDeepSeekProvider(
    service.pi.getProvider('nvidia')!,
    'openai-responses',
  )
  try {
    await service.refresh(true)
    expect((await service.models()).map((model) => String(model.id))).toContain('remote-only')
    expect(service.pi.getModel('nvidia', 'known')).toMatchObject({
      name: 'Known model',
      contextWindow: 131072,
      maxTokens: 65536,
      reasoning: true,
    })
    expect(protocolOverride.getModels().find((model) => model.id === 'remote-only')?.api).toBe(
      'openai-responses',
    )
    expect(requests).toBe(1)
    expect(JSON.stringify([...values.values()])).not.toContain('fixture-key')
    await restored.reload()
    expect(restored.pi.getModel('nvidia', 'remote-only')).toBeDefined()
    expect(requests).toBe(1)
    fail = true
    await expect(service.refresh(true)).rejects.toMatchObject({ code: 'CATALOG_REFRESH_FAILED' })
    expect(service.pi.getModel('nvidia', 'remote-only')).toBeDefined()
    expect(requests).toBe(2)
    fail = false
    enabled = true
    baseUrl = `${server.url}override`
    await service.refresh(true)
    expect(service.pi.getModel('nvidia', 'remote-only')?.baseUrl).toBe(baseUrl)
    expect(requests).toBe(3)
    enabled = false
    await service.refresh(true)
    expect(requests).toBe(3)
    const native = { ...provider(), refreshModels: async () => {} }
    expect(withPiOpenAIModelDiscovery(native, async () => undefined)).toBe(native)
  } finally {
    server.stop(true)
    await service.dispose()
    await restored.dispose()
  }
})
