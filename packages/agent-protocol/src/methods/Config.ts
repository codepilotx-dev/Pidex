import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { JsonValueSchema, NonEmptyStringSchema } from '../wire/Primitives'
const Sha256Schema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
const ConfigProfileIdSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,63}$/))
const ConfigScopeSchema = Schema.Literals(['user', 'profile', 'project'])
const ConfigLayerKindSchema = Schema.Literals(['defaults', 'user', 'profile', 'project'])
const ConfigObjectSchema = Schema.Record(Schema.String, JsonValueSchema)
const ConfigKeyPathSchema = Schema.Array(NonEmptyStringSchema).check(Schema.isMinLength(1))

export const ConfigDiagnosticSchema = Schema.Struct({
  severity: Schema.Literals(['warning', 'error']),
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
  scope: ConfigScopeSchema,
})

export const ConfigLayerSchema = Schema.Struct({
  kind: ConfigLayerKindSchema,
  displayName: NonEmptyStringSchema,
  filePath: Schema.optional(NonEmptyStringSchema),
  version: Sha256Schema,
  writable: Schema.Boolean,
  trusted: Schema.Boolean,
  config: ConfigObjectSchema,
})

export const ConfigEditSchema = Schema.Struct({
  keyPath: ConfigKeyPathSchema,
  value: JsonValueSchema,
  mergeStrategy: Schema.optional(Schema.Literals(['replace', 'upsert'])),
})

export const ConfigWriteTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('user') }),
  Schema.Struct({
    kind: Schema.Literal('profile'),
    profileId: NonEmptyStringSchema,
  }),
  Schema.Struct({ kind: Schema.Literal('project') }),
])

export const ConfigProfileStateSchema = Schema.Struct({
  activeProfile: Schema.NullOr(ConfigProfileIdSchema),
  selectedProfile: Schema.NullOr(ConfigProfileIdSchema),
  restartRequired: Schema.Boolean,
})

export const ConfigProfileSummarySchema = Schema.Struct({
  id: ConfigProfileIdSchema,
  displayName: NonEmptyStringSchema,
  description: Schema.optional(Schema.String),
  filePath: NonEmptyStringSchema,
  version: Sha256Schema,
  valid: Schema.Boolean,
  diagnostics: Schema.Array(ConfigDiagnosticSchema),
})

export const ConfigReadParamsSchema = Schema.Struct({
  includeLayers: Schema.optional(Schema.Boolean),
  cwd: Schema.optional(NonEmptyStringSchema),
})

export const ConfigReadResultSchema = Schema.Struct({
  config: ConfigObjectSchema,
  origins: Schema.Record(Schema.String, ConfigLayerKindSchema),
  layers: Schema.optional(Schema.Array(ConfigLayerSchema)),
  diagnostics: Schema.Array(ConfigDiagnosticSchema),
  profileState: ConfigProfileStateSchema,
})

export const ConfigWriteResultSchema = Schema.Struct({
  status: Schema.Literals(['ok', 'ok-overridden']),
  version: Sha256Schema,
  filePath: NonEmptyStringSchema,
  overridden: Schema.optional(
    Schema.Array(
      Schema.Struct({
        keyPath: ConfigKeyPathSchema,
        by: ConfigScopeSchema,
      }),
    ),
  ),
})

export const ConfigValueWriteParamsSchema = Schema.Struct({
  ...ConfigEditSchema.fields,
  filePath: Schema.optional(NonEmptyStringSchema),
  cwd: Schema.optional(NonEmptyStringSchema),
  expectedVersion: Schema.optional(Sha256Schema),
  target: Schema.optional(ConfigWriteTargetSchema),
})

export const ConfigBatchWriteParamsSchema = Schema.Struct({
  edits: Schema.Array(ConfigEditSchema).check(Schema.isMinLength(1)),
  filePath: Schema.optional(NonEmptyStringSchema),
  cwd: Schema.optional(NonEmptyStringSchema),
  expectedVersion: Schema.optional(Sha256Schema),
  reloadUserConfig: Schema.optional(Schema.Boolean),
  target: Schema.optional(ConfigWriteTargetSchema),
})

export const ConfigProfileSelectParamsSchema = Schema.Struct({
  profileId: Schema.NullOr(ConfigProfileIdSchema),
})

export const ConfigProfileListResultSchema = Schema.Struct({
  profileState: ConfigProfileStateSchema,
  profiles: Schema.Array(ConfigProfileSummarySchema),
  profilesDirectory: NonEmptyStringSchema,
})

export const ConfigProfileSelectResultSchema = Schema.Struct({
  ...ConfigWriteResultSchema.fields,
  profileState: ConfigProfileStateSchema,
})

export const ProjectTrustReadParamsSchema = Schema.Struct({
  cwd: NonEmptyStringSchema,
})

export const ProjectTrustReadResultSchema = Schema.Struct({
  projectRoot: NonEmptyStringSchema,
  trustLevel: Schema.Literals(['trusted', 'untrusted']),
  hasProjectConfig: Schema.Boolean,
})

export const ProjectTrustUpdateParamsSchema = Schema.Struct({
  cwd: NonEmptyStringSchema,
  trustLevel: Schema.Literals(['trusted', 'untrusted']),
  expectedVersion: Schema.optional(Sha256Schema),
})

const ConfigReadErrors = [
  'CONFIG_PATH_NOT_FOUND',
  'CONFIG_PROJECT_UNTRUSTED',
  'CONFIG_VALIDATION_ERROR',
  'CONFIG_PROFILE_INVALID',
  'CONFIG_PROFILE_NOT_FOUND',
] as const

const ConfigWriteErrors = [
  'CONFIG_LAYER_READONLY',
  'CONFIG_VERSION_CONFLICT',
  'CONFIG_VALIDATION_ERROR',
  'CONFIG_PATH_NOT_FOUND',
  'CONFIG_PROJECT_UNTRUSTED',
  'CONFIG_PROFILE_INVALID',
  'CONFIG_PROFILE_NOT_FOUND',
] as const

export const ConfigRpcMethods = {
  'config/read': defineMethod({
    params: ConfigReadParamsSchema,
    result: ConfigReadResultSchema,
    errors: ConfigReadErrors,
    capability: 'config.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'config/value/write': defineMethod({
    params: ConfigValueWriteParamsSchema,
    result: ConfigWriteResultSchema,
    errors: ConfigWriteErrors,
    capability: 'config.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'config/batchWrite': defineMethod({
    params: ConfigBatchWriteParamsSchema,
    result: ConfigWriteResultSchema,
    errors: ConfigWriteErrors,
    capability: 'config.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'config/profile/list': defineMethod({
    params: Schema.Record(Schema.String, Schema.Never),
    result: ConfigProfileListResultSchema,
    errors: ConfigReadErrors,
    capability: 'config.profiles.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'config/profile/select': defineMethod({
    params: ConfigProfileSelectParamsSchema,
    result: ConfigProfileSelectResultSchema,
    errors: ConfigWriteErrors,
    capability: 'config.profiles.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'project/trust/read': defineMethod({
    params: ProjectTrustReadParamsSchema,
    result: ProjectTrustReadResultSchema,
    errors: ConfigReadErrors,
    capability: 'config.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'project/trust/update': defineMethod({
    params: ProjectTrustUpdateParamsSchema,
    result: ConfigWriteResultSchema,
    errors: ConfigWriteErrors,
    capability: 'config.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type ConfigDiagnostic = typeof ConfigDiagnosticSchema.Type
export type ConfigLayer = typeof ConfigLayerSchema.Type
export type ConfigEdit = typeof ConfigEditSchema.Type
export type ConfigProfileState = typeof ConfigProfileStateSchema.Type
export type ConfigProfileSummary = typeof ConfigProfileSummarySchema.Type
