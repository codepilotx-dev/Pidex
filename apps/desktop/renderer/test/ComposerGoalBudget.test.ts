import { describe, expect, test } from 'bun:test'
import { GOAL_STATUS_LABELS } from '../src/features/session/composer/ComposerGoalRow.js'
import { prepareComposerSubmission } from '../src/features/session/composer/ComposerSubmitTransaction.js'
import {
  createComposerDocument,
  parseGoalTokenBudget,
  resolveGoalBudgetAppend,
  type ComposerDraft,
} from '../src/features/session/composer/ComposerTypes.js'

function draft(partial: Partial<ComposerDraft> = {}): ComposerDraft {
  return {
    clientId: 'test-client-id',
    document: createComposerDocument('目标：完成全套系统重构'),
    attachments: [],
    collaborationMode: 'default',
    ...partial,
  }
}

describe('ComposerGoalBudget', () => {
  test('预算创建与编辑共用整数解析，科学计数法不截断，非法值不落盘', () => {
    expect(parseGoalTokenBudget('1e3')).toBe(1000)
    expect(parseGoalTokenBudget('')).toBeNull()
    expect(parseGoalTokenBudget('0')).toBe(0)
    for (const value of ['-5', '1.5', 'Infinity', 'NaN', '9007199254740992']) {
      expect(parseGoalTokenBudget(value)).toBeUndefined()
    }
  })
  test('GOAL_STATUS_LABELS 包含正确的目标预算受限文案', () => {
    expect(GOAL_STATUS_LABELS['budget-limited']).toBe('目标预算受限')
    expect(GOAL_STATUS_LABELS['active']).toBe('进行中的目标')
    expect(GOAL_STATUS_LABELS['paused']).toBe('已暂停的目标')
    expect(GOAL_STATUS_LABELS['blocked']).toBe('目标已停滞')
    expect(GOAL_STATUS_LABELS['usage-limited']).toBe('目标使用受限')
    expect(GOAL_STATUS_LABELS['complete']).toBe('已达成目标')
  })

  test('prepareComposerSubmission: 目标模式携带可选 tokenBudget 提交', () => {
    // 1. 无预算目标
    const unbudgeted = prepareComposerSubmission(
      draft({
        goalModeEnabled: true,
        goalTokenBudget: null,
      }),
    )
    expect('goal' in unbudgeted).toBe(true)
    if ('goal' in unbudgeted) {
      expect(unbudgeted.goal).toEqual({
        objective: '目标：完成全套系统重构',
      })
    }

    // 2. 携带具体预算目标
    const budgeted = prepareComposerSubmission(
      draft({
        goalModeEnabled: true,
        goalTokenBudget: 50000,
      }),
    )
    expect('goal' in budgeted).toBe(true)
    if ('goal' in budgeted) {
      expect(unbudgeted.goal).toBeDefined()
      expect(budgeted.goal).toEqual({
        objective: '目标：完成全套系统重构',
        tokenBudget: 50000,
      })
    }

    // 3. 0 预算目标
    const zeroBudget = prepareComposerSubmission(
      draft({
        goalModeEnabled: true,
        goalTokenBudget: 0,
      }),
    )
    expect('goal' in zeroBudget).toBe(true)
    if ('goal' in zeroBudget) {
      expect(zeroBudget.goal).toEqual({
        objective: '目标：完成全套系统重构',
        tokenBudget: 0,
      })
    }

    // 4. 未启用目标模式不包含 goal
    const nonGoal = prepareComposerSubmission(
      draft({
        goalModeEnabled: false,
        goalTokenBudget: 50000,
      }),
    )
    expect('goal' in nonGoal).toBe(false)
  })
})

describe('Goal 追加预算算术', () => {
  test('200 追加 50 得到 250，非正数与溢出被拒绝', () => {
    expect(resolveGoalBudgetAppend(200, '50')).toEqual({
      status: 'valid',
      tokens: 50,
      nextTotal: 250,
    })
    expect(resolveGoalBudgetAppend(200, '')).toEqual({ status: 'empty' })
    for (const value of ['0', '-5', '1.5', 'abc']) {
      expect(resolveGoalBudgetAppend(200, value)).toEqual({ status: 'invalid' })
    }
    expect(resolveGoalBudgetAppend(Number.MAX_SAFE_INTEGER, '1')).toEqual({
      status: 'overflow',
    })
  })
})
