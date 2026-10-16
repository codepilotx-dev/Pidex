import { describe, expect, test } from 'bun:test'
import type { Project } from '@pidex/shared'
import { createDesktopClient } from '../src/services/desktop-client/index.js'
import { createAgentReviewApi } from '../src/services/desktop-client/AgentReviewApi.js'
import { createAgentGitApi } from '../src/services/desktop-client/AgentGitApi.js'
import { AgentRpcError } from '../src/services/AgentRpcClient.js'

const workspacePath = 'F:\\CodeProject\\clones\\fixture'
const project: Project = {
  id: 'project-git',
  name: 'fixture',
  primaryFolderId: 'folder-primary',
  folders: [
    {
      id: 'folder-primary',
      name: 'fixture',
      path: workspacePath,
      role: 'primary',
      availability: 'available',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  removedAt: null,
  lastOpenedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  settings: {
    defaultModel: null,
    instructions: '',
    version: 1,
  },
}

const status = {
  branchName: 'feature/desktop-rpc',
  upstream: null,
  ahead: 0,
  behind: 0,
  clean: true,
  files: [],
}

const rpc = (id: string | number, result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  })

describe('desktop git workflow client', () => {
  test('Git status preserves RPC error classification without parsing message text', async () => {
    for (const code of ['REPOSITORY_NOT_FOUND', 'CAPABILITY_NOT_SUPPORTED']) {
      const client = createAgentGitApi({
        environment: {} as never,
        ensureDesktopProjectTrusted: async (value) => value,
        invalidateProjectCache: () => {},
        loadProjectById: async () => project,
        loadProjectForPath: async () => project,
        operationError: () => '检测失败',
        requireAgentCapability: () => {},
        rpc: {
          call: async () => {
            throw new Error('unused')
          },
        },
        withRequiredAgent: async () => {
          throw new AgentRpcError('安全错误', -32000, { code })
        },
      })
      expect(await client.getWorkspaceGitStatus(workspacePath)).toEqual({
        ok: false,
        error: '检测失败',
        errorCode: code,
      })
    }
  })
  test('会话内推送与创建 PR 会把 threadId 透传给 Agent 以解析真实工作树目录', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const client = createAgentGitApi({
      environment: {} as never,
      ensureDesktopProjectTrusted: async (value) => value,
      invalidateProjectCache: () => {},
      loadProjectById: async () => project,
      loadProjectForPath: async () => project,
      operationError: () => '失败',
      requireAgentCapability: () => {},
      rpc: {
        call: async (method: string, params: unknown) => {
          calls.push({ method, params })
          if (method === 'github/push')
            return { repositoryUrl: 'https://github.com/octocat/fixture', status }
          if (method === 'github/pullRequest/createForProject')
            return {
              pullRequest: { htmlUrl: 'https://github.com/octocat/fixture/pull/7', number: 7 },
            }
          throw new Error(`unexpected method ${method}`)
        },
      } as never,
      withRequiredAgent: async (operation) => operation(),
    })

    await client.pushWorkspaceBranch({ workspacePath, threadId: 'thread-1', setUpstream: true })
    await client.createPullRequest({ workspacePath, threadId: 'thread-1', title: '标题' })

    expect(calls).toEqual([
      {
        method: 'github/push',
        params: {
          projectId: project.id,
          setUpstream: true,
          forceWithLease: false,
          threadId: 'thread-1',
        },
      },
      {
        method: 'github/pullRequest/createForProject',
        params: { projectId: project.id, title: '标题', threadId: 'thread-1' },
      },
    ])
  })
  test('Electron 克隆、创建分支和切换分支都调用真实 Agent RPC', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = []
    const client = createDesktopClient({
      window: {
        DesktopBridge: {
          pickWorkspaceDirectory: async () => 'F:\\CodeProject\\clones',
        },
      },
      fetch: async (_path, init) => {
        const body = JSON.parse(String(init?.body))
        const params = body.params ?? {}
        if (body.method === 'initialize') {
          return rpc(body.id, {
            protocol: 'thread-rpc-v4',
            serverInfo: { name: 'test-agent', version: '1.0.0' },
            capabilities: [
              'rpc.typed.v1',
              'github.oauth.v1',
              'git.review.v1',
              'git.workspace.v1',
              'config.manage.v1',
            ],
            limits: {
              maxFrameBytes: 1024,
              maxSubscriptions: 8,
              maxStreamsPerSubscription: 8,
              maxPendingRequests: 32,
            },
            connectionId: 'connection-git',
          })
        }
        if (body.method === 'initialized') {
          return new Response(null, { status: 204 })
        }
        requests.push({ method: body.method, params })
        if (body.method === 'github/repository/clone') {
          return rpc(body.id, { project })
        }
        if (body.method === 'project/trust/read') {
          return rpc(body.id, {
            projectRoot: workspacePath,
            trustLevel: 'untrusted',
            hasProjectConfig: false,
          })
        }
        if (body.method === 'project/trust/update') {
          return rpc(body.id, {
            status: 'ok',
            version: 'a'.repeat(64),
            filePath: 'F:\\CodeProject\\config.json',
          })
        }
        if (body.method === 'project/list') {
          return rpc(body.id, { projects: [project], nextCursor: null })
        }
        if (body.method === 'project/open') {
          return rpc(body.id, { project })
        }
        if (body.method === 'review/commits') return rpc(body.id, { commits: [] })
        if (body.method === 'review/status') {
          return rpc(body.id, { status })
        }
        if (body.method === 'git/branch/create' || body.method === 'git/branch/checkout') {
          return rpc(body.id, { project, status })
        }
        throw new Error(`Unexpected RPC method: ${body.method}`)
      },
    })

    const cloned = await client.cloneGithubRepository({
      repository: {
        id: 42,
        name: 'fixture',
        fullName: 'pidex/fixture',
        owner: 'pidex',
        private: false,
        fork: false,
        archived: false,
        disabled: false,
        cloneUrl: 'https://should-not-be-sent.example/fixture.git',
        sshUrl: 'git@example.invalid:fixture.git',
        htmlUrl: 'https://example.invalid/fixture',
        description: null,
        defaultBranch: 'main',
        pushedAt: null,
        updatedAt: null,
      },
    })
    expect(cloned).toMatchObject({
      ok: true,
      workspace: { path: workspacePath, branchName: status.branchName },
    })
    expect(requests.slice(0, 4).map((item) => item.method)).toEqual([
      'github/repository/clone',
      'project/trust/read',
      'project/trust/update',
      'review/status',
    ])

    const created = await client.createWorkspaceBranch({
      workspacePath,
      branchName: 'feature/desktop-rpc',
    })
    expect(created).toMatchObject({
      ok: true,
      workspace: { branchName: status.branchName },
    })
    const checkedOut = await client.checkoutWorkspaceBranch(workspacePath, 'feature/desktop-rpc')
    expect(checkedOut.branchName).toBe(status.branchName)

    const beforeHistory = requests.length
    expect(await client.getAgentReviewCommits('F:\\not-the-selected-project', project.id)).toEqual(
      [],
    )
    expect(
      requests.slice(beforeHistory).filter((request) => request.method !== 'project/list'),
    ).toEqual([{ method: 'review/commits', params: { projectId: project.id, limit: 20 } }])

    expect(
      requests.filter(
        (item) =>
          item.method === 'github/repository/clone' || item.method.startsWith('git/branch/'),
      ),
    ).toEqual([
      {
        method: 'github/repository/clone',
        params: {
          repositoryId: 42,
          targetParent: 'F:\\CodeProject\\clones',
        },
      },
      {
        method: 'git/branch/create',
        params: {
          projectId: project.id,
          branchName: 'feature/desktop-rpc',
        },
      },
      {
        method: 'git/branch/checkout',
        params: {
          projectId: project.id,
          branchName: 'feature/desktop-rpc',
        },
      },
    ])
  })

  test('GitHub clone reports failure without removing the project when trust cannot be persisted', async () => {
    const requests: string[] = []
    const client = createDesktopClient({
      window: {
        DesktopBridge: {
          pickWorkspaceDirectory: async () => 'F:\\CodeProject\\clones',
        },
      },
      fetch: async (_path, init) => {
        const body = JSON.parse(String(init?.body))
        if (body.method === 'initialize') {
          return rpc(body.id, {
            protocol: 'thread-rpc-v4',
            serverInfo: { name: 'test-agent', version: '1.0.0' },
            capabilities: ['rpc.typed.v1', 'github.oauth.v1', 'config.manage.v1'],
            limits: {
              maxFrameBytes: 1024,
              maxSubscriptions: 8,
              maxStreamsPerSubscription: 8,
              maxPendingRequests: 32,
            },
            connectionId: 'connection-git-trust-failure',
          })
        }
        if (body.method === 'initialized') return new Response(null, { status: 204 })
        requests.push(body.method)
        if (body.method === 'github/repository/clone') return rpc(body.id, { project })
        if (body.method === 'project/trust/read') {
          return rpc(body.id, {
            projectRoot: workspacePath,
            trustLevel: 'untrusted',
            hasProjectConfig: false,
          })
        }
        if (body.method === 'project/trust/update') {
          return new Response('trust write failed', { status: 500 })
        }
        throw new Error(`Unexpected RPC method: ${body.method}`)
      },
    })

    const cloned = await client.cloneGithubRepository({
      repository: {
        id: 42,
        name: 'fixture',
        fullName: 'pidex/fixture',
        owner: 'pidex',
        private: false,
        fork: false,
        archived: false,
        disabled: false,
        cloneUrl: 'https://should-not-be-sent.example/fixture.git',
        sshUrl: 'git@example.invalid:fixture.git',
        htmlUrl: 'https://example.invalid/fixture',
        description: null,
        defaultBranch: 'main',
        pushedAt: null,
        updatedAt: null,
      },
    })

    expect(cloned).toMatchObject({ ok: false })
    expect(requests).toEqual([
      'github/repository/clone',
      'project/trust/read',
      'project/trust/update',
    ])
    expect(requests).not.toContain('project/remove')
  })
})

test('按引用查询提交需要协商能力，并透传引用参数', async () => {
  const calls: unknown[] = []
  let capabilities = ['git.review.v1']
  const api = createAgentReviewApi({
    rpc: {
      ensureInitialized: async () => ({ capabilities }),
      call: async (_method: string, params: unknown) => {
        calls.push(params)
        return { commits: [] }
      },
    } as never,
    loadProjectById: async () => project,
    loadProjectForPath: async () => project,
    preparePullRequestReview: async () => {},
    requireGithubPullRequestCapability: () => {},
    requireReviewCapability: () => {},
    unsupportedReviewOperation: () => {
      throw new Error('unsupported')
    },
    withAgentOrMock: (operation) => operation(),
  })
  await expect(api.getAgentReviewCommits(workspacePath, project.id, 'other')).rejects.toThrow(
    'unsupported',
  )
  expect(calls).toEqual([])
  capabilities = [...capabilities, 'git.review.commit-ref.v1']
  await api.getAgentReviewCommits(workspacePath, project.id, 'other')
  expect(calls).toEqual([{ projectId: project.id, limit: 20, ref: 'other' }])
})
