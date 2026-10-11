import { describe, expect, test } from 'bun:test'
import type { DesktopSessionSnapshot } from '../shared/Types'
import { defaultDesktopStoredSettings } from '../shared/SettingsSchema'
import {
  projectPetNotifications,
  resolvePetReplyDelivery,
} from '../src/features/pet/PetNotificationProjector'

function snapshot(
  id: string,
  status: DesktopSessionSnapshot['item']['status'],
  pendingPermissions: DesktopSessionSnapshot['view']['pendingPermissions'] = [],
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
      createdAt: '2026-07-24T00:00:00.000Z',
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
    updatedAt: '2026-07-24T00:00:10.000Z',
  }
}

test('routes active replies to follow-up and idle replies to a message', () => {
  expect(resolvePetReplyDelivery('running', false)).toBe('follow-up')
  expect(resolvePetReplyDelivery('waiting', false)).toBe('follow-up')
  expect(resolvePetReplyDelivery('queued', false)).toBe('follow-up')
  expect(resolvePetReplyDelivery('done', false)).toBe('message')
  expect(resolvePetReplyDelivery('idle', true)).toBe('follow-up')
})

describe('pet notification projector', () => {
  const preferences = defaultDesktopStoredSettings().pet

  test('prioritizes questions and keeps stable blocker IDs', () => {
    const questionRequest = {
      requestId: 'question-1',
      toolName: 'AskUserQuestion',
      input: {},
      description: '请选择一个选项',
    }
    const notifications = projectPetNotifications({
      previous: [],
      current: [
        snapshot('thread-1', 'waiting', [
          questionRequest,
          {
            requestId: 'approval-1',
            toolName: 'PowerShell',
            input: {},
            description: '运行命令',
            requestKind: 'shell-command',
          },
        ]),
      ],
      now: Date.parse('2026-07-24T00:00:20.000Z'),
      dismissedIds: new Set(),
      preferences,
    })
    expect(notifications.map((item) => [item.id, item.kind])).toEqual([
      ['thread-1:question-1', 'question'],
      ['thread-1:approval-1', 'exec'],
    ])
    expect(notifications[0]?.request).toBe(questionRequest)
  })

  test('emits transition notifications and respects dismissal', () => {
    const now = Date.parse('2026-07-24T00:00:20.000Z')
    const completed = projectPetNotifications({
      previous: [snapshot('thread-1', 'running')],
      current: [snapshot('thread-1', 'done')],
      now,
      dismissedIds: new Set(),
      preferences,
    })
    expect(completed[0]?.kind).toBe('completed')
    expect(
      projectPetNotifications({
        previous: [snapshot('thread-1', 'running')],
        current: [snapshot('thread-1', 'done')],
        now,
        dismissedIds: new Set([completed[0]!.id]),
        preferences,
      }),
    ).toEqual([])
  })

  test('respects per-category pet preferences', () => {
    const now = Date.parse('2026-07-24T00:00:20.000Z')
    const disabled = {
      ...preferences,
      notifyAttention: false,
      notifyCompletion: false,
      notifyFailure: false,
    }
    expect(
      projectPetNotifications({
        previous: [],
        current: [
          snapshot('thread-1', 'waiting', [
            {
              requestId: 'approval-1',
              toolName: 'PowerShell',
              input: {},
              description: '运行命令',
              requestKind: 'shell-command',
            },
          ]),
        ],
        now,
        dismissedIds: new Set(),
        preferences: disabled,
      }),
    ).toEqual([])
    expect(
      projectPetNotifications({
        previous: [snapshot('thread-1', 'running')],
        current: [snapshot('thread-1', 'done')],
        now,
        dismissedIds: new Set(),
        preferences: { ...preferences, notifyCompletion: false },
      }),
    ).toEqual([])
    expect(
      projectPetNotifications({
        previous: [snapshot('thread-1', 'running')],
        current: [snapshot('thread-1', 'error')],
        now,
        dismissedIds: new Set(),
        preferences: { ...preferences, notifyFailure: false },
      }),
    ).toEqual([])
  })

  test('skips guardian, archived tasks and subagent transitions', () => {
    const now = Date.parse('2026-07-24T00:00:20.000Z')
    const guardian = snapshot('thread-1', 'waiting', [
      {
        requestId: 'approval-1',
        toolName: 'PowerShell',
        input: {},
        description: '运行命令',
        requestKind: 'shell-command',
      },
    ])
    guardian.item.source = 'internal_guardian'
    const archived = snapshot('thread-2', 'running')
    archived.item.archivedAt = '2026-07-23T00:00:00.000Z'
    const subagentDone = snapshot('thread-3', 'done')
    subagentDone.item.source = 'subagent'
    expect(
      projectPetNotifications({
        previous: [guardian, archived, snapshot('thread-3', 'running')],
        current: [guardian, archived, subagentDone],
        now,
        dismissedIds: new Set(),
        preferences,
      }),
    ).toEqual([])
  })
})
