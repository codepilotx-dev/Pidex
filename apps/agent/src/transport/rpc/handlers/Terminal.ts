import {
  TerminalHostContextParamsSchema,
  TerminalOutputAppendParamsSchema,
  TerminalOutputClearParamsSchema,
  TerminalOutputResetParamsSchema,
} from '@pidex/agent-protocol/terminal'
import type { RpcMethod } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import { decodeRpcParams } from '../Decoders'
import type { RpcHandlerGroup } from './Types'

const decodeContext = Schema.decodeUnknownSync(TerminalHostContextParamsSchema)
const decodeReset = Schema.decodeUnknownSync(TerminalOutputResetParamsSchema)
const decodeAppend = Schema.decodeUnknownSync(TerminalOutputAppendParamsSchema)
const decodeClear = Schema.decodeUnknownSync(TerminalOutputClearParamsSchema)

export const terminalHandlers = {
  name: 'terminal',
  methods: [
    'terminal/host/context',
    'terminal/host/output/reset',
    'terminal/host/output/append',
    'terminal/host/output/clear',
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    context: RpcRouterContext,
  ): Promise<unknown> {
    runtime.requireDesktopHost(context)
    switch (method) {
      case 'terminal/host/context': {
        const params = decodeRpcParams(decodeContext, rawParams, method)
        return runtime.dependencies.terminalContext.resolve(params.threadId)
      }
      case 'terminal/host/output/reset': {
        const params = decodeRpcParams(decodeReset, rawParams, method)
        runtime.dependencies.terminalOutput.reset(params)
        return { ok: true }
      }
      case 'terminal/host/output/append': {
        const params = decodeRpcParams(decodeAppend, rawParams, method)
        runtime.dependencies.terminalOutput.append(params)
        return { ok: true }
      }
      case 'terminal/host/output/clear': {
        const params = decodeRpcParams(decodeClear, rawParams, method)
        runtime.dependencies.terminalOutput.clear(params)
        return { ok: true }
      }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
