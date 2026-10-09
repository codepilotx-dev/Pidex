import type {
  McpRuntimeServerAuth,
  McpSanitizedError,
  McpServerDeclaration,
} from '@pidex/agent-protocol'
import {
  adaptOAuthProvider,
  authorizeMcp,
  discoverAuthorizationServerMetadata,
  discoverOAuthServerInfo,
  exchangeAuthorizationCode,
  McpOAuthAuthorizationRequiredError,
  OAuthError,
  OAuthInsecureEndpointError,
  parseWwwAuthenticate,
  refreshAuthorization,
  registerClient,
  startAuthorization,
  type OAuthClientProvider,
  type OAuthFlowOptions,
  type OAuthFlowResult,
  type OAuthDiscoveryState,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthTokens,
} from '@earendil-works/pi-mcp/oauth'
import { McpClient, type AuthProvider } from '@earendil-works/pi-mcp'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { connectMcpClient, createMcpHttpTransport } from './McpClientFactory'
import {
  McpOAuthCredentialRepository,
  type McpOAuthCredentialIdentity,
  type StoredMcpOAuthCredential,
} from './McpOAuthCredentialRepository'

const ATTEMPT_TTL_MS = 10 * 60_000
const MAX_ATTEMPTS = 32

type HttpServer = McpServerDeclaration & {
  transport: Extract<McpServerDeclaration['transport'], { type: 'http' }>
}

type OAuthAttempt = {
  id: string
  serverKey: string
  stateValue: string
  createdAt: number
  expiresAt: number
  state: 'pending' | 'completed' | 'failed' | 'expired'
  error?: McpSanitizedError
  authorizationUrl?: string
  provider: StoredOAuthProvider
  client: McpClient
  serverUrl: string
  timeoutMs: number
}

const safeError = (code: string, message: string, retryable = true): McpSanitizedError => ({
  code,
  message,
  retryable,
})

const validAuthorizationURL = (value: URL) => {
  if (value.protocol === 'https:') return value.toString()
  if (
    value.protocol === 'http:' &&
    (value.hostname === '127.0.0.1' || value.hostname === 'localhost' || value.hostname === '::1')
  ) {
    return value.toString()
  }
  throw new Error('OAuth 授权地址必须使用 HTTPS 或 loopback HTTP')
}

const constantTimeEqual = (left: string, right: string) => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

const inherited = (references: Record<string, string> | undefined) =>
  Object.fromEntries(
    Object.entries(references ?? {})
      .map(([target, source]) => [target, process.env[source]])
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )

class StoredOAuthProvider implements OAuthClientProvider {
  private value: StoredMcpOAuthCredential
  private verifier = ''

  constructor(
    private readonly repository: McpOAuthCredentialRepository,
    private readonly identity: McpOAuthCredentialIdentity,
    private readonly callbackURL: string,
    private readonly stateValue: string,
    private readonly scopes: readonly string[],
    private readonly resource: string | undefined,
    stored: StoredMcpOAuthCredential | null,
    private readonly onAuthorization: (url: URL) => void,
  ) {
    this.value = stored ?? {
      version: 1,
      serverUrlHash: identity.serverUrlHash,
    }
  }

  get redirectUrl() {
    return this.callbackURL
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.callbackURL],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'Pidex',
      software_id: 'pidex',
      software_version: '0.2.0',
      ...(this.scopes.length ? { scope: this.scopes.join(' ') } : {}),
    }
  }

  state() {
    return this.stateValue
  }

  clientInformation() {
    return this.value.clientInformation
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    this.value = { ...this.value, clientInformation }
    await this.persist()
  }

  tokens() {
    return this.value.tokens
  }

  async saveTokens(tokens: OAuthTokens) {
    this.value = { ...this.value, tokens }
    await this.persist()
  }

  redirectToAuthorization(authorizationUrl: URL) {
    this.onAuthorization(authorizationUrl)
  }

  saveCodeVerifier(codeVerifier: string) {
    this.verifier = codeVerifier
  }

  codeVerifier() {
    if (!this.verifier) throw new Error('OAuth PKCE verifier 不可用')
    return this.verifier
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'verifier') {
      this.verifier = ''
      return
    }
    if (scope === 'all') {
      this.verifier = ''
      this.value = { version: 1, serverUrlHash: this.identity.serverUrlHash }
    } else if (scope === 'client') {
      delete this.value.clientInformation
    } else if (scope === 'tokens') {
      delete this.value.tokens
    } else {
      delete this.value.discoveryState
    }
    await this.persist()
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState) {
    this.value = { ...this.value, discoveryState }
    await this.persist()
  }

  discoveryState() {
    return this.value.discoveryState
  }

  authProvider(): AuthProvider {
    if (!this.resource) return adaptOAuthProvider(this)
    let inFlight: Promise<void> | undefined
    return {
      token: async () => this.tokens()?.access_token,
      onUnauthorized: async (context) => {
        const challenge = parseWwwAuthenticate(context.response.headers.get('www-authenticate'))
        const insufficientScope = challenge.error === 'insufficient_scope'
        const current = this.tokens()?.access_token
        if (
          !insufficientScope &&
          !inFlight &&
          current &&
          context.token &&
          current !== context.token
        )
          return
        inFlight ??= this.authorize({
          serverUrl: context.serverUrl,
          ...(challenge.resourceMetadataUrl
            ? { resourceMetadataUrl: challenge.resourceMetadataUrl }
            : {}),
          ...(challenge.scope ? { scope: challenge.scope } : {}),
          fetch: context.fetch,
          skipRefresh: insufficientScope,
        })
          .then((result) => {
            if (result === 'REDIRECT') throw new McpOAuthAuthorizationRequiredError()
          })
          .finally(() => {
            inFlight = undefined
          })
        await inFlight
      },
    }
  }

  async authorize(options: OAuthFlowOptions): Promise<OAuthFlowResult> {
    if (!this.resource) return authorizeMcp(this, options)
    try {
      return await this.authorizeResource(options, this.resource)
    } catch (cause) {
      if (
        cause instanceof OAuthError &&
        ['invalid_client', 'unauthorized_client'].includes(cause.code)
      ) {
        await this.invalidateCredentials('all')
        return this.authorizeResource(options, this.resource)
      }
      if (cause instanceof OAuthError && cause.code === 'invalid_grant') {
        await this.invalidateCredentials('tokens')
        return this.authorizeResource(options, this.resource)
      }
      throw cause
    }
  }

  // Same pi flow, with the configured resource passed to authorization and both token grants.
  private async authorizeResource(
    options: OAuthFlowOptions,
    resource: string,
  ): Promise<OAuthFlowResult> {
    const fetchOptions = options.fetch ? { fetch: options.fetch } : {}
    const cached = this.discoveryState()
    let discovered: OAuthDiscoveryState
    if (cached?.authorizationServerUrl) {
      const metadata =
        cached.authorizationServerMetadata ??
        (await discoverAuthorizationServerMetadata(cached.authorizationServerUrl, fetchOptions))
      discovered = { ...cached, ...(metadata ? { authorizationServerMetadata: metadata } : {}) }
    } else {
      discovered = await discoverOAuthServerInfo(options.serverUrl, {
        ...(options.resourceMetadataUrl
          ? { resourceMetadataUrl: options.resourceMetadataUrl }
          : {}),
        ...fetchOptions,
      })
    }
    await this.saveDiscoveryState({
      ...discovered,
      ...(options.resourceMetadataUrl
        ? { resourceMetadataUrl: options.resourceMetadataUrl.href }
        : {}),
    })
    const metadata = discovered.authorizationServerMetadata
    const metadataOptions = metadata ? { metadata } : {}
    const scope =
      options.scope ??
      this.clientMetadata.scope ??
      discovered.resourceMetadata?.scopes_supported?.join(' ')
    let clientInformation = this.clientInformation()
    if (!clientInformation) {
      if (options.authorizationCode) throw new Error('OAuth client information unavailable')
      clientInformation = await registerClient(discovered.authorizationServerUrl, {
        ...metadataOptions,
        clientMetadata: this.clientMetadata,
        ...(scope ? { scope } : {}),
        ...fetchOptions,
      })
      await this.saveClientInformation(clientInformation)
    }
    const tokenOptions = { ...metadataOptions, clientInformation, resource, ...fetchOptions }
    if (options.authorizationCode) {
      await this.saveTokens(
        await exchangeAuthorizationCode(discovered.authorizationServerUrl, {
          ...tokenOptions,
          code: options.authorizationCode,
          codeVerifier: this.codeVerifier(),
          redirectUrl: this.redirectUrl,
        }),
      )
      return 'AUTHORIZED'
    }
    const existing = options.skipRefresh ? undefined : this.tokens()
    if (existing?.refresh_token) {
      try {
        await this.saveTokens(
          await refreshAuthorization(discovered.authorizationServerUrl, {
            ...tokenOptions,
            refreshToken: existing.refresh_token,
          }),
        )
        return 'AUTHORIZED'
      } catch (cause) {
        if (
          cause instanceof OAuthInsecureEndpointError ||
          (cause instanceof OAuthError && cause.code !== 'server_error')
        )
          throw cause
      }
    }
    const authorization = await startAuthorization(discovered.authorizationServerUrl, {
      ...metadataOptions,
      clientInformation,
      redirectUrl: this.redirectUrl,
      ...(scope ? { scope } : {}),
      state: this.state(),
      resource,
    })
    this.saveCodeVerifier(authorization.codeVerifier)
    this.redirectToAuthorization(authorization.authorizationUrl)
    return 'REDIRECT'
  }

  clearVerifier() {
    this.verifier = ''
  }

  private async persist() {
    await this.repository.set(this.identity, this.value)
  }
}

export class McpOAuthCoordinator {
  private readonly attempts = new Map<string, OAuthAttempt>()
  private readonly attemptByServer = new Map<string, string>()

  constructor(
    private readonly repository: McpOAuthCredentialRepository,
    private readonly callbackURL: string,
    private readonly now: () => number = Date.now,
  ) {}

  async provider(server: McpServerDeclaration, workspaceHash?: string) {
    if (server.transport.type !== 'http') {
      throw new Error('OAuth 仅支持 HTTP MCP server')
    }
    const identity = this.identity(server, workspaceHash)
    const stored = await this.repository.get(identity)
    return new StoredOAuthProvider(
      this.repository,
      identity,
      this.callbackURL,
      randomUUID(),
      server.transport.scopes ?? [],
      server.transport.oauthResource,
      stored,
      () => undefined,
    ).authProvider()
  }

  async hasCredential(server: McpServerDeclaration, workspaceHash?: string) {
    if (server.transport.type !== 'http') return false
    return Boolean((await this.repository.get(this.identity(server, workspaceHash)))?.tokens)
  }

  async authSummary(
    server: McpServerDeclaration,
    workspaceHash?: string,
  ): Promise<McpRuntimeServerAuth> {
    if (server.transport.type !== 'http') {
      return { source: 'none', canLogin: false, canLogout: false }
    }
    const environment =
      Boolean(
        server.transport.bearerTokenEnvVar && process.env[server.transport.bearerTokenEnvVar],
      ) ||
      Object.values(server.transport.headerFromEnv ?? {}).some(
        (variable) => typeof process.env[variable] === 'string',
      )
    const oauth = await this.hasCredential(server, workspaceHash)
    const allowed = server.transport.auth !== 'none'
    return {
      source: environment ? 'environment' : oauth ? 'oauth' : 'none',
      canLogin: allowed && !environment && !oauth,
      canLogout: oauth,
    }
  }

  async start(server: HttpServer, workspaceHash?: string) {
    this.expireAttempts()
    if (this.attempts.size >= MAX_ATTEMPTS) {
      throw new Error('MCP OAuth 登录尝试过多，请稍后重试')
    }
    const identity = this.identity(server, workspaceHash)
    const existingID = this.attemptByServer.get(identity.integrationID)
    if (existingID) await this.disposeAttempt(existingID)

    const attemptId = randomUUID()
    const stateValue = randomUUID()
    const createdAt = this.now()
    const timeoutMs = server.startupTimeoutMs ?? 10_000
    const client = new McpClient({
      name: 'pidex-agent',
      version: '0.2.0',
      capabilities: {},
      requestTimeoutMs: timeoutMs,
    })
    let authorizationUrl: string | undefined
    const provider = new StoredOAuthProvider(
      this.repository,
      identity,
      this.callbackURL,
      stateValue,
      server.transport.scopes ?? [],
      server.transport.oauthResource,
      await this.repository.get(identity),
      (url) => {
        authorizationUrl = validAuthorizationURL(url)
      },
    )
    const headers = {
      ...(server.transport.headers ?? {}),
      ...inherited(server.transport.headerFromEnv),
    }
    delete headers.Authorization
    delete headers.authorization
    const transport = createMcpHttpTransport({
      url: server.transport.url,
      authProvider: provider.authProvider(),
      headers,
    })
    const attempt: OAuthAttempt = {
      id: attemptId,
      serverKey: identity.integrationID,
      stateValue,
      createdAt,
      expiresAt: createdAt + ATTEMPT_TTL_MS,
      state: 'pending',
      provider,
      client,
      serverUrl: server.transport.url,
      timeoutMs,
    }
    this.attempts.set(attemptId, attempt)
    this.attemptByServer.set(identity.integrationID, attemptId)

    try {
      await connectMcpClient(client, transport, timeoutMs)
      attempt.state = 'completed'
      await client.close().catch(() => undefined)
      return {
        attemptId,
        authorizationUrl: this.callbackURL,
        expiresAt: attempt.expiresAt,
      }
    } catch (cause) {
      if (!(cause instanceof McpOAuthAuthorizationRequiredError) || !authorizationUrl) {
        attempt.state = 'failed'
        attempt.error = safeError('MCP_OAUTH_START_FAILED', '无法启动 MCP OAuth 登录')
        await this.disposeTransport(attempt)
        throw new Error(attempt.error.message)
      }
      attempt.authorizationUrl = authorizationUrl
      return {
        attemptId,
        authorizationUrl,
        expiresAt: attempt.expiresAt,
      }
    }
  }

  status(attemptId: string) {
    this.expireAttempts()
    const attempt = this.attempts.get(attemptId)
    if (!attempt) {
      return {
        state: 'expired' as const,
        error: safeError('MCP_OAUTH_ATTEMPT_EXPIRED', 'MCP OAuth 登录已过期', false),
      }
    }
    return {
      state: attempt.state,
      ...(attempt.error ? { error: attempt.error } : {}),
    }
  }

  async handleCallback(input: { code?: string; state?: string; error?: string }) {
    this.expireAttempts()
    const attempt = [...this.attempts.values()].find(
      (candidate) =>
        candidate.state === 'pending' &&
        Boolean(input.state) &&
        constantTimeEqual(candidate.stateValue, input.state!),
    )
    if (!attempt) return { completed: false, attemptId: null }
    if (input.error || !input.code) {
      attempt.state = 'failed'
      attempt.error = safeError(
        'MCP_OAUTH_DENIED',
        input.error === 'access_denied' ? 'MCP OAuth 登录已取消' : 'MCP OAuth 登录失败',
        false,
      )
      await this.disposeTransport(attempt)
      return { completed: false, attemptId: attempt.id }
    }
    attempt.stateValue = ''
    try {
      const signal = AbortSignal.timeout(attempt.timeoutMs)
      await attempt.provider.authorize({
        serverUrl: attempt.serverUrl,
        authorizationCode: input.code,
        fetch: (url, init) => fetch(url, { ...init, signal }),
      })
      attempt.state = 'completed'
      return { completed: true, attemptId: attempt.id }
    } catch {
      attempt.state = 'failed'
      attempt.error = safeError('MCP_OAUTH_EXCHANGE_FAILED', 'MCP OAuth 授权码交换失败')
      return { completed: false, attemptId: attempt.id }
    } finally {
      attempt.provider.clearVerifier()
      await this.disposeTransport(attempt)
    }
  }

  async remove(server: HttpServer, workspaceHash?: string) {
    const identity = this.identity(server, workspaceHash)
    const attemptID = this.attemptByServer.get(identity.integrationID)
    if (attemptID) await this.disposeAttempt(attemptID)
    await this.repository.remove(identity)
  }

  private identity(server: McpServerDeclaration, workspaceHash?: string) {
    if (server.transport.type !== 'http') {
      throw new Error('OAuth 仅支持 HTTP MCP server')
    }
    return this.repository.identity({
      scope: server.scope,
      ...(workspaceHash ? { workspaceHash } : {}),
      serverName: server.name,
      serverUrl: server.transport.url,
    })
  }

  private expireAttempts() {
    const now = this.now()
    for (const attempt of this.attempts.values()) {
      if (attempt.expiresAt > now) continue
      if (attempt.state === 'pending') {
        attempt.state = 'expired'
        attempt.error = safeError('MCP_OAUTH_ATTEMPT_EXPIRED', 'MCP OAuth 登录已过期', false)
      }
      void this.disposeAttempt(attempt.id)
    }
  }

  private async disposeAttempt(attemptID: string) {
    const attempt = this.attempts.get(attemptID)
    if (!attempt) return
    this.attempts.delete(attemptID)
    if (this.attemptByServer.get(attempt.serverKey) === attemptID) {
      this.attemptByServer.delete(attempt.serverKey)
    }
    await this.disposeTransport(attempt)
  }

  private async disposeTransport(attempt: OAuthAttempt) {
    await attempt.client.close().catch(() => undefined)
  }
}

export type McpOAuthHttpServer = HttpServer
