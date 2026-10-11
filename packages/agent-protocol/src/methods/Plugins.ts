import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import {
  NonEmptyStringSchema,
  OperationParamsSchema,
  SequenceSchema,
  TimestampSchema,
} from '../wire/Primitives'

export const PluginSourceSchema = Schema.Literals(['bundled', 'workspace', 'personal', 'installed'])

export const PluginInstallationPolicySchema = Schema.Literals([
  'NOT_AVAILABLE',
  'AVAILABLE',
  'INSTALLED_BY_DEFAULT',
])

export const PluginStatusSchema = Schema.Literals(['ready', 'unavailable', 'invalid'])

export const PluginSummarySchema = Schema.Struct({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
  description: Schema.String,
  developerName: NonEmptyStringSchema,
  category: NonEmptyStringSchema,
  source: PluginSourceSchema,
  installationPolicy: PluginInstallationPolicySchema,
  installed: Schema.Boolean,
  enabled: Schema.Boolean,
  status: PluginStatusSchema,
  capabilities: Schema.Array(NonEmptyStringSchema),
  skills: Schema.Array(NonEmptyStringSchema),
  unavailableReason: Schema.optional(NonEmptyStringSchema),
})

export const PluginDetailSkillSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  description: Schema.String,
})

export const PluginDetailsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  longDescription: Schema.String,
  displayCapabilities: Schema.Array(NonEmptyStringSchema),
  defaultPrompts: Schema.Array(NonEmptyStringSchema),
  skills: Schema.Array(PluginDetailSkillSchema),
})

export const PluginListParamsSchema = Schema.Struct({
  workspace: Schema.optional(NonEmptyStringSchema),
  forceReload: Schema.optional(Schema.Boolean),
})

export const PluginListResultSchema = Schema.Struct({
  plugins: Schema.Array(PluginSummarySchema),
  generation: SequenceSchema,
  updatedAt: TimestampSchema,
})

export const PluginGetDetailsParamsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  workspace: Schema.optional(NonEmptyStringSchema),
})

export const PluginGetDetailsResultSchema = Schema.Struct({
  details: PluginDetailsSchema,
})

export const PluginSetEnabledParamsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  enabled: Schema.Boolean,
  ...OperationParamsSchema.fields,
})

export const PluginSetEnabledResultSchema = Schema.Struct({
  plugin: PluginSummarySchema,
  generation: SequenceSchema,
  updatedAt: TimestampSchema,
})

const PluginErrors = [
  'PLUGIN_NOT_FOUND',
  'PLUGIN_NOT_INSTALLED',
  'PLUGIN_INVALID',
  'CONFLICT',
  'PATH_DENIED',
  'INTERNAL_ERROR',
] as const

export const PluginRpcMethods = {
  'plugin/list': defineMethod({
    params: PluginListParamsSchema,
    result: PluginListResultSchema,
    errors: PluginErrors,
    capability: 'plugins.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'plugin/getDetails': defineMethod({
    params: PluginGetDetailsParamsSchema,
    result: PluginGetDetailsResultSchema,
    errors: PluginErrors,
    capability: 'plugins.details.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'plugin/setEnabled': defineMethod({
    params: PluginSetEnabledParamsSchema,
    result: PluginSetEnabledResultSchema,
    errors: PluginErrors,
    capability: 'plugins.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type PluginSource = typeof PluginSourceSchema.Type
export type PluginInstallationPolicy = typeof PluginInstallationPolicySchema.Type
export type PluginStatus = typeof PluginStatusSchema.Type
export type PluginSummary = typeof PluginSummarySchema.Type
export type PluginDetailSkill = typeof PluginDetailSkillSchema.Type
export type PluginDetails = typeof PluginDetailsSchema.Type
