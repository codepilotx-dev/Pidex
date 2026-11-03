import { describe, expect, test } from 'bun:test'
import type { EventEnvelope } from '@pidex/agent-protocol'
import { SessionCatalogCoordinator } from '../src/services/desktop-client/SessionCatalogCoordinator.js'

describe('SessionCatalogCoordinator', () => {
  test('deduplicates list-level thread refreshes and waits for the catalog commit', async () => {
    let releaseRefresh = () => {}
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const refreshed: string[][] = []
    const lifecycleUpdates: string[] = []
    let providerUpdates = 0
    const coordinator = new SessionCatalogCoordinator({
      onCatalogUpdated: () => {},
      onProviderCredentialUpdated: () => {
        providerUpdates += 1
      },
      onConfigUpdated: () => {},
      onWorkspaceFileChanged: () => {},
      onWorkspaceGitChanged: () => {},
      onLifecycleUpdated: (update) => {
        lifecycleUpdates.push(update.status)
      },
      refreshThreads: async (threadIds) => {
        refreshed.push([...threadIds])
        await refreshGate
      },
    })

    let committed = false
    const delivery = coordinator
      .deliverBatch([
        threadEvent('thread/created', 'event-1'),
        threadEvent('thread/updated', 'event-2'),
        providerCredentialEvent(),
      ])
      .then(() => {
        committed = true
      })

    await Promise.resolve()
    expect(refreshed).toEqual([['thread-1']])
    expect(providerUpdates).toBe(1)
    expect(lifecycleUpdates).toEqual([])
    expect(committed).toBe(false)

    releaseRefresh()
    await delivery
    expect(committed).toBe(true)
  })

  test('refreshes once per schedule event batch, including global events without a thread ID', async () => {
    const refreshed: string[][] = []
    const coordinator = new SessionCatalogCoordinator({
      onCatalogUpdated: () => {},
      onProviderCredentialUpdated: () => {},
      onConfigUpdated: () => {},
      onWorkspaceFileChanged: () => {},
      onWorkspaceGitChanged: () => {},
      onLifecycleUpdated: () => {},
      refreshThreads: async (threadIds) => {
        refreshed.push([...threadIds])
      },
    })
    const base = {
      streamId: 'global',
      version: 1 as const,
      occurredAt: 2,
      durability: 'durable' as const,
      sequence: 2,
    }
    const scheduled: EventEnvelope = {
      ...base,
      eventId: 'scheduled-1',
      type: 'scheduled-task/changed',
      payload: { scheduledTaskId: 'task-1', revision: 1, status: 'running', changedAt: 2 },
    }
    const automation: EventEnvelope = {
      ...base,
      eventId: 'automation-1',
      type: 'automation/runChanged',
      payload: { automationId: 'automation-1', runId: 'run-1', status: 'running', changedAt: 2 },
    }
    await coordinator.deliverBatch([scheduled])
    await coordinator.deliverBatch([automation])
    await coordinator.deliverBatch([
      scheduled,
      automation,
      threadEvent('thread/updated', 'event-2'),
    ])
    expect(refreshed).toEqual([[], [], ['thread-1']])
  })

  test('applies only the latest lifecycle state for each thread before refresh', async () => {
    const calls: string[] = []
    const coordinator = new SessionCatalogCoordinator({
      onCatalogUpdated: () => {},
      onProviderCredentialUpdated: () => {},
      onConfigUpdated: () => {},
      onWorkspaceFileChanged: () => {},
      onWorkspaceGitChanged: () => {},
      onLifecycleUpdated: (update) => {
        calls.push(`lifecycle:${update.status}:${update.sequence}`)
      },
      refreshThreads: async (threadIds) => {
        calls.push(`refresh:${threadIds.join(',')}`)
      },
    })

    await coordinator.deliverBatch([
      lifecycleEvent('turn/completed', 'completed', 5),
      lifecycleEvent('turn/started', 'running', 3),
      lifecycleEvent('turn/statusChanged', 'waiting-user-input', 4),
    ])

    expect(calls).toEqual(['lifecycle:completed:5', 'refresh:thread-1'])
  })

  test('delivers sanitized error details for failed turn events and null for clean ones', async () => {
    let capturedError: string | null | undefined
    let capturedStatus: string | undefined
    const coordinator = new SessionCatalogCoordinator({
      onCatalogUpdated: () => {},
      onProviderCredentialUpdated: () => {},
      onConfigUpdated: () => {},
      onWorkspaceFileChanged: () => {},
      onWorkspaceGitChanged: () => {},
      onLifecycleUpdated: (update) => {
        capturedStatus = update.status
        capturedError = update.error
      },
      refreshThreads: async () => {},
    })

    const turn = {
      id: 'turn-1',
      threadId: 'thread-1',
      sourceInputID: 'input-1',
      status: 'failed' as const,
      mode: 'chat' as const,
      model: { providerID: 'openai', id: 'gpt-5' },
      permissionConfig: {
        sandboxMode: 'workspace-write' as const,
        approvalPolicy: 'on-request' as const,
        approvalsReviewer: 'user' as const,
      },
      rootAgentId: 'agent-1',
      mergedInputIDs: [],
      startedAt: 1,
      finishedAt: 2,
      elapsedSeconds: 1,
      error: '网络请求超时，请重试',
    }

    const failedEvent: EventEnvelope = {
      eventId: 'ev-failed-1',
      streamId: 'thread-1',
      type: 'turn/failed',
      version: 2,
      occurredAt: 2,
      threadId: 'thread-1',
      turnId: 'turn-1',
      durability: 'durable',
      sequence: 10,
      payload: {
        turn,
        error: { code: 'NETWORK_TIMEOUT', message: '网络请求超时，请重试', retryable: true },
      },
    }

    await coordinator.deliverBatch([failedEvent])
    expect(capturedStatus).toBe('failed')
    expect(capturedError).toBe('网络请求超时，请重试')
  })
})

function lifecycleEvent(
  type: 'turn/started' | 'turn/statusChanged' | 'turn/completed',
  status: 'running' | 'waiting-user-input' | 'completed',
  sequence: number,
): EventEnvelope {
  const turn = {
    id: 'turn-1',
    threadId: 'thread-1',
    sourceInputID: 'input-1',
    status,
    mode: 'chat' as const,
    model: { providerID: 'openai', id: 'gpt-5' },
    permissionConfig: {
      sandboxMode: 'workspace-write' as const,
      approvalPolicy: 'on-request' as const,
      approvalsReviewer: 'user' as const,
    },
    rootAgentId: 'agent-1',
    mergedInputIDs: [],
    startedAt: 1,
    finishedAt: status === 'completed' ? 2 : null,
    elapsedSeconds: status === 'completed' ? 1 : 0,
    error: null,
  }
  const base = {
    eventId: `event-${sequence}`,
    streamId: 'thread-1',
    version: type === 'turn/statusChanged' ? 1 : 2,
    occurredAt: 2,
    threadId: 'thread-1',
    turnId: 'turn-1',
    durability: 'durable' as const,
    sequence,
  }
  if (type === 'turn/statusChanged') {
    return {
      ...base,
      type,
      version: 1,
      payload: { turnId: 'turn-1', status, changedAt: 2 },
    }
  }
  return {
    ...base,
    type,
    version: 2,
    payload:
      type === 'turn/started'
        ? { turn, input: { id: 'input-1', threadId: 'thread-1', content: [], createdAt: 1 } }
        : { turn },
  } as EventEnvelope
}

function threadEvent(type: 'thread/created' | 'thread/updated', eventId: string): EventEnvelope {
  const thread = {
    id: 'thread-1',
    title: 'Thread',
    projectID: null,
    gitBranch: null,
    settings: {
      taskMode: 'chat' as const,
      permissionConfig: {
        sandboxMode: 'workspace-write' as const,
        approvalPolicy: 'on-request' as const,
        approvalsReviewer: 'user' as const,
      },
    },
    createdAt: 1,
    updatedAt: 2,
  }
  if (type === 'thread/created') {
    return {
      eventId,
      streamId: 'global',
      type,
      version: 1,
      occurredAt: 2,
      durability: 'durable',
      sequence: eventId === 'event-1' ? 1 : 2,
      payload: { thread },
    }
  }
  return {
    eventId,
    streamId: 'global',
    type,
    version: 1,
    occurredAt: 2,
    durability: 'durable',
    sequence: eventId === 'event-1' ? 1 : 2,
    payload: { thread, version: 1 },
  }
}

function providerCredentialEvent(): EventEnvelope {
  return {
    eventId: 'provider-event-1',
    streamId: 'global',
    type: 'provider/credential/updated',
    version: 1,
    occurredAt: 2,
    durability: 'live',
    sequence: null,
    afterSequence: 2,
    payload: { providerId: 'openai' },
  }
}

describe('SessionCatalogCoordinator goal reconciliation', () => {
  test('agent-side lightweight thread/updated payload still refreshes the thread', async () => {
    // 预算准入把目标写成 budget-limited 时，agent 会附加一条
    // {threadId, patch, updatedAt} 形状的 thread/updated。旧实现只读
    // payload.thread.id，取不到 id 就静默跳过，目标行于是永远停在“进行中的目标”。
    const refreshed: string[][] = []
    const coordinator = new SessionCatalogCoordinator({
      onCatalogUpdated: () => {},
      onProviderCredentialUpdated: () => {},
      onConfigUpdated: () => {},
      onWorkspaceFileChanged: () => {},
      onWorkspaceGitChanged: () => {},
      onLifecycleUpdated: () => {},
      refreshThreads: async (threadIds) => {
        refreshed.push([...threadIds])
      },
    })

    await coordinator.deliverBatch([
      {
        id: 1,
        type: 'thread/updated',
        threadId: 'thread-1',
        sequence: 1,
        createdAt: Date.now(),
        payload: { threadId: 'thread-1', patch: {}, updatedAt: Date.now() },
      } as unknown as EventEnvelope,
    ])

    expect(refreshed).toEqual([['thread-1']])
  })
})
