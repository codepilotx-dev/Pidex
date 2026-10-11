import { Model, Provider } from '@pidex/model-schema'
import { Schema } from 'effect'

export const ModelRefSchema = Model.Ref
export type ModelRef = typeof ModelRefSchema.Type

export const ModelInfoSchema = Model.Info
export type ModelInfo = typeof ModelInfoSchema.Type

export const ProviderInfoSchema = Provider.Info
export type ProviderInfo = typeof ProviderInfoSchema.Type

export const CatalogProviderSchema = Schema.Struct({
  provider: Provider.Info,
  models: Schema.Array(Model.Info),
})
export type CatalogProvider = typeof CatalogProviderSchema.Type

export const ModelCatalogSchema = Schema.Struct({
  providers: Schema.Array(CatalogProviderSchema),
  defaultModel: Schema.NullOr(Model.Ref),
  reviewerModel: Schema.NullOr(Model.Ref),
})
export type ModelCatalog = typeof ModelCatalogSchema.Type
