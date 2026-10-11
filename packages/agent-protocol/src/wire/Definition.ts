import { Schema } from 'effect'
import type { CapabilityRequirement, ProtocolCapability } from '../runtime/Capabilities'
import type { ApplicationErrorCode } from './Primitives'

export type AnySchema = Schema.Top

export type MethodDefinition<
  Params extends AnySchema = AnySchema,
  Result extends AnySchema = AnySchema,
  Errors extends readonly ApplicationErrorCode[] = readonly ApplicationErrorCode[],
> = {
  readonly params: Params
  readonly result: Result
  readonly errors: Errors
  readonly capability: CapabilityRequirement
  readonly mutation: boolean
  readonly exactParams?: boolean
  readonly exactResult?: boolean
}

export type MethodMap = Record<string, MethodDefinition>

export const defineMethod = <const Definition extends MethodDefinition>(
  definition: Definition,
): Definition & MethodDefinition => definition

export type ServerRequestDefinition<
  Params extends AnySchema = AnySchema,
  Result extends AnySchema = AnySchema,
> = {
  readonly params: Params
  readonly result: Result
  readonly capability: ProtocolCapability
}

export type ServerRequestDefinitionMap = Record<string, ServerRequestDefinition>

export const defineServerRequest = <const Definition extends ServerRequestDefinition>(
  definition: Definition,
): Definition & ServerRequestDefinition => definition

export type EventDefinition<
  Payload extends AnySchema = AnySchema,
  Durability extends 'durable' | 'live' = 'durable' | 'live',
> = {
  readonly payload: Payload
  readonly version: number
  readonly durability: Durability
  readonly stream: 'global' | 'thread'
  readonly capability: ProtocolCapability
  readonly reconcilesWith?: string
}

export type EventMap = Record<string, EventDefinition>

export const defineEvent = <const Definition extends EventDefinition>(
  definition: Definition,
): Definition & EventDefinition => definition

export type ParamsOf<Definition extends MethodDefinition> = Schema.Schema.Type<Definition['params']>
export type ResultOf<Definition extends MethodDefinition> = Schema.Schema.Type<Definition['result']>
export type ServerRequestParamsOf<Definition extends ServerRequestDefinition> = Schema.Schema.Type<
  Definition['params']
>
export type ServerRequestResultOf<Definition extends ServerRequestDefinition> = Schema.Schema.Type<
  Definition['result']
>
export type EventPayloadOf<Definition extends EventDefinition> = Schema.Schema.Type<
  Definition['payload']
>
