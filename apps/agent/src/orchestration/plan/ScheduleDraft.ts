/**
 * submit_schedule_plan 的结构化提交契约：一次提交完整的「任务计划 + 执行安排」
 * 草案。模型可见参数、运行时校验与共享领域 schema 保持同一字段集合；持久化、
 * 版本确认与调度激活都由 SchedulePlanService 负责，本文件只做形状校验。
 */

import { Schema, SchemaIssue } from 'effect'
import {
  AutomationExecutionSchema,
  AutomationNotificationPolicySchema,
} from '@pidex/shared/automation'
import {
  ScheduleAcceptanceSchema,
  ScheduleConditionFallbackSchema,
  ScheduleConditionsSchema,
  ScheduleMissedRunPolicySchema,
  ScheduleTaskPlanSourceSchema,
  ScheduleTriggerSchema,
} from '@pidex/shared/schedule-draft'
import { StructuredPlanSchema } from '@pidex/shared/thread'
import { Type } from '@earendil-works/pi-ai'
import { AgentError } from '../../Domain'
import { structuredPlanParameters } from './StructuredPlan'

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))

export const scheduleDraftSubmissionSchema = Schema.Struct({
  name: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema,
  taskPlan: Schema.Struct({
    source: ScheduleTaskPlanSourceSchema,
    sourceRef: Schema.NullOr(NonEmptyStringSchema),
    structured: StructuredPlanSchema,
  }),
  trigger: ScheduleTriggerSchema,
  conditions: ScheduleConditionsSchema,
  conditionFallback: ScheduleConditionFallbackSchema,
  acceptance: ScheduleAcceptanceSchema,
  notificationPolicy: AutomationNotificationPolicySchema,
  missedRuns: ScheduleMissedRunPolicySchema,
  environment: Schema.NullOr(AutomationExecutionSchema),
})
export type ScheduleDraftSubmission = typeof scheduleDraftSubmissionSchema.Type

/** 共享领域 schema 的字段名，用于校验模型可见参数未遗漏或新增字段。 */
export const scheduleDraftDomainFields = Object.keys(scheduleDraftSubmissionSchema.fields).sort()

const decodeScheduleDraftSync = Schema.decodeUnknownSync(scheduleDraftSubmissionSchema, {
  onExcessProperty: 'error',
})

/**
 * 校验一次 submit_schedule_plan 提交。非法形状、空文本和额外字段都抛出模型
 * 可修正的安全错误；错误信息不回显字段值。
 */
export const parseScheduleDraft = (input: unknown): ScheduleDraftSubmission => {
  try {
    return decodeScheduleDraftSync(input) as ScheduleDraftSubmission
  } catch (error) {
    const details = Schema.isSchemaError(error)
      ? SchemaIssue.makeFormatterStandardSchemaV1({
          leafHook: (issue) =>
            issue._tag === 'MissingKey'
              ? '字段缺失'
              : issue._tag === 'UnexpectedKey'
                ? '未知字段'
                : '字段类型无效',
          checkHook: (issue) =>
            String(issue.filter.annotations?.expected ?? '字段为空或超出允许的长度/数量'),
        })(error.issue)
          .issues.map((issue) => {
            const path = (issue.path ?? [])
              .map((part) =>
                typeof part === 'number' || scheduleDraftDomainFields.includes(String(part))
                  ? String(part)
                  : '<unknown>',
              )
              .join('.')
            return `${path || 'scheduleDraft'}: ${issue.message}`
          })
          .join('；')
      : '字段缺失、为空或包含未知字段'
    throw new AgentError('INVALID_TOOL_INPUT', `任务规划草案参数无效：${details}`, 400)
  }
}

const timeZoneDescription = 'IANA 时区名，例如 Asia/Shanghai'

/**
 * submit_schedule_plan 的模型可见参数：只描述任务内容、触发、条件与验收，
 * 不开放项目、模型或权限字段——那些由宿主按当前聊天与设置填充。
 */
export const scheduleDraftParameters = Type.Object(
  {
    name: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: '\\S',
      description: '任务名称，用于日历与通知中的一行摘要',
    }),
    prompt: Type.String({
      minLength: 1,
      maxLength: 4000,
      pattern: '\\S',
      description: '执行提示：这个任务每次运行时要做什么',
    }),
    taskPlan: Type.Object(
      {
        source: Type.Union([
          Type.Literal('current-plan-item'),
          Type.Literal('pasted-text'),
          Type.Literal('file'),
        ], {
          description:
            '任务计划的来源：当前计划项、用户粘贴的正文，或用户指定的文件；用户已给出明确 Plan 时必须沿用该内容',
        }),
        sourceRef: Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
          description: '计划项 ID 或文件路径；粘贴正文时为 null',
        }),
        structured: structuredPlanParameters,
      },
      { additionalProperties: false, description: '作为固定快照保存的任务计划正文' },
    ),
    trigger: Type.Union(
      [
        Type.Object(
          {
            kind: Type.Literal('once'),
            at: Type.Number({ description: '一次性执行的毫秒时间戳' }),
            timeZone: Type.String({ minLength: 1, description: timeZoneDescription }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            kind: Type.Literal('recurring'),
            schedule: Type.Unsafe<Record<string, unknown>>({
              type: 'object',
              additionalProperties: true,
              description:
                '周期规则：{mode:"hourly",intervalMinutes} / {mode:"daily"|"weekdays",time:"HH:MM"} / {mode:"weekly",weekdays,time} / {mode:"custom",rrule}',
            }),
            timeZone: Type.String({ minLength: 1, description: timeZoneDescription }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            kind: Type.Literal('task-succeeded'),
            taskId: Type.String({ minLength: 1, description: '上游任务 ID' }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            kind: Type.Literal('acceptance-passed'),
            taskId: Type.String({ minLength: 1, description: '上游任务 ID' }),
          },
          { additionalProperties: false },
        ),
      ],
      { description: '触发方式：一次性时间、周期规则，或内部事件（上游任务执行成功 / 验收通过）' },
    ),
    conditions: Type.Object(
      {
        dependsOn: Type.Array(Type.String({ minLength: 1 }), {
          description: '依赖的已确认任务 ID；没有依赖就提交空数组',
        }),
        requireEnvironment: Type.Boolean({ description: '是否要求执行环境可用' }),
        notBefore: Type.Union([Type.Number(), Type.Null()], {
          description: '最早执行时间；不限制时为 null',
        }),
        deadline: Type.Union([Type.Number(), Type.Null()], {
          description: '截止时间；不限制时为 null',
        }),
      },
      { additionalProperties: false },
    ),
    conditionFallback: Type.Union([Type.Literal('skip'), Type.Literal('wait')], {
      description: '条件不满足时：跳过本次，或等待并重新检查',
    }),
    acceptance: Type.Union(
      [
        Type.Object({ kind: Type.Literal('manual') }, { additionalProperties: false }),
        Type.Object(
          {
            kind: Type.Literal('automatic'),
            checks: Type.Array(
              Type.Unsafe<Record<string, unknown>>({
                type: 'object',
                additionalProperties: true,
                description:
                  '可被宿主验证的检查：{kind:"file-exists",path} / {kind:"document-section",path,section} / {kind:"command-exit-code",command,expectedExitCode}',
              }),
              { minItems: 1, maxItems: 20 },
            ),
          },
          { additionalProperties: false },
        ),
      ],
      {
        description:
          '验收方式。只有宿主能实际验证的标准才用 automatic；外观、体验或主观质量必须用 manual',
      },
    ),
    notificationPolicy: Type.Union(
      [Type.Literal('all'), Type.Literal('failures'), Type.Literal('off')],
      { description: '通知策略' },
    ),
    missedRuns: Type.Union([Type.Literal('catch-up'), Type.Literal('skip')], {
      description: '错过执行时间且程序未运行时的处理：补跑一次，或跳过',
    }),
    environment: Type.Union(
      [
        Type.Object({ kind: Type.Literal('local') }, { additionalProperties: false }),
        Type.Object(
          {
            kind: Type.Literal('new-worktree'),
            branchName: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
        Type.Null(),
      ],
      { description: '执行环境；null 表示沿用默认（本地工作区）' },
    ),
  },
  {
    description:
      '任务计划与执行安排的完整草案。一次提交完整内容；提交成功只保存待审阅草案，不会安排或执行任务。',
    additionalProperties: false,
  },
)
