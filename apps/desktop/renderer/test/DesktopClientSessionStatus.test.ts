import { describe, expect, test } from 'bun:test'
import type { Project } from '@pidex/shared'
import type { ThreadListItem } from '@pidex/shared/thread'
import type { DesktopSessionStoreChange } from '../shared/Types.js'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

const now = 1_700_000_000_000
const projectRootPath = 'F:\\CodeProject\\Pidex-Status'
const defaultThreadSettings = {
  taskMode: 'chat' as const,
  permissionConfig: {
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'on-request' as const,
    approvalsReviewer: 'user' as const,
  },
}

const project: Project = {
  id: 'project-1',
  name: 'Pidex-Status',
  primaryFolderId: 'folder-primary',
  folders: [
    {
      id: 'folder-primary',
      name: 'Pidex-Status',
      path: projectRootPath,
      role: 'primary',
      availability: 'available',
      order: 0,
      createdAt: now,
      updatedAt: now,
    },
  ],
  removedAt: null,
  lastOpenedAt: now,
  createdAt: now,
  updatedAt: now,
  settings: { defaultModel: null, instructions: '', version: 1 },
}
const projectWorkspace = {
  kind: 'project' as const,
  projectID: project.id,
  cwd: projectRootPath,
  runtimeWorkspaceRoots: [
    {
      folderId: 'folder-primary',
      path: projectRootPath,
      role: 'primary' as const,
    },
  ],
  instructionSources: [],
  outputDirectory: null,
}

function threadItem(overrides: Partial<ThreadListItem> = {}): ThreadListItem {
  return {
    id: 'session-status',
    projectID: project.id,
    gitBranch: null,
    workspace: projectWorkspace,
    title: '状态会话',
    preview: null,
    firstUserMessage: null,
    messageCount: 0,
    latestTurnStatus: 'running',
    archivedAt: null,
    settings: defaultThreadSettings,
    createdAt: now,
    updatedAt: now + 1_000,
    ...overrides,
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function rpc(id: unknown, result: unknown): Response {
  return json({ jsonrpc: '2.0', id, result })
}

function initializedResult() {
  return {
    protocol: 'thread-rpc-v4',
    serverInfo: { name: 'test-agent', version: '1.0.0' },
    capabilities: ['rpc.typed.v1', 'interaction.recovery.v1'],
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 8,
      maxStreamsPerSubscription: 8,
      maxPendingRequests: 32,
    },
    connectionId: 'test-connection',
  }
}

function listFetcher(latestTurnStatus: () => ThreadListItem['latestTurnStatus']) {
  return async (_path: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (body?.method === 'initialize') return rpc(body.id, initializedResult())
    if (body?.method === 'initialized') return new Response(null, { status: 204 })
    if (body?.method === 'project/list') {
      return rpc(body.id, { projects: [project], nextCursor: null })
    }
    if (body?.method === 'thread/list') {
      return rpc(body.id, {
        threads: [threadItem({ latestTurnStatus: latestTurnStatus() })],
        nextCursor: null,
      })
    }
    throw new Error(`Unexpected RPC method: ${body?.method}`)
  }
}

function statusesFrom(change: DesktopSessionStoreChange | undefined): string[] {
  return (change?.sessions ?? []).map((snapshot) => snapshot.item.status)
}

describe('session status single source', () => {
  test('canonical status overrides the catalog value for store consumers', async () => {
    const client = createDesktopClient({ fetch: listFetcher(() => 'running') })
    const changes: DesktopSessionStoreChange[] = []
    const unsubscribe = client.onSessionStoreChange((change) => changes.push(change))

    const listed = await client.listSessions()
    expect(listed[0]!.item.status).toBe('running')
    await client.setActiveSession('session-status')
    expect(statusesFrom(changes.at(-1))).toEqual(['running'])

    client.publishCanonicalSessionStatus('session-status', {
      status: 'done',
      latestTurnStatus: 'completed',
    })

    const published = changes.at(-1)!.sessions[0]!.item
    expect(published.status).toBe('done')
    expect(published.latestTurnStatus).toBe('completed')

    // Republishing an identical value must not emit another change.
    const emitted = changes.length
    client.publishCanonicalSessionStatus('session-status', {
      status: 'done',
      latestTurnStatus: 'completed',
    })
    expect(changes.length).toBe(emitted)
    unsubscribe()
  })

  test('clearing the canonical status hands the thread back to the catalog', async () => {
    const client = createDesktopClient({ fetch: listFetcher(() => 'running') })
    const changes: DesktopSessionStoreChange[] = []
    const unsubscribe = client.onSessionStoreChange((change) => changes.push(change))

    await client.listSessions()
    client.publishCanonicalSessionStatus('session-status', {
      status: 'done',
      latestTurnStatus: 'completed',
    })
    expect(statusesFrom(changes.at(-1))).toEqual(['done'])

    client.publishCanonicalSessionStatus('session-status', null)
    expect(statusesFrom(changes.at(-1))).toEqual(['running'])
    unsubscribe()
  })

  test('reconciling after a missed terminal event corrects a background row', async () => {
    let terminal = false
    const observedStatuses: string[] = []
    const source = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      close: () => {},
    }
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const params = body?.params ?? {}
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'event/subscribe') {
        return rpc(body.id, {
          subscriptionId: 'subscription-1',
          highWatermarks: [{ streamId: 'global', sequence: 12 }],
        })
      }
      if (body?.method === 'event/unsubscribe') return rpc(body.id, { ok: true })
      if (body?.method === 'event/ack') {
        return rpc(body.id, {
          subscriptionId: params.subscriptionId,
          acknowledged: params.positions,
        })
      }
      if (body?.method === 'interaction/listPending') {
        return rpc(body.id, { interactions: [], nextCursor: null })
      }
      if (body?.method === 'project/list') {
        return rpc(body.id, { projects: [project], nextCursor: null })
      }
      if (body?.method === 'thread/list') {
        return rpc(body.id, {
          threads: [
            threadItem({
              latestTurnStatus: terminal ? 'completed' : 'running',
            }),
          ],
          nextCursor: null,
        })
      }
      throw new Error(`Unexpected RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({
      fetch: fetcher,
      eventSourceFactory: () => source as unknown as EventSource,
    })
    const listed = await client.listSessions()
    expect(listed[0]!.item.status).toBe('running')
    // The row is deliberately not the active session: background rows must
    // recover from the persisted status as well.
    const unsubscribe = client.onSessionStoreChange((change) => {
      observedStatuses.push(...statusesFrom(change))
    })
    for (let index = 0; index < 20 && !source.onmessage; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    // The terminal status is persisted, but this client never received the
    // lifecycle event that would have reported it.
    terminal = true
    source.onmessage?.({
      data: JSON.stringify({
        jsonrpc: '2.0',
        method: 'event/replayComplete',
        params: {
          subscriptionId: 'subscription-1',
          positions: [{ streamId: 'global', sequence: 12 }],
        },
      }),
    } as MessageEvent)
    for (let index = 0; index < 50 && !observedStatuses.includes('done'); index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    unsubscribe()

    expect(observedStatuses).toContain('done')
  })
})
