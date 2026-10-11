import {
  MiniMaxCliMutationParamsSchema,
  MiniMaxCliStatusParamsSchema,
  type RpcMethod,
} from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { AgentError } from '../../../Domain'
import { MiniMaxCliIntegrationError } from '../../../integration/minimax-cli/MiniMaxCliIntegrationService'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const decodeStatus = Schema.decodeUnknownSync(MiniMaxCliStatusParamsSchema)
const decodeMutation = Schema.decodeUnknownSync(MiniMaxCliMutationParamsSchema)

export const miniMaxCliHandlers = {
  name: 'minimax-cli',
  methods: ['minimaxCli/status', 'minimaxCli/install', 'minimaxCli/uninstall'],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    try {
      switch (method) {
        case 'minimaxCli/status':
          return await runtime.dependencies.minimaxCli.status(decodeStatus(rawParams))
        case 'minimaxCli/install':
          return await runtime.dependencies.minimaxCli.install(decodeMutation(rawParams))
        case 'minimaxCli/uninstall':
          return await runtime.dependencies.minimaxCli.uninstall(decodeMutation(rawParams))
        default:
          return undefined
      }
    } catch (cause) {
      if (cause instanceof MiniMaxCliIntegrationError) {
        throw new AgentError(cause.code, cause.message, cause.status)
      }
      throw new AgentError('INTERNAL_ERROR', 'MiniMax CLI 操作失败，请稍后重试', 500)
    }
  },
} as const satisfies RpcHandlerGroup
