import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Item } from '@pidex/shared/thread'
import { SchedulePlanCard } from '../src/features/session/timeline/SchedulePlanCard.js'

type ToolItem = Extract<Item, { type: 'tool' }>

const proposal = {
  id: 'schedule-plan:call-1',
  revision: 1,
  threadId: 'thread-1',
  turnId: 'turn-1',
  toolCallId: 'call-1',
  status: 'pending',
  horizon: 'week',
  createdRefs: [],
  createdAt: 1,
  updatedAt: 1,
  committedAt: null,
  defaults: {
    kind: 'standalone',
    projectId: 'project-1',
    targetThreadId: null,
    execution: { kind: 'local' },
    model: { providerID: 'openai', id: 'gpt-5' },
    reasoningEffort: null,
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
    },
    timeZone: 'Asia/Shanghai',
    notificationPolicy: 'failures',
  },
  items: [
    {
      key: 'one',
      enabled: true,
      kind: 'one-off',
      name: '发布版本',
      prompt: '执行发布检查',
      scheduledFor: Date.parse('2026-09-08T09:00:00+08:00'),
    },
    {
      key: 'daily',
      enabled: false,
      kind: 'recurring',
      name: '每日摘要',
      prompt: '生成摘要',
      schedule: { mode: 'daily', time: '18:00' },
      timeZone: 'Asia/Shanghai',
    },
  ],
} as const

function item(): ToolItem {
  return {
    id: 'tool-1',
    messageID: 'message-1',
    turnId: 'turn-1',
    agentId: 'agent-1',
    type: 'tool',
    callID: 'call-1',
    tool: 'schedule_plan.propose',
    title: '规划日程',
    state: 'completed',
    input: null,
    command: null,
    output: JSON.stringify({ proposal }),
    error: null,
    startedAt: 1,
    finishedAt: 2,
    durationMs: 1,
    createdAt: 1,
  }
}

describe('SchedulePlanCard', () => {
  test('renders editable proposal items and shared unattended settings before commit', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SchedulePlanCard item={item()} />
      </MemoryRouter>,
    )
    expect(html).toContain('确认任务规划')
    expect(html).toContain('发布版本')
    expect(html).toContain('每日摘要')
    expect(html).toContain('整批运行设置')
    expect(html).toContain('确认前不会创建或执行任务')
    expect(html).toContain('确认创建')
  })
})
