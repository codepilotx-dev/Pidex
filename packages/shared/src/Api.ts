import { Model, Provider } from '@pidex/model-schema'
import { Schema } from 'effect'
import { CatalogProviderSchema } from './Model'

export const ProviderTestRequestSchema = Schema.Struct({
  providerID: Provider.ID,
})
export type ProviderTestRequest = typeof ProviderTestRequestSchema.Type

export const ProviderTestResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.optional(Schema.String),
})
export type ProviderTestResponse = typeof ProviderTestResponseSchema.Type

export const UpdateProviderSettingsRequestSchema = CatalogProviderSchema
export type UpdateProviderSettingsRequest = typeof UpdateProviderSettingsRequestSchema.Type

export const ProvidersResponseSchema = Schema.Struct({
  providers: Schema.Array(CatalogProviderSchema),
  defaultModel: Schema.NullOr(Model.Ref),
  reviewerModel: Schema.NullOr(Model.Ref),
})
export type ProvidersResponse = typeof ProvidersResponseSchema.Type

export const OkResponseSchema = Schema.Struct({ ok: Schema.Literal(true) })
export type OkResponse = typeof OkResponseSchema.Type

export const CatalogUpdatedNotificationSchema = ProvidersResponseSchema
export type CatalogUpdatedNotification = typeof CatalogUpdatedNotificationSchema.Type

export const ApiErrorSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
    details: Schema.optional(Schema.Unknown),
  }),
})
export type ApiError = typeof ApiErrorSchema.Type
