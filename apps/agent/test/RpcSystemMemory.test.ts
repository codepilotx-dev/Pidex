import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { Capabilities } from '@pidex/agent-protocol'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { RpcRouter, type RpcRouterDependencies } from '../src/transport/rpc/RpcRouter'

const roots: string[] = []
afterEach(async () => {
  await removeFixturePaths(roots.splice(0))
})

const fixture = async (overrides: Partial<RpcRouterDependencies> = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-rpc-memory-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))

  const router = new RpcRouter({
    config: {
      snapshot: () => ({}),
      dataDir: root,
      write: async () => {},
    } as never,
    db,
    hub: {
      publish: () => () => {},
      subscribe: () => () => {},
    } as never,
    threads: {} as never,
    history: {} as never,
    approvals: {} as never,
    questions: {} as never,
    subagents: {} as never,
    attachments: {} as never,
    artifacts: {} as never,
    localContextPaths: {} as never,
    projectSources: {} as never,
    providers: {} as never,
    piModels: {} as never,
    apiKeys: {} as never,
    modelHealth: {} as never,
    providerCredentials: {} as never,
    providerCredentialStore: {} as never,
    authSessions: {} as never,
    memory: {} as never,
    hooks: {} as never,
    review: {} as never,
    github: {} as never,
    git: {} as never,
    tooling: {} as never,
    pets: {} as never,
    releaseNotes: {} as never,
    minimaxCli: {} as never,
    usage: {} as never,
    turnPatches: {} as never,
    terminalContext: {} as never,
    terminalOutput: {} as never,
    localEnvironment: {} as never,
    worktrees: {} as never,
    handoff: {} as never,
    threadFork: {} as never,
    sideChats: {} as never,
    executionBindings: {} as never,
    worktreeRepository: {} as never,
    environmentDeltas: {} as never,
    speech: {} as never,
    threadExecutions: {} as never,
    sessionGroups: {} as never,
    threadGoals: {} as never,
    threadBookmarks: {} as never,
    automation: {} as never,
    ...overrides,
  })

  let id = 0
  let connectionId: string | null = null

  const call = (method: string, params: Record<string, unknown>) =>
    router.handle(
      { jsonrpc: '2.0', id: `test:${++id}`, method, params },
      { ...(connectionId ? { connectionId } : {}) },
    ) as Promise<any>

  const initialize = async (capabilities: readonly string[] = Capabilities) => {
    const response = await call('initialize', {
      clientInfo: { name: 'test', version: '1.0.0', platform: 'win32' },
      protocols: ['thread-rpc-v4'],
      capabilities: [...capabilities],
      interactionDelivery: 'active',
    })
    if (!response.result) return response
    connectionId = response.result.connectionId
    await router.handle(
      { jsonrpc: '2.0', method: 'initialized', params: { protocol: 'thread-rpc-v4' } },
      { connectionId: connectionId! },
    )
    return response
  }

  return { db, router, call, initialize }
}

describe('system/shrinkMemory RPC', () => {
  test('requires system.memory.v1 capability', async () => {
    const value = await fixture()
    // Initialize without system.memory.v1
    const minimalCapabilities = Capabilities.filter((c) => c !== 'system.memory.v1')
    await value.initialize(minimalCapabilities)

    const response = await value.call('system/shrinkMemory', { reason: 'manual' })
    expect(response.error).toMatchObject({
      code: -32000,
      data: {
        code: 'CAPABILITY_REQUIRED',
      },
    })
    value.db.close()
  })

  test('executes shrink via MemoryManager when capability is negotiated', async () => {
    let passedReason: string | undefined
    const mockMemoryManager = {
      shrink: async (reason: string) => {
        passedReason = reason
        const stats = process.memoryUsage()
        return {
          success: true,
          stats: {
            rss: stats.rss,
            heapTotal: stats.heapTotal,
            heapUsed: stats.heapUsed,
            external: stats.external,
            arrayBuffers: stats.arrayBuffers,
          },
          freedRssBytes: 2048,
        }
      },
    }

    const value = await fixture({ memoryManager: mockMemoryManager as never })
    await value.initialize()

    const response = await value.call('system/shrinkMemory', { reason: 'idle' })
    expect(response.result).toMatchObject({
      success: true,
      stats: {
        rss: expect.any(Number),
        heapUsed: expect.any(Number),
      },
      freedRssBytes: 2048,
    })
    expect(passedReason).toBe('idle')
    value.db.close()
  })

  test('falls back to process.memoryUsage if MemoryManager is not provided', async () => {
    const value = await fixture()
    await value.initialize()

    const response = await value.call('system/shrinkMemory', { reason: 'turn_end' })
    expect(response.result).toMatchObject({
      success: true,
      stats: {
        rss: expect.any(Number),
        heapUsed: expect.any(Number),
      },
    })
    value.db.close()
  })
})
