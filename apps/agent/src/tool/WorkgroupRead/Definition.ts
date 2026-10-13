import { z } from 'zod'
import { AgentError } from '../../Domain'
import type { SessionGroupService } from '../../session-group/SessionGroupService'
import type { ToolDefinition } from '../ToolRegistry'

const schema = z.object({}).strict()

type WorkgroupReadOutput = NonNullable<ReturnType<SessionGroupService['readForThread']>>

export const createWorkgroupReadDefinition = (
  service: SessionGroupService,
): ToolDefinition<z.infer<typeof schema>, WorkgroupReadOutput> => ({
  sdkName: 'workgroup_read',
  name: 'workgroup_read',
  description:
    '读取当前会话所属工作组的成员会话、有效共享条目与近期进展，用于跨项目参考组内已有和后续的成果。返回成员会话 ID 后可用 read_thread 分页读取其完整历史（含加入工作组之前的要求、成果与计划）。只读，不会修改任何数据。',
  schema,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  capabilities: {
    filesystem: 'none',
    network: 'none',
    process: false,
    externalState: false,
    userInteraction: false,
  },
  allowedModes: ['chat', 'plan'],
  allowedProfiles: ['main', 'default', 'explorer', 'worker'],
  approvalStrategy: 'never-review',
  visibility: 'eager',
  executionMode: 'parallel',
  execute: async (_input, context) => {
    if (!context.invocation)
      throw new AgentError('PERMISSION_DENIED', '当前上下文不能读取工作组', 403)
    const view = service.readForThread(context.invocation.threadID)
    if (!view)
      throw new AgentError('SESSION_GROUP_NOT_FOUND', '当前会话不属于任何工作组', 404)
    return view
  },
})
