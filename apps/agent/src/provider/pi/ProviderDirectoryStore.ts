import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import agentPackage from '../../../package.json'
import { AgentError } from '../../Domain'
import { ModelRecommendationIndex } from './ModelRecommendations'
import { downloadCatalogJson } from './ModelRecommendationStore'
import {
  CUSTOM_PROVIDER_APIS,
  parsePiProviderCatalog,
  validateCustomProviderBaseUrl,
  type CustomProviderApi,
  type PiCustomProviderConfig,
} from './PiProviderConfig'

export type DirectoryProvider = {
  id: string
  name: string
  origin: 'pi-remote' | 'models-dev'
  baseUrl?: string
  api?: CustomProviderApi
  env: string[]
  models: Record<string, Record<string, unknown>>
  endpoints?: Partial<Record<CustomProviderApi, string>>
  modelBaseUrls?: Record<string, string>
}
type Snapshot = {
  owner: 'pidex-provider-directory'
  formatVersion: 1
  pi: unknown
  modelsDev: unknown
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid directory')
  return value as Record<string, unknown>
}
const supported = (api: unknown): api is CustomProviderApi =>
  typeof api === 'string' && (CUSTOM_PROVIDER_APIS as readonly string[]).includes(api)
const sdkApis: Record<string, CustomProviderApi> = {
  '@ai-sdk/openai': 'openai-completions',
  '@ai-sdk/openai-compatible': 'openai-completions',
  '@ai-sdk/anthropic': 'anthropic-messages',
  '@ai-sdk/google': 'google-generative-ai',
}
const invalidDirectory = (source: string) =>
  new AgentError('PROVIDER_UNAVAILABLE', `${source} 目录格式无效，已保留原目录。`, 502)
const address = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    return validateCustomProviderBaseUrl(value, false)
  } catch {
    return undefined
  }
}
const positiveLimit = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback

export const directoryBaseUrlKey = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
      return undefined
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}${url.search}`
  } catch {
    return undefined
  }
}

export const directoryProviderConfig = (
  entry: DirectoryProvider,
): PiCustomProviderConfig | undefined => {
  if (!entry.api || !entry.baseUrl) return undefined
  const parsed = parsePiProviderCatalog({
    schemaVersion: 2,
    providers: {
      'pidex-directory-default': {
        kind: 'custom',
        name: entry.name,
        base_url: entry.baseUrl,
        env: entry.env,
        auth: 'api-key',
        models: entry.models,
        endpoints: { [entry.api]: entry.baseUrl, ...entry.endpoints },
      },
    },
  })
  const config = parsed.providers['pidex-directory-default']
  if (parsed.issues.length || config?.kind !== 'custom')
    throw new Error(
      `Invalid directory provider configuration: ${entry.id}: ${parsed.issues.map((issue) => issue.path).join(', ')}`,
    )
  return config
}

export const parseProviderDirectory = (snapshot: Snapshot): DirectoryProvider[] => {
  if (snapshot.owner !== 'pidex-provider-directory' || snapshot.formatVersion !== 1)
    throw new Error('Unsupported directory cache')
  const providers = new Map<string, DirectoryProvider>()
  try {
    new ModelRecommendationIndex(snapshot.modelsDev)
    const devProviders = record(record(snapshot.modelsDev).providers)
    for (const [id, input] of Object.entries(devProviders)) {
      const raw = record(input)
      const api = typeof raw.npm === 'string' ? sdkApis[raw.npm] : undefined
      const baseUrl = address(raw.api)
      const models: DirectoryProvider['models'] = {}
      for (const [modelID, inputModel] of Object.entries(record(raw.models))) {
        const model = record(inputModel)
        if ((model.type !== undefined && model.type !== 'chat') || !api) continue
        const limit = model.limit === undefined ? {} : record(model.limit)
        const modalities = model.modalities === undefined ? {} : record(model.modalities)
        if (Array.isArray(modalities.output) && !modalities.output.includes('text')) continue
        models[modelID] = {
          api,
          name: typeof model.name === 'string' ? model.name : modelID,
          contextWindow: positiveLimit(limit.context, 32768),
          maxTokens: positiveLimit(limit.output, 8192),
          reasoning: model.reasoning === true,
          input: Array.isArray(modalities.input)
            ? modalities.input.filter((v) =>
                ['text', 'image', 'audio', 'video'].includes(String(v)),
              )
            : ['text'],
          ...(typeof model.tool_call === 'boolean' ? { tools: model.tool_call } : {}),
        }
      }
      providers.set(id, {
        id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : id,
        origin: 'models-dev',
        ...(baseUrl ? { baseUrl } : {}),
        ...(api ? { api } : {}),
        env: Array.isArray(raw.env)
          ? raw.env.filter(
              (v): v is string => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v),
            )
          : [],
        models,
      })
    }
  } catch {
    throw invalidDirectory('models.dev')
  }
  try {
    const pi = record(snapshot.pi)
    if (!Object.keys(pi).length || !providers.size) throw new Error('Empty directory')
    for (const [id, input] of Object.entries(pi)) {
      const models: DirectoryProvider['models'] = {}
      const endpoints: Partial<Record<CustomProviderApi, string>> = {}
      const modelBaseUrls: Record<string, string> = {}
      let baseUrl: string | undefined
      let api: CustomProviderApi | undefined
      for (const [modelID, inputModel] of Object.entries(record(input))) {
        const model = record(inputModel)
        if (
          typeof model.id !== 'string' ||
          typeof model.api !== 'string' ||
          typeof model.baseUrl !== 'string'
        )
          throw new Error('Invalid Pi model')
        baseUrl ??= address(model.baseUrl)
        if (!supported(model.api)) continue
        if (!api) {
          api = model.api
          baseUrl = address(model.baseUrl) ?? baseUrl
        }
        const modelBaseUrl = address(model.baseUrl)
        if (modelBaseUrl) {
          endpoints[model.api] ??= modelBaseUrl
          modelBaseUrls[modelID] = modelBaseUrl
        }
        models[modelID] = {
          api: model.api,
          name: model.name,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          reasoning: model.reasoning,
          input: model.input,
          ...(model.cost ? { cost: model.cost } : {}),
          ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
          ...(model.compat ? { compat: model.compat } : {}),
        }
      }
      const previous = providers.get(id)
      const resolvedBaseUrl = baseUrl ?? previous?.baseUrl
      const resolvedApi = api ?? previous?.api
      providers.set(id, {
        id,
        name: previous?.name ?? id,
        origin: 'pi-remote',
        ...(resolvedBaseUrl ? { baseUrl: resolvedBaseUrl } : {}),
        ...(resolvedApi ? { api: resolvedApi } : {}),
        env: previous?.env ?? [],
        models: { ...previous?.models, ...models },
        endpoints,
        modelBaseUrls,
      })
    }
  } catch {
    throw invalidDirectory('Pi')
  }
  const entries = [...providers.values()]
  for (const entry of entries) {
    try {
      directoryProviderConfig(entry)
    } catch {
      throw invalidDirectory(entry.origin === 'pi-remote' ? 'Pi' : 'models.dev')
    }
  }
  return entries
}

export class ProviderDirectoryStore {
  private entries: readonly DirectoryProvider[] = []
  private loaded = false
  private operation: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly path?: string,
    private readonly request: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response> = fetch,
  ) {}

  async providers(): Promise<readonly DirectoryProvider[]> {
    await this.load()
    return this.entries
  }

  private async load(force = false): Promise<void> {
    if (!this.loaded || force) {
      if (this.path) {
        try {
          this.entries = parseProviderDirectory(JSON.parse(await readFile(this.path, 'utf8')))
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
            throw error
        }
      }
      this.loaded = true
    }
  }

  refresh(): Promise<void> {
    const action = async () => {
      await this.load(true)
      const download = async (source: 'Pi' | 'models.dev', url: string) => {
        try {
          return await downloadCatalogJson(this.request, url)
        } catch {
          throw new AgentError(
            'PROVIDER_UNAVAILABLE',
            `${source} 官方目录下载失败，已保留原目录，请稍后重试。`,
            502,
          )
        }
      }
      const [pi, modelsDev] = await Promise.allSettled([
        download(
          'Pi',
          `https://pi.dev/api/models?pi-version=${encodeURIComponent(agentPackage.dependencies['@earendil-works/pi-ai'])}`,
        ),
        download('models.dev', 'https://models.dev/catalog.json?type=all'),
      ])
      if (pi.status === 'rejected') throw pi.reason
      if (modelsDev.status === 'rejected') throw modelsDev.reason
      const snapshot: Snapshot = {
        owner: 'pidex-provider-directory',
        formatVersion: 1,
        pi: pi.value,
        modelsDev: modelsDev.value,
      }
      let entries: DirectoryProvider[]
      try {
        entries = parseProviderDirectory(snapshot)
      } catch (cause) {
        if (cause instanceof AgentError) throw cause
        throw invalidDirectory('Pi / models.dev')
      }
      if (this.path) {
        await mkdir(dirname(this.path), { recursive: true })
        const temporary = `${this.path}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, JSON.stringify(snapshot), 'utf8')
          await rename(temporary, this.path)
        } finally {
          await rm(temporary, { force: true })
        }
      }
      this.entries = entries
    }
    const next = this.operation.then(action, action)
    this.operation = next.catch(() => undefined)
    return next
  }
}
