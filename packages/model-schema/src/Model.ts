export * as Model from './Model'

import { Schema } from 'effect'
import { Provider } from './Provider'
import { optional, statics } from './Schema'

export const ID = Schema.String.pipe(Schema.brand('Model.ID'))
export type ID = typeof ID.Type

export const VariantID = Schema.String.pipe(Schema.brand('Model.VariantID'))
export type VariantID = typeof VariantID.Type

export const Ref = Schema.Struct({
  providerID: Provider.ID,
  id: ID,
  variant: optional(VariantID),
}).annotate({ identifier: 'Model.Ref' })
export interface Ref extends Schema.Schema.Type<typeof Ref> {}

export const Family = Schema.String.pipe(Schema.brand('Model.Family'))
export type Family = typeof Family.Type

export interface Capabilities extends Schema.Schema.Type<typeof Capabilities> {}
export const Capabilities = Schema.Struct({
  tools: Schema.Boolean,
  input: Schema.Array(Schema.String),
  output: Schema.Array(Schema.String),
}).annotate({ identifier: 'Model.Capabilities' })

export interface Cost extends Schema.Schema.Type<typeof Cost> {}
export const Cost = Schema.Struct({
  tier: optional(
    Schema.Struct({
      type: Schema.Literal('context'),
      size: Schema.Int,
    }),
  ),
  input: Schema.Finite,
  output: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite,
    write: Schema.Finite,
  }),
}).annotate({ identifier: 'Model.Cost' })

export const Api = Schema.Union([
  Schema.Struct({
    id: ID,
    type: Schema.Literal('pi'),
    name: Schema.String,
    baseUrl: Schema.String,
  }),
])
  .pipe(Schema.toTaggedUnion('type'))
  .annotate({ identifier: 'Model.Api' })
export type Api = typeof Api.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  providerID: Provider.ID,
  family: optional(Family),
  name: Schema.String,
  api: Api,
  variant: optional(Schema.String),
  capabilities: Capabilities,
  variants: Schema.Array(
    Schema.Struct({
      id: VariantID,
    }),
  ),
  time: Schema.Struct({
    released: Schema.Finite,
  }),
  cost: Schema.Array(Cost),
  status: Schema.Literals(['alpha', 'beta', 'deprecated', 'active']),
  enabled: Schema.Boolean,
  limit: Schema.Struct({
    context: Schema.Int,
    input: optional(Schema.Int),
    output: Schema.Int,
  }),
})
  .annotate({ identifier: 'Model.Info' })
  .pipe(
    statics((schema) => ({
      empty: (providerID: Provider.ID, modelID: ID) =>
        schema.make({
          id: modelID,
          providerID,
          name: modelID,
          api: { id: modelID, type: 'pi', name: '', baseUrl: '' },
          capabilities: { tools: false, input: [], output: [] },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: 'active',
          enabled: true,
          limit: { context: 0, output: 0 },
        }),
    })),
  )
