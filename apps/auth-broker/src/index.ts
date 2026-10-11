import type { DurableObjectStub, Env, FetchLike } from './Cloudflare.ts'
import { OAuthAttempt } from './OauthAttempt.ts'
import {
  isValidPkceChallenge,
  isValidPkceVerifier,
  normalizeLoopbackRedirect,
  randomBase64Url,
  sha256Base64Url,
} from './Security.ts'

export { OAuthAttempt }

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_API_URL = 'https://api.github.com'
const GITHUB_SCOPE = 'repo read:user read:org'
const ATTEMPT_TTL_MS = 10 * 60 * 1_000
const MAX_JSON_BYTES = 8 * 1_024

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const

type JsonRecord = Record<string, unknown>

class PublicError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function jsonResponse(body: JsonRecord, status = 200): Response {
  const headers = new Headers(SECURITY_HEADERS)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status, headers })
}

function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: new Headers(SECURITY_HEADERS),
  })
}

function publicError(error: unknown): Response {
  if (error instanceof PublicError) {
    return jsonResponse(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      error.status,
    )
  }
  return jsonResponse(
    {
      error: {
        code: 'internal_error',
        message: '认证服务暂时不可用。',
      },
    },
    500,
  )
}

async function readJsonObject(request: Request): Promise<JsonRecord> {
  const contentLength = request.headers.get('content-length')
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_JSON_BYTES
  ) {
    throw new PublicError('payload_too_large', 413, '请求体过大。')
  }

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new PublicError('payload_too_large', 413, '请求体过大。')
  }

  try {
    const value = JSON.parse(text) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not_an_object')
    }
    return value as JsonRecord
  } catch {
    throw new PublicError('invalid_json', 400, '请求体不是有效的 JSON 对象。')
  }
}

function requireExactKeys(body: JsonRecord, keys: readonly string[]): void {
  const actual = Object.keys(body).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new PublicError('invalid_request', 400, '请求字段无效。')
  }
}

function requireConfigured(env: Env): void {
  if (env.GITHUB_OAUTH_CLIENT_ID.trim() === '' || env.GITHUB_OAUTH_CLIENT_SECRET.trim() === '') {
    throw new PublicError('service_not_configured', 503, '认证服务尚未配置。')
  }
}

async function applyRateLimit(request: Request, env: Env, endpoint: string): Promise<void> {
  const source = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const result = await env.OAUTH_RATE_LIMITER.limit({
    key: `${endpoint}:${source}`,
  })
  if (!result.success) {
    throw new PublicError('rate_limited', 429, '请求过于频繁，请稍后重试。')
  }
}

function attemptStub(env: Env, attemptId: string): DurableObjectStub {
  return env.OAUTH_ATTEMPTS.get(env.OAUTH_ATTEMPTS.idFromName(attemptId))
}

async function callAttempt(
  stub: DurableObjectStub,
  path: string,
  body?: JsonRecord,
): Promise<Response> {
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }
  return await stub.fetch(`https://oauth-attempt${path}`, {
    ...init,
  })
}

function buildAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  const url = new URL(GITHUB_AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', GITHUB_SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

async function handleStart(request: Request, env: Env): Promise<Response> {
  requireConfigured(env)
  await applyRateLimit(request, env, 'start')
  const body = await readJsonObject(request)
  requireExactKeys(body, ['redirectUri', 'codeChallenge', 'codeChallengeMethod'])

  const redirectUri = normalizeLoopbackRedirect(body.redirectUri)
  if (
    redirectUri === null ||
    !isValidPkceChallenge(body.codeChallenge) ||
    body.codeChallengeMethod !== 'S256'
  ) {
    throw new PublicError('invalid_request', 400, 'OAuth 参数无效。')
  }

  const attemptId = randomBase64Url(24)
  const state = randomBase64Url(32)
  const expiresAtMs = Date.now() + ATTEMPT_TTL_MS
  const stub = attemptStub(env, attemptId)
  const createResponse = await callAttempt(stub, '/create', {
    stateHash: await sha256Base64Url(state),
    codeChallenge: body.codeChallenge,
    redirectUri,
    expiresAt: expiresAtMs,
  })
  if (!createResponse.ok) {
    throw new PublicError('attempt_create_failed', 503, '无法创建登录会话。')
  }

  return jsonResponse({
    attemptId,
    state,
    authorizationUrl: buildAuthorizationUrl(
      env.GITHUB_OAUTH_CLIENT_ID,
      redirectUri,
      state,
      body.codeChallenge,
    ),
    expiresAt: new Date(expiresAtMs).toISOString(),
  })
}

interface GithubTokenResponse {
  access_token?: unknown
  token_type?: unknown
  scope?: unknown
  error?: unknown
}

async function parseGithubJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

async function handleExchange(
  request: Request,
  env: Env,
  githubFetch: FetchLike,
): Promise<Response> {
  requireConfigured(env)
  await applyRateLimit(request, env, 'exchange')
  const body = await readJsonObject(request)
  requireExactKeys(body, ['attemptId', 'state', 'code', 'codeVerifier', 'redirectUri'])

  const redirectUri = normalizeLoopbackRedirect(body.redirectUri)
  if (
    typeof body.attemptId !== 'string' ||
    body.attemptId.length < 16 ||
    body.attemptId.length > 128 ||
    typeof body.state !== 'string' ||
    body.state.length < 16 ||
    body.state.length > 128 ||
    typeof body.code !== 'string' ||
    body.code.length < 1 ||
    body.code.length > 512 ||
    !isValidPkceVerifier(body.codeVerifier) ||
    redirectUri === null
  ) {
    throw new PublicError('invalid_request', 400, 'OAuth 参数无效。')
  }

  const stub = attemptStub(env, body.attemptId)
  const beginResponse = await callAttempt(stub, '/begin-exchange', {
    state: body.state,
    codeVerifier: body.codeVerifier,
    redirectUri,
  })
  if (!beginResponse.ok) {
    const code =
      beginResponse.status === 410
        ? 'attempt_expired'
        : beginResponse.status === 409
          ? 'attempt_consumed'
          : 'attempt_invalid'
    throw new PublicError(code, beginResponse.status, '登录会话无效或已过期。')
  }

  try {
    const tokenResponse = await githubFetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Pidex-Auth-Broker',
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
        code: body.code,
        redirect_uri: redirectUri,
        code_verifier: body.codeVerifier,
      }),
    })
    const token = await parseGithubJson<GithubTokenResponse>(tokenResponse)
    if (
      !tokenResponse.ok ||
      token === null ||
      typeof token.error === 'string' ||
      typeof token.access_token !== 'string' ||
      token.access_token.length < 1 ||
      token.access_token.length > 2_048 ||
      typeof token.token_type !== 'string' ||
      typeof token.scope !== 'string'
    ) {
      throw new PublicError(
        'github_exchange_rejected',
        tokenResponse.status >= 500 ? 502 : 400,
        'GitHub 拒绝了授权码交换。',
      )
    }

    return jsonResponse({
      accessToken: token.access_token,
      tokenType: token.token_type,
      scope: token.scope,
    })
  } finally {
    await callAttempt(stub, '/finish')
  }
}

async function handleRevoke(request: Request, env: Env, githubFetch: FetchLike): Promise<Response> {
  requireConfigured(env)
  await applyRateLimit(request, env, 'revoke')
  const body = await readJsonObject(request)
  requireExactKeys(body, ['accessToken'])
  if (
    typeof body.accessToken !== 'string' ||
    body.accessToken.length < 1 ||
    body.accessToken.length > 2_048
  ) {
    throw new PublicError('invalid_request', 400, 'Token 参数无效。')
  }

  const credentials = btoa(`${env.GITHUB_OAUTH_CLIENT_ID}:${env.GITHUB_OAUTH_CLIENT_SECRET}`)
  const response = await githubFetch(
    `${GITHUB_API_URL}/applications/${encodeURIComponent(env.GITHUB_OAUTH_CLIENT_ID)}/token`,
    {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Pidex-Auth-Broker',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ access_token: body.accessToken }),
    },
  )

  if (response.status === 204 || response.status === 404) {
    return emptyResponse(204)
  }
  throw new PublicError(
    'github_revoke_failed',
    response.status >= 500 ? 502 : 400,
    'GitHub Token 撤销失败。',
  )
}

function methodNotAllowed(allow: string): Response {
  const response = jsonResponse(
    {
      error: {
        code: 'method_not_allowed',
        message: '请求方法不受支持。',
      },
    },
    405,
  )
  response.headers.set('Allow', allow)
  return response
}

export function createBroker(dependencies: { githubFetch?: FetchLike } = {}): {
  fetch(request: Request, env: Env): Promise<Response>
} {
  const githubFetch = dependencies.githubFetch ?? fetch

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      try {
        const url = new URL(request.url)
        if (url.pathname === '/health') {
          return request.method === 'GET' ? jsonResponse({ status: 'ok' }) : methodNotAllowed('GET')
        }
        if (url.pathname === '/v1/github/oauth/start') {
          return request.method === 'POST'
            ? await handleStart(request, env)
            : methodNotAllowed('POST')
        }
        if (url.pathname === '/v1/github/oauth/exchange') {
          return request.method === 'POST'
            ? await handleExchange(request, env, githubFetch)
            : methodNotAllowed('POST')
        }
        if (url.pathname === '/v1/github/oauth/revoke') {
          return request.method === 'POST'
            ? await handleRevoke(request, env, githubFetch)
            : methodNotAllowed('POST')
        }
        return jsonResponse(
          {
            error: {
              code: 'not_found',
              message: '接口不存在。',
            },
          },
          404,
        )
      } catch (error) {
        return publicError(error)
      }
    },
  }
}

export default createBroker()
