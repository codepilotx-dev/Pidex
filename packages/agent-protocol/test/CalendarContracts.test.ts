import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { CalendarRpcMethods } from '../src/methods/Calendar'
import { AutomationRpcMethods } from '../src/methods/Automation'
import { Capabilities } from '../src/runtime/Capabilities'

const decodeStrict = (schema: Schema.Decoder<unknown, never>) =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })

describe('calendar protocol contracts', () => {
  test('公开八个严格方法并保持 automation 契约独立', () => {
    expect(Object.keys(CalendarRpcMethods)).toHaveLength(8)
    expect(
      Object.values(CalendarRpcMethods).every(
        (method) =>
          method.capability === 'calendar.manage.v1' && method.exactParams && method.exactResult,
      ),
    ).toBe(true)
    expect(Capabilities).toContain('calendar.manage.v1')
    expect(Object.keys(AutomationRpcMethods)).toHaveLength(10)
    expect(
      Object.values(AutomationRpcMethods).every(
        (method) => method.capability === 'automation.manage.v1',
      ),
    ).toBe(true)
  })

  test('range 与 commit 拒绝多余字段并限制最多一百个草案', () => {
    const range = decodeStrict(CalendarRpcMethods['calendar/range'].params)
    const commit = decodeStrict(CalendarRpcMethods['schedule-plan/commit'].params)
    const defaults = {
      kind: 'standalone' as const,
      projectId: 'project:1',
      targetThreadId: null,
      execution: { kind: 'local' as const },
      model: { providerID: 'provider:test', id: 'model:test' },
      reasoningEffort: null,
      permissionConfig: {
        sandboxMode: 'workspace-write' as const,
        approvalPolicy: 'never' as const,
        approvalsReviewer: 'auto_review' as const,
      },
      timeZone: 'Asia/Shanghai',
      notificationPolicy: 'failures' as const,
    }
    const item = {
      key: 'item:1',
      enabled: true,
      kind: 'one-off' as const,
      name: '发布检查',
      prompt: '检查发布状态。',
      scheduledFor: 2_000,
    }

    expect(range({ from: 1_000, to: 3_000, timeZone: 'Asia/Shanghai' })).toEqual({
      from: 1_000,
      to: 3_000,
      timeZone: 'Asia/Shanghai',
    })
    expect(() =>
      range({ from: 1_000, to: 3_000, timeZone: 'Asia/Shanghai', path: 'F:/private' }),
    ).toThrow()
    expect(() =>
      commit({
        id: 'schedule-plan:1',
        expectedRevision: 1,
        operationId: 'operation:1',
        defaults,
        items: [{ ...item, secret: '不得进入契约' }],
      }),
    ).toThrow()
    expect(() =>
      commit({
        id: 'schedule-plan:1',
        expectedRevision: 1,
        operationId: 'operation:1',
        defaults,
        items: Array.from({ length: 101 }, (_, index) => ({ ...item, key: `item:${index}` })),
      }),
    ).toThrow()
  })
})
