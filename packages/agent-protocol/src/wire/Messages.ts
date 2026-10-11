import { Schema } from 'effect'
import { JsonValueSchema, RpcErrorSchema, RpcIDSchema } from './Primitives'

export const RpcRequestSchema = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  id: RpcIDSchema,
  method: Schema.String,
  params: JsonValueSchema,
})
export type RpcRequest = typeof RpcRequestSchema.Type

export const RpcSuccessResponseSchema = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  id: RpcIDSchema,
  result: JsonValueSchema,
})
export type RpcSuccessResponse = typeof RpcSuccessResponseSchema.Type

export const RpcFailureResponseSchema = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  id: Schema.Union([RpcIDSchema, Schema.Null]),
  error: RpcErrorSchema,
})
export type RpcFailureResponse = typeof RpcFailureResponseSchema.Type

export const RpcResponseSchema = Schema.Union([RpcSuccessResponseSchema, RpcFailureResponseSchema])
export type RpcResponse = typeof RpcResponseSchema.Type

export const InitializedNotificationSchema = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  method: Schema.Literal('initialized'),
  params: Schema.Struct({
    protocol: Schema.Literal('thread-rpc-v4'),
    clientInstanceId: Schema.optional(Schema.String),
  }),
})
export type InitializedNotification = typeof InitializedNotificationSchema.Type

export const RPC_PARSE_ERROR = -32700
export const RPC_INVALID_REQUEST = -32600
export const RPC_METHOD_NOT_FOUND = -32601
export const RPC_INVALID_PARAMS = -32602
export const RPC_INTERNAL_ERROR = -32603
export const RPC_APPLICATION_ERROR = -32000
