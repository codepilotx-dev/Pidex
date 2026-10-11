import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { EmptyParamsSchema, NonNegativeIntSchema, OperationParamsSchema } from '../wire/Primitives'

export const ToolingIDSchema = Schema.Literals(['nodejs', 'python', 'git-bash', 'ripgrep'])
export const ToolingPreferenceSchema = Schema.Literals(['managed', 'system'])
export const ToolingSourceSchema = Schema.Literals(['managed', 'system'])
export const ToolingPhaseSchema = Schema.Literals([
  'idle',
  'detecting',
  'downloading',
  'installing',
  'ready',
  'error',
  'cleanup-pending',
])

export const ToolingStatusSchema = Schema.Struct({
  id: ToolingIDSchema,
  preference: ToolingPreferenceSchema,
  phase: ToolingPhaseSchema,
  activeSource: Schema.NullOr(ToolingSourceSchema),
  pinnedVersion: Schema.String,
  managed: Schema.Struct({
    installed: Schema.Boolean,
    version: Schema.NullOr(Schema.String),
  }),
  system: Schema.Struct({
    available: Schema.Boolean,
    version: Schema.NullOr(Schema.String),
    path: Schema.NullOr(Schema.String),
  }),
  progress: Schema.optional(
    Schema.Struct({
      receivedBytes: NonNegativeIntSchema,
      totalBytes: Schema.optional(NonNegativeIntSchema),
    }),
  ),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.String,
      message: Schema.String,
    }),
  ),
})

export const ToolingListResultSchema = Schema.Struct({
  statuses: Schema.Array(ToolingStatusSchema),
})
export const ToolingStatusResultSchema = Schema.Struct({
  status: ToolingStatusSchema,
})
export const ToolingSetPreferenceParamsSchema = Schema.Struct({
  id: ToolingIDSchema,
  preference: ToolingPreferenceSchema,
  ...OperationParamsSchema.fields,
})
export const ToolingInstallParamsSchema = Schema.Struct({
  id: ToolingIDSchema,
  force: Schema.optional(Schema.Boolean),
  ...OperationParamsSchema.fields,
})

const ToolingErrors = [
  'TOOLING_UNAVAILABLE',
  'TOOLING_INSTALL_FAILED',
  'TOOLING_DOWNLOAD_FAILED',
  'TOOLING_INTEGRITY_FAILED',
  'TOOLING_ABORTED',
  'PERMISSION_DENIED',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const

export const ToolingRpcMethods = {
  'tooling/list': defineMethod({
    params: EmptyParamsSchema,
    result: ToolingListResultSchema,
    errors: ToolingErrors,
    capability: 'tooling.management.v1',
    mutation: false,
    exactResult: true,
  }),
  'tooling/refresh': defineMethod({
    params: EmptyParamsSchema,
    result: ToolingListResultSchema,
    errors: ToolingErrors,
    capability: 'tooling.management.v1',
    mutation: false,
    exactResult: true,
  }),
  'tooling/setPreference': defineMethod({
    params: ToolingSetPreferenceParamsSchema,
    result: ToolingStatusResultSchema,
    errors: ToolingErrors,
    capability: 'tooling.management.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'tooling/install': defineMethod({
    params: ToolingInstallParamsSchema,
    result: ToolingStatusResultSchema,
    errors: ToolingErrors,
    capability: 'tooling.management.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type ToolingID = typeof ToolingIDSchema.Type
export type ToolingPreference = typeof ToolingPreferenceSchema.Type
export type ToolingSource = typeof ToolingSourceSchema.Type
export type ToolingPhase = typeof ToolingPhaseSchema.Type
export type ToolingStatus = typeof ToolingStatusSchema.Type
