import { describe, expect, test } from 'bun:test'
import type { DesktopPermissionRequest, DesktopSessionSnapshot } from '../shared/Types'
import { projectTaskNotifications } from '../src/features/notifications/TaskNotificationProjector'
import {
  TaskNotificationDispatcher,
  type TaskNotificationSendRequest,
} from '../src/features/notifications/TaskNotificationDispatcher'

function snapshot(
  id: string,
  status: DesktopSessionSnapshot['item']['status'],
  pendingPermissions: DesktopPermissionRequest[] = [],
  overrides: Partial<DesktopSessionSnapshot['item']> = {},
): DesktopSessionSnapshot {
  return {
    item: {
      id,
      workspaceName: 'workspace',
      workspacePath: 'C:\\workspace',
      permissionMode: 'default',
      model: null,
      thinkingMode: 'default',
      hasSystemPrompt: false,
      hasAppendSystemPrompt: false,
      additionalDirectoryCount: 0,
      status,
      createdAt: '2026-08-03T00:00:00.000Z',
      ...overrides,
    },
    workspace: { name: 'workspace', path: 'C:\\workspace' },
    settings: {
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      thinkingMode: 'default',
      additionalDirectories: [],
    },
    view: { messages: [], toolLog: [], pendingPermissions, contextUsage: null },
    updatedAt: '2026-08-03T00:00:10.000Z',
  }
}

const permissionRequest: DesktopPermissionRequest = {
  requestId: 'permission-1',
  toolName: 'request_permissions',
  input: {},
  description: '需要读取 src/',
  requestKind: 'tool',
}

const questionRequest: DesktopPermissionRequest = {
  requestId: 'question-1',
  toolName: 'AskUserQuestion',
  input: {},
  description: '请选择一个选项',
}

describe('task notification projector', () => {
  test('pending 审批与提问产生稳定 ID 的候选', () => {
    const candidates = projectTaskNotifications({
      previous: [],
      current: [snapshot('thread-1', 'waiting', [permissionRequest, questionRequest])],
    })
    expect(candidates.map((item) => [item.id, item.kind, item.requestId])).toEqual([
      ['thread-1:permission-1', 'permission', 'permission-1'],
      ['thread-1:question-1', 'question', 'question-1'],
    ])
    expect(candidates[0]?.request).toBe(permissionRequest)
  })

  test('任务标题按 customTitle → aiTitle → sessionName → firstPrompt 回退', () => {
    const title = (overrides: Partial<DesktopSessionSnapshot['item']>): string | undefined =>
      projectTaskNotifications({
        previous: [snapshot('thread-1', 'running')],
        current: [snapshot('thread-1', 'done', [], overrides)],
      })[0]?.taskTitle
    expect(title({ customTitle: '自定义', aiTitle: 'AI', sessionName: '会话' })).toBe('自定义')
    expect(title({ aiTitle: 'AI', sessionName: '会话' })).toBe('AI')
    expect(title({ sessionName: '会话', firstPrompt: '提示' })).toBe('会话')
    expect(title({ firstPrompt: '提示' })).toBe('提示')
    expect(title({})).toBe('未命名任务')
  })

  test('running→done 与 running→error 各产生一次状态跃迁候选', () => {
    const completed = projectTaskNotifications({
      previous: [snapshot('thread-1', 'running')],
      current: [snapshot('thread-1', 'done')],
    })
    expect(completed.map((item) => [item.kind, item.id])).toEqual([
      ['completed', 'thread-1:completed:2026-08-03T00:00:10.000Z'],
    ])
    const failed = projectTaskNotifications({
      previous: [snapshot('thread-1', 'running')],
      current: [snapshot('thread-1', 'error')],
    })
    expect(failed.map((item) => item.kind)).toEqual(['failed'])
  })

  test('无真实跃迁不产生完成/失败候选', () => {
    expect(
      projectTaskNotifications({
        previous: [snapshot('thread-1', 'done')],
        current: [snapshot('thread-1', 'done')],
      }),
    ).toEqual([])
    expect(
      projectTaskNotifications({
        previous: [snapshot('thread-1', 'error')],
        current: [snapshot('thread-1', 'error')],
      }),
    ).toEqual([])
    expect(
      projectTaskNotifications({
        previous: [snapshot('thread-1', 'running')],
        current: [snapshot('thread-1', 'interrupted')],
      }),
    ).toEqual([])
    // 初次出现即为完成态：没有可观察的跃迁，不补发历史完成。
    expect(
      projectTaskNotifications({
        previous: [],
        current: [snapshot('thread-1', 'done')],
      }),
    ).toEqual([])
  })

  test('内部 Guardian 与归档任务整体跳过', () => {
    const candidates = projectTaskNotifications({
      previous: [],
      current: [
        snapshot('thread-1', 'waiting', [permissionRequest], { source: 'internal_guardian' }),
        snapshot('thread-2', 'waiting', [permissionRequest], {
          archivedAt: '2026-08-01T00:00:00.000Z',
        }),
      ],
    })
    expect(candidates).toEqual([])
  })

  test('子代理允许审批/提问，不通知完成与失败', () => {
    const candidates = projectTaskNotifications({
      previous: [snapshot('thread-1', 'running', [], { source: 'subagent' })],
      current: [
        snapshot('thread-1', 'waiting', [permissionRequest, questionRequest], {
          source: 'subagent',
        }),
        snapshot('thread-2', 'running', [], { source: 'subagent' }),
        snapshot('thread-3', 'running'),
      ],
    })
    const changed = projectTaskNotifications({
      previous: [
        snapshot('thread-1', 'running', [], { source: 'subagent' }),
        snapshot('thread-2', 'running', [], { source: 'subagent' }),
        snapshot('thread-3', 'running'),
      ],
      current: [
        snapshot('thread-1', 'done', [], { source: 'subagent' }),
        snapshot('thread-2', 'error', [], { source: 'subagent' }),
        snapshot('thread-3', 'done'),
      ],
    })
    expect(candidates.map((item) => [item.id, item.kind, item.source])).toEqual([
      ['thread-1:permission-1', 'permission', 'subagent'],
      ['thread-1:question-1', 'question', 'subagent'],
    ])
    expect(changed.map((item) => [item.id, item.kind])).toEqual([
      ['thread-3:completed:2026-08-03T00:00:10.000Z', 'completed'],
    ])
  })
})

describe('task notification dispatcher', () => {
  const defaultSettings = {
    completion: 'unfocused' as const,
    permissions: true,
    questions: true,
    errors: true,
  }

  test('初始历史状态不通知，新审批/提问与跃迁各通知一次', () => {
    const sent: TaskNotificationSendRequest[] = []
    const dispatcher = new TaskNotificationDispatcher((request) => {
      sent.push(request)
    })
    dispatcher.setSettings(defaultSettings)
    dispatcher.markBaselineReady()
    dispatcher.ingest(
      [snapshot('thread-1', 'waiting', [permissionRequest]), snapshot('thread-2', 'running')],
      true,
    )
    expect(sent).toEqual([])
    dispatcher.ingest(
      [
        snapshot('thread-1', 'waiting', [permissionRequest, questionRequest]),
        snapshot('thread-2', 'running'),
      ],
      false,
    )
    expect(sent.map((item) => [item.kind, item.notificationId])).toEqual([
      ['question', 'thread-1:question-1'],
    ])
    dispatcher.ingest(
      [
        snapshot('thread-1', 'waiting', [permissionRequest, questionRequest]),
        snapshot('thread-2', 'done'),
      ],
      false,
    )
    expect(sent.map((item) => item.kind)).toEqual(['question', 'completed'])
  })

  test('SSE 重放与重复 store change 不会重复通知', () => {
    const sent: TaskNotificationSendRequest[] = []
    const dispatcher = new TaskNotificationDispatcher((request) => {
      sent.push(request)
    })
    dispatcher.setSettings(defaultSettings)
    dispatcher.markBaselineReady()
    const batch = [snapshot('thread-1', 'waiting', [permissionRequest])]
    dispatcher.ingest(batch, true)
    dispatcher.ingest(batch, false)
    dispatcher.ingest(batch, false)
    dispatcher.ingest([snapshot('thread-1', 'done')], false)
    dispatcher.ingest([snapshot('thread-1', 'done')], false)
    expect(sent.map((item) => [item.kind, item.notificationId])).toEqual([
      ['completed', 'thread-1:completed:2026-08-03T00:00:10.000Z'],
    ])
  })

  test('React 重挂载（新调度器）由基线吸收，不重复通知', () => {
    const first: TaskNotificationSendRequest[] = []
    const firstDispatcher = new TaskNotificationDispatcher((request) => {
      first.push(request)
    })
    firstDispatcher.setSettings(defaultSettings)
    firstDispatcher.markBaselineReady()
    firstDispatcher.ingest([snapshot('thread-1', 'done')], true)
    firstDispatcher.ingest([snapshot('thread-1', 'done')], false)
    expect(first).toEqual([])

    const second: TaskNotificationSendRequest[] = []
    const secondDispatcher = new TaskNotificationDispatcher((request) => {
      second.push(request)
    })
    secondDispatcher.setSettings(defaultSettings)
    secondDispatcher.markBaselineReady()
    secondDispatcher.ingest([snapshot('thread-1', 'done')], true)
    secondDispatcher.ingest([snapshot('thread-1', 'done')], false)
    expect(second).toEqual([])
  })

  test('设置关闭与完成 never 不发送，开启后只通知新请求', () => {
    const sent: TaskNotificationSendRequest[] = []
    const dispatcher = new TaskNotificationDispatcher((request) => {
      sent.push(request)
    })
    dispatcher.setSettings({
      completion: 'never',
      permissions: false,
      questions: false,
      errors: false,
    })
    dispatcher.markBaselineReady()
    dispatcher.ingest([], true)
    dispatcher.ingest(
      [
        snapshot('thread-1', 'waiting', [permissionRequest, questionRequest]),
        snapshot('thread-2', 'running'),
      ],
      false,
    )
    dispatcher.ingest(
      [
        snapshot('thread-1', 'waiting', [permissionRequest, questionRequest]),
        snapshot('thread-2', 'done'),
      ],
      false,
    )
    expect(sent).toEqual([])

    dispatcher.setSettings(defaultSettings)
    dispatcher.ingest(
      [
        snapshot('thread-1', 'waiting', [permissionRequest, questionRequest]),
        snapshot('thread-2', 'done'),
      ],
      false,
    )
    // 旧请求已观察，不补发；只有新请求才通知。
    dispatcher.ingest(
      [
        snapshot('thread-1', 'waiting', [
          permissionRequest,
          questionRequest,
          {
            ...questionRequest,
            requestId: 'question-2',
          },
        ]),
        snapshot('thread-2', 'done'),
      ],
      false,
    )
    expect(sent.map((item) => [item.kind, item.notificationId])).toEqual([
      ['question', 'thread-1:question-2'],
    ])
  })

  test('完成通知按设置传 always/unfocused，其他类别固定 unfocused', () => {
    const sent: TaskNotificationSendRequest[] = []
    const dispatcher = new TaskNotificationDispatcher((request) => {
      sent.push(request)
    })
    dispatcher.setSettings({ ...defaultSettings, completion: 'always' })
    dispatcher.markBaselineReady()
    dispatcher.ingest([], true)
    dispatcher.ingest(
      [
        snapshot('thread-1', 'waiting', [permissionRequest, questionRequest]),
        snapshot('thread-2', 'running'),
      ],
      false,
    )
    dispatcher.ingest(
      [
        snapshot('thread-1', 'waiting', [permissionRequest, questionRequest]),
        snapshot('thread-2', 'done'),
        snapshot('thread-3', 'running'),
      ],
      false,
    )
    dispatcher.ingest(
      [
        snapshot('thread-1', 'waiting', [permissionRequest, questionRequest]),
        snapshot('thread-2', 'done'),
        snapshot('thread-3', 'error'),
      ],
      false,
    )
    expect(sent.map((item) => [item.kind, item.visibility])).toEqual([
      ['permission', 'unfocused'],
      ['question', 'unfocused'],
      ['completed', 'always'],
      ['failed', 'unfocused'],
    ])
  })

  test('失败通知正文采用任务标题加固定后缀，并保持 200 字符上限', () => {
    const sent: TaskNotificationSendRequest[] = []
    const dispatcher = new TaskNotificationDispatcher((request) => {
      sent.push(request)
    })
    dispatcher.setSettings(defaultSettings)
    dispatcher.markBaselineReady()
    dispatcher.ingest([], true)
    dispatcher.ingest(
      [
        snapshot('thread-1', 'running', [], { customTitle: '我的任务' }),
        snapshot('thread-2', 'running', [], { customTitle: '长'.repeat(220) }),
      ],
      false,
    )
    dispatcher.ingest(
      [
        snapshot('thread-1', 'error', [], { customTitle: '我的任务' }),
        snapshot('thread-2', 'error', [], { customTitle: '长'.repeat(220) }),
      ],
      false,
    )
    expect(sent.filter((item) => item.kind === 'failed').map((item) => item.body)).toEqual([
      '我的任务 · 需要检查',
      `${'长'.repeat(200 - ' · 需要检查'.length)} · 需要检查`,
    ])
    for (const item of sent) {
      expect(item.body.length).toBeLessThanOrEqual(200)
    }
  })

  test('子代理审批/提问发送，子代理完成/失败不发送', () => {
    const sent: TaskNotificationSendRequest[] = []
    const dispatcher = new TaskNotificationDispatcher((request) => {
      sent.push(request)
    })
    dispatcher.setSettings(defaultSettings)
    dispatcher.markBaselineReady()
    dispatcher.ingest([snapshot('thread-1', 'running', [], { source: 'subagent' })], true)
    dispatcher.ingest(
      [
        snapshot('thread-1', 'waiting', [permissionRequest, questionRequest], {
          source: 'subagent',
        }),
      ],
      false,
    )
    dispatcher.ingest([snapshot('thread-1', 'done', [], { source: 'subagent' })], false)
    expect(sent.map((item) => item.kind)).toEqual(['permission', 'question'])
  })
})
