import { Schema } from 'effect'
import type { PublicRpcMethod, PublicRpcParams, PublicRpcResult } from '../methods/index'
import {
  InitializedNotificationSchema,
  RpcResponseSchema,
  type InitializedNotification,
  type RpcRequest,
} from '../wire/Messages'
import type { JsonValue, RpcError, RpcID } from '../wire/Primitives'

export interface RpcTransport {
  request(message: RpcRequest): Promise<unknown>
  notify(message: InitializedNotification): Promise<void>
}

export class RpcRemoteError extends Error {
  constructor(readonly rpcError: RpcError) {
    super(rpcError.message)
    this.name = 'RpcRemoteError'
  }
}

export type RpcClient = {
  call<M extends PublicRpcMethod>(
    method: M,
    params: PublicRpcParams<M>,
  ): Promise<PublicRpcResult<M>>
  initialized(params: InitializedNotification['params']): Promise<void>
}

type RpcDefinition = {
  params: Schema.Top
  result: Schema.Top
  exactParams?: boolean
  exactResult?: boolean
}

const definitionFor = async (method: PublicRpcMethod): Promise<RpcDefinition> => {
  const definition = (await import('../methods/index')).RpcMethods[method]
  if (definition) return definition
  throw new Error(`Unknown RPC method: ${method}`)
}

export function createRpcClient(
  transport: RpcTransport,
  options: { idPrefix?: string } = {},
): RpcClient {
  const idPrefix = options.idPrefix ?? 'client'
  let ordinal = 0

  return {
    async call<M extends PublicRpcMethod>(
      method: M,
      params: PublicRpcParams<M>,
    ): Promise<PublicRpcResult<M>> {
      const definition = await definitionFor(method)
      const encodedParams = Schema.encodeSync(
        definition.params as Schema.Encoder<unknown, never>,
        definition.exactParams ? { onExcessProperty: 'error' } : undefined,
      )(params) as JsonValue
      const id: RpcID = `${idPrefix}:${++ordinal}`
      const raw = await transport.request({
        jsonrpc: '2.0',
        id,
        method,
        params: encodedParams as never,
      })
      const response = Schema.decodeUnknownSync(RpcResponseSchema)(raw)
      if (response.id !== id)
        throw new Error(`RPC response id mismatch: expected ${id}, received ${String(response.id)}`)
      if ('error' in response) throw new RpcRemoteError(response.error)
      return Schema.decodeUnknownSync(
        definition.result as Schema.Decoder<unknown, never>,
        definition.exactResult ? { onExcessProperty: 'error' } : undefined,
      )(response.result) as PublicRpcResult<M>
    },

    async initialized(params) {
      const notification = Schema.decodeUnknownSync(InitializedNotificationSchema)({
        jsonrpc: '2.0',
        method: 'initialized',
        params,
      })
      await transport.notify(notification)
    },
  }
}
