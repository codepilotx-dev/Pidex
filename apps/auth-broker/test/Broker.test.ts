import { describe, expect, test } from 'bun:test'
import type {
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectTransaction,
  Env,
  FetchLike,
} from '../src/Cloudflare.ts'
import { createBroker, OAuthAttempt } from '../src/index.ts'
import { sha256Base64Url } from '../src/Security.ts'

class MemoryStorage implements DurableObjectStorage {
  readonly values = new Map<string, unknown>()
  alarm: number | null = null
  private transactionTail: Promise<void> = Promise.resolve()

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value)
  }

  async deleteAll(): Promise<void> {
    this.values.clear()
    this.alarm = null
  }

  async setAlarm(scheduledTime: number): Promise<void> {
    this.alarm = scheduledTime
  }

  async transaction<T>(closure: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T> {
    let release: (() => void) | undefined
    const previous = this.transactionTail
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await closure(this)
    } finally {
      release?.()
    }
  }
}

class MemoryAttempts {
  readonly storages = new Map<string, MemoryStorage>()
  private readonly instances = new Map<string, OAuthAttempt>()
  private env: Env | null = null

  bindEnv(env: Env): void {
    this.env = env
  }

  idFromName(name: string): unknown {
    return name
  }

  get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } {
    const name = String(id)
    let instance = this.instances.get(name)
    if (instance === undefined) {
      const storage = new MemoryStorage()
      this.storages.set(name, storage)
      instance = new OAuthAttempt({ storage } satisfies DurableObjectState, this.env as Env)
      this.instances.set(name, instance)
    }
    return {
      fetch: async (input, init) => await instance.fetch(new Request(input, init)),
    }
  }
}

function createEnv(options: { rateLimit?: boolean } = {}): Env {
  const attempts = new MemoryAttempts()
  const env: Env = {
    GITHUB_OAUTH_CLIENT_ID: 'client-id',
    GITHUB_OAUTH_CLIENT_SECRET: 'client-secret',
    OAUTH_ATTEMPTS: attempts,
    OAUTH_RATE_LIMITER: {
      limit: async () => ({ success: options.rateLimit ?? true }),
    },
  }
  attempts.bindEnv(env)
  return env
}

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`https://auth-staging.codepilotx.top${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.9',
    },
    body: JSON.stringify(body),
  })
}

const verifier = 'a'.repeat(64)
const redirectUri = 'http://127.0.0.1:47831/auth/github/callback'

async function startLogin(
  env: Env,
  githubFetch?: FetchLike,
): Promise<{
  attemptId: string
  state: string
  authorizationUrl: string
}> {
  const broker = createBroker(githubFetch === undefined ? {} : { githubFetch })
  const response = await broker.fetch(
    post('/v1/github/oauth/start', {
      redirectUri,
      codeChallenge: await sha256Base64Url(verifier),
      codeChallengeMethod: 'S256',
    }),
    env,
  )
  expect(response.status).toBe(200)
  return (await response.json()) as {
    attemptId: string
    state: string
    authorizationUrl: string
  }
}

describe('auth broker', () => {
  test('health 响应不允许缓存且不开放 CORS', async () => {
    const response = await createBroker().fetch(
      new Request('https://auth-staging.codepilotx.top/health'),
      createEnv(),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  test('只接受带动态端口的 127.0.0.1 精确回调', async () => {
    const broker = createBroker()
    const env = createEnv()
    const challenge = await sha256Base64Url(verifier)

    for (const invalidRedirect of [
      'http://localhost:47831/auth/github/callback',
      'http://127.0.0.1/auth/github/callback',
      'http://127.0.0.1:47831/auth/github/callback?code=leak',
      'https://127.0.0.1:47831/auth/github/callback',
    ]) {
      const response = await broker.fetch(
        post('/v1/github/oauth/start', {
          redirectUri: invalidRedirect,
          codeChallenge: challenge,
          codeChallengeMethod: 'S256',
        }),
        env,
      )
      expect(response.status).toBe(400)
    }
  })

  test('创建 attempt 并返回固定 GitHub 授权地址', async () => {
    const result = await startLogin(createEnv())
    const authorizationUrl = new URL(result.authorizationUrl)

    expect(authorizationUrl.origin).toBe('https://github.com')
    expect(authorizationUrl.pathname).toBe('/login/oauth/authorize')
    expect(authorizationUrl.searchParams.get('client_id')).toBe('client-id')
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(redirectUri)
    expect(authorizationUrl.searchParams.get('scope')).toBe('repo read:user read:org')
    expect(authorizationUrl.searchParams.get('state')).toBe(result.state)
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
  })

  test('并发 PKCE 交换只有一次能消费 attempt', async () => {
    let exchangeCalls = 0
    const githubFetch: FetchLike = async (input, init) => {
      expect(String(input)).toBe('https://github.com/login/oauth/access_token')
      const body = init?.body as URLSearchParams
      expect(body.get('client_secret')).toBe('client-secret')
      expect(body.get('code_verifier')).toBe(verifier)
      exchangeCalls += 1
      return Response.json({
        access_token: 'gho_sensitive',
        token_type: 'bearer',
        scope: 'repo,read:user,read:org',
      })
    }
    const env = createEnv()
    const broker = createBroker({ githubFetch })
    const attempt = await startLogin(env, githubFetch)
    const requestBody = {
      attemptId: attempt.attemptId,
      state: attempt.state,
      code: 'github-code',
      codeVerifier: verifier,
      redirectUri,
    }

    const responses = await Promise.all([
      broker.fetch(post('/v1/github/oauth/exchange', requestBody), env),
      broker.fetch(post('/v1/github/oauth/exchange', requestBody), env),
    ])

    const success = responses.find((response) => response.status === 200)
    const replay = responses.find((response) => response.status !== 200)

    if (!success) {
      throw new Error('并发 PKCE 交换缺少成功响应')
    }
    if (!replay) {
      throw new Error('并发 PKCE 交换缺少重放响应')
    }
    expect(success.status).toBe(200)
    expect(await success.json()).toEqual({
      accessToken: 'gho_sensitive',
      tokenType: 'bearer',
      scope: 'repo,read:user,read:org',
    })
    expect([404, 409]).toContain(replay.status)
    expect(exchangeCalls).toBe(1)
  })

  test('错误 state 在访问 GitHub 前被拒绝', async () => {
    let exchangeCalls = 0
    const githubFetch: FetchLike = async () => {
      exchangeCalls += 1
      return new Response(null, { status: 500 })
    }
    const env = createEnv()
    const broker = createBroker({ githubFetch })
    const attempt = await startLogin(env, githubFetch)
    const response = await broker.fetch(
      post('/v1/github/oauth/exchange', {
        attemptId: attempt.attemptId,
        state: 'x'.repeat(43),
        code: 'github-code',
        codeVerifier: verifier,
        redirectUri,
      }),
      env,
    )

    expect(response.status).toBe(400)
    expect(exchangeCalls).toBe(0)
  })

  test('过期 attempt 被拒绝并清理', async () => {
    const env = createEnv()
    const broker = createBroker()
    const attempt = await startLogin(env)
    const attempts = env.OAUTH_ATTEMPTS as MemoryAttempts
    const storage = attempts.storages.get(attempt.attemptId)
    const record = storage?.values.get('attempt') as Record<string, unknown> | undefined
    expect(record).toBeDefined()
    if (record !== undefined) {
      record.expiresAt = Date.now() - 1
      storage?.values.set('attempt', record)
    }

    const response = await broker.fetch(
      post('/v1/github/oauth/exchange', {
        attemptId: attempt.attemptId,
        state: attempt.state,
        code: 'github-code',
        codeVerifier: verifier,
        redirectUri,
      }),
      env,
    )

    expect(response.status).toBe(410)
    expect(storage?.values.size).toBe(0)
  })

  test('GitHub 404 撤销被视为 token 已失效', async () => {
    const githubFetch: FetchLike = async (input, init) => {
      expect(String(input)).toBe('https://api.github.com/applications/client-id/token')
      expect(init?.method).toBe('DELETE')
      expect(init?.headers).not.toBeUndefined()
      return new Response(null, { status: 404 })
    }
    const response = await createBroker({ githubFetch }).fetch(
      post('/v1/github/oauth/revoke', {
        accessToken: 'gho_already_revoked',
      }),
      createEnv(),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('限流失败时不处理请求', async () => {
    const response = await createBroker().fetch(
      post('/v1/github/oauth/start', {
        redirectUri,
        codeChallenge: await sha256Base64Url(verifier),
        codeChallengeMethod: 'S256',
      }),
      createEnv({ rateLimit: false }),
    )

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({
      error: {
        code: 'rate_limited',
        message: '请求过于频繁，请稍后重试。',
      },
    })
  })
})
