import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ProviderDirectoryStore,
  directoryBaseUrlKey,
  parseProviderDirectory,
} from '../src/provider/pi/ProviderDirectoryStore'

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
const modelsDev = {
  models: { m: { name: 'Common model' } },
  providers: {
    vendor: {
      name: 'Vendor',
      api: 'https://fallback.example/v1',
      npm: '@ai-sdk/openai-compatible',
      env: ['VENDOR_API_KEY'],
      models: { m: { name: 'Dev model', limit: { context: 0, output: 0 } } },
    },
  },
}

test('directory URL identity normalizes only URL syntax and trailing slashes', () => {
  expect(directoryBaseUrlKey('https://EXAMPLE.com:443/v1///')).toBe(
    directoryBaseUrlKey('https://example.com/v1'),
  )
  for (const url of [
    'http://example.com/v1',
    'https://example.com/v2',
    'https://example.com:8443/v1',
    'https://example.com/v1?region=cn',
    'https://example.com/coding/v1',
  ]) {
    expect(directoryBaseUrlKey(url)).not.toBe(directoryBaseUrlKey('https://example.com/v1'))
  }
  expect(directoryBaseUrlKey(undefined)).toBeUndefined()
  expect(directoryBaseUrlKey('invalid')).toBeUndefined()
})

test('Pi definitions take priority while models.dev fills provider metadata and unknown limits', () => {
  const entries = parseProviderDirectory({
    owner: 'pidex-provider-directory',
    formatVersion: 1,
    pi,
    modelsDev,
  })
  expect(entries[0]).toMatchObject({
    id: 'vendor',
    name: 'Vendor',
    api: 'openai-responses',
    origin: 'pi-remote',
    baseUrl: 'https://vendor.example/v1',
    env: ['VENDOR_API_KEY'],
    models: { m: { name: 'Pi model', contextWindow: 65536 } },
  })
})

test('dual-source refresh commits atomically, restores offline and refuses foreign caches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-directory-'))
  const path = join(root, 'directory.json')
  const requests: string[] = []
  let failure = ''
  const store = new ProviderDirectoryStore(path, async (url, init) => {
    const source = new URL(String(url)).hostname === 'pi.dev' ? 'Pi' : 'models.dev'
    requests.push(String(url))
    expect(init?.headers).toBeUndefined()
    expect(init?.redirect).toBe('error')
    if (source === failure) return new Response(null, { status: 503 })
    return Response.json(source === 'Pi' ? pi : modelsDev)
  })
  try {
    await store.refresh()
    expect(requests).toHaveLength(2)
    expect(requests).toContain('https://pi.dev/api/models?pi-version=0.99.2')
    const before = await readFile(path, 'utf8')
    const entries = await store.providers()
    expect(await new ProviderDirectoryStore(path).providers()).toEqual(entries)
    for (const source of ['Pi', 'models.dev']) {
      failure = source
      await expect(store.refresh()).rejects.toThrow(source)
      expect(await store.providers()).toEqual(entries)
      expect(await readFile(path, 'utf8')).toBe(before)
    }
    await writeFile(path, '{"owner":"someone-else","formatVersion":1}', 'utf8')
    await expect(store.refresh()).rejects.toThrow('Unsupported directory cache')
    await expect(new ProviderDirectoryStore(path).refresh()).rejects.toThrow(
      'Unsupported directory cache',
    )
    expect(await readFile(path, 'utf8')).toBe('{"owner":"someone-else","formatVersion":1}')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
