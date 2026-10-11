import { describe, expect, test } from 'bun:test'
import type { EventEnvelope } from '@pidex/agent-protocol'
import type { ThreadSnapshot } from '@pidex/shared/thread'
import { agentThreadSnapshotToDesktop } from '../src/services/AgentThreadAdapter.js'
import { SessionCatalogCoordinator } from '../src/services/desktop-client/SessionCatalogCoordinator.js'

const snapshotWithGoal = (goal: unknown): ThreadSnapshot =>
  ({
    thread: {
      id: 'thread:1',
      title: '目标线程',
      projectID: null,
      gitBranch: null,
      workspace: {
        kind: 'projectless',
        projectID: null,
        workspaceRoot: 'C:\\workspace',
        cwd: 'C:\\workspace',
        outputDirectory: 'C:\\workspace\\outputs',
      },
      settings: {
        taskMode: 'chat',
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
      },
      createdAt: 1,
      updatedAt: 2,
    },
    turns: [],
    agents: [],
    subagents: [],
    inputs: [],
    messages: [],
    items: [],
    approvals: [],
    goal: goal as never,
  }) as ThreadSnapshot

const goalEvent = (type: 'thread/goal/updated' | 'thread/goal/cleared'): EventEnvelope =>
  ({
    id: 1,
    type,
    durability: 'durable',
    stream: 'thread',
    threadId: 'thread:1',
    turnId: null,
    payload:
      type === 'thread/goal/updated'
        ? {
            threadId: 'thread:1',
            goal: {
              id: 'goal:1',
              threadId: 'thread:1',
              objective: '持续执行',
              status: 'active',
              tokenBudget: 200_000,
              tokensUsed: 1_500,
              timeUsedSeconds: 30,
              version: 2,
              createdAt: 1,
              updatedAt: 2,
            },
            version: 2,
          }
        : { threadId: 'thread:1', goalId: 'goal:1', clearedAt: 3 },
  }) as unknown as EventEnvelope

const coordinatorWith = () => {
  const refreshed: Array<readonly string[]> = []
  const coordinator = new SessionCatalogCoordinator({
    onCatalogUpdated: () => {},
    onProviderCredentialUpdated: () => {},
    onConfigUpdated: () => {},
    onWorkspaceFileChanged: () => {},
    onWorkspaceGitChanged: () => {},
    onLifecycleUpdated: () => {},
    refreshThreads: async (threadIds) => {
      refreshed.push(threadIds)
    },
  })
  return { coordinator, refreshed }
}

describe('Goal snapshot initialization', () => {
  test('snapshot 中的 goal 投影为 threadGoal', () => {
    const snapshot = agentThreadSnapshotToDesktop(
      snapshotWithGoal({
        id: 'goal:1',
        threadId: 'thread:1',
        objective: '持续执行',
        status: 'active',
        tokenBudget: 200_000,
        tokensUsed: 1_500,
        timeUsedSeconds: 30,
        version: 2,
        createdAt: 1,
        updatedAt: 2,
      }),
    )
    expect(snapshot.item.threadGoal).toMatchObject({
      id: 'goal:1',
      objective: '持续执行',
      status: 'active',
      tokensUsed: 1_500,
      timeUsedSeconds: 30,
    })
  })

  test('未设置或已清除的 goal 投影为 null', () => {
    expect(agentThreadSnapshotToDesktop(snapshotWithGoal(null)).item.threadGoal ?? null).toBeNull()
    expect(
      agentThreadSnapshotToDesktop(snapshotWithGoal(undefined)).item.threadGoal ?? null,
    ).toBeNull()
  })
})

describe('Goal events refresh the session store', () => {
  test('thread/goal/updated 自行触发目录刷新', async () => {
    const { coordinator, refreshed } = coordinatorWith()
    await coordinator.deliverBatch([goalEvent('thread/goal/updated')])
    expect(refreshed).toEqual([['thread:1']])
  })

  test('thread/goal/cleared 自行触发目录刷新', async () => {
    const { coordinator, refreshed } = coordinatorWith()
    await coordinator.deliverBatch([goalEvent('thread/goal/cleared')])
    expect(refreshed).toEqual([['thread:1']])
  })

  test('同一批次内去重，不重复刷新同一线程', async () => {
    const { coordinator, refreshed } = coordinatorWith()
    await coordinator.deliverBatch([
      goalEvent('thread/goal/updated'),
      goalEvent('thread/goal/cleared'),
    ])
    expect(refreshed).toEqual([['thread:1']])
  })
})
