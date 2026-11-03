import { describe, expect, test } from 'bun:test'
import { SHARED_SLASH_COMMANDS, parsePlanTaskFromInput } from '@pidex/shared/slash-commands'

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

  test('plan parsing accepts optional text only', () => {
    expect(parsePlanTaskFromInput('/plan 设计权限系统')).toBe('设计权限系统')
    expect(parsePlanTaskFromInput('/plan\n保留现有数据')).toBe('保留现有数据')
    expect(parsePlanTaskFromInput('/plan')).toBeNull()
    expect(parsePlanTaskFromInput('/status')).toBeNull()
  })
})
