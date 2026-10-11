import type { RpcMethod } from '@pidex/agent-protocol'
import { AgentError } from '../../../Domain'
import { enumValue, stringParam, type RpcRouter } from '../RpcRouter'
import { optionalRpcRecord as optionalRecord, rpcRecord as record } from '../Decoders'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

/** Factory keeps Handoff wiring out of RpcRouter and bootstrap business logic. */
export const handoffHandlers: RpcHandlerGroup = {
  name: 'handoff',
  methods: [
    'thread/handoff/start',
    'thread/handoff/status',
    'thread/handoff/pending',
    'thread/handoff/ack-client-transfer',
  ],
  async handle(
    _runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ) {
    const handoff = _runtime.dependencies.handoff
    const params = optionalRecord(rawParams)
    switch (method) {
      case 'thread/handoff/start': {
        const destination = record(params.destination, 'destination')
        const kind = enumValue(destination.kind, ['local', 'worktree'] as const, 'destination.kind')
        return {
          operation: await handoff.start({
            operationID: stringParam(params, 'operationId'),
            sourceThreadID: stringParam(params, 'sourceThreadId'),
            destination:
              kind === 'local'
                ? { kind }
                : { kind, worktreeID: stringParam(destination, 'worktreeId') },
          }),
        }
      }
      case 'thread/handoff/status': {
        const afterRevision = params.afterRevision
        const waitMs = params.waitMs
        return handoff.status(
          stringParam(params, 'operationId'),
          typeof afterRevision === 'number' ? afterRevision : undefined,
          typeof waitMs === 'number'
            ? Math.max(0, Math.min(30_000, Math.trunc(waitMs)))
            : undefined,
        )
      }
      case 'thread/handoff/pending':
        return {
          operation: handoff.pending(stringParam(params, 'sourceThreadId')),
        }
      case 'thread/handoff/ack-client-transfer': {
        if (
          typeof params.revision !== 'number' ||
          !Number.isSafeInteger(params.revision) ||
          params.revision < 0
        )
          throw new AgentError('INVALID_REQUEST', 'revision 参数无效', 400)
        return {
          operation: await handoff.acknowledgeClientTransfer(
            stringParam(params, 'operationId'),
            params.revision,
          ),
        }
      }
      default:
        throw new Error(`Unsupported Handoff method: ${method}`)
    }
  },
}
