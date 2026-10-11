import { Schema } from 'effect'
import type { RpcMethod, RpcParams, RpcResult } from '../methods/index'
import { RpcMethods } from '../methods/index'
import {
  RPC_APPLICATION_ERROR,
  RPC_INTERNAL_ERROR,
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RpcRequestSchema,
  type RpcFailureResponse,
  type RpcRequest,
  type RpcResponse,
} from '../wire/Messages'
import type { ApplicationErrorCode, JsonValue, RpcID } from '../wire/Primitives'
import type { MethodDefinition } from '../wire/Definition'

export class RpcApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: JsonValue,
  ) {
    super(message)
    this.name = 'RpcApplicationError'
  }
}

export type RpcHandlerContext = object

export type RpcHandlers<Context extends RpcHandlerContext = RpcHandlerContext> = {
  [M in RpcMethod]: (params: RpcParams<M>, context: Context) => RpcResult<M> | Promise<RpcResult<M>>
}

export function defineRpcHandlers<Context extends RpcHandlerContext>(
  handlers: RpcHandlers<Context>,
): RpcHandlers<Context> {
  const missing = Object.keys(RpcMethods).filter(
    (method) => typeof (handlers as Record<string, unknown>)[method] !== 'function',
  )
  if (missing.length > 0) throw new Error(`Missing RPC handlers: ${missing.join(', ')}`)
  return handlers
}

const failure = (
  id: RpcID | null,
  code: number,
  message: string,
  data?: RpcFailureResponse['error']['data'],
): RpcFailureResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, ...(data === undefined ? {} : { data }) },
})

export async function dispatchRpcMessage<Context extends RpcHandlerContext>(
  input: unknown,
  handlers: RpcHandlers<Context>,
  context: Context,
): Promise<RpcResponse> {
  return dispatchRpcMessageWithMethods(input, RpcMethods, handlers, context)
}

export async function dispatchRpcMessageWithMethods<Context extends RpcHandlerContext>(
  input: unknown,
  methods: Readonly<Record<string, MethodDefinition>>,
  handlers: Readonly<Record<string, (params: never, context: Context) => unknown>>,
  context: Context,
): Promise<RpcResponse> {
  if (Array.isArray(input))
    return failure(null, RPC_INVALID_REQUEST, 'RPC v4 does not support batch messages')

  let request: RpcRequest
  try {
    request = Schema.decodeUnknownSync(RpcRequestSchema)(input)
  } catch {
    return failure(null, RPC_INVALID_REQUEST, 'Invalid JSON-RPC request')
  }

  if (!(request.method in methods))
    return failure(request.id, RPC_METHOD_NOT_FOUND, `Unknown RPC method: ${request.method}`)
  const method = request.method
  const definition = methods[method]!
  const handler = handlers[method]
  if (typeof handler !== 'function') {
    return failure(request.id, RPC_INTERNAL_ERROR, `Missing RPC handler for ${method}`)
  }

  let params: unknown
  try {
    params = Schema.decodeUnknownSync(
      definition.params as Schema.Decoder<unknown, never>,
      definition.exactParams ? { onExcessProperty: 'error' } : undefined,
    )(request.params)
  } catch {
    return failure(request.id, RPC_INVALID_PARAMS, `Invalid params for ${method}`)
  }

  try {
    const result = await handler(params as never, context)
    const encoded = Schema.encodeSync(
      definition.result as Schema.Encoder<unknown, never>,
      definition.exactResult ? { onExcessProperty: 'error' } : undefined,
    )(result)
    return { jsonrpc: '2.0', id: request.id, result: encoded as never }
  } catch (cause) {
    if (cause instanceof RpcApplicationError) {
      const declared = (definition.errors as readonly string[]).includes(cause.code)
      if (declared)
        return failure(request.id, RPC_APPLICATION_ERROR, cause.message, {
          code: cause.code,
          retryable: cause.retryable,
          ...(cause.details === undefined ? {} : { details: cause.details }),
        })
    }
    return failure(request.id, RPC_INTERNAL_ERROR, 'Internal RPC error', {
      code: 'INTERNAL_ERROR',
      retryable: false,
    })
  }
}
