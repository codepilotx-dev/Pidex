import { FULL_ACCESS_PERMISSION_CONFIG } from '@pidex/shared/thread'
import { z } from 'zod'
import type { AutomationService } from '../../automation'
import { AgentError } from '../../Domain'
import type { ToolContext, ToolDefinition } from '../ToolRegistry'

const schedule = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('hourly'), intervalMinutes: z.number().int().positive() }).strict(),
  z.object({ mode: z.literal('daily'), time: z.string().regex(/^\d{2}:\d{2}$/) }).strict(),
  z.object({ mode: z.literal('weekdays'), time: z.string().regex(/^\d{2}:\d{2}$/) }).strict(),
  z
    .object({
      mode: z.literal('weekly'),
      weekdays: z.array(z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])).min(1),
      time: z.string().regex(/^\d{2}:\d{2}$/),
    })
    .strict(),
  z.object({ mode: z.literal('custom'), rrule: z.string().trim().min(1) }).strict(),
])
const model = z
  .object({
    providerID: z.string().min(1),
    id: z.string().min(1),
    variant: z.string().min(1).optional(),
  })
  .strict()
const execution = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('local') }).strict(),
    z.object({ kind: z.literal('new-worktree'), branchName: z.string().trim().min(1) }).strict(),
  ])
  .nullable()
const definition = z
  .object({
    kind: z.enum(['standalone', 'thread']),
    name: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    projectId: z.string().nullable(),
    targetThreadId: z.string().nullable(),
    execution,
    model,
    reasoningEffort: z.string().nullable(),
    sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']),
    schedule,
    timeZone: z.string().min(1),
    notificationPolicy: z.enum(['all', 'failures', 'off']),
  })
  .strict()
const identity = (context: ToolContext) => {
  if (!context.invocation)
    throw new AgentError('PERMISSION_DENIED', '自动化工具缺少受信任的执行上下文', 403)
  return `automation-tool:${context.invocation.toolCallID}`
}
const base = {
  allowedProfiles: ['main'] as const,
  approvalStrategy: 'policy' as const,
  visibility: 'deferred' as const,
  executionMode: 'sequential' as const,
  allowedModes: ['chat'] as const,
}
const capabilities = (externalState: boolean) => ({
  filesystem: 'none' as const,
  network: 'none' as const,
  process: false,
  externalState,
  userInteraction: false,
})
const permissionConfig = (sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access') => ({
  ...FULL_ACCESS_PERMISSION_CONFIG,
  sandboxMode,
})

export const createAutomationDefinitions = (
  service: AutomationService,
): readonly ToolDefinition<any, any>[] => [
  {
    ...base,
    sdkName: 'automation_view',
    name: 'automation.view',
    capabilities: capabilities(false),
    schema: z.object({ automationId: z.string().optional() }).strict(),
    description: '列出本地自动化，或读取指定自动化及其当前 revision。更新或删除前必须先读取。',
    inputSchema: {
      type: 'object',
      properties: { automationId: { type: 'string' } },
      additionalProperties: false,
    },
    execute: async (input) =>
      input.automationId
        ? { automation: service.read(input.automationId) }
        : { automations: service.list(), runs: service.listRuns({ limit: 50 }) },
  },
  {
    ...base,
    sdkName: 'automation_create',
    name: 'automation.create',
    capabilities: capabilities(true),
    schema: definition,
    description: '用户确认任务、频率、执行位置和无人值守权限后，创建本地计划自动化。',
    inputSchema: { type: 'object', additionalProperties: true },
    execute: (input, context) =>
      service.create({
        ...input,
        permissionConfig: permissionConfig(input.sandboxMode),
        operationId: identity(context),
      }),
  },
  {
    ...base,
    sdkName: 'automation_update',
    name: 'automation.update',
    capabilities: capabilities(true),
    schema: definition
      .extend({ automationId: z.string(), expectedRevision: z.number().int().positive() })
      .strict(),
    description:
      '使用 automation.view 返回的当前 revision 更新自动化；冲突时重新读取，不覆盖较新修改。',
    inputSchema: { type: 'object', additionalProperties: true },
    execute: (input) => {
      const { automationId, expectedRevision, sandboxMode, ...value } = input
      return service.update(automationId, {
        ...value,
        expectedRevision,
        permissionConfig: permissionConfig(sandboxMode),
      })
    },
  },
  {
    ...base,
    sdkName: 'automation_delete',
    name: 'automation.delete',
    capabilities: capabilities(true),
    schema: z
      .object({ automationId: z.string(), expectedRevision: z.number().int().positive() })
      .strict(),
    description: '软删除自动化并停止未来运行；不会中断已开始的 turn，也不会删除历史聊天。',
    inputSchema: {
      type: 'object',
      properties: {
        automationId: { type: 'string' },
        expectedRevision: { type: 'integer', minimum: 1 },
      },
      required: ['automationId', 'expectedRevision'],
      additionalProperties: false,
    },
    execute: (input) => service.delete(input.automationId, input.expectedRevision),
  },
]
