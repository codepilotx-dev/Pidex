import { z } from 'zod'
import type { SchedulePlanService } from '../../calendar/SchedulePlanService'
import { AgentError } from '../../Domain'
import type { ToolDefinition } from '../ToolRegistry'

const schedule = z.discriminatedUnion('mode', [
  z
    .object({ mode: z.literal('hourly'), intervalMinutes: z.number().int().min(1).max(43_200) })
    .strict(),
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
const item = z.discriminatedUnion('kind', [
  z
    .object({
      key: z.string().trim().min(1),
      enabled: z.boolean().default(true),
      kind: z.literal('one-off'),
      name: z.string().trim().min(1).max(200),
      prompt: z.string().trim().min(1).max(100_000),
      scheduledFor: z.number().finite(),
    })
    .strict(),
  z
    .object({
      key: z.string().trim().min(1),
      enabled: z.boolean().default(true),
      kind: z.literal('recurring'),
      name: z.string().trim().min(1).max(200),
      prompt: z.string().trim().min(1).max(100_000),
      schedule,
      timeZone: z.string().trim().min(1),
    })
    .strict(),
])
const input = z
  .object({
    horizon: z.enum(['day', 'week', 'month', 'year']),
    timeZone: z.string().trim().min(1),
    items: z.array(item).min(1).max(100),
  })
  .strict()

export const createSchedulePlanDefinition = (
  service: SchedulePlanService,
  projectIdForThread: (threadId: string) => string | null,
): ToolDefinition<z.infer<typeof input>, Awaited<ReturnType<SchedulePlanService['propose']>>> => ({
  sdkName: 'schedule_plan_propose',
  name: 'schedule_plan.propose',
  description:
    '用户确认规划目标和时间范围后，生成可在聊天中逐项编辑和确认的日程草案。此工具只创建草案，不会直接安排或执行任务。',
  schema: input,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['horizon', 'timeZone', 'items'],
    properties: {
      horizon: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
      timeZone: { type: 'string' },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: { type: 'object', additionalProperties: true },
      },
    },
  },
  capabilities: {
    filesystem: 'none',
    network: 'none',
    process: false,
    externalState: true,
    userInteraction: false,
  },
  allowedModes: ['chat'],
  allowedProfiles: ['main'],
  approvalStrategy: 'policy',
  visibility: 'deferred',
  executionMode: 'sequential',
  formatResult: (proposal) => ({
    content: JSON.stringify({ proposal }, null, 2),
    details: { proposal },
  }),
  execute: async (value, context) => {
    if (!context.invocation)
      throw new AgentError('PERMISSION_DENIED', '当前上下文不能创建日程草案', 403)
    const projectId = projectIdForThread(context.invocation.threadID)
    return service.propose({
      threadId: context.invocation.threadID,
      turnId: context.invocation.turnID,
      toolCallId: context.invocation.toolCallID,
      horizon: value.horizon,
      defaults: projectId
        ? {
            kind: 'standalone',
            projectId,
            targetThreadId: null,
            execution: { kind: 'local' },
            model: context.model,
            reasoningEffort: context.model.variant ?? null,
            permissionConfig: context.permissionConfig,
            timeZone: value.timeZone,
            notificationPolicy: 'failures',
          }
        : {
            kind: 'thread',
            projectId: null,
            targetThreadId: context.invocation.threadID,
            execution: null,
            model: context.model,
            reasoningEffort: context.model.variant ?? null,
            permissionConfig: context.permissionConfig,
            timeZone: value.timeZone,
            notificationPolicy: 'failures',
          },
      items: value.items,
    })
  },
})
