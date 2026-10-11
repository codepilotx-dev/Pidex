import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { removeFixturePaths } from './FixtureCleanup'
import { Effect } from 'effect'
import {
  EncryptedCredentialRepository,
  type MasterKeyStore,
} from '../src/auth/EncryptedCredentialRepository'
import { GithubAuthService, __test } from '../src/github/auth/GithubAuthService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'

const paths: string[] = []
afterEach(async () => {
  await removeFixturePaths(paths.splice(0))
})

const memoryKeyStore = (): MasterKeyStore & { value: string | null } => ({
  value: null,
  async get() {
    return this.value
  },
  async set(value) {
    this.value = value
  },
})

const repository = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-github-auth-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  return { db, credentials: new EncryptedCredentialRepository(db, memoryKeyStore()) }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const user = {
  login: 'octocat',
  id: 1,
  name: 'The Octocat',
  avatar_url: 'https://avatars.example/octocat',
  html_url: 'https://github.com/octocat',
}

describe('GithubAuthService PKCE', () => {
  test('通过 Broker 完成 S256 登录并加密保存 token', async () => {
    const { db, credentials } = await repository()
    const requests: Array<{ url: string; body: Record<string, string> }> = []
    const now = 1_000
    const service = new GithubAuthService(credentials, {
      now: () => now,
      getBrokerURL: () => 'https://auth-staging.codepilotx.top',
      getCallbackURL: () => 'http://127.0.0.1:41234/auth/github/callback',
      fetch: async (input, init) => {
        const url = String(input)
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {}
        requests.push({ url, body })
        if (url.endsWith('/v1/github/oauth/start')) {
          return json({
            attemptId: 'attempt_123',
            state: 'state_123',
            authorizationUrl:
              'https://github.com/login/oauth/authorize?client_id=client&state=state_123',
            expiresAt: new Date(now + 600_500).toISOString(),
          })
        }
        if (url.endsWith('/v1/github/oauth/exchange')) {
          return json({
            accessToken: 'gho_super_secret',
            tokenType: 'bearer',
            scope: 'repo read:user read:org',
          })
        }
        if (url === 'https://api.github.com/user') return json(user)
        throw new Error(`unexpected request ${url}`)
      },
    })

    const started = await service.start('browser')
    expect(started).toMatchObject({
      mode: 'browser',
      state: 'awaiting_auth',
      authorizationUrl: expect.stringContaining('https://github.com/login/oauth/authorize'),
      userCode: null,
    })

    const completed = await service.handleCallback({ code: 'github-code', state: 'state_123' })
    expect(completed).toMatchObject({
      mode: 'browser',
      state: 'completed',
      auth: { authenticated: true, user: { login: 'octocat' } },
    })
    expect(requests[0]?.body).toMatchObject({
      redirectUri: 'http://127.0.0.1:41234/auth/github/callback',
      codeChallengeMethod: 'S256',
    })
    expect(__test.pkceChallenge(requests[1]!.body.codeVerifier!)).toBe(
      requests[0]!.body.codeChallenge!,
    )
    expect(requests[1]?.body).toMatchObject({
      attemptId: 'attempt_123',
      state: 'state_123',
      code: 'github-code',
      redirectUri: 'http://127.0.0.1:41234/auth/github/callback',
    })
    expect(db.encryptedCredential('github')?.ciphertext).not.toContain('gho_super_secret')
    expect(
      (await Effect.runPromise(credentials.get<{ accessToken: string }>('github')))?.value
        .accessToken,
    ).toBe('gho_super_secret')
    await expect(
      service.handleCallback({ code: 'github-code', state: 'state_123' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    db.close()
  })

  test('state 不匹配时拒绝交换且不破坏当前 attempt', async () => {
    const { db, credentials } = await repository()
    let requests = 0
    const service = new GithubAuthService(credentials, {
      now: () => 1_000,
      getBrokerURL: () => 'https://auth-staging.codepilotx.top',
      getCallbackURL: () => 'http://127.0.0.1:41234/auth/github/callback',
      fetch: async () => {
        requests += 1
        return json({
          attemptId: 'attempt_123',
          state: 'expected-state',
          authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=client',
          expiresAt: new Date(601_000).toISOString(),
        })
      },
    })

    const started = await service.start('browser')
    await expect(
      service.handleCallback({ code: 'code', state: 'wrong-state' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
    expect(requests).toBe(1)
    expect(await service.poll(started.loginId)).toMatchObject({ state: 'awaiting_auth' })
    db.close()
  })

  test('浏览器取消授权后返回可展示失败状态', async () => {
    const { db, credentials } = await repository()
    const service = new GithubAuthService(credentials, {
      now: () => 1_000,
      getBrokerURL: () => 'https://auth-staging.codepilotx.top',
      getCallbackURL: () => 'http://127.0.0.1:41234/auth/github/callback',
      fetch: async () =>
        json({
          attemptId: 'attempt_123',
          state: 'state_123',
          authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=client',
          expiresAt: new Date(601_000).toISOString(),
        }),
    })
    const started = await service.start('browser')
    expect(
      await service.handleCallback({ state: 'state_123', error: 'access_denied' }),
    ).toMatchObject({
      loginId: started.loginId,
      state: 'failed',
      error: expect.stringContaining('取消'),
    })
    db.close()
  })

  test('未配置 Device Flow Client ID 时安全失败且不访问网络', async () => {
    const { db, credentials } = await repository()
    let requested = false
    const service = new GithubAuthService(credentials, {
      fetch: async () => {
        requested = true
        throw new Error('should not fetch')
      },
    })
    expect(await service.start('device')).toMatchObject({
      mode: 'device',
      state: 'failed',
      error: expect.stringContaining('尚未配置'),
    })
    expect(requested).toBe(false)
    db.close()
  })
})

describe('GithubAuthService logout', () => {
  test('Broker 撤销成功后才删除本地 token', async () => {
    const { db, credentials } = await repository()
    await Effect.runPromise(
      credentials.set({
        integrationID: 'github',
        value: {
          type: 'oauth',
          accessToken: 'token',
          tokenType: 'bearer',
          scope: 'repo read:user',
        },
      }),
    )
    const service = new GithubAuthService(credentials, {
      getBrokerURL: () => 'https://auth-staging.codepilotx.top',
      fetch: async () => new Response(null, { status: 204 }),
    })
    expect(await service.logout()).toMatchObject({ authenticated: false })
    expect(db.encryptedCredential('github')).toBeNull()
    db.close()
  })

  test('Broker 网络失败时保留本地 token', async () => {
    const { db, credentials } = await repository()
    await Effect.runPromise(
      credentials.set({
        integrationID: 'github',
        value: {
          type: 'oauth',
          accessToken: 'token',
          tokenType: 'bearer',
          scope: 'repo read:user',
        },
      }),
    )
    const service = new GithubAuthService(credentials, {
      getBrokerURL: () => 'https://auth-staging.codepilotx.top',
      fetch: async () => {
        throw new Error('offline')
      },
    })
    await expect(service.logout()).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
      status: 503,
    })
    expect(db.encryptedCredential('github')).not.toBeNull()
    db.close()
  })
})

describe('GithubAuthService URL 安全边界', () => {
  test('Broker 仅允许 HTTPS 或 loopback HTTP', () => {
    expect(__test.validatedBrokerURL('https://auth-staging.codepilotx.top').origin).toBe(
      'https://auth-staging.codepilotx.top',
    )
    expect(__test.validatedBrokerURL('http://127.0.0.1:8787').origin).toBe('http://127.0.0.1:8787')
    expect(() => __test.validatedBrokerURL('http://example.com')).toThrow('地址无效')
  })
})
