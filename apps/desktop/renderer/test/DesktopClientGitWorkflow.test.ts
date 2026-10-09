import { describe, expect, test } from 'bun:test'
import type { Project } from '@pidex/shared'
import { createDesktopClient } from '../src/services/desktop-client/index.js'
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
        rpc: { call: async () => { throw new Error('unused') } },
        withRequiredAgent: async () => { throw new AgentRpcError('安全错误', -32000, { code }) },
      })
      expect(await client.getWorkspaceGitStatus(workspacePath)).toEqual({
        ok: false, error: '检测失败', errorCode: code,
      })
    }
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
