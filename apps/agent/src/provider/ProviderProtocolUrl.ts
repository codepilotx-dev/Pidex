import {
  assertSafeProviderHeaders,
  CUSTOM_PROVIDER_APIS,
  validateCustomProviderBaseUrl,
  type CustomProviderApi,
  type ProviderEndpointApi,
} from './pi/PiProviderConfig'

/**
 * The four chat wire protocols a draft provider can be tested against. Order is
 * the report order used by protocol detection cells.
 */
export const PROTOCOL_DETECTION_APIS: readonly CustomProviderApi[] = CUSTOM_PROVIDER_APIS

/** Transient, never persisted credential input of an unsaved provider request draft. */
export type ProviderRequestDraftLike = {
  readonly baseUrl: string
  readonly endpoints?: Partial<Record<ProviderEndpointApi, string>>
  readonly auth: 'api-key' | 'none'
  readonly headers?: Readonly<Record<string, string>>
  readonly allowInsecureHttp?: boolean
  readonly apiKey?: string
}

/**
 * Placeholder bearer token handed to adapters that refuse to construct a client
 * without a key. It is not a credential: it is only used for drafts that declare
 * `auth: 'none'`, so an unauthenticated local endpoint still receives a request.
 */
export const TRANSIENT_NO_AUTH_API_KEY = 'pidex-transient-no-auth'

const AUTH_HEADER_NAMES = new Set(['authorization', 'x-api-key', 'cf-aig-authorization'])

/** Whether the headers already carry request auth owned by the credential chain. */
export const hasAuthorizationHeader = (headers: Readonly<Record<string, string>>): boolean =>
  Object.keys(headers).some((name) => AUTH_HEADER_NAMES.has(name.toLowerCase()))

/** Validates and copies draft-owned public headers; sensitive headers are rejected. */
export const validateDraftHeaders = (headers: unknown): Readonly<Record<string, string>> =>
  assertSafeProviderHeaders(headers, 'draft provider')

/**
 * Resolves the api key for a one-off probe. Explicit input and draft input win;
 * a header-owned credential needs no key; `auth: 'none'` falls back to the
 * adapter placeholder so unauthenticated endpoints can still be reached.
 */
export const resolveTransientProbeApiKey = (
  draft: Pick<ProviderRequestDraftLike, 'auth' | 'apiKey'>,
  headers: Readonly<Record<string, string>>,
  explicitApiKey?: string,
): string | undefined => {
  const explicit = explicitApiKey?.trim()
  if (explicit) return explicit
  const draftKey = draft.apiKey?.trim()
  if (draftKey) return draftKey
  if (hasAuthorizationHeader(headers)) return undefined
  return draft.auth === 'none' ? TRANSIENT_NO_AUTH_API_KEY : undefined
}

const stripTrailingSlashes = (pathname: string): string => pathname.replace(/\/+$/, '')

const stripPathSuffix = (pathname: string, suffix: string): string | undefined => {
  const path = stripTrailingSlashes(pathname)
  if (!path.toLowerCase().endsWith(suffix.toLowerCase())) return undefined
  return stripTrailingSlashes(path.slice(0, path.length - suffix.length)) || '/'
}

/** Gemini exposes `<base>/models/<model>:generateContent`; the adapter appends it again. */
const GOOGLE_MODEL_METHOD_SUFFIX = /\/models\/[^/]+:(?:stream)?generateContent$/i

/**
 * Normalizes a user-entered address to the base URL each Pi adapter expects.
 * Both root addresses and full interface addresses are accepted; the protocol's
 * request suffix is stripped so the adapter can append it exactly once.
 */
export const normalizeProtocolBaseUrl = (
  protocol: CustomProviderApi,
  value: unknown,
  allowInsecureHttp: boolean,
): string => {
  // Validate before rewriting so unsafe schemes, credentials and fragments are
  // rejected on the exact value the user submitted.
  const validated = validateCustomProviderBaseUrl(value, allowInsecureHttp)
  const url = new URL(validated)
  let pathname = stripTrailingSlashes(url.pathname) || '/'
  switch (protocol) {
    case 'openai-completions':
      pathname = stripPathSuffix(pathname, '/chat/completions') ?? pathname
      break
    case 'openai-responses':
      pathname = stripPathSuffix(pathname, '/responses') ?? pathname
      break
    case 'anthropic-messages':
      pathname =
        stripPathSuffix(pathname, '/v1/messages') ??
        stripPathSuffix(pathname, '/messages') ??
        pathname
      break
    case 'google-generative-ai':
      pathname = pathname.replace(GOOGLE_MODEL_METHOD_SUFFIX, '') || '/'
      break
  }
  url.pathname = pathname
  // Endpoint addresses never carry a query or fragment; keeping them would make
  // the adapter's appended request path part of the query string.
  url.search = ''
  url.hash = ''
  return validateCustomProviderBaseUrl(url.toString().replace(/\/$/, ''), allowInsecureHttp)
}

/** Address used to probe one protocol: a per-protocol endpoint wins over the draft base URL. */
export const protocolProbeAddress = (
  protocol: CustomProviderApi,
  draft: ProviderRequestDraftLike,
): string =>
  normalizeProtocolBaseUrl(
    protocol,
    draft.endpoints?.[protocol] ?? draft.baseUrl,
    draft.allowInsecureHttp === true,
  )
