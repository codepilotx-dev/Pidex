import { describe, expect, test } from 'bun:test'
import type { Project } from '@pidex/shared'
import type { ThreadListItem, ThreadSnapshot } from '@pidex/shared/thread'
import {
  createDesktopClient,
  type DesktopForegroundController,
} from '../src/services/desktop-client/index.js'

const now = 1_700_000_000_000
const projectRootPath = 'F:\\CodeProject\\Pidex-Ts'
const primaryFolder = {
  id: 'folder-primary',
  name: 'Pidex-Ts',
  path: projectRootPath,
  role: 'primary' as const,
  availability: 'available' as const,
  order: 0,
  createdAt: now,
  updatedAt: now,
}
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
  name: 'Pidex-Ts',
  primaryFolderId: primaryFolder.id,
  folders: [primaryFolder],
  removedAt: null,
  lastOpenedAt: now,
  createdAt: now,
  updatedAt: now,
  settings: {
    defaultModel: null,
    instructions: '',
    executionEnvironment: 'auto' as const,
    version: 1,
  },
}
const projectWorkspace = {
  kind: 'project' as const,
  projectID: project.id,
  cwd: projectRootPath,
  runtimeWorkspaceRoots: [
    { folderId: primaryFolder.id, path: projectRootPath, role: 'primary' as const },
  ],
  instructionSources: [],
  outputDirectory: null,
}
const goal = {
  id: 'goal-1',
  threadId: 'session-1',
  objective: '目标',
  status: 'active' as const,
  tokenBudget: null,
  tokensUsed: 0,
  timeUsedSeconds: 0,
  version: 1,
  createdAt: now,
  updatedAt: now,
}

function sessionItem(overrides: Partial<ThreadListItem> = {}): ThreadListItem {
  return {
    id: 'session-1',
    projectID: project.id,
    gitBranch: null,
    workspace: projectWorkspace,
    title: '历史会话',
    preview: '预览',
    firstUserMessage: '第一条消息',
    messageCount: 1,
    latestTurnStatus: 'completed',
    archivedAt: null,
    settings: defaultThreadSettings,
    createdAt: now,
    updatedAt: now + 1000,
    ...overrides,
  }
}

/** A narrow `getListItem`-shaped item: no goal/sessionGroupId/workflowId/pendingPlanApproval. */
function narrowItem(id: string, unreadAt: number | null): ThreadListItem {
  return {
    id,
    storageSource: 'local',
    projectID: project.id,
    gitBranch: null,
    title: '历史会话',
    preview: '预览',
    firstUserMessage: '第一条消息',
    messageCount: 1,
    latestTurnStatus: 'completed',
    archivedAt: null,
    unreadAt,
    workspace: projectWorkspace,
    settings: defaultThreadSettings,
    createdAt: now,
    updatedAt: now + 1000,
  }
}

function snapshotFor(thread: ThreadListItem): ThreadSnapshot {
  return {
    thread: {
      id: thread.id,
      title: thread.title,
      projectID: thread.projectID,
      gitBranch: null,
      workspace: projectWorkspace,
      settings: defaultThreadSettings,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    },
    turns: [],
    inputs: [],
    messages: [],
    items: [],
    approvals: [],
    proposals: [],
    agents: [],
    subagents: [],
  }
}

type RpcCall = { threadId: string; readThroughAt: number; operationId: string }
type UnreadCall = { threadId: string; unreadAt: number; operationId: string }

function createHarness(initialThreads: ThreadListItem[]) {
  const unreadById = new Map<string, number | null>()
  for (const thread of initialThreads) unreadById.set(thread.id, thread.unreadAt ?? null)
  const markReadCalls: RpcCall[] = []
  const markUnreadCalls: UnreadCall[] = []
  let markReadFailures = 0
  let markReadDelayMs = 0

  const listThreads = (): ThreadListItem[] =>
    initialThreads.map((thread) => ({ ...thread, unreadAt: unreadById.get(thread.id) ?? null }))

  const fetch = async (_path: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    const method = body?.method as string
    const params = body?.params ?? {}
    switch (method) {
      case 'initialize':
        return rpc(body.id, initializedResult())
      case 'initialized':
        return new Response(null, { status: 204 })
      case 'project/list':
        return rpc(body.id, { projects: [project], nextCursor: null })
      case 'thread/list':
        return rpc(body.id, { threads: listThreads(), nextCursor: null })
      case 'thread/read': {
        const thread = listThreads().find((entry) => entry.id === params.threadId) ?? listThreads()[0]
        return rpc(body.id, snapshotResult(snapshotFor(thread!)))
      }
      case 'interaction/listPending':
        return rpc(body.id, { interactions: [], nextCursor: null })
      case 'event/subscribe':
        return rpc(body.id, {
          subscriptionId: 'unread-sub',
          highWatermarks: [{ streamId: 'global', sequence: 0 }],
        })
      case 'event/unsubscribe':
        return rpc(body.id, { ok: true })
      case 'event/ack':
        return rpc(body.id, { subscriptionId: params.subscriptionId, acknowledged: params.positions })
      case 'thread/mark-read': {
        const call: RpcCall = {
          threadId: params.threadId,
          readThroughAt: params.readThroughAt,
          operationId: params.operationId,
        }
        markReadCalls.push(call)
        if (markReadDelayMs > 0) await Bun.sleep(markReadDelayMs)
        if (markReadFailures > 0) {
          markReadFailures -= 1
          return new Response('mark read failed', { status: 500 })
        }
        const current = unreadById.get(call.threadId) ?? null
        if (current != null && current <= call.readThroughAt) unreadById.set(call.threadId, null)
        return rpc(body.id, {
          thread: { ...narrowItem(call.threadId, null), unreadAt: unreadById.get(call.threadId) ?? null },
        })
      }
      case 'thread/update':
      case 'thread/title/regenerate': {
        const thread = initialThreads.find((entry) => entry.id === params.threadId)!
        thread.title = method === 'thread/title/regenerate' ? '重新生成的标题' : (params.patch.title ?? thread.title)
        if (typeof params.patch?.archived === 'boolean') thread.archivedAt = params.patch.archived ? now + 2000 : null
        return rpc(body.id, { thread: { ...narrowItem(thread.id, unreadById.get(thread.id) ?? null), title: thread.title, archivedAt: thread.archivedAt } })
      }
      case 'thread/mark-unread': {
        const call: UnreadCall = {
          threadId: params.threadId,
          unreadAt: params.unreadAt,
          operationId: params.operationId,
        }
        markUnreadCalls.push(call)
        unreadById.set(call.threadId, call.unreadAt)
        return rpc(body.id, { thread: { ...narrowItem(call.threadId, null), unreadAt: call.unreadAt } })
      }
      default:
        throw new Error(`Unhandled RPC method: ${method}`)
    }
  }

  return {
    fetch,
    markReadCalls,
    markUnreadCalls,
    unreadById,
    setMarkReadFailures: (count: number) => {
      markReadFailures = count
    },
    setMarkReadDelay: (ms: number) => {
      markReadDelayMs = ms
    },
  }
}

type FakeSource = {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: (() => void) | null
  close: () => void
}

function createSource(): FakeSource {
  return { onmessage: null, onerror: null, close: () => {} }
}

function emitTurn(
  source: FakeSource,
  input: {
    sequence: number
    type: 'turn/completed' | 'turn/failed'
    threadId: string
    occurredAt: number
    error?: string
  },
): void {
  const status = input.type === 'turn/completed' ? 'completed' : 'failed'
  source.onmessage!({
    data: JSON.stringify({
      jsonrpc: '2.0',
      method: 'event/next',
      params: {
        subscriptionId: 'unread-sub',
        event: {
          eventId: String(input.sequence),
          streamId: 'global',
          sequence: input.sequence,
          version: 2,
          occurredAt: input.occurredAt,
          threadId: input.threadId,
          durability: 'durable',
          type: input.type,
          payload: {
            turn: {
              id: `turn-${input.sequence}`,
              threadId: input.threadId,
              sourceInputID: 'input-1',
              status,
              mode: 'chat',
              model: { providerID: 'openai', id: 'gpt-5' },
              permissionConfig: defaultThreadSettings.permissionConfig,
              rootAgentId: 'root',
              mergedInputIDs: [],
              queuePosition: null,
              startedAt: input.occurredAt - 1000,
              finishedAt: input.occurredAt,
              elapsedSeconds: 1,
              error: input.error ?? null,
            },
            ...(input.type === 'turn/failed'
              ? { error: { code: 'E_TURN', message: input.error ?? 'boom', retryable: false } }
              : {}),
          },
        },
      },
    }),
  } as MessageEvent)
}

function createForegroundController(initial: boolean) {
  let foreground = initial
  const listeners = new Set<() => void>()
  const controller: DesktopForegroundController = {
    isForeground: () => foreground,
    addChangeListener: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    controller,
    setForeground(next: boolean) {
      foreground = next
      for (const listener of listeners) listener()
    },
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2500): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await Bun.sleep(5)
  }
}

async function waitForEventSource(source: FakeSource): Promise<void> {
  for (let i = 0; i < 200 && !source.onmessage; i += 1) await Bun.sleep(5)
  expect(source.onmessage).not.toBeNull()
}

function rpc(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function snapshotResult(snapshot: ThreadSnapshot) {
  return { snapshot, streamPosition: { streamId: snapshot.thread.id, sequence: 1 } }
}

function initializedResult() {
  return {
    protocol: 'thread-rpc-v4',
    serverInfo: { name: 'test-agent', version: '1.0.0' },
    capabilities: ['rpc.typed.v1', 'config.manage.v1'],
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 8,
      maxStreamsPerSubscription: 8,
      maxPendingRequests: 32,
    },
    connectionId: 'test-connection',
  }
}

describe('会话自动已读', () => {
  test('前台完成事件只对当前查看的会话自动标记已读', async () => {
    const harness = createHarness([
      sessionItem({ id: 'session-1' }),
      sessionItem({ id: 'session-2', title: '另一个会话' }),
    ])
    const source = createSource()
    const client = createDesktopClient({
      fetch: harness.fetch,
      eventSourceFactory: () => source as unknown as EventSource,
    })
    await client.listSessions()
    await client.setActiveSession('session-1')
    const unsubscribe = client.onSessionStoreChange(() => {})
    try {
      await waitForEventSource(source)
      harness.unreadById.set('session-1', now + 5000)
      emitTurn(source, {
        sequence: 5,
        type: 'turn/completed',
        threadId: 'session-1',
        occurredAt: now + 5000,
      })
      await waitFor(() => harness.markReadCalls.length >= 1)
      expect(harness.markReadCalls[0]).toMatchObject({
        threadId: 'session-1',
        readThroughAt: now + 5000,
      })
      await waitFor(() => harness.unreadById.get('session-1') === null)

      // A completion for a session the user is not viewing must not be cleared.
      harness.unreadById.set('session-2', now + 6000)
      emitTurn(source, {
        sequence: 6,
        type: 'turn/completed',
        threadId: 'session-2',
        occurredAt: now + 6000,
      })
      await Bun.sleep(180)
      expect(harness.markReadCalls.some((call) => call.threadId === 'session-2')).toBe(false)
    } finally {
      unsubscribe()
    }
  })

  test('窗口失焦时保留未读，恢复前台后自动清除', async () => {
    const harness = createHarness([sessionItem({ id: 'session-1' })])
    const source = createSource()
    const foreground = createForegroundController(false)
    const observed: Array<string | null | undefined> = []
    const client = createDesktopClient({
      fetch: harness.fetch,
      eventSourceFactory: () => source as unknown as EventSource,
      foreground: foreground.controller,
    })
    await client.listSessions()
    await client.setActiveSession('session-1')
    const unsubscribe = client.onSessionStoreChange((change) => {
      observed.push(change.sessions.find((entry) => entry.item.id === 'session-1')?.item.unreadAt)
    })
    try {
      await waitForEventSource(source)
      harness.unreadById.set('session-1', now + 5000)
      emitTurn(source, {
        sequence: 7,
        type: 'turn/completed',
        threadId: 'session-1',
        occurredAt: now + 5000,
      })
      await waitFor(() => observed.some((unread) => unread === new Date(now + 5000).toISOString()))
      // Backgrounded: the unread must stay and no mark-read may fire yet.
      expect(harness.markReadCalls).toHaveLength(0)
      expect(harness.unreadById.get('session-1')).toBe(now + 5000)

      foreground.setForeground(true)
      await waitFor(() => harness.markReadCalls.length >= 1)
      await waitFor(() => harness.unreadById.get('session-1') === null)
      expect(harness.markReadCalls[0]).toMatchObject({
        threadId: 'session-1',
        readThroughAt: now + 5000,
      })
    } finally {
      unsubscribe()
    }
  })

  test('自动清除失败不使用永久水位隐藏未读，并在下次目录刷新时重试', async () => {
    const harness = createHarness([sessionItem({ id: 'session-1' })])
    harness.setMarkReadFailures(1)
    const source = createSource()
    const client = createDesktopClient({
      fetch: harness.fetch,
      eventSourceFactory: () => source as unknown as EventSource,
    })
    await client.listSessions()
    await client.setActiveSession('session-1')
    const unsubscribe = client.onSessionStoreChange(() => {})
    try {
      await waitForEventSource(source)
      harness.unreadById.set('session-1', now + 5000)
      emitTurn(source, {
        sequence: 8,
        type: 'turn/completed',
        threadId: 'session-1',
        occurredAt: now + 5000,
      })
      await waitFor(() => harness.markReadCalls.length >= 1)
      // First attempt failed: the unread must not be hidden behind a watermark.
      await Bun.sleep(120)
      expect(harness.unreadById.get('session-1')).toBe(now + 5000)
      expect((await client.listSessions())[0]?.item.unreadAt).toBe(
        new Date(now + 5000).toISOString(),
      )

      // The next catalog refresh retries and clears it.
      await client.listSessions()
      await waitFor(() => harness.markReadCalls.length >= 2)
      await waitFor(() => harness.unreadById.get('session-1') === null)
      expect((await client.listSessions())[0]?.item.unreadAt).toBeNull()
    } finally {
      unsubscribe()
    }
  })

  test('重复的完成事件只触发一次自动已读', async () => {
    const harness = createHarness([sessionItem({ id: 'session-1' })])
    const source = createSource()
    const client = createDesktopClient({
      fetch: harness.fetch,
      eventSourceFactory: () => source as unknown as EventSource,
    })
    await client.listSessions()
    await client.setActiveSession('session-1')
    const unsubscribe = client.onSessionStoreChange(() => {})
    try {
      await waitForEventSource(source)
      harness.unreadById.set('session-1', now + 5000)
      emitTurn(source, {
        sequence: 9,
        type: 'turn/completed',
        threadId: 'session-1',
        occurredAt: now + 5000,
      })
      emitTurn(source, {
        sequence: 9,
        type: 'turn/completed',
        threadId: 'session-1',
        occurredAt: now + 5000,
      })
      await waitFor(() => harness.markReadCalls.length >= 1)
      await Bun.sleep(180)
      expect(harness.markReadCalls).toHaveLength(1)
    } finally {
      unsubscribe()
    }
  })

  test('手动标未读不会被进行中的自动已读清掉', async () => {
    const harness = createHarness([sessionItem({ id: 'session-1' })])
    harness.setMarkReadDelay(60)
    const source = createSource()
    const client = createDesktopClient({
      fetch: harness.fetch,
      eventSourceFactory: () => source as unknown as EventSource,
    })
    await client.listSessions()
    await client.setActiveSession('session-1')
    const unsubscribe = client.onSessionStoreChange(() => {})
    try {
      await waitForEventSource(source)
      harness.unreadById.set('session-1', now + 5000)
      emitTurn(source, {
        sequence: 10,
        type: 'turn/completed',
        threadId: 'session-1',
        occurredAt: now + 5000,
      })
      // Wait until the automatic mark-read is actually in flight, then race a
      // manual mark-unread against it.
      await waitFor(() => harness.markReadCalls.length >= 1)
      const manualUnreadAt = now + 7000
      await client.markSessionUnread('session-1', new Date(manualUnreadAt).toISOString())
      await waitFor(() => harness.unreadById.get('session-1') === manualUnreadAt)
      expect(harness.markUnreadCalls).toHaveLength(1)
      expect((await client.listSessions())[0]?.item.unreadAt).toBe(
        new Date(manualUnreadAt).toISOString(),
      )
    } finally {
      unsubscribe()
    }
  })

  test('重命名、归档和重新生成标题保留完整会话字段', async () => {
    const harness = createHarness([sessionItem({
      sessionGroupId: 'group-1', workflowId: 'group-1', pendingPlanApproval: true, goal,
    })])
    const client = createDesktopClient({ fetch: harness.fetch })
    await client.listSessions()
    const renamed = await client.renameSession('session-1', '新标题')
    expect(renamed.item.sessionName).toBe('新标题')
    const archived = await client.updateSessionMetadata('session-1', { archivedAt: new Date(now + 2000).toISOString() })
    expect(archived.item.archivedAt).toBe(new Date(now + 2000).toISOString())
    const regenerated = await client.regenerateSessionTitle('session-1')
    expect(regenerated.item.sessionName).toBe('重新生成的标题')
    for (const snapshot of [renamed, archived, regenerated]) {
      expect(snapshot.item.threadGoal).toEqual(goal)
      expect(snapshot.item.sessionGroupId).toBe('group-1')
      expect(snapshot.item.workflowId).toBe('group-1')
      expect(snapshot.item.pendingPlanApproval).toBe(true)
    }
  })

  test('读态响应只合并权威字段，保留 Goal、分组与待确认计划', async () => {
    const harness = createHarness([
      sessionItem({
        id: 'session-1',
        unreadAt: now + 500,
        sessionGroupId: 'group-1',
        workflowId: 'group-1',
        pendingPlanApproval: true,
        goal,
      }),
    ])
    const client = createDesktopClient({ fetch: harness.fetch })
    await client.listSessions()

    const read = await client.markSessionRead('session-1', new Date(now + 500).toISOString())
    expect(read.unreadAt).toBeNull()
    expect(read.threadGoal).toEqual(goal)
    expect(read.sessionGroupId).toBe('group-1')
    expect(read.workflowId).toBe('group-1')
    expect(read.pendingPlanApproval).toBe(true)

    const unread = await client.markSessionUnread('session-1', new Date(now + 600).toISOString())
    expect(unread.unreadAt).toBe(new Date(now + 600).toISOString())
    expect(unread.threadGoal).toEqual(goal)
    expect(unread.sessionGroupId).toBe('group-1')
    expect(unread.workflowId).toBe('group-1')
    expect(unread.pendingPlanApproval).toBe(true)
  })
})
