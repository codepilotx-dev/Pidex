import type { RpcMethod } from '@pidex/agent-protocol'
import { AgentError } from '../../../Domain'
import { enumValue, stringParam, type RpcRouter } from '../RpcRouter'
import { optionalRpcRecord as optionalRecord, rpcRecord as record } from '../Decoders'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const revisionParam = (params: Record<string, unknown>) => {
  const revision = params.revision
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    throw new AgentError('INVALID_REQUEST', 'revision 参数无效', 400)
  }
  return revision
}

export const threadForkHandlers = {
  name: 'thread-fork',
  methods: [
    'thread/fork/start',
    'thread/fork/status',
    'thread/fork/pending',
    'thread/fork/retry-setup',
    'thread/fork/continue-without-setup',
    'thread/fork/abandon',
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ) {
    const service = runtime.dependencies.threadFork
    const params = optionalRecord(rawParams)
    switch (method) {
      case 'thread/fork/start': {
        const destination = record(params.destination, 'destination')
        return {
          operation: await service.start({
            operationID: stringParam(params, 'operationId'),
            sourceThreadID: stringParam(params, 'sourceThreadId'),
            sourceTurnID: stringParam(params, 'lastTurnId'),
            sourceItemID: stringParam(params, 'sourceItemId'),
            destination: {
              kind: enumValue(
                destination.kind,
                ['same-worktree', 'new-worktree'] as const,
                'destination.kind',
              ),
            },
          }),
        }
      }
      case 'thread/fork/status': {
        const afterRevision = params.afterRevision
        const afterOutputCursor = params.afterOutputCursor
        const waitMs = params.waitMs
        if (
          afterRevision !== undefined &&
          (typeof afterRevision !== 'number' ||
            !Number.isSafeInteger(afterRevision) ||
            afterRevision < 0)
        ) {
          throw new AgentError('INVALID_REQUEST', 'afterRevision 参数无效', 400)
        }
        if (
          afterOutputCursor !== undefined &&
          (typeof afterOutputCursor !== 'number' ||
            !Number.isSafeInteger(afterOutputCursor) ||
            afterOutputCursor < 0)
        ) {
          throw new AgentError('INVALID_REQUEST', 'afterOutputCursor 参数无效', 400)
        }
        return service.status(
          stringParam(params, 'operationId'),
          afterRevision as number | undefined,
          typeof waitMs === 'number'
            ? Math.max(0, Math.min(30_000, Math.trunc(waitMs)))
            : undefined,
          afterOutputCursor as number | undefined,
        )
      }
      case 'thread/fork/pending':
        return {
          operation: service.pending(
            stringParam(params, 'sourceThreadId'),
            stringParam(params, 'lastTurnId'),
            stringParam(params, 'sourceItemId'),
          ),
        }
      case 'thread/fork/retry-setup':
        return {
          operation: await service.retrySetup(
            stringParam(params, 'operationId'),
            revisionParam(params),
          ),
        }
      case 'thread/fork/continue-without-setup':
        return {
          operation: await service.continueWithoutSetup(
            stringParam(params, 'operationId'),
            revisionParam(params),
          ),
        }
      case 'thread/fork/abandon':
        return {
          operation: await service.abandon(
            stringParam(params, 'operationId'),
            revisionParam(params),
          ),
        }
      default:
        throw new Error(`Unsupported thread fork method: ${method}`)
    }
  },
} as const satisfies RpcHandlerGroup
