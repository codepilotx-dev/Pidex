import {
  AutomationExecutionSchema,
  AutomationKindSchema,
  AutomationNotificationPolicySchema,
  AutomationRunSchema,
  AutomationScheduleSchema,
  AutomationSchema,
  AutomationStatusSchema,
} from '@pidex/shared/automation'
import { ModelRefSchema } from '@pidex/shared/model'
import { PermissionConfigSchema } from '@pidex/shared/thread'
import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { LimitSchema, NonEmptyStringSchema, OpaqueIDSchema } from '../wire/Primitives'

const AutomationErrors = [
  'AUTOMATION_NOT_FOUND',
  'AUTOMATION_RUN_NOT_FOUND',
  'PROJECT_NOT_FOUND',
  'PROJECT_REMOVED',
  'THREAD_NOT_FOUND',
  'MODEL_UNAVAILABLE',
  'WORKTREE_BRANCH_NOT_FOUND',
  'OPERATION_ID_CONFLICT',
  'PERMISSION_DENIED',
  'CONFLICT',
  'INVALID_REQUEST',
  'INTERNAL_ERROR',
] as const

const PositiveRevisionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const AutomationDefinitionFields = {
  kind: AutomationKindSchema,
  name: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema,
  projectId: Schema.NullOr(OpaqueIDSchema),
  targetThreadId: Schema.NullOr(OpaqueIDSchema),
  execution: Schema.NullOr(AutomationExecutionSchema),
  model: ModelRefSchema,
  reasoningEffort: Schema.NullOr(NonEmptyStringSchema),
  permissionConfig: PermissionConfigSchema,
  schedule: AutomationScheduleSchema,
  timeZone: NonEmptyStringSchema,
  notificationPolicy: AutomationNotificationPolicySchema,
} as const

export const AutomationCreateParamsSchema = Schema.Struct({
  operationId: OpaqueIDSchema,
  ...AutomationDefinitionFields,
})
export type AutomationCreateParams = typeof AutomationCreateParamsSchema.Type

export const AutomationUpdateParamsSchema = Schema.Struct({
  automationId: OpaqueIDSchema,
  expectedRevision: PositiveRevisionSchema,
  kind: Schema.optional(AutomationKindSchema),
  name: Schema.optional(NonEmptyStringSchema),
  prompt: Schema.optional(NonEmptyStringSchema),
  projectId: Schema.optional(Schema.NullOr(OpaqueIDSchema)),
  targetThreadId: Schema.optional(Schema.NullOr(OpaqueIDSchema)),
  execution: Schema.optional(Schema.NullOr(AutomationExecutionSchema)),
  model: Schema.optional(ModelRefSchema),
  reasoningEffort: Schema.optional(Schema.NullOr(NonEmptyStringSchema)),
  permissionConfig: Schema.optional(PermissionConfigSchema),
  schedule: Schema.optional(AutomationScheduleSchema),
  timeZone: Schema.optional(NonEmptyStringSchema),
  notificationPolicy: Schema.optional(AutomationNotificationPolicySchema),
  status: Schema.optional(AutomationStatusSchema),
})
export type AutomationUpdateParams = typeof AutomationUpdateParamsSchema.Type

export const AutomationSchedulePreviewSchema = Schema.Struct({
  canonicalRrule: NonEmptyStringSchema,
  summary: NonEmptyStringSchema,
  nextRunAt: Schema.Array(Schema.Number),
})
export type AutomationSchedulePreview = typeof AutomationSchedulePreviewSchema.Type

export const AutomationRpcMethods = {
  'automation/list': defineMethod({
    params: Schema.Struct({
      statuses: Schema.optional(Schema.Array(AutomationStatusSchema)),
      query: Schema.optional(Schema.String),
    }),
    result: Schema.Struct({ automations: Schema.Array(AutomationSchema) }),
    errors: AutomationErrors,
    capability: 'automation.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'automation/read': defineMethod({
    params: Schema.Struct({ automationId: OpaqueIDSchema }),
    result: Schema.Struct({ automation: AutomationSchema }),
    errors: AutomationErrors,
    capability: 'automation.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'automation/create': defineMethod({
    params: AutomationCreateParamsSchema,
    result: Schema.Struct({ automation: AutomationSchema }),
    errors: AutomationErrors,
    capability: 'automation.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'automation/update': defineMethod({
    params: AutomationUpdateParamsSchema,
    result: Schema.Struct({ automation: AutomationSchema }),
    errors: AutomationErrors,
    capability: 'automation.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'automation/delete': defineMethod({
    params: Schema.Struct({
      automationId: OpaqueIDSchema,
      expectedRevision: PositiveRevisionSchema,
    }),
    result: Schema.Struct({ automation: AutomationSchema }),
    errors: AutomationErrors,
    capability: 'automation.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'automation/run': defineMethod({
    params: Schema.Struct({ automationId: OpaqueIDSchema, operationId: OpaqueIDSchema }),
    result: Schema.Struct({ run: AutomationRunSchema }),
    errors: AutomationErrors,
    capability: 'automation.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'automation/run/list': defineMethod({
    params: Schema.Struct({
      automationId: Schema.optional(OpaqueIDSchema),
      unreadOnly: Schema.optional(Schema.Boolean),
      limit: Schema.optional(LimitSchema),
    }),
    result: Schema.Struct({ runs: Schema.Array(AutomationRunSchema) }),
    errors: AutomationErrors,
    capability: 'automation.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'automation/run/mark-read': defineMethod({
    params: Schema.Struct({ runId: OpaqueIDSchema }),
    result: Schema.Struct({ run: AutomationRunSchema }),
    errors: AutomationErrors,
    capability: 'automation.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'automation/run/mark-all-read': defineMethod({
    params: Schema.Struct({ automationId: Schema.optional(OpaqueIDSchema) }),
    result: Schema.Struct({ updatedCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
    errors: AutomationErrors,
    capability: 'automation.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'automation/schedule/preview': defineMethod({
    params: Schema.Struct({
      schedule: AutomationScheduleSchema,
      timeZone: NonEmptyStringSchema,
      count: Schema.optional(LimitSchema),
    }),
    result: Schema.Struct({ preview: AutomationSchedulePreviewSchema }),
    errors: AutomationErrors,
    capability: 'automation.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type AutomationRpcMethodMap = typeof AutomationRpcMethods
