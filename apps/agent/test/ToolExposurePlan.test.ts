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
  test('Chat 主 Agent 暴露 finalize_result 结构化交付工具', () => {
    const plan = exposure({ taskMode: 'chat', profile: 'main' })
    expect(plan.allows('finalize_result')).toBe(true)
    expect(plan.allows('update_plan')).toBe(true)
    expect(plan.allows('request_permissions')).toBe(true)
    expect(plan.exposed).toContain('finalize_result')
  })

  test('Plan 主 Agent 不暴露 finalize_result，改以 submit_plan 交付', () => {
    const plan = exposure({ taskMode: 'plan', profile: 'main' })
    expect(plan.allows('finalize_result')).toBe(false)
    expect(plan.allows('update_plan')).toBe(false)
    expect(plan.allows('request_permissions')).toBe(false)
    expect(plan.allows('submit_plan')).toBe(true)
    expect(plan.exposed).toContain('submit_plan')
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

  test('主 Agent 的 finalize_result 服从 Skill allowlist，子 Agent 的收尾工具不被剥离', () => {
    const main = exposure({
      taskMode: 'chat',
      profile: 'main',
      allowedTools: ['Read'],
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
