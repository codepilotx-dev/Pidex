import { Schema } from 'effect'
import { ComputerRpcMethods, ComputerHostRpcMethods } from '@pidex/agent-protocol'
import { AgentError } from '../../../Domain'
import type { RpcHandlerGroup } from './Types'
const methods = { ...ComputerRpcMethods, ...ComputerHostRpcMethods }
export const computerHandlers: RpcHandlerGroup = {
  name: 'computer',
  methods: Object.keys(methods) as Array<keyof typeof methods>,
  async handle(runtime, method, raw, context) {
    const computer = runtime.dependencies.computer
    if (!computer) throw new AgentError('CAPABILITY_REQUIRED', '电脑控制不可用', 409)
    if (!(method in methods)) return
    const params = Schema.decodeUnknownSync(
      methods[method as keyof typeof methods].params as Schema.Decoder<any, never>,
    )(raw) as Record<string, any>
    if (method.startsWith('computer/host/')) {
      runtime.requireDesktopHost(context)
      if (method !== 'computer/host/register' && method !== 'computer/host/registerIdentity')
        computer.requireHost(params.instanceId, context.connectionId!)
    }
    switch (method) {
      case 'computer/state':
        return computer.state()
      case 'computer/apps':
        return computer.discoverApplications()
      case 'computer/configure':
        return computer.configure(params)
      case 'computer/stop':
        computer.stop()
        return { ok: true }
      case 'computer/host/register':
        return computer.register(params.instanceId, context.connectionId!, params.available)
      case 'computer/host/registerIdentity':
        return computer.register(params.instanceId, context.connectionId!, params.available, true)
      case 'computer/host/next':
        return computer.next(params.generation)
      case 'computer/host/complete':
        computer.complete(params.requestId, params.generation, params.result)
        return { ok: true }
      case 'computer/host/release':
        computer.release(params.instanceId)
        return { ok: true }
    }
  },
}
