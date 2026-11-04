import { AgentError } from '../../../Domain'
import type { RpcHandlerGroup } from './Types'

/** 保留已发布的 wire 契约；此集成不再提供 capability。 */
export const miniMaxCliHandlers = {
  name: 'retired-minimax-cli',
  methods: ['minimaxCli/status', 'minimaxCli/install', 'minimaxCli/uninstall'],
  async handle(): Promise<never> {
    throw new AgentError('INTERNAL_ERROR', 'MiniMax CLI 集成已移除', 410)
  },
} as const satisfies RpcHandlerGroup
