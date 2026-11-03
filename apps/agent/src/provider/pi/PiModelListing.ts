import { AgentError } from '../../Domain'
import { discoverOpenAIModels } from './PiCustomProvider'
import { CUSTOM_PROVIDER_APIS, type CustomProviderApi } from './PiProviderConfig'

/** Chat protocols whose upstream model catalog can be listed. */
export type ListableChatApi = CustomProviderApi
export const LISTABLE_CHAT_APIS = CUSTOM_PROVIDER_APIS

export type ProviderModelFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface ProviderModelListingRequest {
  readonly api: ListableChatApi
  /** Protocol endpoint or provider base URL; a full request URL is accepted. */
  readonly baseUrl: string
  readonly headers?: Readonly<Record<string, string>>
  readonly apiKey?: string
  readonly signal?: AbortSignal
  readonly fetch?: ProviderModelFetch
}

export interface ListedProviderModel {
  readonly id: string
  readonly name: string
}

export interface ProviderModelListing {
  readonly models: readonly ListedProviderModel[]
  readonly fetchedAt: number
}

const MAX_PAGE_BYTES = 1024 * 1024
const REQUEST_TIMEOUT_MS = 12_000
const MAX_PAGES = 10
const MAX_LISTED_MODELS = 1_000

const listingError = (message: string): AgentError =>
  new AgentError('PROVIDER_UNAVAILABLE', message, 502)

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, '')

const endsWithIgnoreCase = (value: string, suffix: string): boolean =>
  value.toLowerCase().endsWith(suffix.toLowerCase())

const stripSuffix = (value: string, suffix: string): string =>
  endsWithIgnoreCase(value, suffix)
    ? trimTrailingSlashes(value.slice(0, value.length - suffix.length))
    : value

/**
 * Resolves the catalog root for one protocol. Users may save either the API
 * root or a full inference URL (`.../chat/completions`, `.../responses`,
 * `.../v1/messages`, `.../models/x:generateContent`); every suffix is removed
 * so the model-list endpoint is appended exactly once.
 */
export const resolveModelListingRoot = (address: string, api: ListableChatApi): string => {
  let root = trimTrailingSlashes(address.trim())
  if (api === 'openai-completions') {
    root = stripSuffix(root, '/chat/completions')
  } else if (api === 'openai-responses') {
    root = stripSuffix(root, '/responses')
  } else if (api === 'anthropic-messages') {
    for (const suffix of ['/v1/messages', '/messages']) {
      if (!endsWithIgnoreCase(root, suffix)) continue
      root = stripSuffix(root, suffix)
      break
    }
  } else {
    root = root.replace(/\/models\/[^/]+:(?:stream)?generateContent$/i, '')
    root = trimTrailingSlashes(root)
  }
  return stripSuffix(root, '/models')
}

const hasHeader = (headers: Readonly<Record<string, string>>, name: string): boolean =>
  Object.keys(headers).some((key) => key.toLowerCase() === name)

const withAuthHeader = (
  headers: Readonly<Record<string, string>>,
  scheme: 'anthropic' | 'google',
  apiKey: string | undefined,
): Record<string, string> => {
  const output: Record<string, string> = { Accept: 'application/json', ...headers }
  if (scheme === 'anthropic') {
    if (!hasHeader(output, 'anthropic-version')) output['anthropic-version'] = '2023-06-01'
    // Anthropic-compatible gateways accept either header; the caller's saved
    // request headers always win over the resolved api-key.
    if (!hasHeader(output, 'authorization') && !hasHeader(output, 'x-api-key') && apiKey) {
      output['x-api-key'] = apiKey
    }
  } else if (
    !hasHeader(output, 'authorization') &&
    !hasHeader(output, 'x-goog-api-key') &&
    apiKey
  ) {
    output['x-goog-api-key'] = apiKey
  }
  return output
}

const combineSignals = (signal: AbortSignal | undefined): AbortSignal => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

const isAbortCause = (cause: unknown): boolean =>
  (cause instanceof DOMException &&
    (cause.name === 'TimeoutError' || cause.name === 'AbortError')) ||
  (cause instanceof Error && cause.name === 'AbortError')

const readJson = async (response: Response): Promise<unknown> => {
  if (!response.ok) throw listingError(`上游模型列表请求失败（HTTP ${response.status}）`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_PAGE_BYTES) {
    throw listingError('上游模型列表响应过大')
  }
  if (!response.body) throw listingError('上游模型列表响应为空')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > MAX_PAGE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw listingError('上游模型列表响应过大')
      }
      chunks.push(next.value)
    }
  } catch (cause) {
    if (cause instanceof AgentError) throw cause
    throw listingError('读取上游模型列表失败')
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw listingError('上游模型列表格式无效')
  }
}

const requestJson = async (
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetchImpl: ProviderModelFetch,
): Promise<unknown> => {
  let response: Response
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal, headers })
  } catch (cause) {
    throw isAbortCause(cause)
      ? listingError('上游模型列表请求超时')
      : listingError('无法连接上游模型列表接口')
  }
  return readJson(response)
}

const endpointUrl = (root: string, suffix: string, query: Record<string, string>): URL => {
  let url: URL
  try {
    url = new URL(root)
  } catch {
    throw listingError('上游模型列表地址无效')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw listingError('上游模型列表地址无效')
  const basePath = trimTrailingSlashes(url.pathname)
  url.pathname = `${basePath}${suffix}`
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
  return url
}

const collect = (models: Map<string, string>, id: unknown, name: unknown): void => {
  if (typeof id !== 'string') return
  const modelID = id.trim()
  if (!modelID) return
  const label = typeof name === 'string' && name.trim() ? name.trim() : modelID
  if (!models.has(modelID)) models.set(modelID, label)
}

const listOpenAIModels = async (
  root: string,
  request: ProviderModelListingRequest,
  signal: AbortSignal,
  fetchImpl: ProviderModelFetch,
): Promise<Map<string, string>> => {
  try {
    const discovered = await discoverOpenAIModels({
      baseUrl: root,
      ...(request.headers ? { headers: request.headers } : {}),
      ...(request.apiKey ? { apiKey: request.apiKey } : {}),
      signal,
      fetch: fetchImpl,
    })
    return new Map(discovered.map((model) => [model.id, model.name]))
  } catch (cause) {
    if (cause instanceof AgentError) throw cause
    if (isAbortCause(cause)) throw listingError('上游模型列表请求超时')
    const message = cause instanceof Error ? cause.message : ''
    const status = /HTTP (\d{3})/.exec(message)?.[1]
    if (status) throw listingError(`上游模型列表请求失败（HTTP ${status}）`)
    if (message.includes('exceeds 1 MiB')) throw listingError('上游模型列表响应过大')
    if (message.includes('no body')) throw listingError('上游模型列表响应为空')
    if (message.includes('invalid')) throw listingError('上游模型列表格式无效')
    throw listingError('无法读取上游模型列表')
  }
}

const listAnthropicModels = async (
  root: string,
  request: ProviderModelListingRequest,
  signal: AbortSignal,
  fetchImpl: ProviderModelFetch,
): Promise<Map<string, string>> => {
  const headers = withAuthHeader(request.headers ?? {}, 'anthropic', request.apiKey)
  const usesVersionPath = endsWithIgnoreCase(trimTrailingSlashes(root), '/v1')
  const models = new Map<string, string>()
  let afterID: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const document = await requestJson(
      endpointUrl(root, usesVersionPath ? '/models' : '/v1/models', {
        limit: '1000',
        ...(afterID ? { after_id: afterID } : {}),
      }),
      headers,
      signal,
      fetchImpl,
    )
    if (!isObject(document) || !Array.isArray(document.data)) {
      throw listingError('上游模型列表格式无效')
    }
    for (const entry of document.data) {
      if (!isObject(entry)) continue
      collect(models, entry.id, entry.display_name)
    }
    if (document.has_more === undefined) break
    if (typeof document.has_more !== 'boolean') throw listingError('上游模型列表格式无效')
    if (!document.has_more) break
    if (typeof document.last_id !== 'string' || !document.last_id.trim()) {
      throw listingError('上游模型列表格式无效')
    }
    if (page === MAX_PAGES - 1) throw listingError('上游模型列表分页超出上限')
    afterID = document.last_id
  }
  return models
}

const listGoogleModels = async (
  root: string,
  request: ProviderModelListingRequest,
  signal: AbortSignal,
  fetchImpl: ProviderModelFetch,
): Promise<Map<string, string>> => {
  const headers = withAuthHeader(request.headers ?? {}, 'google', request.apiKey)
  const models = new Map<string, string>()
  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const document = await requestJson(
      endpointUrl(root, '/models', {
        pageSize: '1000',
        ...(pageToken ? { pageToken } : {}),
      }),
      headers,
      signal,
      fetchImpl,
    )
    if (!isObject(document) || !Array.isArray(document.models)) {
      throw listingError('上游模型列表格式无效')
    }
    for (const entry of document.models) {
      if (!isObject(entry) || typeof entry.name !== 'string') continue
      const name = entry.name.trim()
      if (!name) continue
      collect(
        models,
        name.startsWith('models/') ? name.slice('models/'.length) : name,
        entry.displayName,
      )
    }
    const next = document.nextPageToken
    if (next === undefined || next === null || next === '') break
    if (typeof next !== 'string') throw listingError('上游模型列表格式无效')
    if (page === MAX_PAGES - 1) throw listingError('上游模型列表分页超出上限')
    pageToken = next
  }
  return models
}

/**
 * Reads the upstream model catalog for one chat protocol without touching any
 * persisted configuration. Every failure surfaces as a safe
 * PROVIDER_UNAVAILABLE AgentError: upstream response bodies, credentials and
 * filesystem paths never reach the message.
 */
export const listProviderModels = async (
  request: ProviderModelListingRequest,
): Promise<ProviderModelListing> => {
  if (!(LISTABLE_CHAT_APIS as readonly string[]).includes(request.api)) {
    throw new AgentError('INVALID_REQUEST', '不支持的模型列表协议', 400)
  }
  const root = resolveModelListingRoot(request.baseUrl, request.api)
  if (!root) throw listingError('上游模型列表地址无效')
  const signal = combineSignals(request.signal)
  const fetchImpl = request.fetch ?? globalThis.fetch
  const models =
    request.api === 'openai-completions' || request.api === 'openai-responses'
      ? await listOpenAIModels(root, request, signal, fetchImpl)
      : request.api === 'anthropic-messages'
        ? await listAnthropicModels(root, request, signal, fetchImpl)
        : await listGoogleModels(root, request, signal, fetchImpl)
  if (models.size === 0) throw listingError('上游未返回任何模型')
  if (models.size > MAX_LISTED_MODELS) throw listingError('上游模型数量超过上限')
  return {
    models: [...models].map(([id, name]) => ({ id, name })),
    fetchedAt: Date.now(),
  }
}
