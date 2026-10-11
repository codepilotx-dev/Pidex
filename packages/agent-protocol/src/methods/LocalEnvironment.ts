import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { JsonValueSchema, NonEmptyStringSchema, OpaqueIDSchema } from '../wire/Primitives'

const Sha256Schema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
const EnvironmentRevisionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const ConfigKeyPathSchema = Schema.Array(
  Schema.Union([NonEmptyStringSchema, Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))]),
).check(Schema.isMinLength(1))

export const LocalEnvironmentActionMetadataSchema = Schema.Struct({
  name: NonEmptyStringSchema,
  icon: Schema.optional(NonEmptyStringSchema),
  availability: Schema.Literals(['available', 'unsupported-platform']),
})

export const LocalEnvironmentReadParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
})

export const LocalEnvironmentReadResultSchema = Schema.Struct({
  exists: Schema.Boolean,
  filePath: NonEmptyStringSchema,
  gitRoot: NonEmptyStringSchema,
  revision: Sha256Schema,
  configHash: Sha256Schema,
  config: Schema.Record(Schema.String, JsonValueSchema),
  executionTrusted: Schema.Boolean,
})

export const LocalEnvironmentUpdateParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  expectedRevision: Sha256Schema,
  edits: Schema.optional(
    Schema.Array(
      Schema.Struct({
        keyPath: ConfigKeyPathSchema,
        value: JsonValueSchema,
      }),
    ).check(Schema.isMinLength(1)),
  ),
  trust: Schema.optional(
    Schema.Struct({
      configHash: Sha256Schema,
      decision: Schema.Literals(['allow', 'revoke']),
    }),
  ),
}).check(
  Schema.makeFilter((value) => value.edits !== undefined || value.trust !== undefined, {
    expected: 'at least one of edits or trust',
  }),
)

export const LocalEnvironmentUpdateResultSchema = Schema.Struct({
  filePath: NonEmptyStringSchema,
  revision: Sha256Schema,
  configHash: Sha256Schema,
  executionTrusted: Schema.Boolean,
})

export const LocalEnvironmentActionListParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
})

export const LocalEnvironmentActionListResultSchema = Schema.Struct({
  revision: Sha256Schema,
  actions: Schema.Array(LocalEnvironmentActionMetadataSchema),
})

export const TerminalHostEnvironmentParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
})

export const TerminalHostEnvironmentResultSchema = Schema.Struct({
  revision: EnvironmentRevisionSchema,
  set: Schema.Record(NonEmptyStringSchema, Schema.String),
  unset: Schema.Array(NonEmptyStringSchema),
})

export const TerminalHostActionResolveParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  actionName: NonEmptyStringSchema,
})

export const TerminalHostActionResolveResultSchema = Schema.Struct({
  contextVersion: NonEmptyStringSchema,
  environmentRevision: EnvironmentRevisionSchema,
  command: NonEmptyStringSchema,
})

const LocalEnvironmentErrors = [
  'PROJECT_NOT_FOUND',
  'LOCAL_ENVIRONMENT_NOT_GIT',
  'LOCAL_ENVIRONMENT_INVALID',
  'LOCAL_ENVIRONMENT_CONFLICT',
  'LOCAL_ENVIRONMENT_UNTRUSTED',
  'LOCAL_ENVIRONMENT_ACTION_NOT_FOUND',
  'LOCAL_ENVIRONMENT_PLATFORM_UNSUPPORTED',
  'PERMISSION_DENIED',
  'INTERNAL_ERROR',
] as const

export const LocalEnvironmentRpcMethods = {
  'local-environment/project/list': defineMethod({
    params: Schema.Struct({ projectId: OpaqueIDSchema }),
    result: Schema.Struct({
      environments: Schema.Array(
        Schema.Struct({
          id: OpaqueIDSchema,
          name: Schema.String,
          path: NonEmptyStringSchema,
          inherited: Schema.Boolean,
          exists: Schema.Boolean,
          invalid: Schema.Boolean,
        }),
      ),
      selectedEnvironmentId: Schema.NullOr(OpaqueIDSchema),
    }),
    errors: LocalEnvironmentErrors,
    capability: 'local-environment.multiple.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'local-environment/project/read': defineMethod({
    params: Schema.Struct({ projectId: OpaqueIDSchema, environmentId: OpaqueIDSchema }),
    result: LocalEnvironmentReadResultSchema,
    errors: LocalEnvironmentErrors,
    capability: 'local-environment.multiple.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'local-environment/project/create': defineMethod({
    params: Schema.Struct({ projectId: OpaqueIDSchema, name: NonEmptyStringSchema }),
    result: Schema.Struct({ environmentId: OpaqueIDSchema }),
    errors: LocalEnvironmentErrors,
    capability: 'local-environment.multiple.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'local-environment/project/update': defineMethod({
    params: Schema.Struct({
      projectId: OpaqueIDSchema,
      environmentId: OpaqueIDSchema,
      expectedRevision: Sha256Schema,
      edits: Schema.optional(
        Schema.Array(Schema.Struct({ keyPath: ConfigKeyPathSchema, value: JsonValueSchema })).check(
          Schema.isMinLength(1),
        ),
      ),
      trust: Schema.optional(
        Schema.Struct({ configHash: Sha256Schema, decision: Schema.Literals(['allow', 'revoke']) }),
      ),
    }).check(
      Schema.makeFilter((value) => value.edits !== undefined || value.trust !== undefined, {
        expected: 'edits or trust',
      }),
    ),
    result: LocalEnvironmentUpdateResultSchema,
    errors: LocalEnvironmentErrors,
    capability: 'local-environment.multiple.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'local-environment/project/select': defineMethod({
    params: Schema.Struct({ projectId: OpaqueIDSchema, environmentId: OpaqueIDSchema }),
    result: Schema.Void,
    errors: LocalEnvironmentErrors,
    capability: 'local-environment.multiple.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'local-environment/project/delete': defineMethod({
    params: Schema.Struct({
      projectId: OpaqueIDSchema,
      environmentId: OpaqueIDSchema,
      expectedRevision: Sha256Schema,
    }),
    result: Schema.Void,
    errors: LocalEnvironmentErrors,
    capability: 'local-environment.multiple.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'local-environment/read': defineMethod({
    params: LocalEnvironmentReadParamsSchema,
    result: LocalEnvironmentReadResultSchema,
    errors: LocalEnvironmentErrors,
    capability: 'local-environment.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'local-environment/update': defineMethod({
    params: LocalEnvironmentUpdateParamsSchema,
    result: LocalEnvironmentUpdateResultSchema,
    errors: LocalEnvironmentErrors,
    capability: 'local-environment.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'local-environment/action/list': defineMethod({
    params: LocalEnvironmentActionListParamsSchema,
    result: LocalEnvironmentActionListResultSchema,
    errors: LocalEnvironmentErrors,
    capability: 'local-environment.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export const LocalEnvironmentHostRpcMethods = {
  'terminal/host/environment': defineMethod({
    params: TerminalHostEnvironmentParamsSchema,
    result: TerminalHostEnvironmentResultSchema,
    errors: LocalEnvironmentErrors,
    capability: 'terminal.host.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'terminal/host/action/resolve': defineMethod({
    params: TerminalHostActionResolveParamsSchema,
    result: TerminalHostActionResolveResultSchema,
    errors: LocalEnvironmentErrors,
    capability: 'terminal.host.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type LocalEnvironmentActionMetadata = typeof LocalEnvironmentActionMetadataSchema.Type
export type LocalEnvironmentReadResult = typeof LocalEnvironmentReadResultSchema.Type
export type LocalEnvironmentHostRpcMethodMap = typeof LocalEnvironmentHostRpcMethods
