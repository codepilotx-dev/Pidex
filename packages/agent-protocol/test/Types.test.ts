import type {
  RpcErrors,
  RpcMethod,
  RpcParams,
  RpcResult,
  ServerRequestParams,
  ServerRequestResult,
  DurableEventEnvelope,
} from '../src/index'
import {
  RpcMethodMap,
  ServerRequestMap,
  createRpcClient,
  defineRpcHandlers,
  type RpcHandlers,
  type RpcTransport,
} from '../src/index'

const params: RpcParams<'thread/read'> = { threadId: 'thread-1' }
const result: RpcResult<'sandbox/status'> = {
  sandbox: {
    state: 'available',
    platform: 'win32',
    architecture: 'x64',
    runtimeVersion: '1.0.0',
    maturity: 'alpha',
    maxConcurrentCommands: 8,
    error: null,
    operations: { canInstall: false, canRepair: true, canUninstall: true },
  },
}
const error: RpcErrors<'memory/read'> = 'MEMORY_NOT_FOUND'
const approval: ServerRequestParams<'approval/request'>['kind'] = 'approval'
const approvalResult: ServerRequestResult<'approval/request'> = {
  kind: 'approval',
  decision: 'deny',
}
void [params, result, error, approval, approvalResult]
void [RpcMethodMap, ServerRequestMap]

const durableEvent: DurableEventEnvelope<'thread/deleted'> = {
  eventId: 'event-1',
  streamId: 'global',
  type: 'thread/deleted',
  version: 1,
  occurredAt: 1,
  durability: 'durable',
  sequence: 1,
  payload: { threadId: 'thread-1', deletedAt: 1 },
}
void durableEvent

// @ts-expect-error the manifest fixes the event version
const invalidEventVersion: DurableEventEnvelope<'thread/deleted'> = { ...durableEvent, version: 2 }
void invalidEventVersion

function assertTypes(transport: RpcTransport) {
  const client = createRpcClient(transport)
  void client.call('thread/read', { threadId: 'thread-1' })
  void client.call('sandbox/status', {})

  // @ts-expect-error unknown methods cannot be called
  void client.call('thread/missing', {})
  // @ts-expect-error params are method-specific
  void client.call('thread/read', {})
  // @ts-expect-error even no-argument methods require an object
  void client.call('sandbox/status')
  // @ts-expect-error result schemas remain exact at compile time
  const invalidResult: RpcResult<'sandbox/status'> = { ok: true }
  // @ts-expect-error only declared application errors are accepted
  const invalidError: RpcErrors<'memory/read'> = 'SANDBOX_UNAVAILABLE'
  const invalidServerResult: ServerRequestResult<'question/request'> = {
    // @ts-expect-error server request results are tied to their request method
    kind: 'approval',
    decision: 'deny',
  }
  // @ts-expect-error RpcMethod is a closed union
  const invalidMethod: RpcMethod = 'arbitrary/method'

  // @ts-expect-error the dispatcher registration requires a complete handler map
  defineRpcHandlers({ 'sandbox/status': () => result })
  void (null as unknown as RpcHandlers)
  void [invalidResult, invalidError, invalidServerResult, invalidMethod]
}

void assertTypes
