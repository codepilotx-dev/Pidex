import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  PlanApprovalSchema,
  PlanItemSchema,
  StructuredPlanSchema,
  decodeStructuredPlan,
  formatStructuredPlanMarkdown,
} from '@pidex/shared/thread'

const structuredPlan = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: '结构化计划交付',
  summary: '把最终方案从标签解析升级为 submit_plan 结构化提交。',
  changes: [
    { area: '共享契约', items: ['新增 StructuredPlanSchema', '派生 Markdown'] },
    { area: '桌面展示', items: ['按章节渲染结构化计划'] },
  ],
  interfaceChanges: ['新增 plan.structured.v1 capability'],
  tests: [],
  assumptions: ['历史纯 Markdown 计划不迁移'],
  ...overrides,
})

const planItem = (data: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
  id: 'turn-1:plan',
  messageID: 'turn-1',
  turnId: 'turn-1',
  agentId: 'agent-1',
  type: 'plan',
  title: '结构化计划交付',
  markdown: '# 结构化计划交付',
  status: 'completed',
  createdAt: 1_700_000_000_000,
  ...data,
  ...overrides,
})

describe('StructuredPlanSchema', () => {
  test('固定字段通过校验并保持原值，空的可选章节合法', () => {
    const decoded = Schema.decodeUnknownSync(StructuredPlanSchema)(structuredPlan())
    expect(decoded.changes).toHaveLength(2)
    expect(decoded.changes[0]).toEqual({
      area: '共享契约',
      items: ['新增 StructuredPlanSchema', '派生 Markdown'],
    })
    expect(decoded.tests).toEqual([])
  })

  test('changes 至少一组且每组至少一项', () => {
    expect(decodeStructuredPlan(structuredPlan({ changes: [] }))).toBeNull()
    expect(
      decodeStructuredPlan(
        structuredPlan({
          changes: [{ area: '共享契约', items: [] }],
        }),
      ),
    ).toBeNull()
  })

  test('空文本与未知字段被拒绝，错误不回显字段值', () => {
    for (const overrides of [
      { ...structuredPlan(), title: '   ' },
      { ...structuredPlan(), summary: '' },
      { ...structuredPlan(), changes: [{ area: '', items: ['x'] }] },
      { ...structuredPlan(), interfaceChanges: [''] },
      { ...structuredPlan(), extra: 'sk-sensitive-field' },
    ]) {
      expect(decodeStructuredPlan(overrides)).toBeNull()
    }
  })

  test('旧数据或非对象输入回退为 null', () => {
    expect(decodeStructuredPlan(undefined)).toBeNull()
    expect(decodeStructuredPlan(null)).toBeNull()
    expect(decodeStructuredPlan('markdown only')).toBeNull()
    expect(decodeStructuredPlan({ title: '只有标题' })).toBeNull()
  })
})

describe('formatStructuredPlanMarkdown', () => {
  test('按固定章节顺序确定性生成 Markdown', () => {
    const plan = Schema.decodeUnknownSync(StructuredPlanSchema)(structuredPlan())
    const markdown = formatStructuredPlanMarkdown(plan)
    expect(markdown).toBe(formatStructuredPlanMarkdown(plan))
    expect(markdown).toBe(
      [
        '# 结构化计划交付',
        '',
        '把最终方案从标签解析升级为 submit_plan 结构化提交。',
        '',
        '## 实现变更',
        '### 共享契约',
        '- 新增 StructuredPlanSchema',
        '- 派生 Markdown',
        '### 桌面展示',
        '- 按章节渲染结构化计划',
        '',
        '## 接口变化',
        '- 新增 plan.structured.v1 capability',
        '',
        '## 假设',
        '- 历史纯 Markdown 计划不迁移',
      ].join('\n'),
    )
  })

  test('空的测试章节不渲染', () => {
    const plan = Schema.decodeUnknownSync(StructuredPlanSchema)(structuredPlan({ tests: [] }))
    expect(formatStructuredPlanMarkdown(plan)).not.toContain('## 测试')
  })
})

describe('PlanItem and PlanApproval compatibility', () => {
  test('历史 Markdown 计划缺少 structured 时正常解码', () => {
    const legacy = Schema.decodeUnknownSync(PlanItemSchema)(planItem({}))
    expect(legacy.structured).toBeUndefined()
    expect(legacy.markdown).toBe('# 结构化计划交付')
  })

  test('新计划携带结构化字段，非法对象使计划解码失败', () => {
    const current = Schema.decodeUnknownSync(PlanItemSchema)(
      planItem({ structured: structuredPlan() }),
    )
    expect(current.structured?.changes).toHaveLength(2)
    expect(() =>
      Schema.decodeUnknownSync(PlanItemSchema)(planItem({ structured: { title: '缺字段' } })),
    ).toThrow()
  })

  test('计划审批共享同一结构化对象且兼容旧审批', () => {
    const base = {
      id: 'approval-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      planItemId: 'turn-1:plan',
      version: 1,
      status: 'pending' as const,
      title: '结构化计划交付',
      markdown: '# 结构化计划交付',
      nextTurnId: null,
      createdAt: 1_700_000_000_000,
      resolvedAt: null,
    }
    expect(Schema.decodeUnknownSync(PlanApprovalSchema)(base).structured).toBeUndefined()
    const current = Schema.decodeUnknownSync(PlanApprovalSchema)({
      ...base,
      structured: structuredPlan(),
    })
    expect(current.structured?.title).toBe('结构化计划交付')
  })
})
