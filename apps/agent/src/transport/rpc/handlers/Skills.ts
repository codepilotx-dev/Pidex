import {
  SkillListParamsSchema,
  SkillReadParamsSchema,
  SkillSetEnabledParamsSchema,
  type RpcMethod,
} from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { AgentError } from '../../../Domain'
import { SkillManagementError } from '../../../prompt/SkillManagementService'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const decodeList = Schema.decodeUnknownSync(SkillListParamsSchema)
const decodeRead = Schema.decodeUnknownSync(SkillReadParamsSchema)
const decodeSetEnabled = Schema.decodeUnknownSync(SkillSetEnabledParamsSchema)

export const skillHandlers = {
  name: 'skills',
  methods: ['skill/list', 'skill/read', 'skill/setEnabled'],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    const skills = runtime.dependencies.skills
    if (!skills) throw new AgentError('INTERNAL_ERROR', '技能管理服务未配置', 500)
    try {
      switch (method) {
        case 'skill/list':
          return skills.list(decodeList(rawParams))
        case 'skill/read':
          return skills.read(decodeRead(rawParams))
        case 'skill/setEnabled': {
          const result = await skills.setEnabled(decodeSetEnabled(rawParams))
          if (result.changed) {
            await runtime.emit('skill/updated', { generation: result.result.generation })
          }
          return result.result
        }
        default:
          return undefined
      }
    } catch (cause) {
      if (cause instanceof SkillManagementError) {
        throw new AgentError(cause.code, cause.message, cause.status)
      }
      throw cause
    }
  },
} as const satisfies RpcHandlerGroup
