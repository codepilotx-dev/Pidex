import {
  WorkflowSchema,
  WorkflowMembershipSchema,
  WorkflowStepSchema,
  WorkflowContextEntrySchema,
  WorkflowContextStateSchema,
  WorkflowContextChangeSchema,
  WorkflowContextSectionSchema,
} from '@pidex/shared'
import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import {
  CursorSchema,
  LimitSchema,
  OpaqueIDSchema,
  OperationParamsSchema,
  TimestampSchema,
} from '../wire/Primitives'
import { SessionGroupStepDiffResultSchema } from './SessionGroup'

const VersionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const errors = [
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
const definition = <P extends Schema.Top, R extends Schema.Top>(
  params: P,
  result: R,
  mutation: boolean,
) =>
  defineMethod({
    params,
    result,
    errors,
    capability: 'workflow.v1',
    mutation,
    exactParams: true,
    exactResult: true,
  })

export const WorkflowRpcMethods = {
  'workflow/list': definition(
    Schema.Struct({
      query: Schema.optional(Schema.String),
      cursor: Schema.optional(CursorSchema),
      limit: Schema.optional(LimitSchema),
    }),
    Schema.Struct({
      workflows: Schema.Array(WorkflowSchema),
      nextCursor: Schema.NullOr(CursorSchema),
    }),
    false,
  ),
  'workflow/read': definition(
    Schema.Struct({ workflowId: OpaqueIDSchema }),
    Schema.Struct({
      workflow: WorkflowSchema,
      memberships: Schema.Array(WorkflowMembershipSchema),
    }),
    false,
  ),
  'workflow/create': definition(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optional(Schema.String),
      ...OperationParamsSchema.fields,
    }),
    Schema.Struct({ workflow: WorkflowSchema }),
    true,
  ),
  'workflow/update': definition(
    Schema.Struct({
      workflowId: OpaqueIDSchema,
      expectedVersion: VersionSchema,
      patch: Schema.Struct({
        name: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
      }),
      ...OperationParamsSchema.fields,
    }),
    Schema.Struct({ workflow: WorkflowSchema }),
    true,
  ),
  'workflow/delete': definition(
    Schema.Struct({
      workflowId: OpaqueIDSchema,
      expectedVersion: VersionSchema,
      ...OperationParamsSchema.fields,
    }),
    Schema.Struct({ workflowId: OpaqueIDSchema, deletedAt: TimestampSchema }),
    true,
  ),
  'workflow/membership/set': definition(
    Schema.Struct({
      threadId: OpaqueIDSchema,
      workflowId: Schema.NullOr(OpaqueIDSchema),
      ...OperationParamsSchema.fields,
    }),
    Schema.Struct({ membership: Schema.NullOr(WorkflowMembershipSchema) }),
    true,
  ),
  'workflow/context/read': definition(
    Schema.Struct({
      workflowId: OpaqueIDSchema,
      sections: Schema.optional(Schema.Array(WorkflowContextSectionSchema)),
    }),
    Schema.Struct({
      state: WorkflowContextStateSchema,
      entries: Schema.Array(WorkflowContextEntrySchema),
    }),
    false,
  ),
  'workflow/context/update': definition(
    Schema.Struct({
      workflowId: OpaqueIDSchema,
      expectedContextRevision: VersionSchema,
      changes: Schema.Array(WorkflowContextChangeSchema),
      ...OperationParamsSchema.fields,
    }),
    Schema.Struct({
      state: WorkflowContextStateSchema,
      entries: Schema.Array(WorkflowContextEntrySchema),
    }),
    true,
  ),
  'workflow/step/list': definition(
    Schema.Struct({
      workflowId: OpaqueIDSchema,
      cursor: Schema.optional(CursorSchema),
      limit: Schema.optional(LimitSchema),
    }),
    Schema.Struct({
      steps: Schema.Array(WorkflowStepSchema),
      nextCursor: Schema.NullOr(CursorSchema),
    }),
    false,
  ),
  'workflow/step/diff': definition(
    Schema.Struct({
      workflowId: OpaqueIDSchema,
      stepId: OpaqueIDSchema,
      path: Schema.optional(Schema.String),
    }),
    SessionGroupStepDiffResultSchema,
    false,
  ),
} as const satisfies MethodMap

export type WorkflowRpcMethodMap = typeof WorkflowRpcMethods
