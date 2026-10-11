import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { Effect } from 'effect'
import {
  EncryptedCredentialRepository,
  type MasterKeyStore,
} from '../src/auth/EncryptedCredentialRepository'
import { AgentError } from '../src/Domain'
import { GithubService, __test } from '../src/github/GithubService'
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
  const root = await mkdtemp(join(tmpdir(), 'pidex-github-service-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  return { root, db, credentials: new EncryptedCredentialRepository(db, memoryKeyStore()) }
}

const json = (value: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const git = async (cwd: string, ...args: string[]) => {
  const process = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (code !== 0) throw new Error(`git ${args.join(' ')} failed: ${stderr}`)
  return stdout.trim()
}

const user = {
  login: 'octocat',
  id: 1,
  name: 'The Octocat',
  avatar_url: 'https://avatars.example/octocat',
  html_url: 'https://github.com/octocat',
}

describe('GithubService Device Flow', () => {
  test('遵守 interval 和 slow_down，并将 access token 加密保存', async () => {
    const { db, credentials } = await repository()
    let now = 1_000
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responses = [
      json({
        device_code: 'device-secret',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 1,
      }),
      json({ error: 'slow_down' }),
      json({
        access_token: 'gho_super_secret_token_value',
        token_type: 'bearer',
        scope: 'repo,read:user,read:org',
      }),
      json(user),
    ]
    const service = new GithubService(credentials, {
      now: () => now,
      getConfiguredClientId: () => 'client-id',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) })
        const response = responses.shift()
        if (!response) throw new Error('unexpected request')
        return response
      },
    })

    const started = await service.startDeviceFlow()
    expect(started).toMatchObject({
      state: 'awaiting_auth',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
    })
    expect(typeof started.loginId).toBe('string')
    expect(new URLSearchParams(String(requests[0]?.init?.body)).get('scope')).toBe(
      'repo read:user read:org',
    )

    expect((await service.pollDeviceFlow(started.loginId!)).state).toBe('awaiting_auth')
    expect(requests).toHaveLength(1)
    now += 1_000
    expect((await service.pollDeviceFlow(started.loginId!)).state).toBe('awaiting_auth')
    now += 5_999
    expect((await service.pollDeviceFlow(started.loginId!)).state).toBe('awaiting_auth')
    expect(requests).toHaveLength(2)
    now += 1

    const completed = await service.pollDeviceFlow(started.loginId!)
    expect(completed).toMatchObject({
      state: 'completed',
      auth: { configured: true, authenticated: true, user: { login: 'octocat' } },
    })
    expect(requests).toHaveLength(4)
    expect(db.encryptedCredential('github')?.ciphertext).not.toContain(
      'gho_super_secret_token_value',
    )
    expect(
      (await Effect.runPromise(credentials.get<{ accessToken: string }>('github')))?.value
        .accessToken,
    ).toBe('gho_super_secret_token_value')
    db.close()
  })

  test('过期、拒绝和未启用 Device Flow 返回可操作错误', async () => {
    for (const [error, message] of [
      ['token_expired', '已过期'],
      ['access_denied', '已被取消'],
      ['incorrect_client_credentials', 'Client ID 无效'],
      ['incorrect_device_code', 'Device Code 无效'],
      ['device_flow_disabled', '未启用 Device Flow'],
    ] as const) {
      const { db, credentials } = await repository()
      let call = 0
      let now = 10_000
      const service = new GithubService(credentials, {
        now: () => now,
        fetch: async () => {
          call += 1
          return call === 1
            ? json({
                device_code: 'device',
                user_code: 'CODE',
                verification_uri: 'https://github.com/login/device',
                expires_in: 900,
                interval: 1,
              })
            : json({ error })
        },
      })
      const started = await service.startDeviceFlow('client-id')
      now += 1_000
      expect(await service.pollDeviceFlow(started.loginId!)).toMatchObject({
        state: 'failed',
        error: expect.stringContaining(message),
      })
      db.close()
    }
  })

  test('授权范围不足时不保存 token', async () => {
    const { db, credentials } = await repository()
    let call = 0
    let now = 10_000
    const service = new GithubService(credentials, {
      now: () => now,
      fetch: async () => {
        call += 1
        return call === 1
          ? json({
              device_code: 'device',
              user_code: 'CODE',
              verification_uri: 'https://github.com/login/device',
              expires_in: 900,
              interval: 1,
            })
          : json({
              access_token: 'gho_under_scoped',
              token_type: 'bearer',
              scope: 'repo,read:user',
            })
      },
    })
    const started = await service.startDeviceFlow('client-id')
    now += 1_000
    expect(await service.pollDeviceFlow(started.loginId!)).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('授权范围不足'),
    })
    expect(db.encryptedCredential('github')).toBeNull()
    db.close()
  })

  test('新登录尝试会使旧 loginId 的轮询失效', async () => {
    const { db, credentials } = await repository()
    let sequence = 0
    const service = new GithubService(credentials, {
      fetch: async () => {
        sequence += 1
        return json({
          device_code: `device-${sequence}`,
          user_code: `CODE-${sequence}`,
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 1,
        })
      },
    })

    const first = await service.startDeviceFlow('client-id')
    const second = await service.startDeviceFlow('client-id')
    expect(first.loginId).not.toBe(second.loginId)
    await expect(service.pollDeviceFlow(first.loginId!)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
    db.close()
  })
})

describe('GithubService API', () => {
  test('PR 自动合并重新读取门槛，并以 expectedHeadOid 原子绑定准确 SHA', async () => {
    const { db, credentials } = await repository()
    await Effect.runPromise(
      credentials.set({
        integrationID: 'github',
        value: { type: 'oauth', accessToken: 'test-token', tokenType: 'bearer', scope: 'repo' },
      }),
    )
    let mutations = 0
    let state = {
      id: 'PR_node',
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'a'.repeat(40),
      headRefName: 'feature',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: 'APPROVED',
      headRepository: { name: 'repository', owner: { login: 'owner' } },
      statusCheckRollup: { state: 'SUCCESS' },
      reviews: { nodes: [] },
    }
    const service = new GithubService(credentials, {
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body))
        if (body.query.startsWith('mutation')) {
          mutations++
          expect(body.variables.input).toEqual({
            pullRequestId: 'PR_node',
            expectedHeadOid: 'a'.repeat(40),
            mergeMethod: 'SQUASH',
          })
          return json({ data: { mergePullRequest: { pullRequest: { merged: true } } } })
        }
        return json({ data: { repository: { pullRequest: state } } })
      },
    })
    const input = {
      owner: 'owner',
      repository: 'repository',
      number: 1,
      headSha: 'a'.repeat(40),
      method: 'squash' as const,
    }
    await expect(
      service.mergeWatchedPullRequest({ ...input, headSha: 'b'.repeat(40) }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    state = { ...state, reviewDecision: 'REVIEW_REQUIRED' }
    await expect(service.mergeWatchedPullRequest(input)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(mutations).toBe(0)
    state = { ...state, reviewDecision: 'APPROVED' }
    await service.mergeWatchedPullRequest(input)
    expect(mutations).toBe(1)
    db.close()
  })
  test('仓库列表只在 Agent 内附加 Authorization', async () => {
    const { db, credentials } = await repository()
    await Effect.runPromise(
      credentials.set({
        integrationID: 'github',
        value: {
          type: 'oauth',
          accessToken: 'gho_hidden_value',
          tokenType: 'bearer',
          scope: 'repo read:user',
        },
      }),
    )
    let authorization = ''
    const service = new GithubService(credentials, {
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get('Authorization') ?? ''
        return json([
          {
            id: 42,
            name: 'repo',
            full_name: 'octocat/repo',
            owner: { login: 'octocat' },
            private: true,
            fork: false,
            archived: false,
            disabled: false,
            clone_url: 'https://github.com/octocat/repo.git',
            ssh_url: 'git@github.com:octocat/repo.git',
            html_url: 'https://github.com/octocat/repo',
            description: null,
            default_branch: 'main',
            pushed_at: null,
            updated_at: '2026-01-01T00:00:00Z',
          },
        ])
      },
    })

    expect(await service.repositories()).toEqual({
      repositories: [expect.objectContaining({ fullName: 'octocat/repo', private: true })],
    })
    expect(authorization).toBe('Bearer gho_hidden_value')
    db.close()
  })

  test('Profile overview 使用真实 GraphQL 组织、仓库和贡献数据', async () => {
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
    let requestBody: Record<string, unknown> | null = null
    const repositoryNode = {
      id: 'R_repo',
      name: 'repo',
      nameWithOwner: 'octocat/repo',
      url: 'https://github.com/octocat/repo',
      description: 'Repository',
      isPrivate: false,
      isFork: false,
      primaryLanguage: { name: 'TypeScript', color: '#3178c6' },
      stargazerCount: 12,
      forkCount: 3,
      updatedAt: '2026-07-18T00:00:00Z',
    }
    const service = new GithubService(credentials, {
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body))
        return json({
          data: {
            viewer: {
              login: 'octocat',
              databaseId: 1,
              name: 'The Octocat',
              avatarUrl: 'https://avatars.example/octocat',
              url: 'https://github.com/octocat',
              bio: 'Hello',
              company: '@github',
              location: 'Internet',
              websiteUrl: 'https://example.com',
              email: null,
              followers: { totalCount: 10 },
              following: { totalCount: 2 },
              repositories: { totalCount: 20 },
              starredRepositories: { totalCount: 30 },
              status: {
                emoji: ':shipit:',
                message: 'Building',
                indicatesLimitedAvailability: false,
                expiresAt: null,
              },
              organizations: {
                nodes: [
                  {
                    login: 'github',
                    avatarUrl: 'https://avatars.example/github',
                    url: 'https://github.com/github',
                  },
                ],
              },
              pinnedItems: { nodes: [repositoryNode] },
              popularRepositories: { nodes: [repositoryNode] },
              contributionsCollection: {
                totalCommitContributions: 100,
                totalIssueContributions: 4,
                totalPullRequestContributions: 8,
                totalPullRequestReviewContributions: 6,
                restrictedContributionsCount: 1,
                contributionCalendar: {
                  totalContributions: 119,
                  weeks: [
                    {
                      contributionDays: [
                        {
                          date: '2026-07-18',
                          contributionCount: 5,
                          color: '#216e39',
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        })
      },
    })

    const result = await service.profileOverview()
    expect(requestBody).toMatchObject({
      query: expect.stringContaining('PidexProfileOverview'),
      variables: {},
    })
    expect(result.overview).toMatchObject({
      user: {
        login: 'octocat',
        repositoryCount: 20,
        starredRepositoryCount: 30,
        status: { message: 'Building' },
      },
      organizations: [{ login: 'github' }],
      pinnedRepositories: [{ fullName: 'octocat/repo', stargazerCount: 12 }],
      popularRepositories: [{ fullName: 'octocat/repo' }],
      contributions: {
        totalContributions: 119,
        totalCommitContributions: 100,
        weeks: [{ days: [{ date: '2026-07-18', count: 5, color: '#216e39' }] }],
      },
    })
    db.close()
  })

  test('行评论自动读取最新 head SHA 并使用 line/side', async () => {
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
    const bodies: unknown[] = []
    const service = new GithubService(credentials, {
      fetch: async (input, init) => {
        if (init?.body) bodies.push(JSON.parse(String(init.body)))
        if (String(input).endsWith('/pulls/7')) {
          return json({
            id: 10,
            number: 7,
            title: 'PR',
            body: null,
            state: 'open',
            draft: false,
            html_url: 'https://github.com/octocat/repo/pull/7',
            base: { ref: 'main', sha: 'base-sha' },
            head: { ref: 'feature', sha: 'head-sha' },
            additions: 1,
            deletions: 0,
            changed_files: 1,
            mergeable: true,
          })
        }
        return json({
          id: 99,
          node_id: 'PRRC_node',
          html_url: 'https://github.com/octocat/repo/pull/7#discussion_r99',
          body: 'please fix',
        })
      },
    })

    await service.createPullRequestComment({
      owner: 'octocat',
      repository: 'repo',
      number: 7,
      body: 'please fix',
      path: 'src/index.ts',
      side: 'RIGHT',
      line: 12,
      expectedHeadRevision: 'head-sha',
    })
    expect(bodies).toEqual([
      {
        body: 'please fix',
        path: 'src/index.ts',
        side: 'RIGHT',
        line: 12,
        commit_id: 'head-sha',
      },
    ])
    db.close()
  })

  test('Pull Request head 变化时拒绝提交行评论', async () => {
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
    let requests = 0
    const service = new GithubService(credentials, {
      fetch: async () => {
        requests += 1
        return json({
          id: 10,
          number: 7,
          title: 'PR',
          body: null,
          state: 'open',
          draft: false,
          html_url: 'https://github.com/octocat/repo/pull/7',
          base: { ref: 'main', sha: 'base-sha' },
          head: { ref: 'feature', sha: 'new-head-sha' },
          additions: 1,
          deletions: 0,
          changed_files: 1,
          mergeable: true,
        })
      },
    })

    await expect(
      service.createPullRequestComment({
        owner: 'octocat',
        repository: 'repo',
        number: 7,
        body: 'please fix',
        path: 'src/index.ts',
        side: 'RIGHT',
        line: 12,
        expectedHeadRevision: 'old-head-sha',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(requests).toBe(1)
    db.close()
  })

  test('从已注册项目的 GitHub remote 和当前分支创建 PR', async () => {
    const { root, db, credentials } = await repository()
    await git(root, 'init', '-b', 'feature')
    await git(root, 'config', 'user.name', 'Pidex Test')
    await git(root, 'config', 'user.email', 'test@pidex.local')
    await Bun.write(join(root, 'README.md'), '# fixture\n')
    await git(root, 'add', 'README.md')
    await git(root, 'commit', '-m', 'initial')
    await git(root, 'remote', 'add', 'origin', 'git@github.com:octocat/repo.git')
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
    const requests: Array<{ url: string; body: unknown }> = []
    const service = new GithubService(credentials, {
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        })
        if (init?.method === 'GET') return json({ default_branch: 'main' })
        return json({
          id: 10,
          number: 7,
          title: 'Fixture PR',
          body: 'Body',
          state: 'open',
          draft: true,
          html_url: 'https://github.com/octocat/repo/pull/7',
          base: { ref: 'main', sha: 'base-sha' },
          head: { ref: 'feature', sha: 'head-sha' },
          additions: 1,
          deletions: 0,
          changed_files: 1,
          mergeable: null,
        })
      },
    })

    expect(
      await service.createPullRequestForProject({
        workspaceRoot: root,
        title: 'Fixture PR',
        body: 'Body',
        draft: true,
      }),
    ).toMatchObject({
      pullRequest: { number: 7, head: { ref: 'feature' }, base: { ref: 'main' } },
    })
    expect(requests).toEqual([
      {
        url: 'https://api.github.com/repos/octocat/repo',
        body: null,
      },
      {
        url: 'https://api.github.com/repos/octocat/repo/pulls',
        body: {
          title: 'Fixture PR',
          head: 'feature',
          base: 'main',
          body: 'Body',
          draft: true,
        },
      },
    ])
    db.close()
  }, 15_000)

  test('COMMENT 和 REQUEST_CHANGES 必须包含 body', async () => {
    const { db, credentials } = await repository()
    const service = new GithubService(credentials)
    await expect(
      service.submitPullRequestReview({
        owner: 'octocat',
        repository: 'repo',
        number: 1,
        event: 'REQUEST_CHANGES',
        expectedHeadRevision: 'head-sha',
      }),
    ).rejects.toBeInstanceOf(AgentError)
    db.close()
  })

  test('只接受 GitHub.com remote', () => {
    expect(__test.parseGithubRemote('git@github.com:octocat/repo.git')).toEqual({
      owner: 'octocat',
      repository: 'repo',
    })
    expect(__test.parseGithubRemote('https://github.com/octocat/repo.git')).toEqual({
      owner: 'octocat',
      repository: 'repo',
    })
    expect(() => __test.parseGithubRemote('https://gitlab.com/octocat/repo.git')).toThrow(
      '不是 GitHub.com',
    )
    expect(() => __test.parseGithubRemote('https://github.com/octocat%26calc/repo.git')).toThrow(
      '地址无效',
    )
  })

  test('解析 porcelain v2 分支、ahead/behind、普通文件、重命名和未跟踪文件', () => {
    expect(
      __test.parseGitStatus(
        [
          '# branch.oid abc',
          '# branch.head feature',
          '# branch.upstream origin/feature',
          '# branch.ab +2 -1',
          '1 M. N... 100644 100644 100644 abc def src/staged.ts',
          '2 R. N... 100644 100644 100644 abc def R100 src/new name.ts',
          'src/old name.ts',
          '? src/untracked.ts',
          '',
        ].join('\0'),
      ),
    ).toEqual({
      branchName: 'feature',
      upstream: 'origin/feature',
      ahead: 2,
      behind: 1,
      clean: false,
      files: [
        expect.objectContaining({ path: 'src/staged.ts', stagedStatus: 'M', unstagedStatus: '' }),
        expect.objectContaining({
          path: 'src/new name.ts',
          originalPath: 'src/old name.ts',
          stagedStatus: 'R',
        }),
        expect.objectContaining({ path: 'src/untracked.ts', isUntracked: true }),
      ],
    })
  })
})
