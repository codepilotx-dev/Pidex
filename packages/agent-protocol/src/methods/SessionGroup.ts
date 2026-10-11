import {
  SESSION_GROUP_CONTEXT_CONTENT_MAX_LENGTH,
  SESSION_GROUP_DESCRIPTION_MAX_LENGTH,
  SESSION_GROUP_NAME_MAX_LENGTH,
  SessionGroupContextChangeSchema,
  SessionGroupContextEntrySchema,
  SessionGroupContextSectionSchema,
  SessionGroupContextStateSchema,
  SessionGroupMembershipSchema,
  SessionGroupSchema,
  SessionGroupStepSchema,
} from '@pidex/shared/session-group'
import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import {
  CursorSchema,
  LimitSchema,
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  OpaqueIDSchema,
  OkResultSchema,
  OperationParamsSchema,
  TimestampSchema,
} from '../wire/Primitives'

const VersionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const GroupNameSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(SESSION_GROUP_NAME_MAX_LENGTH),
)
const GroupDescriptionSchema = Schema.String.check(
  Schema.isMaxLength(SESSION_GROUP_DESCRIPTION_MAX_LENGTH),
)

const SessionGroupErrors = [
  'SESSION_GROUP_NOT_FOUND',
  'SESSION_GROUP_STEP_NOT_FOUND',
  'SESSION_GROUP_CONTEXT_ENTRY_NOT_FOUND',
  'SESSION_GROUP_CONTEXT_REVISION_CONFLICT',
  'SESSION_GROUP_THREAD_BUSY',
  'THREAD_NOT_FOUND',
  'OPERATION_ID_CONFLICT',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const

export const SessionGroupListParamsSchema = Schema.Struct({
  query: Schema.optional(Schema.String),
  cursor: Schema.optional(CursorSchema),
  limit: Schema.optional(LimitSchema),
})
export const SessionGroupListResultSchema = Schema.Struct({
  groups: Schema.Array(SessionGroupSchema),
  nextCursor: Schema.NullOr(CursorSchema),
})

export const SessionGroupReadParamsSchema = Schema.Struct({ groupId: OpaqueIDSchema })
export const SessionGroupReadResultSchema = Schema.Struct({
  group: SessionGroupSchema,
  memberships: Schema.Array(SessionGroupMembershipSchema),
})

export const SessionGroupCreateParamsSchema = Schema.Struct({
  name: GroupNameSchema,
  description: Schema.optional(GroupDescriptionSchema),
  ...OperationParamsSchema.fields,
})

export const SessionGroupUpdateParamsSchema = Schema.Struct({
  groupId: OpaqueIDSchema,
  expectedVersion: VersionSchema,
  patch: Schema.Struct({
    name: Schema.optional(GroupNameSchema),
    description: Schema.optional(GroupDescriptionSchema),
  }),
  ...OperationParamsSchema.fields,
})

export const SessionGroupDeleteParamsSchema = Schema.Struct({
  groupId: OpaqueIDSchema,
  expectedVersion: VersionSchema,
  ...OperationParamsSchema.fields,
})
export const SessionGroupDeleteResultSchema = Schema.Struct({
  groupId: OpaqueIDSchema,
  deletedAt: TimestampSchema,
})

export const SessionGroupMembershipSetParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  groupId: Schema.NullOr(OpaqueIDSchema),
  ...OperationParamsSchema.fields,
})
export const SessionGroupMembershipSetResultSchema = Schema.Struct({
  membership: Schema.NullOr(SessionGroupMembershipSchema),
})

export const SessionGroupContextReadParamsSchema = Schema.Struct({
  groupId: OpaqueIDSchema,
  sections: Schema.optional(Schema.Array(SessionGroupContextSectionSchema)),
})
export const SessionGroupContextReadResultSchema = Schema.Struct({
  state: SessionGroupContextStateSchema,
  entries: Schema.Array(SessionGroupContextEntrySchema),
})

export const SessionGroupContextUpdateParamsSchema = Schema.Struct({
  groupId: OpaqueIDSchema,
  expectedContextRevision: VersionSchema,
  changes: Schema.Array(SessionGroupContextChangeSchema).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(10),
  ),
  ...OperationParamsSchema.fields,
})

export const SessionGroupStepListParamsSchema = Schema.Struct({
  groupId: OpaqueIDSchema,
  cursor: Schema.optional(CursorSchema),
  limit: Schema.optional(LimitSchema),
})
export const SessionGroupStepListResultSchema = Schema.Struct({
  steps: Schema.Array(SessionGroupStepSchema),
  nextCursor: Schema.NullOr(CursorSchema),
})

export const SessionGroupStepDiffParamsSchema = Schema.Struct({
  groupId: OpaqueIDSchema,
  stepId: OpaqueIDSchema,
  path: Schema.optional(NonEmptyStringSchema),
})
export const SessionGroupStepDiffHunkSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  header: NonEmptyStringSchema,
  oldStart: NonNegativeIntSchema,
  oldLines: NonNegativeIntSchema,
  newStart: NonNegativeIntSchema,
  newLines: NonNegativeIntSchema,
  patch: Schema.String,
})
export const SessionGroupStepDiffFileSchema = Schema.Struct({
  workspaceLabel: NonEmptyStringSchema,
  path: NonEmptyStringSchema,
  operation: Schema.Literals(['create', 'update', 'delete', 'rename']),
  patch: Schema.String,
  hunks: Schema.Array(SessionGroupStepDiffHunkSchema),
  renderable: Schema.Boolean,
  tooLargeReason: Schema.NullOr(Schema.Literals(['changed-lines', 'changed-bytes', 'line-bytes'])),
})
export const SessionGroupStepDiffResultSchema = Schema.Struct({
  stepId: OpaqueIDSchema,
  files: Schema.Array(SessionGroupStepDiffFileSchema),
})

export const SessionGroupRpcMethods = {
  'session-group/list': defineMethod({
    params: SessionGroupListParamsSchema,
    result: SessionGroupListResultSchema,
    errors: SessionGroupErrors,
    capability: 'session-group.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'session-group/read': defineMethod({
    params: SessionGroupReadParamsSchema,
    result: SessionGroupReadResultSchema,
    errors: SessionGroupErrors,
    capability: 'session-group.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'session-group/create': defineMethod({
    params: SessionGroupCreateParamsSchema,
    result: Schema.Struct({ group: SessionGroupSchema }),
    errors: SessionGroupErrors,
    capability: 'session-group.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'session-group/update': defineMethod({
    params: SessionGroupUpdateParamsSchema,
    result: Schema.Struct({ group: SessionGroupSchema }),
    errors: SessionGroupErrors,
    capability: 'session-group.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'session-group/delete': defineMethod({
    params: SessionGroupDeleteParamsSchema,
    result: SessionGroupDeleteResultSchema,
    errors: SessionGroupErrors,
    capability: 'session-group.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'session-group/membership/set': defineMethod({
    params: SessionGroupMembershipSetParamsSchema,
    result: SessionGroupMembershipSetResultSchema,
    errors: SessionGroupErrors,
    capability: 'session-group.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'session-group/context/read': defineMethod({
    params: SessionGroupContextReadParamsSchema,
    result: SessionGroupContextReadResultSchema,
    errors: SessionGroupErrors,
    capability: 'session-group.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'session-group/context/update': defineMethod({
    params: SessionGroupContextUpdateParamsSchema,
    result: SessionGroupContextReadResultSchema,
    errors: SessionGroupErrors,
    capability: 'session-group.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'session-group/step/list': defineMethod({
    params: SessionGroupStepListParamsSchema,
    result: SessionGroupStepListResultSchema,
    errors: SessionGroupErrors,
    capability: 'session-group.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'session-group/step/diff': defineMethod({
    params: SessionGroupStepDiffParamsSchema,
    result: SessionGroupStepDiffResultSchema,
    errors: SessionGroupErrors,
    capability: 'session-group.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type SessionGroupRpcMethodMap = typeof SessionGroupRpcMethods

// Keep these limits reachable from the protocol package for form validation.
export const SessionGroupWireLimits = {
  contextContent: SESSION_GROUP_CONTEXT_CONTENT_MAX_LENGTH,
  description: SESSION_GROUP_DESCRIPTION_MAX_LENGTH,
  name: SESSION_GROUP_NAME_MAX_LENGTH,
} as const
