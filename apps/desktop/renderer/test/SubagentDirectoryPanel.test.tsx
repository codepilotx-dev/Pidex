import { describe, expect, test } from 'bun:test'
import type {
  SubagentProjection,
  SubagentRun,
  SubagentStatus,
  SubagentTask,
} from '@pidex/shared/thread'

import {
  buildSubagentDirectory,
  toSubagentDirectoryRow,
} from '../src/features/session/subagents/SubagentDirectoryRows.js'
import {
  subagentAttentionLabel,
  subagentStatusLabel,
} from '../src/features/session/subagents/SubagentStatusLabel.js'

function run(
  overrides: Partial<SubagentRun> & Pick<SubagentRun, 'status'>,
  id = 'run-1',
): SubagentRun {
  return {
    id,
    taskId: 'task-1',
    generation: 1,
    status: overrides.status,
    queueReason: null,
    model: { providerID: 'test', modelID: 'test' },
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      reviewers: [],
    },
    result: null,
    error: null,
    createdAt: 0,
    startedAt: null,
    finishedAt: null,
    updatedAt: 0,
    ...overrides,
  } as SubagentRun
}

function task(
  overrides: Partial<SubagentTask> & Pick<SubagentTask, 'id' | 'displayName'>,
): SubagentTask {
  return {
    id: overrides.id,
    parentThreadId: 'thread-main',
    parentTurnId: 'turn-1',
    parentAgentId: 'agent-1',
    childThreadId: `child-${overrides.id}`,
    displayName: overrides.displayName,
    profile: 'explorer',
    task: overrides.task ?? '审阅仓库',
    permissionCeiling: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      reviewers: [],
    },
    workspace: { mode: 'shared', state: 'ready', rootPath: null, baselineRef: null },
    currentRun: null,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  } as SubagentTask
}

function projection(
  id: string,
  name: string,
  status: SubagentStatus,
  extra: {
    parentThreadId?: string
    finishedAt?: number
    summary?: string
    createdAt?: number
  } = {},
): SubagentProjection {
  const currentRun = run({
    status,
    finishedAt: extra.finishedAt ?? null,
    result: extra.summary
      ? {
          outcome: 'succeeded',
          summary: extra.summary,
          findings: [],
          changedFiles: [],
          validation: [],
          risks: [],
          references: [],
        }
      : null,
  })
  return {
    task: task({
      id,
      displayName: name,
      ...(extra.parentThreadId ? { parentThreadId: extra.parentThreadId } : {}),
      ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
      currentRun,
    }),
    currentRun,
  }
}

describe('subagent directory rows', () => {
  test('splits running and finished, and ignores other parent threads', () => {
    const directory = buildSubagentDirectory(
      [
        projection('task-a', 'Explorer 1', 'running'),
        projection('task-b', 'Worker 1', 'waiting-permission'),
        projection('task-c', 'Worker 2', 'completed', { finishedAt: 900 }),
        projection('task-d', 'Worker 3', 'failed', { finishedAt: 800 }),
        projection('task-e', 'Other', 'running', { parentThreadId: 'thread-other' }),
      ],
      'thread-main',
    )

    expect(directory.running.map((row) => row.taskId)).toEqual(['task-a', 'task-b'])
    expect(directory.finished.map((row) => row.taskId)).toEqual(['task-c', 'task-d'])
  })

  test('sorts each section by finished, then started, then created desc', () => {
    const directory = buildSubagentDirectory(
      [
        projection('old', 'Old', 'completed', { finishedAt: 100 }),
        projection('never-started', 'New', 'interrupted', { createdAt: 500 }),
        projection('newest', 'Newest', 'completed', { finishedAt: 900 }),
      ],
      'thread-main',
    )

    expect(directory.finished.map((row) => row.taskId)).toEqual(['newest', 'never-started', 'old'])
  })

  test('prefers result summary, then error, then task description', () => {
    expect(
      toSubagentDirectoryRow(projection('a', 'A', 'completed', { summary: '审计完成' })).summary,
    ).toBe('审计完成')

    const failed = projection('b', 'B', 'failed')
    failed.currentRun!.error = '模型返回失败'
    expect(toSubagentDirectoryRow(failed).summary).toBe('模型返回失败')

    expect(toSubagentDirectoryRow(projection('c', 'C', 'running')).summary).toBe('审阅仓库')
  })

  test('treats every terminal status as finished and runningSince only for live runs', () => {
    for (const status of ['completed', 'failed', 'stopped', 'interrupted'] as const) {
      const row = toSubagentDirectoryRow(projection(status, status, status))
      expect(row.terminal).toBe(true)
      expect(row.runningSince).toBeNull()
    }
    const live = toSubagentDirectoryRow(projection('live', 'Live', 'preparing'))
    expect(live.terminal).toBe(false)
  })
})

describe('subagent status vocabulary', () => {
  test('labels preparing instead of falling through to 运行中', () => {
    expect(subagentStatusLabel('preparing')).toBe('准备中')
  })

  test('only surfaces status words that need attention', () => {
    expect(subagentAttentionLabel('completed')).toBeNull()
    expect(subagentAttentionLabel('running')).toBeNull()
    expect(subagentAttentionLabel('waiting-permission')).toBe('等待审批')
    expect(subagentAttentionLabel('failed')).toBe('失败')
    expect(subagentAttentionLabel('stopped')).toBe('已停止')
    expect(subagentAttentionLabel('interrupted')).toBe('已中断')
  })
})
