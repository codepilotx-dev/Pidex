import { z } from 'zod'
import { stat, readFile } from 'node:fs/promises'
import type { ToolDefinition } from '../ToolRegistry'
import type { TaskScheduleService } from '../../calendar/TaskScheduleService'
import { AgentError } from '../../Domain'
import { defaultTaskSchedule } from '@pidex/shared/task-schedule'
const capabilities = {
  filesystem: 'none',
  network: 'none',
  process: false,
  externalState: true,
  userInteraction: false,
} as const
const base = {
  allowedModes: ['chat'] as const,
  allowedProfiles: ['main'] as const,
  approvalStrategy: 'policy' as const,
  visibility: 'deferred' as const,
  executionMode: 'sequential' as const,
}

export function taskScheduleDefinitions(service: TaskScheduleService): ToolDefinition<any, any>[] {
  const task = z
    .object({
      name: z.string().trim().min(1).max(200),
      owner: z.enum(['human', 'agent']).optional(),
    })
    .strict()
  const arrangement = taskArrangementInput
  return [
    {
      ...base,
      sdkName: 'task_schedule_view',
      name: 'task_schedule.view',
      description:
        '读取任务、会话关联、每次执行与验收状态、待处理提醒及排程草案；安排时间前读取现有任务与日历。',
      schema: z.object({}).strict(),
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      capabilities: { ...capabilities, externalState: false },
      allowedModes: ['chat', 'plan'],
      execute: async () => service.list(),
      formatResult: (value) => ({ content: JSON.stringify(value), details: value }),
    },
    {
      ...base,
      sdkName: 'task_schedule_create',
      name: 'task_schedule.create',
      description:
        '用户要求创建任务时，仅用名称即可创建；不要求先写方案或选择模型。创建不执行，人工验收默认开启。',
      schema: task,
      inputSchema: z.toJSONSchema(task),
      capabilities,
      execute: async (input, context) => {
        if (!context.invocation) throw new AgentError('PERMISSION_DENIED', '缺少任务上下文', 403)
        return service.save({
          name: input.name,
          operationId: `${context.invocation.toolCallID}:create`,
          definition: { ...defaultTaskSchedule(input.name), owner: input.owner ?? 'agent' },
        })
      },
      formatResult: (value) => ({ content: JSON.stringify(value), details: value }),
    },
    {
      ...base,
      sdkName: 'task_schedule_propose',
      name: 'task_schedule.propose',
      description:
        '保存批量时间安排草案，不激活执行。默认保留已有安排，按可用时间、优先级、预计时长、截止时间与依赖排程；无法安排的任务必须给出原因。用户在自动化页面统一确认。',
      schema: arrangement,
      inputSchema: z.toJSONSchema(arrangement),
      capabilities,
      execute: async (input, context) => {
        if (!context.invocation) throw new AgentError('PERMISSION_DENIED', '缺少任务上下文', 403)
        return service.propose({
          ...input,
          operationId: `${context.invocation.toolCallID}:propose`,
        })
      },
      formatResult: (value) => ({
        content: JSON.stringify({ proposal: value, reviewUrl: '/automations' }),
        details: value,
      }),
    },
  ]
}

export const taskArrangementInput = z
  .object({
    items: z
      .array(
        z.union([
          z
            .object({
              taskId: z.string().min(1),
              expectedRevision: z.number().int().positive(),
              at: z.number().finite(),
              durationMinutes: z.number().int().positive().default(30),
            })
            .strict(),
          z
            .object({
              name: z.string().trim().min(1).max(200),
              owner: z.enum(['human', 'agent']),
              at: z.number().finite(),
              durationMinutes: z.number().int().positive().default(30),
            })
            .strict(),
        ]),
      )
      .max(100),
    unscheduled: z
      .array(
        z.union([
          z.object({ taskId: z.string().min(1), reason: z.string().min(1) }).strict(),
          z
            .object({
              name: z.string().trim().min(1).max(200),
              owner: z.enum(['human', 'agent']),
              reason: z.string().min(1),
            })
            .strict(),
        ]),
      )
      .default([]),
  })
  .strict()

const fileCheck = z
  .object({ file_path: z.string().min(1), section: z.string().min(1).optional() })
  .strict()
export const taskScheduleCheckDefinition: ToolDefinition<z.infer<typeof fileCheck>, boolean> = {
  ...base,
  sdkName: 'task_schedule_check',
  name: 'task_schedule.check',
  description: '检查非空文件或 UTF-8 Markdown 章节，用于任务自动验收。',
  schema: fileCheck,
  inputSchema: z.toJSONSchema(fileCheck),
  capabilities: { ...capabilities, filesystem: 'read', externalState: false },
  execute: async (input, context) => {
    const path = await context.workspace.resolveExistingPath(input.file_path)
    const metadata = await stat(path)
    if (!metadata.isFile() || metadata.size === 0) return false
    if (!input.section) return true
    const content = await readFile(path, 'utf8')
    return content.split(/\r?\n/).some(
      (line) =>
        line
          .replace(/^\s*#{1,6}\s+/, '')
          .replace(/\s+#+\s*$/, '')
          .trim() === input.section?.trim() && /^\s*#{1,6}\s+/.test(line),
    )
  },
}
