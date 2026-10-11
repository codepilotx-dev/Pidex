import { z } from 'zod'
import type { ToolDefinition } from '../tool/ToolRegistry'
import { AgentError } from '../Domain'

const taskMessage = z
  .object({ taskID: z.string().trim().min(1), message: z.string().trim().min(1) })
  .strict()
const task = z.object({ taskID: z.string().trim().min(1) }).strict()
const schemas = {
  spawn_agents: z
    .object({
      agents: z
        .array(
          z
            .object({
              name: z.string().optional(),
              profile: z.enum(['default', 'explorer', 'worker']),
              task: z.string().trim().min(1),
              workspaceMode: z.enum(['shared', 'worktree']).optional(),
              model: z
                .object({ providerID: z.string(), id: z.string(), variant: z.string().optional() })
                .optional(),
            })
            .strict(),
        )
        .min(1)
        .max(4),
    })
    .strict(),
  wait_agents: z
    .object({
      runIDs: z.array(z.string().min(1)).min(1),
      mode: z.enum(['all', 'any']).default('all'),
    })
    .strict(),
  send_agent: taskMessage,
  stop_agent: task,
  followup_agent: taskMessage,
  report_agent: z.object({ message: z.string().trim().min(1) }).strict(),
  list_agents: z.object({}).strict(),
}

export const subagentToolDefinitions: ToolDefinition[] = Object.entries(schemas).map(
  ([name, schema]) => ({
    sdkName: name,
    name,
    schema,
    prepareArguments: (raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('taskId' in raw)) return raw
      const { taskId, ...rest } = raw as Record<string, unknown>
      return { ...rest, taskID: rest.taskID ?? taskId }
    },
    inputSchema: z.toJSONSchema(schema),
    description: `子 Agent 协作：${name}。只允许直接父子关系，不能扩大权限。`,
    capabilities: {
      filesystem: 'none',
      network: 'none',
      process: false,
      externalState: false,
      userInteraction: false,
    },
    allowedModes: ['chat', 'plan'],
    allowedProfiles:
      name === 'report_agent'
        ? ['default', 'explorer', 'worker']
        : ['main', 'default', 'explorer', 'worker'],
    approvalStrategy: 'never-review',
    visibility: 'internal',
    executionMode: 'sequential',
    execute: async (input, context) => {
      if (!context.subagentLifecycle)
        throw new AgentError('TOOL_NOT_AVAILABLE', '当前执行没有子 Agent 协作入口', 409)
      return context.subagentLifecycle(name, input as Record<string, unknown>)
    },
  }),
)
