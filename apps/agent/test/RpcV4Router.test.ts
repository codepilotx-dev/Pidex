import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { Effect, Schema } from 'effect'
import { DEFAULT_PERMISSION_CONFIG } from '@pidex/shared/thread'
import { Model, Provider } from '@pidex/model-schema'
import { Capabilities, type ProtocolCapability } from '@pidex/agent-protocol'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { AgentError } from '../src/Domain'
import { PiModelServiceError } from '../src/provider/pi/PiModelService'
import { RpcRouter, type RpcRouterDependencies } from '../src/transport/rpc/RpcRouter'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { TerminalOutputMirror } from '../src/terminal/TerminalOutputMirror'
import { rpcTransportAuthority } from '../src/transport/Server'
import { TurnCoordinator } from '../src/session/TurnCoordinator'

const roots: string[] = []
afterEach(async () => {
  await removeFixturePaths(roots.splice(0))
})

const fixture = async (
  overrides: Partial<RpcRouterDependencies> = {},
  routerOptions: { connectionLeaseMs?: number; now?: () => number } = {},
) => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-rpc-v4-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  let reviewSummaryCalls = 0
  let githubStatusCalls = 0
  const reviewSnapshot = (projectId: string, source: { kind: 'unstaged' }) => ({
    projectId,
    generation: 'generation:1',
    source,
    repositoryRoot: root,
    headSha: null,
    baseSha: null,
    files: [],
    totals: { files: 0, additions: 0, deletions: 0, changedLines: 0, changedBytes: 0 },
    largeDiffMode: false,
  })
  const review = {
    summary: async (projectId: string, source: { kind: 'unstaged' }) => {
      reviewSummaryCalls += 1
      return reviewSnapshot(projectId, source)
    },
    summaryResult: async (projectId: string, source: { kind: 'unstaged' }) => {
      reviewSummaryCalls += 1
      return {
        snapshot: reviewSnapshot(projectId, source),
        cacheState: 'fresh' as const,
      }
    },
    applyBatch: async (input: {
      action: 'stage' | 'unstage' | 'revert'
      generation: string
      items: Array<{ path: string }>
    }) => ({
      ok: true as const,
      action: input.action,
      paths: input.items.map((item) => item.path),
      generation: input.generation,
      appliedCount: input.items.length,
    }),
  }
  const github = {
    authStatus: async () => {
      githubStatusCalls += 1
      return { configured: false, authenticated: false, user: null }
    },
  }
  const configDocument: Record<string, unknown> = {}
  const router = new RpcRouter(
    {
      config: {
        snapshot: () => configDocument,
        read: async () => ({
          config: configDocument,
          origins: {},
          diagnostics: [],
          profileState: {
            activeProfile: null,
            selectedProfile: null,
            restartRequired: false,
          },
        }),
        batchWrite: async ({ edits }: { edits: Array<{ keyPath: string[]; value: unknown }> }) => {
          for (const edit of edits) {
            let cursor = configDocument
            for (const key of edit.keyPath.slice(0, -1)) {
              if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {}
              cursor = cursor[key] as Record<string, unknown>
            }
            const leaf = edit.keyPath.at(-1)!
            if (edit.value === null) delete cursor[leaf]
            else cursor[leaf] = edit.value
          }
          return {
            status: 'ok',
            version: 'a'.repeat(64),
            filePath: join(root, 'config.json'),
          }
        },
      },
      db,
      review,
      github,
      hub: { publish: () => Effect.void },
      threads: { resumeHookTrust: () => undefined },
      history: null,
      approvals: null,
      questions: null,
      subagents: null,
      attachments: null,
      providers: null,
      piModels: null,
      providerCredentials: null,
      authSessions: null,
      apiKeys: null,
      modelHealth: null,
      memory: null,
      hooks: null,
      handoff: { assertAdmissionOpen: () => undefined },
      ...overrides,
    } as unknown as RpcRouterDependencies,
    routerOptions,
  )
  let id = 0
  let connectionId: string | null = null
  let transportAuthority: 'desktop-host' | 'renderer' | undefined
  const call = (method: string, params: Record<string, unknown>) =>
    router.handle(
      { jsonrpc: '2.0', id: `test:${++id}`, method, params },
      {
        ...(connectionId ? { connectionId } : {}),
        ...(transportAuthority ? { transportAuthority } : {}),
      },
    ) as Promise<any>
  const initialize = async (
    capabilities: readonly string[] = Capabilities,
    clientInfo: Record<string, unknown> = {},
    authority?: 'desktop-host' | 'renderer',
  ) => {
    transportAuthority = authority
    const response = await call('initialize', {
      clientInfo: { name: 'test', version: '1.0.0', platform: 'win32', ...clientInfo },
      protocols: ['thread-rpc-v4'],
      capabilities: [...capabilities],
      interactionDelivery: 'active',
    })
    if (!response.result) return response
    connectionId = response.result.connectionId
    await router.handle(
      {
        jsonrpc: '2.0',
        method: 'initialized',
        params: { protocol: 'thread-rpc-v4' },
      },
      {
        connectionId: connectionId!,
        ...(transportAuthority ? { transportAuthority } : {}),
      },
    )
    return response
  }
  return {
    db,
    configDocument,
    router,
    call,
    initialize,
    setTransportAuthority: (authority?: 'desktop-host' | 'renderer') => {
      transportAuthority = authority
    },
    counts: () => ({ reviewSummaryCalls, githubStatusCalls }),
  }
}

describe('RPC v4 Router', () => {
  test('连接关闭只清理连接资源，不中止后端普通任务，重连保留执行句柄', async () => {
    const coordinator = new TurnCoordinator()
    const handle = coordinator.reserve('thread:background', 'turn:background')
    let stopped = 0
    const { db, router, initialize } = await fixture({
      threads: {
        resumeHookTrust: () => undefined,
        stop: async () => { stopped++; handle.controller.abort() },
      } as never,
    })
    try {
      const connected = await initialize()
      router.closeConnection(connected.result.connectionId)
      await Bun.sleep(10)
      expect(stopped).toBe(0)
      expect(handle.controller.signal.aborted).toBe(false)
      expect(coordinator.active('thread:background')?.turnID).toBe('turn:background')
      await initialize()
      expect(handle.controller.signal.aborted).toBe(false)
    } finally { db.close() }
  })
  test('归档先移除定时任务并停止活动 turn，失败不写入归档', async () => {
    const calls: string[] = []
    let fail = false
    const { db, initialize, call } = await fixture({
      automation: {
        removeThreadSchedules: async () => {
          calls.push('automation')
        },
      } as never,
      scheduledTasks: {
        removeThreadSchedules: async () => {
          calls.push('scheduled')
        },
      } as never,
      threads: {
        stop: async () => {
          calls.push('stop')
          if (fail) throw new Error('stop failed')
        },
      } as never,
      history: {
        patch: async () => {
          calls.push('archive')
          return new ThreadProjection(db).list({ limit: 1 })[0]
        },
      } as never,
    })
    try {
      const root = db.createProject({ primaryPath: process.cwd() })
      const thread = db.createThread({ workspace: { kind: 'project', projectID: root.id } })
      db.sqlite
        .query(
          "INSERT INTO turns (id, thread_id, mode, sandbox_mode, approval_policy, approvals_reviewer, model_ref, status, strategy, created_at, updated_at) VALUES (?, ?, 'chat', 'workspace-write', 'never', 'user', '{}', 'running', 'start', ?, ?)",
        )
        .run('turn:archive', thread.id, Date.now(), Date.now())
      db.sqlite
        .query(
          "INSERT INTO turns (id, thread_id, mode, sandbox_mode, approval_policy, approvals_reviewer, model_ref, status, strategy, created_at, updated_at) SELECT 'turn:queued', thread_id, mode, sandbox_mode, approval_policy, approvals_reviewer, model_ref, 'queued', 'queue', created_at + 1, updated_at FROM turns WHERE id = 'turn:archive'",
        )
        .run()
      await initialize()
      const archived = await call('thread/update', {
        threadId: thread.id,
        operationId: fail ? 'archive:failed' : 'archive:ok',
        patch: { archived: true },
      })
      expect(archived.error).toBeUndefined()
      expect(calls).toEqual(['automation', 'scheduled', 'stop', 'archive'])
      expect(db.queueStateMeta(thread.id)?.pauseReason).toBe('interrupted')
      calls.length = 0
      fail = true
      const failed = await call('thread/update', {
        threadId: thread.id,
        operationId: fail ? 'archive:failed' : 'archive:ok',
        patch: { archived: true },
      })
      expect(failed.error).toBeDefined()
      expect(calls).toEqual(['automation', 'scheduled', 'stop'])
    } finally {
      db.close()
    }
  })

  test('/rpc 仅从认证来源派生 transport authority', () => {
    expect(rpcTransportAuthority('Bearer desktop-token', null, 'desktop-token')).toBe(
      'desktop-host',
    )
    expect(rpcTransportAuthority(null, 'pidex_session=desktop-token', 'desktop-token')).toBe(
      'renderer',
    )
    expect(rpcTransportAuthority(null, null, 'desktop-token')).toBeUndefined()
    expect(rpcTransportAuthority('Bearer desktop-token', null, undefined)).toBeUndefined()
  })

  test('Chat admission 使用独立 start、steer、queue/add 和精确 interrupt 入口', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const threads = {
      startTurn: async (...args: unknown[]) => {
        calls.push({ method: 'start', args })
        return { disposition: 'started' as const, turnID: 'turn:start', inputID: 'input:start' }
      },
      steerTurn: async (...args: unknown[]) => {
        calls.push({ method: 'steer', args })
        return { disposition: 'steered' as const, turnID: 'turn:active', inputID: 'input:steer' }
      },
      enqueueFollowUp: async (...args: unknown[]) => {
        calls.push({ method: 'queue', args })
        return { disposition: 'queued' as const, turnID: 'turn:queued', inputID: 'input:queued' }
      },
      stop: async (...args: unknown[]) => {
        calls.push({ method: 'interrupt', args })
        return 'interrupted' as const
      },
      resumeHookTrust: () => undefined,
    }
    const value = await fixture({ threads: threads as never })
    await value.initialize()
    const model = Model.Ref.make({
      providerID: Provider.ID.make('openai'),
      id: Model.ID.make('test'),
    })
    const thread = value.db.createThread()
    const active = value.db.createTurn(thread.id, {
      content: 'active',
      model,
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      strategy: 'start',
      taskMode: 'chat',
    })
    value.db.claimTurnExecution(active.turnID)

    const start = await value.call('turn/start', {
      threadId: 'thread:start',
      inputId: 'input:start',
      content: 'start',
      model,
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      taskMode: 'chat',
    })
    const steer = await value.call('turn/steer', {
      threadId: thread.id,
      turnId: active.turnID,
      inputId: 'input:steer',
      content: 'steer',
      attachmentIds: ['attachment:steer'],
    })
    const queued = await value.call('queue/add', {
      threadId: thread.id,
      inputId: 'input:queued',
      content: 'later',
      model,
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      taskMode: 'chat',
      operationId: 'operation:queue',
    })
    const interrupted = await value.call('turn/interrupt', {
      threadId: thread.id,
      turnId: active.turnID,
      operationId: 'operation:interrupt',
    })

    expect(start.result.disposition).toBe('accepted')
    expect(steer.result.disposition).toBe('accepted')
    expect(queued.result.admission).toBe('queued')
    expect(interrupted.result).toMatchObject({ turnId: active.turnID, status: 'interrupted' })
    expect(calls.map(({ method }) => method)).toEqual(['start', 'steer', 'queue', 'interrupt'])
    expect(calls.at(-1)?.args).toEqual([thread.id, active.turnID])
    value.db.close()
  })

  test('initialize negotiates thread-rpc-v4 and returns formal capabilities', async () => {
    const { db, initialize } = await fixture()
    const response = await initialize()
    expect(response.result).toMatchObject({
      protocol: 'thread-rpc-v4',
      serverInfo: { name: 'pidex-agent' },
      capabilities: expect.arrayContaining(['rpc.typed.v1', 'git.review.v1', 'github.oauth.v1']),
      limits: { maxSubscriptions: 16, maxStreamsPerSubscription: 64 },
    })
    expect(typeof response.result.connectionId).toBe('string')
    db.close()
  })

  test('terminal host RPC 同时要求 capability、桌面 authority 与托管进程', async () => {
    const previousManaged = process.env.PIDEX_DESKTOP_MANAGED
    process.env.PIDEX_DESKTOP_MANAGED = '1'
    try {
      const denied = await fixture({
        terminalContext: { resolve: async () => null } as never,
        terminalOutput: new TerminalOutputMirror(),
      })
      await denied.initialize()
      expect(
        (await denied.call('terminal/host/context', { threadId: 'thread:1' })).error.data.code,
      ).toBe('PERMISSION_DENIED')
      denied.db.close()

      const rendererClaim = await fixture({
        terminalContext: { resolve: async () => null } as never,
        terminalOutput: new TerminalOutputMirror(),
      })
      expect(
        (await rendererClaim.initialize(Capabilities, { authority: 'desktop-host' }, 'renderer'))
          .error.data.code,
      ).toBe('PERMISSION_DENIED')
      rendererClaim.db.close()

      const terminalOutput = new TerminalOutputMirror()
      const allowed = await fixture({
        terminalContext: {
          resolve: async (threadId: string) => ({
            threadId,
            bindingId: 'terminal-binding:1',
            contextVersion: 'context:1',
            workspaceKind: 'project' as const,
            target: { kind: 'local' as const, cwd: 'F:\\fixture' },
          }),
        } as never,
        terminalOutput,
      })
      await allowed.initialize(Capabilities, { authority: 'desktop-host' }, 'desktop-host')
      expect(
        (await allowed.call('terminal/host/context', { threadId: 'thread:1' })).result,
      ).toEqual({
        threadId: 'thread:1',
        bindingId: 'terminal-binding:1',
        contextVersion: 'context:1',
        workspaceKind: 'project',
        target: { kind: 'local', cwd: 'F:\\fixture' },
      })
      expect(
        (
          await allowed.call('terminal/host/output/reset', {
            threadId: 'thread:1',
            terminalId: 'terminal:1',
            instanceId: 'instance:1',
            oldestSequence: 0,
            nextSequence: 1,
            chunks: [
              { terminalId: 'terminal:1', instanceId: 'instance:1', sequence: 0, data: 'ready' },
            ],
            state: 'running',
            exitCode: null,
          })
        ).result,
      ).toEqual({ ok: true })
      expect(terminalOutput.read({ threadId: 'thread:1' })?.content).toBe('ready')
      allowed.setTransportAuthority('renderer')
      expect(
        (await allowed.call('terminal/host/context', { threadId: 'thread:1' })).error.data.code,
      ).toBe('UNAUTHORIZED')
      allowed.db.close()
    } finally {
      if (previousManaged === undefined) delete process.env.PIDEX_DESKTOP_MANAGED
      else process.env.PIDEX_DESKTOP_MANAGED = previousManaged
    }
  })

  test('sandbox compatibility methods report the removed runtime without invoking a backend', async () => {
    const { db, initialize, call } = await fixture()
    await initialize()

    for (const method of ['sandbox/status', 'sandbox/refresh']) {
      expect((await call(method, {})).result).toEqual({
        sandbox: {
          state: 'unsupported',
          platform: process.platform,
          architecture: process.arch,
          runtimeVersion: 'host-hook-v1',
          maturity: 'alpha',
          maxConcurrentCommands: 1,
          error: '内置命令沙箱已移除；Shell 经 Pi Hook 和权限检查后以当前用户身份在本机执行。',
          operations: {
            canInstall: false,
            canRepair: false,
            canUninstall: false,
          },
        },
      })
    }

    for (const [method, params] of [
      ['sandbox/install', { operationId: 'sandbox:install' }],
      ['sandbox/repair', { operationId: 'sandbox:repair' }],
      ['sandbox/uninstall', { operationId: 'sandbox:uninstall', confirm: true }],
    ] as const) {
      expect((await call(method, params)).error).toMatchObject({
        code: -32000,
        data: { code: 'SANDBOX_UNAVAILABLE', retryable: true },
      })
    }
    db.close()
  })

  test('Local environment、worktree 与 Handoff 方法经独立 handler 注册且保持公开边界', async () => {
    const operation = {
      operationId: 'operation:handoff',
      sourceThreadId: 'thread:1',
      targetThreadId: 'thread:2',
      direction: 'local-to-worktree' as const,
      status: 'await-client-transfer' as const,
      step: 'await-client-transfer' as const,
      revision: 10,
      errorCode: null,
      warnings: [],
      createdAt: 1,
      updatedAt: 2,
      completedAt: null,
    }
    const { db, initialize, call } = await fixture({
      localEnvironment: {
        actionListForThread: async () => ({
          revision: 'a'.repeat(64),
          actions: [{ name: 'Dev', availability: 'available' as const }],
        }),
      } as unknown as RpcRouterDependencies['localEnvironment'],
      worktrees: {
        list: () => ({ worktrees: [] }),
      } as unknown as RpcRouterDependencies['worktrees'],
      handoff: {
        assertAdmissionOpen: () => undefined,
        pending: () => operation,
        status: async () => ({ operation, changed: true }),
      } as unknown as RpcRouterDependencies['handoff'],
    })
    await initialize()
    expect(
      (await call('local-environment/action/list', { threadId: 'thread:1' })).result.actions,
    ).toEqual([{ name: 'Dev', availability: 'available' }])
    expect((await call('worktree/list', { projectId: 'project:1' })).result).toEqual({
      worktrees: [],
    })
    expect(
      (await call('thread/handoff/status', { operationId: operation.operationId })).result,
    ).toEqual({
      operation,
      changed: true,
    })
    expect(
      (await call('thread/handoff/pending', { sourceThreadId: operation.sourceThreadId })).result,
    ).toEqual({
      operation,
    })
    db.close()
  })

  test('Handoff 持久锁在 admission 前返回稳定错误', async () => {
    const { db, initialize, call } = await fixture({
      handoff: {
        assertAdmissionOpen: () => {
          throw new AgentError('HANDOFF_IN_PROGRESS', '任务正在 Handoff', 409)
        },
      } as unknown as RpcRouterDependencies['handoff'],
    })
    await initialize()
    const response = await call('turn/start', {
      threadId: 'thread:locked',
      inputId: 'input:locked',
      content: 'blocked',
      model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      taskMode: 'chat',
    })
    expect(response.error.data.code).toBe('HANDOFF_IN_PROGRESS')
    db.close()
  })

  test('release notes RPC requires its capability and delegates exact list params', async () => {
    const calls: Array<{ currentVersion: string; refresh: boolean }> = []
    const { db, call, initialize } = await fixture({
      releaseNotes: {
        list: async (currentVersion: string, refresh: boolean) => {
          calls.push({ currentVersion, refresh })
          return {
            source: 'github-releases',
            repository: 'codepilotx-dev/Pidex',
            currentVersion,
            currentReleaseFound: false,
            fetchedAt: '2026-07-27T00:00:00.000Z',
            truncated: false,
            releases: [],
          }
        },
      } as unknown as RpcRouterDependencies['releaseNotes'],
    })
    await initialize()

    const response = await call('release-notes/list', {
      currentVersion: '0.2.0-beta.1',
      refresh: true,
    })

    expect(response.error).toBeUndefined()
    expect(response.result).toMatchObject({
      repository: 'codepilotx-dev/Pidex',
      currentVersion: '0.2.0-beta.1',
    })
    expect(calls).toEqual([
      {
        currentVersion: '0.2.0-beta.1',
        refresh: true,
      },
    ])
    db.close()
  })

  test('dispatches all MCP management methods through the typed runtime service', async () => {
    const calls: Array<{ method: string; input: unknown }> = []
    const server = {
      name: 'fixture',
      scope: 'user' as const,
      enabled: true,
      transport: {
        type: 'http' as const,
        url: 'http://127.0.0.1:3000/mcp',
      },
    }
    const listResult = {
      servers: [{ server, effective: true }],
      generation: 2,
    }
    const mcp = {
      list: async (input: unknown) => {
        calls.push({ method: 'list', input })
        return listResult
      },
      status: async (input: unknown) => {
        calls.push({ method: 'status', input })
        return {
          servers: [
            {
              name: 'fixture',
              scope: 'user',
              type: 'http',
              state: 'connected',
              auth: { source: 'none', canLogin: true, canLogout: false },
              toolCount: 1,
              resourceCount: 1,
              promptCount: 1,
            },
          ],
          totalTools: 1,
          totalResources: 1,
          totalPrompts: 1,
          generation: 2,
        }
      },
      save: async (input: unknown) => {
        calls.push({ method: 'save', input })
        return { ...listResult, changed: true }
      },
      remove: async (input: unknown) => {
        calls.push({ method: 'remove', input })
        return { servers: [], generation: 3, changed: true }
      },
      setEnabled: async (input: unknown) => {
        calls.push({ method: 'setEnabled', input })
        return { ...listResult, changed: true }
      },
      reload: async (input: unknown) => {
        calls.push({ method: 'reload', input })
        return {
          generation: 4,
          added: [],
          replaced: ['fixture'],
          removed: [],
          unchanged: [],
          failed: [],
        }
      },
      oauthStart: async (input: unknown) => {
        calls.push({ method: 'oauthStart', input })
        return {
          attemptId: 'oauth-attempt',
          authorizationUrl: 'https://auth.example/authorize',
          expiresAt: Date.now() + 60_000,
        }
      },
      oauthStatus: (input: unknown) => {
        calls.push({ method: 'oauthStatus', input })
        return { state: 'pending' }
      },
      oauthLogout: async (input: unknown) => {
        calls.push({ method: 'oauthLogout', input })
        return { generation: 5 }
      },
    }
    const { db, call, initialize } = await fixture({ mcp } as never)
    await initialize()
    const workspace = 'F:\\workspace'
    expect((await call('mcp/list', { workspace })).result).toEqual(listResult)
    expect((await call('mcp/status', { workspace })).result.totalTools).toBe(1)
    expect(
      (
        await call('mcp/save', {
          workspace,
          server,
          operationId: 'save-operation',
        })
      ).result,
    ).toEqual(listResult)
    expect(
      (
        await call('mcp/setEnabled', {
          workspace,
          scope: 'user',
          name: 'fixture',
          enabled: false,
          operationId: 'enable-operation',
        })
      ).result,
    ).toEqual(listResult)
    expect(
      (
        await call('mcp/remove', {
          workspace,
          scope: 'user',
          name: 'fixture',
          operationId: 'remove-operation',
        })
      ).result.servers,
    ).toEqual([])
    expect(
      (
        await call('mcp/reload', {
          workspace,
          operationId: 'reload-operation',
        })
      ).result.replaced,
    ).toEqual(['fixture'])
    expect(
      (
        await call('mcp/oauth/start', {
          workspace,
          scope: 'user',
          name: 'fixture',
          operationId: 'oauth-start-operation',
        })
      ).result.attemptId,
    ).toBe('oauth-attempt')
    expect(
      (
        await call('mcp/oauth/status', {
          attemptId: 'oauth-attempt',
        })
      ).result.state,
    ).toBe('pending')
    expect(
      (
        await call('mcp/oauth/logout', {
          workspace,
          scope: 'user',
          name: 'fixture',
          operationId: 'oauth-logout-operation',
        })
      ).result.generation,
    ).toBe(5)
    expect(calls.map((entry) => entry.method)).toEqual([
      'list',
      'status',
      'save',
      'setEnabled',
      'remove',
      'reload',
      'oauthStart',
      'oauthStatus',
      'oauthLogout',
    ])
    expect(
      calls
        .filter((entry) => entry.method !== 'oauthStatus')
        .every((entry) => (entry.input as { workspace?: string }).workspace === workspace),
    ).toBe(true)
    db.close()
  })

  test('thread/history/read 返回分页正文与同事务 streamPosition', async () => {
    const { db, initialize, call } = await fixture()
    await initialize()
    const thread = db.createThread('分页 RPC')
    const model = Model.Ref.make({
      providerID: Provider.ID.make('openai'),
      id: Model.ID.make('gpt'),
    })
    for (let index = 0; index < 11; index += 1) {
      const turn = db.createTurn(
        thread.id,
        {
          content: `第 ${index + 1} 轮`,
          model,
          permissionConfig: DEFAULT_PERMISSION_CONFIG,
          strategy: 'queue',
          taskMode: 'chat',
        },
        'completed',
      )
      db.updateTurnStatus(turn.turnID, 'completed')
    }

    const response = await call('thread/history/read', { threadId: thread.id })
    expect(response.error).toBeUndefined()
    expect(response.result.turns).toHaveLength(10)
    expect(response.result.hasOlder).toBe(true)
    expect(response.result.streamPosition).toEqual({
      streamId: thread.id,
      sequence: (
        db.sqlite.query('SELECT MAX(id) AS id FROM events WHERE thread_id = ?').get(thread.id) as {
          id: number
        }
      ).id,
    })

    const older = await call('thread/history/read', {
      threadId: thread.id,
      before: response.result.olderCursor,
    })
    expect(older.result.turns).toHaveLength(1)
    expect(older.result.hasOlder).toBe(false)
    expect(older.result.olderCursor).toBeNull()
    db.close()
  })

  test('thread/mark-read 通过 read-through 清除持久化未读标记', async () => {
    let database: AgentDatabase
    const history = {
      markRead: (threadID: string, readThroughAt: number) => {
        database.markThreadReadThrough(threadID, readThroughAt)
        return new ThreadProjection(database).list().find((item) => item.id === threadID)!
      },
    } as unknown as RpcRouterDependencies['history']
    const { db, initialize, call } = await fixture({ history })
    database = db
    await initialize()
    const thread = db.createThread('未读 RPC')
    db.markThreadUnread(thread.id, 100)

    const stale = await call('thread/mark-read', {
      threadId: thread.id,
      readThroughAt: 90,
      operationId: 'operation:mark-read-stale',
    })
    expect(stale.error).toBeUndefined()
    expect(stale.result.thread.unreadAt).toBe(100)

    const read = await call('thread/mark-read', {
      threadId: thread.id,
      readThroughAt: 100,
      operationId: 'operation:mark-read',
    })
    expect(read.error).toBeUndefined()
    expect(read.result.thread.unreadAt).toBeNull()
    expect(
      db.sqlite
        .query('SELECT read_at, unread_at FROM thread_read_state WHERE thread_id = ?')
        .get(thread.id),
    ).toEqual({ read_at: 100, unread_at: null })
    db.close()
  })

  test('thread/mark-unread 持久化未读标记并校验时间', async () => {
    let database: AgentDatabase
    const history = {
      markUnread: (threadID: string, unreadAt: number) => {
        database.markThreadUnread(threadID, unreadAt)
        return new ThreadProjection(database).list().find((item) => item.id === threadID)!
      },
    } as unknown as RpcRouterDependencies['history']
    const { db, initialize, call } = await fixture({ history })
    database = db
    await initialize()
    const thread = db.createThread('手动未读 RPC')

    const invalid = await call('thread/mark-unread', {
      threadId: thread.id,
      unreadAt: -1,
      operationId: 'operation:mark-unread-invalid',
    })
    expect(invalid.error?.code).toBe(-32602)

    const unread = await call('thread/mark-unread', {
      threadId: thread.id,
      unreadAt: 200,
      operationId: 'operation:mark-unread',
    })
    expect(unread.error).toBeUndefined()
    expect(unread.result.thread.unreadAt).toBe(200)
    expect(
      db.sqlite
        .query('SELECT read_at, unread_at FROM thread_read_state WHERE thread_id = ?')
        .get(thread.id),
    ).toEqual({ read_at: 0, unread_at: 200 })
    db.close()
  })

  test('RpcMethods is the only method allowlist and params are validated before services', async () => {
    const { db, call, counts, initialize } = await fixture()
    await initialize()
    expect((await call('project/updateSettings', {})).error).toMatchObject({ code: -32601 })
    expect(
      (await call('review/summary', { projectId: '', source: { kind: 'unstaged' } })).error,
    ).toMatchObject({ code: -32602 })
    expect(counts().reviewSummaryCalls).toBe(0)
    db.close()
  })

  test('rejects requests until the initialized notification completes the negotiated connection', async () => {
    const { db, call } = await fixture()
    expect((await call('github/auth/status', {})).error).toMatchObject({
      code: -32000,
      data: { code: 'UNAUTHORIZED' },
    })
    db.close()
  })

  test('rejects methods whose capability was not negotiated by the client', async () => {
    const { db, call, initialize } = await fixture()
    await initialize(['rpc.typed.v1'])
    expect(
      (
        await call('review/summary', {
          projectId: 'project:1',
          source: { kind: 'unstaged' },
        })
      ).error,
    ).toMatchObject({
      code: -32000,
      data: { code: 'CAPABILITY_REQUIRED', details: { capability: 'git.review.v1' } },
    })
    db.close()
  })

  test('review and github methods pass through the typed dispatcher', async () => {
    const { db, call, counts, initialize } = await fixture()
    await initialize()
    const review = await call('review/summary', {
      projectId: 'project:1',
      source: { kind: 'unstaged' },
    })
    expect(review.result).toMatchObject({
      snapshot: {
        projectId: 'project:1',
        generation: 'generation:1',
        totals: { files: 0 },
      },
      cacheState: 'fresh',
    })
    const applied = await call('review/applyBatch', {
      projectId: 'project:1',
      source: { kind: 'unstaged' },
      generation: 'generation:1',
      action: 'stage',
      items: [{ path: 'src/index.ts', expectedRevision: 'revision:1' }],
    })
    expect(applied.result).toEqual({
      ok: true,
      action: 'stage',
      paths: ['src/index.ts'],
      generation: 'generation:1',
      appliedCount: 1,
    })
    const github = await call('github/auth/status', {})
    expect(github.result).toEqual({ configured: false, authenticated: false, user: null })
    expect(counts()).toEqual({ reviewSummaryCalls: 1, githubStatusCalls: 1 })
    db.close()
  })

  test('Git 和 Review RPC 错误只公开允许的安全 details', async () => {
    const gitFailure = await fixture({
      review: {
        summaryResult: async () => {
          throw new AgentError('GIT_COMMAND_FAILED', 'Git 操作失败', 409, {
            stderr: 'fatal: C:\\secret\\repository',
            args: ['status', '--porcelain'],
          })
        },
      } as never,
    })
    await gitFailure.initialize()
    const failed = await gitFailure.call('review/summary', {
      projectId: 'project:git-error',
      source: { kind: 'unstaged' },
    })
    expect(failed.error.data).toEqual({
      code: 'GIT_COMMAND_FAILED',
      retryable: false,
    })
    expect(JSON.stringify(failed)).not.toContain('secret')

    const expiredFailure = await fixture({
      review: {
        summaryResult: async () => {
          throw new AgentError(
            'REVIEW_SNAPSHOT_EXPIRED',
            'Review 快照已经过期，请刷新后重试',
            409,
            {
              latestGeneration: 'generation:latest',
              retryable: true,
              stderr: 'fatal: C:\\secret\\repository',
            },
          )
        },
      } as never,
    })
    await expiredFailure.initialize()
    const expired = await expiredFailure.call('review/summary', {
      projectId: 'project:review-expired',
      source: { kind: 'unstaged' },
    })
    expect(expired.error.data).toEqual({
      code: 'REVIEW_SNAPSHOT_EXPIRED',
      retryable: false,
      details: {
        latestGeneration: 'generation:latest',
        retryable: true,
      },
    })
    expect(JSON.stringify(expired)).not.toContain('secret')
    gitFailure.db.close()
    expiredFailure.db.close()
  })

  test('task suggestion RPC resolves project scope and returns safe service output', async () => {
    let calls = 0
    const suggestions = {
      generate: async (params: any, projectKey?: string) => {
        calls += 1
        expect(params.workspace.kind).toBe('project')
        expect(typeof projectKey).toBe('string')
        return {
          contextKey: 'context:1',
          generatedAt: 1,
          suggestions: [
            {
              id: 'suggestion:1',
              categoryId: 'codex-review',
              label: '审查当前改动',
              prompt: 'Review current changes',
            },
          ],
        }
      },
    }
    const { db, call, initialize } = await fixture({
      suggestions,
    } as unknown as Partial<RpcRouterDependencies>)
    await initialize()
    const project = db.createProject({ rootPath: roots.at(-1)! })
    const context = {
      workspaceName: 'fixture',
      branchName: 'main',
      git: null,
      recentTasks: [],
      localCandidates: [
        { id: '1', categoryId: 'codex-explore', label: '探索', prompt: 'Explore' },
        { id: '2', categoryId: 'codex-create', label: '构建', prompt: 'Build' },
        { id: '3', categoryId: 'codex-review', label: '审查', prompt: 'Review' },
        { id: '4', categoryId: 'codex-fix', label: '修复', prompt: 'Fix' },
      ],
    }
    const response = await call('task-suggestion/generate', {
      workspace: { kind: 'project', projectId: project.id },
      context,
    })
    expect(response.error).toBeUndefined()
    expect(response.result).toMatchObject({
      contextKey: 'context:1',
      suggestions: [{ categoryId: 'codex-review' }],
    })
    expect(calls).toBe(1)

    const missing = await call('task-suggestion/generate', {
      workspace: { kind: 'project', projectId: 'project:missing' },
      context,
    })
    expect(missing.error).toMatchObject({
      data: { code: 'PROJECT_NOT_FOUND' },
    })
    expect(calls).toBe(1)
    db.close()
  })

  test('workspace file methods encode editor revisions and expose declared file errors', async () => {
    const { db, router, call, initialize } = await fixture()
    await initialize()
    const root = roots.at(-1)!
    const project = db.createProject({ rootPath: root })
    await writeFile(join(root, 'tsconfig.json'), '{\n  "compilerOptions": {}\n}\n', 'utf8')
    await writeFile(join(root, 'binary.bin'), new Uint8Array([0xff, 0xfe]))
    await writeFile(join(root, 'too-large.txt'), Buffer.alloc(20 * 1024 * 1024 + 1, 97))

    const opened = await call('workspace/file/read', {
      projectId: project.id,
      folderId: project.primaryFolderId,
      path: 'tsconfig.json',
    })
    expect(opened.error).toBeUndefined()
    expect(opened.result).toMatchObject({
      path: 'tsconfig.json',
      content: '{\n  "compilerOptions": {}\n}\n',
      revision: {
        sha256: expect.any(String),
        rawSha256: expect.any(String),
        utf8Bom: false,
      },
    })

    const missing = await call('workspace/file/read', {
      projectId: project.id,
      folderId: project.primaryFolderId,
      path: 'missing.txt',
    })
    expect(missing.error).toMatchObject({
      code: -32000,
      data: { code: 'FILE_NOT_FOUND', retryable: false },
    })
    expect(missing.error.message).not.toBe('Agent 内部错误')
    expect(
      (
        await call('workspace/file/read', {
          projectId: project.id,
          folderId: project.primaryFolderId,
          path: 'binary.bin',
        })
      ).error,
    ).toMatchObject({
      code: -32000,
      data: { code: 'FILE_NOT_TEXT', retryable: false },
    })
    expect(
      (
        await call('workspace/file/read', {
          projectId: project.id,
          folderId: project.primaryFolderId,
          path: 'too-large.txt',
        })
      ).error,
    ).toMatchObject({
      code: -32000,
      data: {
        code: 'FILE_TOO_LARGE',
        retryable: false,
        details: {
          sizeBytes: 20 * 1024 * 1024 + 1,
          maxBytes: 20 * 1024 * 1024,
        },
      },
    })
    expect(
      (
        await call('workspace/file/read', {
          projectId: project.id,
          folderId: project.primaryFolderId,
          path: '../outside.txt',
        })
      ).error,
    ).toMatchObject({
      code: -32000,
      data: { code: 'PATH_DENIED', retryable: false },
    })

    const watchParams = {
      projectId: project.id,
      folderId: project.primaryFolderId,
      path: 'tsconfig.json',
    }
    expect((await call('workspace/file/watch', watchParams)).result).toEqual({
      watching: true,
      path: 'tsconfig.json',
    })
    expect((await call('workspace/file/watch', watchParams)).result).toEqual({
      watching: true,
      path: 'tsconfig.json',
    })
    const watched = [...router.workspaceFileWatchers.values()][0]
    expect(watched?.ownerCounts.values().next().value).toBe(2)

    await call('workspace/file/unwatch', watchParams)
    expect(router.workspaceFileWatchers.size).toBe(1)
    await call('workspace/file/unwatch', watchParams)
    expect(router.workspaceFileWatchers.size).toBe(0)

    await call('workspace/file/watch', watchParams)
    const [connectionId] = router.connections.keys()
    router.closeConnection(connectionId!)
    expect(router.workspaceFileWatchers.size).toBe(0)
    db.close()
  })

  test('model/list returns the complete versioned v4 catalog', async () => {
    const { db, call, initialize } = await fixture({
      providers: {
        list: async () => [],
        models: async () => [],
      } as unknown as RpcRouterDependencies['providers'],
    })
    await initialize()
    const response = await call('model/list', {})
    expect(response.error).toBeUndefined()
    expect(response.result).toEqual({
      providers: [],
      defaultModel: null,
      reviewerModel: null,
      catalogVersion: expect.any(Number),
    })
    db.close()
  })

  test('model/list.defaultModel 只反映最近新建任务模型且当前可用', async () => {
    const providerID = Schema.decodeUnknownSync(Provider.ID)('provider:test')
    const otherProviderID = Schema.decodeUnknownSync(Provider.ID)('provider:other')
    const modelID = Schema.decodeUnknownSync(Model.ID)('alpha')
    const disabledModelID = Schema.decodeUnknownSync(Model.ID)('disabled')
    const variantID = Schema.decodeUnknownSync(Model.VariantID)('reasoning')
    const models = [
      { ...Model.Info.empty(providerID, modelID), variants: [{ id: variantID }] },
      { ...Model.Info.empty(providerID, disabledModelID), enabled: false },
      {
        ...Model.Info.empty(otherProviderID, Schema.decodeUnknownSync(Model.ID)('gamma')),
        enabled: true,
      },
    ]
    const value = await fixture({
      providers: {
        list: async () => [Provider.Info.empty(providerID), Provider.Info.empty(otherProviderID)],
        models: async () => models,
      } as unknown as RpcRouterDependencies['providers'],
    })
    await value.initialize()

    // 有可用目录模型但没有最近选择：不再把第一个 enabled 模型伪装成 defaultModel。
    const unconfigured = await value.call('model/list', {})
    expect(unconfigured.error).toBeUndefined()
    expect(unconfigured.result.defaultModel).toBeNull()
    expect(unconfigured.result.reviewerModel).toBeNull()

    // 最近选择有效时返回原 ref 和 variant（兼容外壳：读取语义仍叫 defaultModel）。
    value.configDocument.desktop = {
      recent_new_thread_model: { providerID: 'provider:test', id: 'alpha', variant: 'reasoning' },
    }
    value.configDocument.specialized_models = { security: 'provider:test/alpha' }
    const configured = await value.call('model/list', {})
    expect(configured.result.defaultModel).toEqual({
      providerID: 'provider:test',
      id: 'alpha',
      variant: 'reasoning',
    })
    expect(configured.result.reviewerModel).toEqual({
      providerID: 'provider:test',
      id: 'alpha',
    })

    for (const thinkingMode of ['default', 'enabled', 'adaptive', 'disabled'] as const) {
      value.configDocument.desktop = {
        recent_new_thread_model: {
          providerID: 'provider:test',
          id: 'alpha',
          variant: thinkingMode,
        },
      }
      expect((await value.call('model/list', {})).result.defaultModel).toEqual({
        providerID: 'provider:test',
        id: 'alpha',
      })
    }

    // 最近选择存在但 variant 无效：返回 null。
    value.configDocument.desktop = {
      recent_new_thread_model: {
        providerID: 'provider:test',
        id: 'alpha',
        variant: 'invalid-variant',
      },
    }
    const invalidVariant = await value.call('model/list', {})
    expect(invalidVariant.result.defaultModel).toBeNull()
    expect(invalidVariant.result.reviewerModel).toEqual({
      providerID: 'provider:test',
      id: 'alpha',
    })

    // 最近选择存在但模型被禁用：返回 null。
    value.configDocument.desktop = {
      recent_new_thread_model: { providerID: 'provider:test', id: 'disabled' },
    }
    expect((await value.call('model/list', {})).result.defaultModel).toBeNull()

    // 最近选择在目录中不存在：返回 null。
    value.configDocument.desktop = {
      recent_new_thread_model: { providerID: 'provider:test', id: 'missing' },
    }
    expect((await value.call('model/list', {})).result.defaultModel).toBeNull()
    value.db.close()
  })

  test('provider/delete 不再被遗留 model_provider 阻塞', async () => {
    const deletedCredentials: string[] = []
    const providerID = Schema.decodeUnknownSync(Provider.ID)('provider:custom')
    const value = await fixture({
      providerCredentials: {
        deleteAll: async (id: string) => {
          deletedCredentials.push(id)
        },
      } as unknown as RpcRouterDependencies['providerCredentials'],
      providers: {
        list: async () => [],
        models: async () => [],
        reload: async () => undefined,
      } as unknown as RpcRouterDependencies['providers'],
    })
    await value.initialize()
    value.configDocument.model_providers = {
      [String(providerID)]: { kind: 'custom', id: String(providerID), enabled: true },
    }
    // 遗留的全局默认模型仍指向该 Provider：只保留兼容数据，不再阻塞删除。
    value.configDocument.model_provider = String(providerID)
    value.configDocument.model = 'legacy-model'

    const deleted = await value.call('provider/delete', {
      providerId: String(providerID),
      operationId: 'operation:provider-delete',
    })
    expect(deleted.error).toBeUndefined()
    expect(deleted.result).toMatchObject({ providerId: String(providerID), deleted: true })
    expect(value.configDocument.model_providers).toEqual({})
    expect(deletedCredentials).toEqual([String(providerID)])
    expect(value.configDocument.model_provider).toBe(String(providerID))
    value.db.close()
  })

  test('provider/delete 仍被真实专用模型引用阻塞', async () => {
    let credentialsDeleted = false
    const providerID = Schema.decodeUnknownSync(Provider.ID)('provider:custom')
    const value = await fixture({
      providerCredentials: {
        deleteAll: async () => {
          credentialsDeleted = true
        },
      } as unknown as RpcRouterDependencies['providerCredentials'],
      providers: {
        list: async () => [],
        models: async () => [],
        reload: async () => undefined,
      } as unknown as RpcRouterDependencies['providers'],
    })
    await value.initialize()
    value.configDocument.model_providers = {
      [String(providerID)]: { kind: 'custom', id: String(providerID), enabled: true },
    }
    value.configDocument.specialized_models = { security: `${String(providerID)}/alpha` }

    const blocked = await value.call('provider/delete', {
      providerId: String(providerID),
      operationId: 'operation:provider-delete',
    })
    expect(blocked.error).toMatchObject({
      code: -32000,
      data: { code: 'CONFLICT' },
      message: 'Provider 仍被最近模型或专用模型引用',
    })
    expect(value.configDocument.model_providers).toHaveProperty(String(providerID))
    expect(credentialsDeleted).toBe(false)
    value.db.close()
  })

  test('provider/delete 凭据清理失败时保留供应商入口', async () => {
    const value = await fixture({
      providerCredentials: {
        deleteAll: async () => {
          throw new AgentError('CREDENTIAL_WRITE_FAILED', '凭据删除失败', 500)
        },
      } as unknown as RpcRouterDependencies['providerCredentials'],
    })
    await value.initialize()
    value.configDocument.model_providers = { 'provider:custom': { kind: 'custom' } }
    const result = await value.call('provider/delete', {
      providerId: 'provider:custom',
      operationId: 'operation:delete-failed',
    })
    expect(result.error.data.code).toBe('INTERNAL_ERROR')
    expect(value.configDocument.model_providers).toHaveProperty('provider:custom')
    value.db.close()
  })

  test('paged model catalog filters, caches, and expires versioned cursors', async () => {
    const providerID = Schema.decodeUnknownSync(Provider.ID)('provider:test')
    const otherProviderID = Schema.decodeUnknownSync(Provider.ID)('provider:other')
    const models = [
      Model.Info.empty(providerID, Schema.decodeUnknownSync(Model.ID)('alpha')),
      Model.Info.empty(providerID, Schema.decodeUnknownSync(Model.ID)('beta')),
      {
        ...Model.Info.empty(otherProviderID, Schema.decodeUnknownSync(Model.ID)('gamma')),
        enabled: false,
      },
    ]
    let listCalls = 0
    let modelCalls = 0
    const authConfiguredCalls: string[] = []
    const { db, call, initialize } = await fixture({
      providers: {
        list: async () => {
          listCalls += 1
          return [
            { ...Provider.Info.empty(providerID), catalogOrigin: 'pi-bundled' as const },
            { ...Provider.Info.empty(otherProviderID), disabled: true },
          ]
        },
        models: async () => {
          modelCalls += 1
          return models
        },
        refresh: async () => undefined,
      } as unknown as RpcRouterDependencies['providers'],
      piModels: {
        providerDefinitions: async () => [
          {
            kind: 'builtin',
            id: providerID,
            enabled: true,
            allowModels: [],
            denyModels: [],
            models: [],
          },
          {
            kind: 'builtin',
            id: otherProviderID,
            enabled: true,
            allowModels: [],
            denyModels: [],
            models: [],
          },
        ],
        configIssues: async () => [],
        isAuthConfigured: async (candidateProviderID: string) => {
          authConfiguredCalls.push(candidateProviderID)
          return true
        },
      } as unknown as RpcRouterDependencies['piModels'],
    })
    await initialize()

    const providers = await call('provider/list', {})
    expect(providers.error).toBeUndefined()
    expect(providers.result.providers).toHaveLength(2)
    expect(
      providers.result.providers.map(
        (provider: { authConfigured: boolean }) => provider.authConfigured,
      ),
    ).toEqual([true, false])
    expect(
      providers.result.providers.map((provider: { modelCount: number }) => provider.modelCount),
    ).toEqual([2, 1])
    expect(authConfiguredCalls).toEqual([String(providerID)])
    const first = await call('model/list', { providerId: providerID, enabled: true, limit: 1 })
    expect(first.result).toMatchObject({ total: 2, catalogVersion: 1 })
    expect(first.result.providers[0].models.map((model: Model.Info) => model.id)).toEqual(['alpha'])
    expect(typeof first.result.nextCursor).toBe('string')

    const second = await call('model/list', {
      providerId: providerID,
      enabled: true,
      limit: 1,
      cursor: first.result.nextCursor,
    })
    expect(second.result.providers[0].models.map((model: Model.Info) => model.id)).toEqual(['beta'])
    expect(second.result.nextCursor).toBeUndefined()
    expect(listCalls).toBe(1)
    expect(modelCalls).toBe(1)

    await call('model/refresh', { operationId: 'operation:model-refresh-paged', providerId: providerID })
    const expired = await call('model/list', {
      providerId: providerID,
      enabled: true,
      limit: 1,
      cursor: first.result.nextCursor,
    })
    expect(expired.error).toMatchObject({ data: { code: 'CURSOR_EXPIRED' } })
    db.close()
  })

  test('model refresh failures use the declared provider error without exposing causes', async () => {
    const { db, call, initialize } = await fixture({
      providers: {
        refresh: async () => {
          throw new PiModelServiceError('CATALOG_REFRESH_FAILED', 'private upstream failure', {
            cause: new Error('private credential or endpoint'),
          })
        },
      } as unknown as RpcRouterDependencies['providers'],
    })
    try {
      await initialize()
      const result = await call('model/refresh', { operationId: 'operation:failed-refresh', providerId: 'google' })
      expect(result.error).toMatchObject({
        message: '模型目录刷新失败，请检查提供商连接、凭据和模型接口后重试。',
        data: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
      })
      expect(JSON.stringify(result)).not.toContain('private')
    } finally {
      db.close()
    }
  })

  test('model refresh returns safe provider diagnostics for the toast', async () => {
    const { db, call, initialize } = await fixture({
      providers: {
        refresh: async () => {
          throw new PiModelServiceError('CATALOG_REFRESH_FAILED', 'private upstream failure',
            { cause: new Error('private credential') }, ['openai：凭据鉴权失败（HTTP 401）'])
        },
      } as unknown as RpcRouterDependencies['providers'],
    })
    try {
      await initialize()
      const result = await call('model/refresh', { operationId: 'operation:refresh-diagnostics', providerId: 'openai' })
      expect(result.error).toMatchObject({
        message: '模型目录刷新失败（1 个提供商）：openai：凭据鉴权失败（HTTP 401）。',
        data: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
      })
      expect(JSON.stringify(result)).not.toContain('private')
    } finally {
      db.close()
    }
  })

  test('model mutations and refresh return their declared versioned results', async () => {
    let refreshCalls = 0
    let reloadCalls = 0
    const refreshScopes: Array<string | undefined> = []
    const { db, call, initialize } = await fixture({
      providers: {
        list: async () => [],
        models: async () => [],
        refresh: async (_force: boolean, providerId?: string) => {
          refreshCalls += 1
          refreshScopes.push(providerId)
        },
      } as unknown as RpcRouterDependencies['providers'],
      piModels: {
        refreshDirectory: async () => { reloadCalls += 1 },
      } as unknown as RpcRouterDependencies['piModels'],
    })
    await initialize()
    expect(
      (
        await call('model/setDefault', {
          model: null,
          operationId: 'operation:model-default',
        })
      ).result,
    ).toEqual({
      defaultModel: null,
      settingsVersion: 2,
    })
    expect(
      (
        await call('model/setReviewer', {
          model: null,
          operationId: 'operation:model-reviewer',
        })
      ).result,
    ).toEqual({
      reviewerModel: null,
      settingsVersion: 3,
    })
    expect(
      (
        await call('model/refresh', {
          operationId: 'operation:model-refresh',
        })
      ).result,
    ).toMatchObject({
      providers: [],
      catalogVersion: 4,
    })
    expect(refreshCalls).toBe(0)
    expect(reloadCalls).toBe(1)
    expect(refreshScopes).toEqual([])
    const scoped = await call('model/refresh', {
      operationId: 'operation:google-refresh', providerId: 'google',
    })
    expect(scoped.error).toBeUndefined()
    expect(refreshScopes).toEqual(['google'])
    db.close()
  })

  test('provider methods create canonical Pi v2 configuration', async () => {
    const provider = Provider.Info.empty(Provider.ID.make('provider:fixture'))
    const { db, configDocument, call, initialize } = await fixture({
      providers: {
        list: async () => [provider],
        models: async () => [],
        reload: async () => undefined,
      } as unknown as RpcRouterDependencies['providers'],
    })
    await initialize()

    expect(
      (
        await call('provider/test', {
          providerId: provider.id,
        })
      ).result,
    ).toMatchObject({
      providerId: provider.id,
      status: 'unavailable',
      category: 'configuration',
    })
    expect(
      (
        await call('provider/create', {
          definition: {
            kind: 'custom',
            id: provider.id,
            name: 'Fixture provider',
            enabled: true,
            baseUrl: 'https://example.com/v1',
            auth: 'none',
            env: [],
            allowInsecureHttp: false,
            headers: {},
            models: [
              {
                id: 'fixture-model',
                api: 'openai-completions',
              },
            ],
          },
          operationId: 'operation:provider-create',
        })
      ).result,
    ).toEqual({
      providerId: provider.id,
      catalogVersion: 2,
    })
    expect((configDocument.model_providers as Record<string, unknown>)[provider.id]).toMatchObject({
      name: 'Fixture provider',
      base_url: 'https://example.com/v1',
    })
    const stored = (configDocument.model_providers as Record<string, Record<string, unknown>>)[
      provider.id
    ]!
    stored.future_setting = { keep: true }
    ;(stored.models as Record<string, Record<string, unknown>>)['fixture-model']!.future_parameter =
      42
    const updated = await call('provider/update', {
      providerId: provider.id,
      definition: {
        kind: 'custom',
        id: provider.id,
        name: 'Updated',
        enabled: true,
        baseUrl: 'https://updated.example/v1',
        auth: 'none',
        env: [],
        allowInsecureHttp: false,
        headers: {},
        models: [{ id: 'fixture-model', api: 'openai-completions' }],
      },
      operationId: 'operation:provider-update',
    })
    expect(updated.error).toBeUndefined()
    expect(stored.future_setting).toEqual({ keep: true })
    expect(
      (stored.models as Record<string, Record<string, unknown>>)['fixture-model']!.future_parameter,
    ).toBe(42)
    expect(stored.base_url).toBe('https://updated.example/v1')
    const builtin = await call('provider/update', {
      providerId: 'nvidia',
      definition: {
        kind: 'builtin',
        id: 'nvidia',
        enabled: true,
        allowModels: [],
        denyModels: [],
        baseUrl: 'https://gateway.example/v1',
        models: [
          { id: 'private-model', enabled: true, api: 'openai-completions', maxTokens: 65536 },
        ],
      },
      operationId: 'operation:builtin-update',
    })
    expect(builtin.error).toBeUndefined()
    expect((configDocument.model_providers as Record<string, unknown>).nvidia).toMatchObject({
      kind: 'builtin',
      base_url: 'https://gateway.example/v1',
      models: { 'private-model': { enabled: true, api: 'openai-completions', maxTokens: 65536 } },
    })

    const invalidCreate = await call('provider/create', {
      definition: {
        kind: 'custom',
        id: 'google',
        name: 'Google Gemini',
        enabled: true,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        auth: 'none',
        env: [],
        allowInsecureHttp: false,
        headers: {},
        models: [
          {
            id: 'gemini-model',
            api: 'openai-completions',
          },
        ],
      },
      operationId: 'operation:provider-create-invalid',
    })
    expect(invalidCreate.error).toMatchObject({
      code: -32000,
      data: {
        code: 'INVALID_REQUEST',
      },
    })
    expect(invalidCreate.error?.message).toContain('与系统内置 Provider 重名')
    expect(invalidCreate.error?.message).not.toBe('Agent 内部错误')
    db.close()
  })

  test('model/health RPC supports preview/start/read/cancel', async () => {
    const provider = Provider.Info.empty(Provider.ID.make('provider:health'))
    const model = Model.ID.make('model:health')
    const modelRef = { providerID: provider.id, id: model }
    const runSnapshot = {
      runId: 'op:health',
      status: 'running' as const,
      startedAt: 1,
      counts: { total: 1, queued: 0, running: 1, healthy: 0, failed: 0, cancelled: 0 },
      excludedProviders: [],
      items: [{ model: modelRef, status: 'running' as const, startedAt: 1 }],
    }
    const modelHealth = {
      preview: async () => ({
        totalRequests: 1,
        excludedProviders: [],
      }),
      start: async (operationId: string) =>
        operationId === 'op:health'
          ? runSnapshot
          : (() => {
              throw Object.assign(new Error('conflict'), { status: 409 })
            })(),
      read: async (runId: string) => (runId === 'op:health' ? runSnapshot : null),
      cancel: async () => ({ ...runSnapshot, status: 'cancelled' as const }),
      dispose: async () => undefined,
    }
    const { db, call, initialize } = await fixture({
      providers: {
        list: async () => [provider],
        models: async () => [{ providerID: provider.id, id: model, enabled: true }],
        reload: async () => undefined,
      } as unknown as RpcRouterDependencies['providers'],
      modelHealth: modelHealth as unknown as RpcRouterDependencies['modelHealth'],
    })
    await initialize()

    expect((await call('model/health/preview', {})).result).toMatchObject({
      totalRequests: 1,
      excludedProviders: [],
    })
    expect((await call('model/health/start', { operationId: 'op:health' })).result).toMatchObject({
      run: { runId: 'op:health', status: 'running' },
    })
    expect((await call('model/health/read', { runId: 'op:health' })).result.run).toMatchObject({
      runId: 'op:health',
    })
    expect((await call('model/health/read', { runId: 'op:unknown' })).result.run).toBeNull()
    expect(
      (
        await call('model/health/cancel', {
          runId: 'op:health',
          operationId: 'op:health',
        })
      ).result.run,
    ).toMatchObject({ status: 'cancelled' })
    db.close()
  })

  test('provider/test 将内部 timeout/provider 分类映射为 unknown 且仅显式 model 时附带 model', async () => {
    const provider = Provider.Info.empty(Provider.ID.make('provider:legacy'))
    const model = Model.ID.make('model:legacy')
    const modelRef = { providerID: provider.id, id: model }
    const modelHealth = {
      probe: async (ref: { providerID: Provider.ID; id: Model.ID }) =>
        String(ref.id) === 'model:legacy'
          ? { ok: false, category: 'timeout' as const, message: '请求在 15 秒内未完成' }
          : { ok: false, category: 'provider' as const, message: 'Provider 服务暂时不可用' },
      dispose: async () => undefined,
    }
    const { db, call, initialize } = await fixture({
      providers: {
        list: async () => [provider],
        models: async () => [{ providerID: provider.id, id: model, enabled: true }],
        reload: async () => undefined,
      } as unknown as RpcRouterDependencies['providers'],
      modelHealth: modelHealth as unknown as RpcRouterDependencies['modelHealth'],
    })
    await initialize()

    // Old shape: no explicit model means no `model` field in the result.
    const withoutModel = await call('provider/test', { providerId: 'provider:legacy' })
    expect(withoutModel.result).toMatchObject({
      providerId: 'provider:legacy',
      status: 'unavailable',
      category: 'unknown',
      message: '请求在 15 秒内未完成',
    })
    expect(withoutModel.result.model).toBeUndefined()

    const withModel = await call('provider/test', {
      providerId: 'provider:legacy',
      model: modelRef,
    })
    expect(withModel.result).toMatchObject({
      providerId: 'provider:legacy',
      status: 'unavailable',
      category: 'unknown',
    })
    expect(withModel.result.model).toEqual(modelRef)
    db.close()
  })

  test('provider/test Provider/model 不匹配返回 INVALID_REQUEST；health 冲突返回 CONFLICT', async () => {
    const provider = Provider.Info.empty(Provider.ID.make('provider:mismatch'))
    const model = Model.ID.make('model:mismatch')
    const modelHealth = {
      start: async () => {
        throw new AgentError('CONFLICT', '另一个模型健康测试批次正在进行', 409)
      },
      cancel: async () => {
        throw new AgentError('CONFLICT', '未找到对应的模型健康测试批次', 409)
      },
      dispose: async () => undefined,
    }
    const { db, call, initialize } = await fixture({
      providers: {
        list: async () => [provider],
        models: async () => [{ providerID: provider.id, id: model, enabled: true }],
        reload: async () => undefined,
      } as unknown as RpcRouterDependencies['providers'],
      modelHealth: modelHealth as unknown as RpcRouterDependencies['modelHealth'],
    })
    await initialize()

    const mismatch = await call('provider/test', {
      providerId: 'provider:mismatch',
      model: { providerID: Provider.ID.make('anthropic'), id: Model.ID.make('claude') },
    })
    expect(mismatch.error.data.code).toBe('INVALID_REQUEST')

    const conflict = await call('model/health/start', { operationId: 'op:conflict' })
    expect(conflict.error.data.code).toBe('CONFLICT')
    const cancelConflict = await call('model/health/cancel', {
      runId: 'op:missing',
      operationId: 'op:missing',
    })
    expect(cancelConflict.error.data.code).toBe('CONFLICT')
    db.close()
  })

  test('event/subscribe 记录连接已协商的 capabilities，供 live event 门禁使用', async () => {
    const { db, call, initialize, router } = await fixture()
    await initialize(['rpc.typed.v1', 'events.replay.v1'])
    const withoutHealth = await call('event/subscribe', {
      streams: [{ streamId: 'global', after: 0 }],
      liveEventTypes: ['model/health/updated'],
    })
    const [connectionId] = router.connections.keys()
    expect(
      router.subscriptions
        .get(withoutHealth.result.subscriptionId, connectionId as string)
        ?.capabilities.has('model.health.v1'),
    ).toBe(false)
    await call('event/unsubscribe', {
      subscriptionId: withoutHealth.result.subscriptionId,
    })

    // A connection that negotiates model.health.v1 records it on the subscription.
    const {
      call: capCall,
      db: capDb,
      initialize: capInitialize,
      router: capRouter,
    } = await fixture()
    await capInitialize(['rpc.typed.v1', 'events.replay.v1', 'model.health.v1'])
    const subscribed = await capCall('event/subscribe', {
      streams: [{ streamId: 'global', after: 0 }],
      liveEventTypes: ['model/health/updated'],
    })
    const [capConnectionId] = capRouter.connections.keys()
    expect(
      capRouter.subscriptions
        .get(subscribed.result.subscriptionId, capConnectionId as string)
        ?.capabilities.has('model.health.v1'),
    ).toBe(true)
    capDb.close()
    db.close()
  })

  test('liveEventDeliveryAllowed 按 capability 与 liveEventTypes 双重门禁', async () => {
    const { liveEventDeliveryAllowed } = await import('../src/transport/Server')
    const event = {
      id: 0,
      afterSequence: 1,
      threadId: null,
      turnId: null,
      method: 'model/health/updated',
      params: { runId: 'op:1', status: 'running' },
      createdAt: Date.now(),
    }
    const base = { liveEventTypes: null, capabilities: new Set<ProtocolCapability>() }
    // No negotiated capability and no explicit filter: still blocked by capability.
    expect(liveEventDeliveryAllowed(event, base)).toBe(false)
    // Capability negotiated but event not explicitly subscribed: still blocked.
    expect(
      liveEventDeliveryAllowed(event, {
        liveEventTypes: new Set(['catalog/updated']),
        capabilities: new Set<ProtocolCapability>(['model.health.v1']),
      }),
    ).toBe(false)
    // Capability negotiated and explicitly subscribed: delivered.
    expect(
      liveEventDeliveryAllowed(event, {
        liveEventTypes: new Set(['model/health/updated']),
        capabilities: new Set<ProtocolCapability>(['model.health.v1']),
      }),
    ).toBe(true)
    // Without liveEventTypes the capability gate alone still applies.
    expect(
      liveEventDeliveryAllowed(event, {
        liveEventTypes: null,
        capabilities: new Set<ProtocolCapability>(['model.health.v1']),
      }),
    ).toBe(true)
    // Durable events are not affected by the live gate.
    expect(
      liveEventDeliveryAllowed(
        {
          ...event,
          method: 'thread/updated',
        },
        base,
      ),
    ).toBe(false)
  })

  test('initialize 响应和 connection set 精确等于交集且顺序与 serverAvailable 一致', async () => {
    const { db, initialize, router } = await fixture()
    const response = await initialize(['rpc.typed.v1', 'events.replay.v1'])
    const negotiated = response.result.capabilities as ProtocolCapability[]
    expect(negotiated).toEqual(['rpc.typed.v1', 'events.replay.v1'])
    const [connectionId] = router.connections.keys()
    const connectionCaps = router.connections.get(connectionId as string)!.capabilities
    expect([...connectionCaps]).toEqual(negotiated)
    expect([...connectionCaps]).toEqual(['rpc.typed.v1', 'events.replay.v1'])
    db.close()
  })

  test('item_artifacts 缺失时 initialize 响应和 connection/subscription 均不含 artifacts.read.v1，artifact/read 返回 CAPABILITY_REQUIRED', async () => {
    const { db, initialize, call, router } = await fixture()
    db.sqlite.query('DROP TABLE IF EXISTS item_artifacts').run()
    const response = await initialize([...(Capabilities as unknown as string[])])
    expect(response.result.capabilities as string[]).not.toContain('artifacts.read.v1')
    const [connectionId] = router.connections.keys()
    expect(
      router.connections.get(connectionId as string)!.capabilities.has('artifacts.read.v1'),
    ).toBe(false)
    const subscribed = await call('event/subscribe', {
      streams: [{ streamId: 'global', after: 0 }],
    })
    const subCaps = router.subscriptions.get(
      subscribed.result.subscriptionId,
      connectionId as string,
    )!.capabilities
    expect(subCaps.has('artifacts.read.v1')).toBe(false)
    expect((await call('artifact/read', { artifactId: 'artifact:test' })).error).toMatchObject({
      data: { code: 'CAPABILITY_REQUIRED', details: { capability: 'artifacts.read.v1' } },
    })
    const tables = new Set(
      (
        db.sqlite
          .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'item_artifacts'")
          .all() as Array<{ name: string }>
      ).map(({ name }) => name),
    )
    expect(tables.has('item_artifacts')).toBe(false)
    db.close()
  })

  test('session-group/changed 缺 session-group.v1 时不允许 durable 投递，thread/updated 在 events.replay.v1 下允许', async () => {
    const { eventDeliveryAllowed } = await import('../src/transport/Server')
    const sessionGroupEvent = {
      id: 0,
      afterSequence: 1,
      threadId: null,
      turnId: null,
      method: 'session-group/changed',
      params: { groupId: 'group:1', reason: 'created' as const, revision: 1, changedAt: 1 },
      createdAt: Date.now(),
    }
    const threadEvent = {
      id: 0,
      afterSequence: 1,
      threadId: null,
      turnId: null,
      method: 'thread/updated',
      params: {
        thread: {
          id: 'thread:1',
          title: 'test',
          projectId: null,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
          unreadAt: null,
          readThroughAt: null,
        },
        version: 1,
      },
      createdAt: Date.now(),
    }
    const withSessionGroup = {
      capabilities: new Set<ProtocolCapability>([
        'rpc.typed.v1',
        'events.replay.v1',
        'session-group.v1',
      ]),
    }
    expect(eventDeliveryAllowed(sessionGroupEvent, withSessionGroup)).toBe(true)
    const withoutSessionGroup = {
      capabilities: new Set<ProtocolCapability>(['rpc.typed.v1', 'events.replay.v1']),
    }
    expect(eventDeliveryAllowed(sessionGroupEvent, withoutSessionGroup)).toBe(false)
    expect(eventDeliveryAllowed(threadEvent, withoutSessionGroup)).toBe(true)
  })

  test('event subscriptions track high-watermarks, acknowledgements and closure', async () => {
    const { db, call, initialize } = await fixture()
    await initialize()
    db.insertEvent('thread:1', null, 'thread/updated', {})
    const subscribed = await call('event/subscribe', {
      streams: [
        { streamId: 'global', after: 0 },
        { streamId: 'thread:1', after: 0 },
      ],
    })
    expect(subscribed.result.highWatermarks).toEqual([
      { streamId: 'global', sequence: 1 },
      { streamId: 'thread:1', sequence: 1 },
    ])
    const subscriptionId = subscribed.result.subscriptionId
    expect(
      (
        await call('event/ack', {
          subscriptionId,
          positions: [{ streamId: 'thread:1', sequence: 1 }],
        })
      ).result.acknowledged,
    ).toEqual([{ streamId: 'thread:1', sequence: 1 }])
    expect((await call('event/unsubscribe', { subscriptionId })).result).toEqual({ ok: true })
    expect(
      (
        await call('event/ack', {
          subscriptionId,
          positions: [{ streamId: 'thread:1', sequence: 1 }],
        })
      ).error,
    ).toMatchObject({ code: -32000, data: { code: 'SUBSCRIPTION_NOT_FOUND' } })
    expect(
      (
        await call('event/subscribe', {
          streams: [{ streamId: 'global', after: 99 }],
        })
      ).error,
    ).toMatchObject({ code: -32000, data: { code: 'CURSOR_EXPIRED' } })
    db.close()
  })

  test('thread stream cursors use the global event high-watermark', async () => {
    const { db, call, initialize } = await fixture()
    await initialize()
    db.insertEvent('thread:1', null, 'thread/updated', {})
    const globalHigh = db.insertEvent('thread:2', null, 'thread/updated', {}).id

    const subscribed = await call('event/subscribe', {
      streams: [{ streamId: 'thread:1', after: 'latest' }],
    })
    expect(subscribed.result.highWatermarks).toEqual([
      { streamId: 'thread:1', sequence: globalHigh },
    ])
    expect(
      (
        await call('event/ack', {
          subscriptionId: subscribed.result.subscriptionId,
          positions: [{ streamId: 'thread:1', sequence: globalHigh }],
        })
      ).result.acknowledged,
    ).toEqual([{ streamId: 'thread:1', sequence: globalHigh }])
    db.close()
  })

  test('connection lease is touched by RPC/SSE activity and lazily closes subscriptions', async () => {
    let now = 1_000
    const { db, router, call, initialize } = await fixture(
      {},
      {
        connectionLeaseMs: 1_000,
        now: () => now,
      },
    )
    const initialized = await initialize()
    const connectionId = initialized.result.connectionId as string
    const subscribed = await call('event/subscribe', {
      streams: [{ streamId: 'global', after: 'latest' }],
    })

    now = 1_900
    expect((await call('github/auth/status', {})).error).toBeUndefined()
    now = 2_800
    expect(router.touchConnection(connectionId)).toBe(true)
    now = 3_801
    expect(router.touchConnection(connectionId)).toBe(false)
    expect(router.subscriptions.get(subscribed.result.subscriptionId, connectionId)).toBeNull()
    expect((await call('github/auth/status', {})).error).toMatchObject({
      data: { code: 'UNAUTHORIZED' },
    })
    db.close()
  })

  test('latest event cursors normalize to the captured high-watermark after retained history advances', async () => {
    const { db, router, call, initialize } = await fixture()
    const initialized = await initialize()
    const discarded = db.insertEvent('thread:1', null, 'thread/updated', {})
    const retained = db.insertEvent('thread:1', null, 'thread/updated', {})
    db.sqlite.query('DELETE FROM events WHERE id = ?').run(discarded.id)

    expect(
      (
        await call('event/subscribe', {
          streams: [{ streamId: 'global', after: 0 }],
        })
      ).error,
    ).toMatchObject({
      code: -32000,
      data: {
        code: 'CURSOR_EXPIRED',
        details: { streamId: 'global', lowWatermark: retained.id, highWatermark: retained.id },
      },
    })

    const subscribed = await call('event/subscribe', {
      streams: [{ streamId: 'global', after: 'latest' }],
    })
    expect(subscribed.result.highWatermarks).toEqual([
      { streamId: 'global', sequence: retained.id },
    ])
    const subscription = router.subscriptions.get(
      subscribed.result.subscriptionId,
      initialized.result.connectionId,
    )
    expect(subscription?.streams.get('global')).toBe(retained.id)
    expect(subscription?.acknowledged.get('global')).toBe(retained.id)
    db.close()
  })

  test('recovers and idempotently resolves hook trust through the unified interaction methods', async () => {
    const { db, call, initialize } = await fixture()
    await initialize()
    const project = db.createProject({ rootPath: roots.at(-1)! })
    const thread = db.createThread('interaction', project.id)
    const turn = db.createTurn(thread.id, {
      content: 'test',
      model: Model.Ref.make({
        providerID: Provider.ID.make('test'),
        id: Model.ID.make('model'),
      }),
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      strategy: 'queue',
      taskMode: 'chat',
    })
    const pending = db.ensureHookTrustRequest({
      threadID: thread.id,
      turnID: turn.turnID,
      workspacePath: roots.at(-1)!,
      configPath: join(roots.at(-1)!, '.pidex', 'hooks.json'),
      configHash: 'a'.repeat(64),
      auditSummary: {
        hooks: [{ id: 'pre-tool', event: 'preToolUse', command: 'bun run check' }],
      },
    })
    const listed = await call('interaction/listPending', {
      threadId: thread.id,
      kinds: ['hookTrust'],
    })
    expect(listed.result.interactions).toMatchObject([
      {
        interactionId: pending.request.id,
        kind: 'hookTrust',
        version: 1,
        hook: { id: 'pre-tool', command: 'bun run check' },
      },
    ])
    const params = {
      interactionId: pending.request.id,
      expectedVersion: 1,
      response: { kind: 'hookTrust', decision: 'allow' },
      operationId: 'interaction:hook:allow',
    }
    const resolved = await call('interaction/respond', params)
    expect(resolved.result).toMatchObject({
      interactionId: pending.request.id,
      kind: 'hookTrust',
      state: 'resolved',
      version: 2,
    })
    expect((await call('interaction/respond', params)).result).toEqual(resolved.result)
    expect(db.interactionOperation(params.operationId)?.result).toEqual(resolved.result)
    db.close()
  })
})
