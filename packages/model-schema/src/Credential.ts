export * as Credential from './Credential'

import { Schema } from 'effect'
import { NonNegativeInt, optional } from './Schema'

export const ID = Schema.String.pipe(Schema.brand('Credential.ID'))
export type ID = typeof ID.Type
export const MethodID = Schema.String.pipe(Schema.brand('Credential.MethodID'))
export type MethodID = typeof MethodID.Type

export interface OAuth extends Schema.Schema.Type<typeof OAuth> {}
export const OAuth = Schema.Struct({
  type: Schema.Literal('oauth'),
  methodID: MethodID,
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: 'Credential.OAuth' })

export interface Key extends Schema.Schema.Type<typeof Key> {}
export const Key = Schema.Struct({
  type: Schema.Literal('key'),
  key: Schema.String,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: 'Credential.Key' })

export const Value = Schema.Union([OAuth, Key])
  .pipe(Schema.toTaggedUnion('type'))
  .annotate({ identifier: 'Credential.Value' })
export type Value = Schema.Schema.Type<typeof Value>
