import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Effect } from 'effect'
import { AgentError } from '../../Domain'
import type { EncryptedCredentialRepository } from '../../auth/EncryptedCredentialRepository'

const GITHUB_INTEGRATION_ID = 'github'
const GITHUB_API_USER = 'https://api.github.com/user'
const GITHUB_DEVICE_CODE = 'https://github.com/login/device/code'
const GITHUB_ACCESS_TOKEN = 'https://github.com/login/oauth/access_token'
const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize'
const GITHUB_SCOPE = 'repo read:user read:org'
const BROWSER_ATTEMPT_TTL_MS = 10 * 60 * 1_000
const BROKER_EXPIRY_TOLERANCE_MS = 30_000
const MAX_CALLBACK_VALUE_LENGTH = 2_048

type CredentialRepository = Pick<EncryptedCredentialRepository, 'get' | 'set' | 'remove'>
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type GithubAuthMode = 'browser' | 'device'

export type GithubUser = {
  login: string
  id: number
  name: string | null
  avatarUrl: string | null
  htmlUrl: string
}

export type GithubAuthStatus = {
  configured: boolean
  authenticated: boolean
  user: GithubUser | null
  error?: string
}

export type GithubLoginStatus = {
  loginId: string
  mode: GithubAuthMode
  state: 'starting' | 'awaiting_auth' | 'completed' | 'failed'
  authorizationUrl: string | null
  userCode: string | null
  verificationUri: string | null
  expiresAt: string | null
  error: string | null
  auth: GithubAuthStatus | null
  elapsedMs: number
}

export type StoredGithubCredential = {
  type: 'oauth'
  accessToken: string
  tokenType: string
  scope: string
}

type BaseAttempt = {
  loginId: string
  mode: GithubAuthMode
  createdAt: number
  expiresAt: number
  state: GithubLoginStatus['state']
  error: string | null
  auth: GithubAuthStatus | null
}

type BrowserAttempt = BaseAttempt & {
  mode: 'browser'
  attemptId: string
  stateValue: string
  codeVerifier: string
  redirectUri: string
  authorizationUrl: string
}

type DeviceAttempt = BaseAttempt & {
  mode: 'device'
  clientId: string
  deviceCode: string
  userCode: string
  verificationUri: string
  intervalMs: number
  nextPollAt: number
}

type LoginAttempt = BrowserAttempt | DeviceAttempt

export type GithubAuthServiceOptions = {
  fetch?: Fetch
  now?: () => number
  getConfiguredClientId?: () => string | null | undefined
  getBrokerURL?: () => string | null | undefined
  getCallbackURL?: () => string | null | undefined
}

export type GithubOAuthCallback = {
  code?: string
  state?: string
  error?: string
}

const nonEmpty = (value: string, name: string) => {
  const normalized = value.trim()
  if (!normalized) throw new AgentError('INVALID_REQUEST', `${name} 参数无效`, 400)
  return normalized
}

const asRecord = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentError('GITHUB_RESPONSE_INVALID', `${name}响应无效`, 502)
  }
  return value as Record<string, unknown>
}

const stringField = (value: Record<string, unknown>, key: string) => {
  if (typeof value[key] !== 'string' || !value[key]) {
    throw new AgentError('GITHUB_RESPONSE_INVALID', `GitHub 响应缺少 ${key}`, 502)
  }
  return value[key]
}

const numberField = (value: Record<string, unknown>, key: string) => {
  if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
    throw new AgentError('GITHUB_RESPONSE_INVALID', `GitHub 响应缺少 ${key}`, 502)
  }
  return value[key]
}

export const githubUserFromApi = (value: unknown): GithubUser => {
  const input = asRecord(value, 'GitHub 用户')
  return {
    login: stringField(input, 'login'),
    id: numberField(input, 'id'),
    name: typeof input.name === 'string' ? input.name : null,
    avatarUrl: typeof input.avatar_url === 'string' ? input.avatar_url : null,
    htmlUrl: stringField(input, 'html_url'),
  }
}

const encodeForm = (values: Record<string, string>) => new URLSearchParams(values).toString()
const base64url = (value: Uint8Array) => Buffer.from(value).toString('base64url')
const pkceChallenge = (verifier: string) =>
  createHash('sha256').update(verifier, 'ascii').digest('base64url')

const constantTimeEqual = (left: string, right: string) => {
  const leftHash = createHash('sha256').update(left, 'utf8').digest()
  const rightHash = createHash('sha256').update(right, 'utf8').digest()
  return timingSafeEqual(leftHash, rightHash)
}

const validatedCallbackURL = (raw: string | null | undefined) => {
  if (!raw)
    throw new AgentError('GITHUB_OAUTH_FAILED', 'GitHub 本机回调端口尚未就绪，请稍后重试。', 503)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new AgentError('GITHUB_OAUTH_FAILED', 'GitHub 本机回调地址无效。', 500)
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/auth/github/callback' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new AgentError('GITHUB_OAUTH_FAILED', 'GitHub 本机回调地址无效。', 500)
  }
  return url.toString()
}

const validatedBrokerURL = (raw: string | null | undefined) => {
  if (!raw?.trim()) {
    throw new AgentError('GITHUB_OAUTH_FAILED', 'GitHub 登录服务尚未配置。', 503)
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new AgentError('GITHUB_OAUTH_FAILED', 'GitHub 登录服务地址无效。', 500)
  }
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === 'localhost'
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new AgentError('GITHUB_OAUTH_FAILED', 'GitHub 登录服务地址无效。', 500)
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

const validatedAuthorizationURL = (raw: string) => {
  const url = new URL(raw)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.pathname !== '/login/oauth/authorize'
  ) {
    throw new AgentError('GITHUB_RESPONSE_INVALID', 'GitHub 授权地址无效', 502)
  }
  return url.toString()
}

const callbackValue = (value: string | undefined) => {
  if (value === undefined) return undefined
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_CALLBACK_VALUE_LENGTH) {
    throw new AgentError('INVALID_REQUEST', 'GitHub 回调参数无效', 400)
  }
  return normalized
}

const hasRequiredScopes = (scope: string) => {
  const scopes = new Set(
    scope
      .split(/[\s,]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )
  return scopes.has('repo') && scopes.has('read:user') && scopes.has('read:org')
}

const oauthErrorMessage = (value: Record<string, unknown>) => {
  const error = typeof value.error === 'string' ? value.error : ''
  if (error === 'authorization_pending') return '等待在 GitHub 完成授权。'
  if (error === 'slow_down') return 'GitHub 要求降低轮询频率。'
  if (error === 'expired_token' || error === 'token_expired')
    return 'GitHub 验证码已过期，请重新登录。'
  if (error === 'access_denied') return 'GitHub 登录已被取消。'
  if (error === 'incorrect_client_credentials') return 'GitHub OAuth Client ID 无效。'
  if (error === 'incorrect_device_code') return 'GitHub Device Code 无效，请重新登录。'
  if (error === 'device_flow_disabled') return '该 GitHub OAuth App 未启用 Device Flow。'
  return 'GitHub 登录失败，请稍后重试。'
}

const brokerErrorMessage = (value: unknown, status: number) => {
  const input =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const error =
    input.error && typeof input.error === 'object' && !Array.isArray(input.error)
      ? (input.error as Record<string, unknown>)
      : input
  const code = typeof error.code === 'string' ? error.code : ''
  if (code === 'ATTEMPT_EXPIRED' || code === 'attempt_expired') {
    return 'GitHub 登录请求已过期，请重新登录。'
  }
  if (
    code === 'ATTEMPT_CONSUMED' ||
    code === 'attempt_consumed' ||
    code === 'STATE_MISMATCH' ||
    code === 'state_mismatch'
  ) {
    return 'GitHub 登录请求已失效，请重新登录。'
  }
  if (code === 'ACCESS_DENIED' || code === 'access_denied') return 'GitHub 登录已被取消。'
  if (status === 429) return 'GitHub 登录请求过于频繁，请稍后重试。'
  return status >= 500
    ? 'GitHub 登录服务暂时不可用，请稍后重试。'
    : 'GitHub 登录请求无效，请重新登录。'
}

export class GithubAuthService {
  private readonly fetch: Fetch
  private readonly now: () => number
  private readonly getConfiguredClientId: () => string | null | undefined
  private readonly getBrokerURL: () => string | null | undefined
  private readonly getCallbackURL: () => string | null | undefined
  private attempt: LoginAttempt | null = null

  constructor(
    private readonly credentials: CredentialRepository,
    options: GithubAuthServiceOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.now = options.now ?? Date.now
    this.getConfiguredClientId = options.getConfiguredClientId ?? (() => null)
    this.getBrokerURL = options.getBrokerURL ?? (() => null)
    this.getCallbackURL = options.getCallbackURL ?? (() => null)
  }

  async authStatus(): Promise<GithubAuthStatus> {
    const configured = this.isConfigured()
    const stored = await this.credential()
    if (!stored) return { configured, authenticated: false, user: null }
    try {
      return {
        configured: true,
        authenticated: true,
        user: await this.fetchUser(stored.accessToken),
      }
    } catch (cause) {
      if (cause instanceof AgentError && cause.status === 401) {
        await Effect.runPromise(this.credentials.remove(GITHUB_INTEGRATION_ID))
        return {
          configured,
          authenticated: false,
          user: null,
          error: 'GitHub 登录已失效，请重新登录。',
        }
      }
      return {
        configured: true,
        authenticated: true,
        user: null,
        error: cause instanceof Error ? cause.message : '无法连接 GitHub。',
      }
    }
  }

  async start(mode: GithubAuthMode, clientIdOverride?: string): Promise<GithubLoginStatus> {
    this.attempt = null
    if (mode === 'browser') return this.startBrowserFlow()
    return this.startDeviceFlow(clientIdOverride)
  }

  async poll(loginId: string): Promise<GithubLoginStatus> {
    const attempt = this.requireAttempt(loginId)
    if (attempt.state === 'completed' || attempt.state === 'failed')
      return this.attemptStatus(attempt)
    if (this.now() >= attempt.expiresAt) {
      attempt.state = 'failed'
      attempt.error =
        attempt.mode === 'device'
          ? 'GitHub 验证码已过期，请重新登录。'
          : 'GitHub 登录请求已过期，请重新登录。'
      return this.attemptStatus(attempt)
    }
    if (attempt.mode === 'browser') return this.attemptStatus(attempt)
    return this.pollDeviceAttempt(attempt)
  }

  async handleCallback(input: GithubOAuthCallback): Promise<GithubLoginStatus> {
    const attempt = this.attempt
    if (!attempt || attempt.mode !== 'browser') {
      throw new AgentError('CONFLICT', 'GitHub 登录尝试已失效，请重新开始登录。', 409)
    }
    if (attempt.state !== 'awaiting_auth') {
      throw new AgentError('CONFLICT', 'GitHub 登录回调已处理，请重新开始登录。', 409)
    }
    if (this.now() >= attempt.expiresAt) {
      attempt.state = 'failed'
      attempt.error = 'GitHub 登录请求已过期，请重新登录。'
      return this.attemptStatus(attempt)
    }

    const state = callbackValue(input.state)
    if (!state || !constantTimeEqual(state, attempt.stateValue)) {
      throw new AgentError('CONFLICT', 'GitHub 登录状态无效，请重新开始登录。', 409)
    }
    const oauthError = callbackValue(input.error)
    if (oauthError) {
      attempt.state = 'failed'
      attempt.error =
        oauthError === 'access_denied' ? 'GitHub 登录已被取消。' : 'GitHub 登录失败，请重新登录。'
      return this.attemptStatus(attempt)
    }
    const code = callbackValue(input.code)
    if (!code) {
      attempt.state = 'failed'
      attempt.error = 'GitHub 登录回调缺少授权码，请重新登录。'
      return this.attemptStatus(attempt)
    }

    let accessToken: string | null = null
    try {
      const broker = validatedBrokerURL(this.getBrokerURL())
      const value = await this.fetchBroker(new URL('/v1/github/oauth/exchange', broker), {
        attemptId: attempt.attemptId,
        state,
        code,
        codeVerifier: attempt.codeVerifier,
        redirectUri: attempt.redirectUri,
      })
      const body = asRecord(value, 'GitHub 登录服务')
      accessToken = stringField(body, 'accessToken')
      const tokenType = typeof body.tokenType === 'string' ? body.tokenType : 'bearer'
      const scope = typeof body.scope === 'string' ? body.scope : ''
      if (!hasRequiredScopes(scope)) {
        await this.revokeRemoteToken(accessToken).catch(() => undefined)
        attempt.state = 'failed'
        attempt.error = 'GitHub 授权范围不足，需要 repo、read:user 和 read:org 权限。'
        return this.attemptStatus(attempt)
      }
      const user = await this.fetchUser(accessToken)
      await this.saveCredential(accessToken, tokenType, scope, 'oauth-pkce')
      attempt.state = 'completed'
      attempt.auth = { configured: true, authenticated: true, user }
      return this.attemptStatus(attempt)
    } catch (cause) {
      if (accessToken) await this.revokeRemoteToken(accessToken).catch(() => undefined)
      attempt.state = 'failed'
      attempt.error = cause instanceof Error ? cause.message : 'GitHub 登录失败，请稍后重试。'
      return this.attemptStatus(attempt)
    } finally {
      attempt.codeVerifier = ''
      attempt.stateValue = ''
    }
  }

  async logout(): Promise<GithubAuthStatus> {
    this.attempt = null
    const stored = await this.credential()
    if (!stored) return { configured: this.isConfigured(), authenticated: false, user: null }

    await this.revokeRemoteToken(stored.accessToken)
    await Effect.runPromise(this.credentials.remove(GITHUB_INTEGRATION_ID))
    return { configured: this.isConfigured(), authenticated: false, user: null }
  }

  private async startBrowserFlow(): Promise<GithubLoginStatus> {
    const loginId = randomUUID()
    const createdAt = this.now()
    try {
      const broker = validatedBrokerURL(this.getBrokerURL())
      const redirectUri = validatedCallbackURL(this.getCallbackURL())
      const codeVerifier = base64url(randomBytes(32))
      const value = await this.fetchBroker(new URL('/v1/github/oauth/start', broker), {
        redirectUri,
        codeChallenge: pkceChallenge(codeVerifier),
        codeChallengeMethod: 'S256',
      })
      const body = asRecord(value, 'GitHub 登录服务')
      const expiresAt = Date.parse(stringField(body, 'expiresAt'))
      if (
        !Number.isFinite(expiresAt) ||
        expiresAt <= createdAt ||
        expiresAt > createdAt + BROWSER_ATTEMPT_TTL_MS + BROKER_EXPIRY_TOLERANCE_MS
      ) {
        throw new AgentError('GITHUB_RESPONSE_INVALID', 'GitHub 登录服务过期时间无效', 502)
      }
      const attempt: BrowserAttempt = {
        loginId,
        mode: 'browser',
        attemptId: stringField(body, 'attemptId'),
        stateValue: stringField(body, 'state'),
        codeVerifier,
        redirectUri,
        authorizationUrl: validatedAuthorizationURL(stringField(body, 'authorizationUrl')),
        createdAt,
        expiresAt,
        state: 'awaiting_auth',
        error: null,
        auth: null,
      }
      this.attempt = attempt
      return this.attemptStatus(attempt)
    } catch (cause) {
      return this.failedStatus('browser', loginId, createdAt, cause)
    }
  }

  private async startDeviceFlow(clientIdOverride?: string): Promise<GithubLoginStatus> {
    const loginId = randomUUID()
    const createdAt = this.now()
    let clientId: string
    try {
      clientId = nonEmpty(clientIdOverride ?? this.getConfiguredClientId() ?? '', 'clientId')
    } catch {
      return this.failedStatus(
        'device',
        loginId,
        createdAt,
        new AgentError('GITHUB_OAUTH_FAILED', 'GitHub Device Flow 尚未配置。', 503),
      )
    }
    try {
      const response = await this.fetchJson(GITHUB_DEVICE_CODE, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: encodeForm({ client_id: clientId, scope: GITHUB_SCOPE }),
      })
      const body = asRecord(response, 'GitHub Device Flow')
      if (typeof body.error === 'string')
        return this.failedStatus('device', loginId, createdAt, oauthErrorMessage(body))
      const expiresInSeconds = numberField(body, 'expires_in')
      const intervalSeconds = Math.max(1, typeof body.interval === 'number' ? body.interval : 5)
      const attempt: DeviceAttempt = {
        loginId,
        mode: 'device',
        clientId,
        deviceCode: stringField(body, 'device_code'),
        userCode: stringField(body, 'user_code'),
        verificationUri: stringField(body, 'verification_uri'),
        createdAt,
        expiresAt: createdAt + expiresInSeconds * 1_000,
        intervalMs: intervalSeconds * 1_000,
        nextPollAt: createdAt + intervalSeconds * 1_000,
        state: 'awaiting_auth',
        error: null,
        auth: null,
      }
      this.attempt = attempt
      return this.attemptStatus(attempt)
    } catch (cause) {
      return this.failedStatus('device', loginId, createdAt, cause)
    }
  }

  private async pollDeviceAttempt(attempt: DeviceAttempt): Promise<GithubLoginStatus> {
    const now = this.now()
    if (now < attempt.nextPollAt) return this.attemptStatus(attempt)
    attempt.nextPollAt = now + attempt.intervalMs
    let body: Record<string, unknown>
    try {
      body = asRecord(
        await this.fetchJson(GITHUB_ACCESS_TOKEN, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: encodeForm({
            client_id: attempt.clientId,
            device_code: attempt.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        }),
        'GitHub Device Flow',
      )
    } catch (cause) {
      attempt.state = 'failed'
      attempt.error = cause instanceof Error ? cause.message : 'GitHub 登录失败，请稍后重试。'
      return this.attemptStatus(attempt)
    }
    if (typeof body.access_token === 'string' && body.access_token) {
      const tokenType = typeof body.token_type === 'string' ? body.token_type : 'bearer'
      const scope = typeof body.scope === 'string' ? body.scope : ''
      if (!hasRequiredScopes(scope)) {
        await this.revokeRemoteToken(body.access_token).catch(() => undefined)
        attempt.state = 'failed'
        attempt.error = 'GitHub 授权范围不足，需要 repo、read:user 和 read:org 权限。'
        return this.attemptStatus(attempt)
      }
      try {
        const user = await this.fetchUser(body.access_token)
        await this.saveCredential(body.access_token, tokenType, scope, 'device-flow')
        attempt.state = 'completed'
        attempt.auth = { configured: true, authenticated: true, user }
      } catch (cause) {
        await this.revokeRemoteToken(body.access_token).catch(() => undefined)
        attempt.state = 'failed'
        attempt.error = cause instanceof Error ? cause.message : 'GitHub 登录失败，请稍后重试。'
      }
      return this.attemptStatus(attempt)
    }
    const error = typeof body.error === 'string' ? body.error : 'unknown'
    if (error === 'authorization_pending') return this.attemptStatus(attempt)
    if (error === 'slow_down') {
      attempt.intervalMs += 5_000
      attempt.nextPollAt = now + attempt.intervalMs
      return this.attemptStatus(attempt)
    }
    attempt.state = 'failed'
    attempt.error = oauthErrorMessage(body)
    return this.attemptStatus(attempt)
  }

  private async fetchBroker(url: URL, body: Record<string, string>) {
    let response: Response
    try {
      response = await this.fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      throw new AgentError(
        'GITHUB_UNAVAILABLE',
        '无法连接 GitHub 登录服务，请检查网络后重试。',
        503,
      )
    }
    const value = (await response.json().catch(() => null)) as unknown
    if (!response.ok) {
      throw new AgentError(
        response.status === 429 ? 'GITHUB_RATE_LIMITED' : 'GITHUB_OAUTH_FAILED',
        brokerErrorMessage(value, response.status),
        response.status === 429 ? 429 : 502,
      )
    }
    return value
  }

  private async revokeRemoteToken(accessToken: string): Promise<void> {
    const broker = validatedBrokerURL(this.getBrokerURL())
    let response: Response
    try {
      response = await this.fetch(new URL('/v1/github/oauth/revoke', broker), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      })
    } catch {
      throw new AgentError('GITHUB_UNAVAILABLE', '无法连接 GitHub 登录服务，当前登录仍保留。', 503)
    }
    if (response.status === 204 || response.status === 404) return
    throw new AgentError(
      response.status === 429 ? 'GITHUB_RATE_LIMITED' : 'GITHUB_OAUTH_FAILED',
      response.status === 429
        ? 'GitHub 登录请求过于频繁，请稍后重试。'
        : '无法撤销 GitHub 登录，当前登录仍保留。',
      response.status === 429 ? 429 : 502,
    )
  }

  private async fetchJson(url: string, init: RequestInit) {
    let response: Response
    try {
      response = await this.fetch(url, init)
    } catch {
      throw new AgentError('GITHUB_UNAVAILABLE', '无法连接 GitHub，请检查网络后重试。', 503)
    }
    const value = (await response.json().catch(() => null)) as unknown
    if (!response.ok) {
      if (response.status === 401) {
        throw new AgentError('GITHUB_AUTH_INVALID', 'GitHub 登录已失效，请重新登录。', 401)
      }
      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        throw new AgentError(
          'GITHUB_RATE_LIMITED',
          'GitHub API 请求次数已达上限，请稍后重试。',
          429,
        )
      }
      throw new AgentError(
        'GITHUB_OAUTH_FAILED',
        oauthErrorMessage(asRecord(value, 'GitHub OAuth')),
        response.status,
      )
    }
    return value
  }

  private async fetchUser(accessToken: string) {
    return githubUserFromApi(
      await this.fetchJson(GITHUB_API_USER, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Pidex',
        },
      }),
    )
  }

  private async saveCredential(
    accessToken: string,
    tokenType: string,
    scope: string,
    methodID: string,
  ) {
    await Effect.runPromise(
      this.credentials.set({
        integrationID: GITHUB_INTEGRATION_ID,
        methodID,
        label: 'GitHub',
        value: {
          type: 'oauth',
          accessToken,
          tokenType,
          scope,
        } satisfies StoredGithubCredential,
      }),
    )
  }

  private async credential() {
    const stored = await Effect.runPromise(
      this.credentials.get<StoredGithubCredential>(GITHUB_INTEGRATION_ID),
    )
    if (
      !stored ||
      stored.value.type !== 'oauth' ||
      typeof stored.value.accessToken !== 'string' ||
      !stored.value.accessToken
    ) {
      return null
    }
    return stored.value
  }

  private requireAttempt(loginId: string) {
    const expected = nonEmpty(loginId, 'loginId')
    if (!this.attempt || this.attempt.loginId !== expected) {
      throw new AgentError('CONFLICT', 'GitHub 登录尝试已失效，请重新开始登录。', 409)
    }
    return this.attempt
  }

  private attemptStatus(attempt: LoginAttempt): GithubLoginStatus {
    return {
      loginId: attempt.loginId,
      mode: attempt.mode,
      state: attempt.state,
      authorizationUrl: attempt.mode === 'browser' ? attempt.authorizationUrl : null,
      userCode: attempt.mode === 'device' ? attempt.userCode : null,
      verificationUri: attempt.mode === 'device' ? attempt.verificationUri : null,
      expiresAt: new Date(attempt.expiresAt).toISOString(),
      error: attempt.error,
      auth: attempt.auth,
      elapsedMs: Math.max(0, this.now() - attempt.createdAt),
    }
  }

  private failedStatus(
    mode: GithubAuthMode,
    loginId: string,
    createdAt: number,
    cause: unknown,
  ): GithubLoginStatus {
    const error =
      typeof cause === 'string'
        ? cause
        : cause instanceof Error
          ? cause.message
          : 'GitHub 登录失败，请稍后重试。'
    const attempt: LoginAttempt =
      mode === 'browser'
        ? {
            loginId,
            mode,
            attemptId: '',
            stateValue: '',
            codeVerifier: '',
            redirectUri: '',
            authorizationUrl: GITHUB_AUTHORIZE,
            createdAt,
            expiresAt: createdAt,
            state: 'failed',
            error,
            auth: null,
          }
        : {
            loginId,
            mode,
            clientId: '',
            deviceCode: '',
            userCode: '',
            verificationUri: '',
            createdAt,
            expiresAt: createdAt,
            intervalMs: 0,
            nextPollAt: createdAt,
            state: 'failed',
            error,
            auth: null,
          }
    this.attempt = attempt
    const status = this.attemptStatus(attempt)
    return {
      ...status,
      authorizationUrl: null,
      userCode: null,
      verificationUri: null,
      expiresAt: null,
    }
  }

  private isConfigured() {
    return Boolean(this.getBrokerURL()?.trim() || this.getConfiguredClientId()?.trim())
  }
}

export const __test = {
  pkceChallenge,
  validatedBrokerURL,
  validatedCallbackURL,
}
