import { describe, expect, test } from 'bun:test'
import { createToolExposurePlan } from '../src/tool/ToolExposurePlan'
import { ToolCatalog } from '../src/tool/ToolRegistry'
import type { SubagentProfile, TaskMode } from '../src/Domain'
import type { ApprovalPolicy } from '@pidex/shared/thread'

const exposure = (input: {
  taskMode: TaskMode
  profile?: SubagentProfile
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: ApprovalPolicy
  allowedTools?: readonly string[]
}) =>
  createToolExposurePlan(new ToolCatalog(), {
    taskMode: input.taskMode,
    sandboxMode: input.sandboxMode ?? 'workspace-write',
    approvalPolicy: input.approvalPolicy ?? 'on-request',
    ...(input.profile ? { profile: input.profile } : {}),
    ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
  })

describe('ToolExposurePlan finalize_result exposure', () => {
  test('纯时间草案仅由支持该能力的 Plan 主 Agent 提交，allowlist 仍有效', () => {
    const input = {
      taskMode: 'plan' as const,
      sandboxMode: 'read-only' as const,
      approvalPolicy: 'never' as const,
      hasTaskSchedules: true,
    }
    expect(createToolExposurePlan(new ToolCatalog(), input).allows('submit_task_schedule')).toBe(
      true,
    )
    expect(
      createToolExposurePlan(new ToolCatalog(), { ...input, hasTaskSchedules: false }).allows(
        'submit_task_schedule',
      ),
    ).toBe(false)
    expect(
      createToolExposurePlan(new ToolCatalog(), { ...input, profile: 'explorer' }).allows(
        'submit_task_schedule',
      ),
    ).toBe(false)
    expect(
      createToolExposurePlan(new ToolCatalog(), { ...input, taskMode: 'chat' }).allows(
        'submit_task_schedule',
      ),
    ).toBe(false)
    expect(
      createToolExposurePlan(new ToolCatalog(), { ...input, allowedTools: ['Read'] }).allows(
        'submit_task_schedule',
      ),
    ).toBe(false)
  })
  test('Chat 主 Agent 以文本收尾，不暴露 finalize_result', () => {
    const plan = exposure({ taskMode: 'chat', profile: 'main' })
    expect(plan.allows('finalize_result')).toBe(false)
    expect(plan.allows('update_plan')).toBe(true)
    expect(plan.allows('request_permissions')).toBe(true)
    expect(plan.exposed).not.toContain('finalize_result')
  })

  test('Plan 主 Agent 不暴露 finalize_result，改以 submit_plan 交付', () => {
    const plan = exposure({ taskMode: 'plan', profile: 'main' })
    expect(plan.allows('finalize_result')).toBe(false)
    expect(plan.allows('update_plan')).toBe(false)
    expect(plan.allows('request_permissions')).toBe(false)
    expect(plan.allows('submit_plan')).toBe(true)
    expect(plan.exposed).toContain('submit_plan')
  })

  test('Grill 主 Agent 只读调查、可提问与派发 Explorer，但不暴露计划提交', () => {
    const plan = exposure({ taskMode: 'grill', profile: 'main', sandboxMode: 'danger-full-access' })
    expect(plan.allows('request_user_input')).toBe(true)
    expect(plan.allows('spawn_agents')).toBe(true)
    expect(plan.allows('submit_plan')).toBe(false)
    expect(plan.allows('submit_schedule_plan')).toBe(false)
    expect(plan.allows('update_plan')).toBe(false)
    expect(plan.allows('update_goal')).toBe(false)
    expect(plan.allows('request_permissions')).toBe(false)
    expect(plan.exposed).toContain('Read')
    expect(plan.exposed).not.toContain('Write')
    expect(plan.exposed).not.toContain('Edit')
  })

  test('submit_plan 只属于 Plan 主 Agent', () => {
    expect(exposure({ taskMode: 'chat', profile: 'main' }).allows('submit_plan')).toBe(false)
    for (const profile of ['default', 'explorer', 'worker'] as const) {
      expect(exposure({ taskMode: 'plan', profile }).allows('submit_plan')).toBe(false)
    }
  })

  test('子 Agent 暴露递归协作与收尾工具，但不暴露主 Agent 计划和权限工具', () => {
    for (const profile of ['default', 'explorer', 'worker'] as const) {
      const plan = exposure({ taskMode: 'chat', profile })
      expect(plan.allows('finalize_result')).toBe(true)
      expect(plan.allows('update_plan')).toBe(false)
      expect(plan.allows('request_permissions')).toBe(false)
      expect(plan.allows('spawn_agents')).toBe(true)
      expect(plan.allows('followup_agent')).toBe(true)
      expect(plan.allows('report_agent')).toBe(true)
    }
  })

  test('深度上限隐藏创建入口，但保留父子通信工具', () => {
    const plan = createToolExposurePlan(new ToolCatalog(), {
      taskMode: 'chat',
      profile: 'worker',
      depth: 3,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
    })
    expect(plan.allows('spawn_agents')).toBe(false)
    expect(plan.allows('report_agent')).toBe(true)
    expect(plan.allows('wait_agents')).toBe(true)
  })

  test('Skill allowlist 不恢复主 Agent 收尾工具，子 Agent 的收尾工具不被剥离', () => {
    const main = exposure({
      taskMode: 'chat',
      profile: 'main',
      allowedTools: ['Read', 'finalize_result'],
    })
    expect(main.allows('Read')).toBe(true)
    expect(main.allows('finalize_result')).toBe(false)
    const subagent = exposure({
      taskMode: 'chat',
      profile: 'default',
      allowedTools: ['Read'],
    })
    expect(subagent.allows('Read')).toBe(true)
    expect(subagent.allows('finalize_result')).toBe(true)
  })
})
