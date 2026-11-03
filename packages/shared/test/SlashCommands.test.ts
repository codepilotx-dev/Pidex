import { describe, expect, test } from 'bun:test'
import {
  SHARED_SLASH_COMMANDS,
  parseGoalTaskFromInput,
  parseGrillTaskFromInput,
  parsePlanTaskFromInput,
} from '@pidex/shared/slash-commands'

describe('shared slash commands', () => {
  test('plan and status share stable ids, triggers and argument modes', () => {
    expect(SHARED_SLASH_COMMANDS.plan).toEqual({
      id: 'plan',
      trigger: 'plan',
      argumentMode: 'optional-text',
    })
    expect(SHARED_SLASH_COMMANDS.status).toEqual({
      id: 'status',
      trigger: 'status',
      argumentMode: 'none',
    })
  })

  test('a long whitespace tail stays linear instead of backtracking', () => {
    // 旧实现 /^\/plan\s+([\s\S]*\S)\s*$/ 在这类输入上会二次回溯。
    const started = performance.now()
    expect(parsePlanTaskFromInput(`/plan${' '.repeat(200_000)}`)).toBeNull()
    expect(parsePlanTaskFromInput(`/plan 目标${' '.repeat(200_000)}`)).toBe('目标')
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  test('grill and goal reuse the same task extraction', () => {
    expect(parseGrillTaskFromInput('/grill 澄清需求')).toBe('澄清需求')
    expect(parseGoalTaskFromInput('/goal 收敛预算')).toBe('收敛预算')
    expect(parseGrillTaskFromInput('/grill')).toBeNull()
    expect(parseGoalTaskFromInput('/goalx 不是命令')).toBeNull()
  })

  test('plan parsing accepts optional text only', () => {
    expect(parsePlanTaskFromInput('/plan 设计权限系统')).toBe('设计权限系统')
    expect(parsePlanTaskFromInput('/plan\n保留现有数据')).toBe('保留现有数据')
    expect(parsePlanTaskFromInput('/plan')).toBeNull()
    expect(parsePlanTaskFromInput('/status')).toBeNull()
  })
})
