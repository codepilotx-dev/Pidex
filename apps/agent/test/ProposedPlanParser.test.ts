import { describe, expect, test } from 'bun:test'
import { executionPlanInputSchema } from '../src/orchestration/plan/ExecutionPlanInput'
import {
  ProposedPlanStreamParser,
  proposedPlanTitle,
} from '../src/orchestration/plan/ProposedPlanStreamParser'

describe('ProposedPlanStreamParser', () => {
  test('跨 chunk 分离标签外文本与计划', () => {
    const parser = new ProposedPlanStreamParser()
    const chunks = [
      ...parser.push('先说明。\n<proposed_'),
      ...parser.push('plan>\n# 重构方案\n'),
      ...parser.push('- 修改运行时\n</proposed_plan'),
      ...parser.push('>\n后续说明。'),
    ]
    const completed = parser.finish()

    expect(
      chunks
        .filter(({ kind }) => kind === 'text')
        .map(({ delta }) => delta)
        .join(''),
    ).toBe('先说明。\n')
    expect(
      chunks
        .filter(({ kind }) => kind === 'plan')
        .map(({ delta }) => delta)
        .join(''),
    ).toBe('# 重构方案\n- 修改运行时\n')
    expect(completed).toEqual({
      chunks: [{ kind: 'text', delta: '后续说明。' }],
      text: '先说明。\n后续说明。',
      plan: '# 重构方案\n- 修改运行时',
    })
    expect(proposedPlanTitle(completed.plan!)).toBe('重构方案')
  })

  test('仅识别独占行标签，最后一个非空块为权威结果', () => {
    const parser = new ProposedPlanStreamParser()
    parser.push('inline <proposed_plan> 不解析\n<proposed_plan>\n旧计划\n</proposed_plan>\n')
    parser.push('<proposed_plan>\n# 新计划\n</proposed_plan>')
    parser.push('\n<proposed_plan>\n  \n</proposed_plan>')
    expect(parser.finish()).toMatchObject({
      text: 'inline <proposed_plan> 不解析',
      plan: '# 新计划',
    })
  })

  test('空块不生成计划，未闭合块在流结束时收口', () => {
    const empty = new ProposedPlanStreamParser()
    empty.push('<proposed_plan>\n  \n</proposed_plan>')
    expect(empty.finish().plan).toBeNull()

    const interrupted = new ProposedPlanStreamParser()
    interrupted.push('<proposed_plan>\n# 可恢复计划')
    expect(interrupted.finish().plan).toBe('# 可恢复计划')
  })
})

describe('executionPlanInputSchema', () => {
  test('规范化步骤并限制唯一进行中项', () => {
    expect(
      executionPlanInputSchema.parse({
        explanation: '  执行中  ',
        plan: [
          { step: ' 读取实现 ', status: 'completed' },
          { step: '修改运行时', status: 'in_progress' },
        ],
      }),
    ).toEqual({
      explanation: '执行中',
      plan: [
        { step: '读取实现', status: 'completed' },
        { step: '修改运行时', status: 'in_progress' },
      ],
    })
    expect(
      executionPlanInputSchema.safeParse({
        plan: [
          { step: '重复', status: 'in_progress' },
          { step: ' 重复 ', status: 'in_progress' },
        ],
      }).success,
    ).toBe(false)
  })
})
