import { Schema } from 'effect'
import {
  AutomationExecutionSchema,
  AutomationKindSchema,
  AutomationNotificationPolicySchema,
  AutomationScheduleSchema,
} from './Automation'
import { CalendarSourceRefSchema } from './Calendar'
import { ModelRefSchema } from './Model'
import { StructuredPlanSchema } from './thread/Items'
import { PermissionConfigSchema } from './thread/Permission'

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))
const PositiveIntegerSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

/** 任务计划正文的来源，用于说明快照是从哪里固定下来的。 */
export const ScheduleTaskPlanSourceSchema = Schema.Literals([
  'current-plan-item',
  'pasted-text',
  'file',
])
export type ScheduleTaskPlanSource = typeof ScheduleTaskPlanSourceSchema.Type

/**
 * 固定的任务计划快照。一经确认就保持不变：原聊天或源文件后续变化都不会替换它，
 * `contentHash` 用于证明固定下来的正文没有被改写。
 */
export const ScheduleTaskPlanSchema = Schema.Struct({
  source: ScheduleTaskPlanSourceSchema,
  /** 当前计划项 ID、或用户在消息中给出的文件路径；粘贴正文时为 null。 */
  sourceRef: Schema.NullOr(NonEmptyStringSchema),
  contentHash: NonEmptyStringSchema,
  structured: StructuredPlanSchema,
})
export type ScheduleTaskPlan = typeof ScheduleTaskPlanSchema.Type

export const ScheduleOnceTriggerSchema = Schema.Struct({
  kind: Schema.Literal('once'),
  at: Schema.Number,
  timeZone: NonEmptyStringSchema,
})

export const ScheduleRecurringTriggerSchema = Schema.Struct({
  kind: Schema.Literal('recurring'),
  schedule: AutomationScheduleSchema,
  timeZone: NonEmptyStringSchema,
})

/** 内部事件触发：引用确认后的具体任务身份，不接外部事件。 */
export const ScheduleTaskSucceededTriggerSchema = Schema.Struct({
  kind: Schema.Literal('task-succeeded'),
  taskId: NonEmptyStringSchema,
})

export const ScheduleAcceptancePassedTriggerSchema = Schema.Struct({
  kind: Schema.Literal('acceptance-passed'),
  taskId: NonEmptyStringSchema,
})

export const ScheduleTriggerSchema = Schema.Union([
  ScheduleOnceTriggerSchema,
  ScheduleRecurringTriggerSchema,
  ScheduleTaskSucceededTriggerSchema,
  ScheduleAcceptancePassedTriggerSchema,
])
export type ScheduleTrigger = typeof ScheduleTriggerSchema.Type

/** 执行前提条件；“执行成功 / 验收通过”触发的实例也要先满足这些条件。 */
export const ScheduleConditionsSchema = Schema.Struct({
  /** 确认后的任务 ID；提交时校验存在并拒绝循环依赖。 */
  dependsOn: Schema.Array(NonEmptyStringSchema),
  requireEnvironment: Schema.Boolean,
  notBefore: Schema.NullOr(Schema.Number),
  deadline: Schema.NullOr(Schema.Number),
})
export type ScheduleConditions = typeof ScheduleConditionsSchema.Type

/** 条件不满足时的处理：跳过本次，或等待并随调度统一重查。 */
export const ScheduleConditionFallbackSchema = Schema.Literals(['skip', 'wait'])
export type ScheduleConditionFallback = typeof ScheduleConditionFallbackSchema.Type

/**
 * 自动验收只支持宿主可验证的标准。自然语言外观、体验或主观质量标准必须规划为
 * 人工验收，不能伪装成自动检查。
 */
export const ScheduleAutomaticCheckSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('file-exists'), path: NonEmptyStringSchema }),
  Schema.Struct({
    kind: Schema.Literal('document-section'),
    path: NonEmptyStringSchema,
    section: NonEmptyStringSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('command-exit-code'),
    command: NonEmptyStringSchema,
    expectedExitCode: Schema.Int,
  }),
])
export type ScheduleAutomaticCheck = typeof ScheduleAutomaticCheckSchema.Type

export const ScheduleAcceptanceSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('manual') }),
  Schema.Struct({
    kind: Schema.Literal('automatic'),
    checks: Schema.Array(ScheduleAutomaticCheckSchema).check(Schema.isMinLength(1)),
  }),
])
export type ScheduleAcceptance = typeof ScheduleAcceptanceSchema.Type

/** 时间到期但程序未运行时：周期任务沿用合并补跑，一次性任务可跳过。 */
export const ScheduleMissedRunPolicySchema = Schema.Literals(['catch-up', 'skip'])
export type ScheduleMissedRunPolicy = typeof ScheduleMissedRunPolicySchema.Type

export const ScheduleExecutionSchema = Schema.Struct({
  kind: AutomationKindSchema,
  projectId: Schema.NullOr(NonEmptyStringSchema),
  targetThreadId: Schema.NullOr(NonEmptyStringSchema),
  environment: Schema.NullOr(AutomationExecutionSchema),
  model: ModelRefSchema,
  reasoningEffort: Schema.NullOr(NonEmptyStringSchema),
  permissionConfig: PermissionConfigSchema,
})
export type ScheduleExecution = typeof ScheduleExecutionSchema.Type

export const ScheduleDraftStatusSchema = Schema.Literals(['pending', 'committed', 'cancelled'])
export type ScheduleDraftStatus = typeof ScheduleDraftStatusSchema.Type

/**
 * 任务计划 + 执行安排的单份草案。确认前不激活任何调度：只有
 * `schedule-draft/commit` 会原子保存安排并创建任务。
 */
export const ScheduleDraftSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  revision: PositiveIntegerSchema,
  threadId: NonEmptyStringSchema,
  turnId: NonEmptyStringSchema,
  toolCallId: NonEmptyStringSchema,
  status: ScheduleDraftStatusSchema,
  name: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema,
  taskPlan: ScheduleTaskPlanSchema,
  trigger: ScheduleTriggerSchema,
  conditions: ScheduleConditionsSchema,
  conditionFallback: ScheduleConditionFallbackSchema,
  acceptance: ScheduleAcceptanceSchema,
  notificationPolicy: AutomationNotificationPolicySchema,
  missedRuns: ScheduleMissedRunPolicySchema,
  execution: ScheduleExecutionSchema,
  createdRefs: Schema.Array(CalendarSourceRefSchema),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  committedAt: Schema.NullOr(Schema.Number),
})
export type ScheduleDraft = typeof ScheduleDraftSchema.Type
