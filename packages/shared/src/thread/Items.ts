import { Model } from '@pidex/model-schema'
import { Option, Schema } from 'effect'
import {
  RESULT_CARD_ENVELOPE_KIND,
  RESULT_CARD_ENVELOPE_VERSION,
  RESULT_CARD_MAX_ITEMS,
  RESULT_CARD_MAX_REFERENCES,
  RESULT_CARD_MAX_SECTIONS,
  RESULT_CARD_TEXT_MAX_LENGTH,
  RESULT_CARD_TITLE_MAX_LENGTH,
} from '../ThreadResultCard'
import {
  AdditionalPermissionsSchema,
  PermissionConfigSchema,
  PermissionGrantScopeSchema,
  RiskCategorySchema,
  ShellInputSchema,
  ShellReviewSchema,
} from './Permission'
import { TaskModeSchema } from './Settings'
import {
  AgentExecutionSchema,
  SubagentProfileSchema,
  SubagentQueueReasonSchema,
  SubagentResultSchema,
  SubagentStatusSchema,
} from './Subagent'
import { TurnSchema } from './Schema'

export const InputDeliverySchema = Schema.Literals(['start', 'steer', 'follow-up'])
export type InputDelivery = typeof InputDeliverySchema.Type

export const InputOriginSchema = Schema.Literals(['user', 'goal-continuation'])
export type InputOrigin = typeof InputOriginSchema.Type

export const SkillSelectionSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  path: Schema.String.check(Schema.isMinLength(1)),
})
export type SkillSelection = typeof SkillSelectionSchema.Type

export const InputSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  turnId: Schema.NullOr(Schema.String),
  content: Schema.String,
  skills: Schema.optional(Schema.Array(SkillSelectionSchema)),
  delivery: InputDeliverySchema,
  origin: Schema.optional(InputOriginSchema),
  mode: TaskModeSchema,
  model: Model.Ref,
  permissionConfig: PermissionConfigSchema,
  attachmentIds: Schema.optional(Schema.Array(Schema.String)),
  contextReferenceIds: Schema.optional(Schema.Array(Schema.String)),
  state: Schema.Literals(['queued', 'merged', 'active', 'completed', 'cancelled']),
  createdAt: Schema.Number,
})
export type Input = typeof InputSchema.Type

export const MessageSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  turnId: Schema.NullOr(Schema.String),
  role: Schema.Literals(['user', 'assistant', 'system']),
  createdAt: Schema.Number,
})
export type Message = typeof MessageSchema.Type

export const ToolStateSchema = Schema.Literals([
  'pending',
  'waiting-permission',
  'running',
  'completed',
  'error',
  'interrupted',
])
export type ToolState = typeof ToolStateSchema.Type

/** Rich tool-result block projected from any provider protocol. */
export const ToolResultBlockSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('text'),
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal('citation'),
    title: Schema.optional(Schema.String),
    url: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal('json'),
    value: Schema.Json,
  }),
  Schema.Struct({
    type: Schema.Literal('artifact'),
    artifactId: Schema.String,
    name: Schema.String,
    mimeType: Schema.String,
    size: Schema.optional(Schema.Number),
  }),
])
export type ToolResultBlock = typeof ToolResultBlockSchema.Type

/**
 * Wire contract of the display-neutral result-card envelope that a tool result
 * may carry inside an existing `{ type: "json", value }` block. The envelope
 * adds no new block discriminator, so clients that do not know it keep showing
 * the raw JSON. Clients normalize and validate untrusted payloads with
 * `decodeResultCardEnvelope` from `@pidex/shared/thread-result-card`; this
 * schema is the strict shape those normalized envelopes must satisfy.
 */
export const ResultCardToneSchema = Schema.Literals(['neutral', 'success', 'warning', 'danger'])
/** Non-blank text: the normalizing decoder trims, this schema rejects blanks. */
const resultCardText = (maxLength: number) =>
  Schema.String.check(Schema.isPattern(/\S/)).check(Schema.isMaxLength(maxLength))
export const ResultCardItemSchema = Schema.Struct({
  label: resultCardText(RESULT_CARD_TITLE_MAX_LENGTH),
  value: Schema.optional(resultCardText(RESULT_CARD_TEXT_MAX_LENGTH)),
  tone: Schema.optional(ResultCardToneSchema),
})
export const ResultCardSectionSchema = Schema.Struct({
  title: resultCardText(RESULT_CARD_TITLE_MAX_LENGTH),
  items: Schema.Array(ResultCardItemSchema)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(RESULT_CARD_MAX_ITEMS)),
})
export const ResultCardReferenceSchema = Schema.Struct({
  kind: Schema.Literals(['file', 'url', 'thread', 'subagent']),
  value: resultCardText(RESULT_CARD_TEXT_MAX_LENGTH),
  label: Schema.optional(resultCardText(RESULT_CARD_TITLE_MAX_LENGTH)),
})
export const ResultCardEnvelopeSchema = Schema.Struct({
  kind: Schema.Literal(RESULT_CARD_ENVELOPE_KIND),
  version: Schema.Literal(RESULT_CARD_ENVELOPE_VERSION),
  card: Schema.Struct({
    title: resultCardText(RESULT_CARD_TITLE_MAX_LENGTH),
    summary: resultCardText(RESULT_CARD_TEXT_MAX_LENGTH),
    tone: ResultCardToneSchema,
    sections: Schema.Array(ResultCardSectionSchema).check(
      Schema.isMaxLength(RESULT_CARD_MAX_SECTIONS),
    ),
    references: Schema.Array(ResultCardReferenceSchema).check(
      Schema.isMaxLength(RESULT_CARD_MAX_REFERENCES),
    ),
  }),
})

export const ToolCompletionMetadataSchema = Schema.Struct({
  stopReason: Schema.optional(Schema.String),
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
})
export type ToolCompletionMetadata = typeof ToolCompletionMetadataSchema.Type

export const EditedFileSchema = Schema.Struct({
  path: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  patch: Schema.optional(Schema.String),
})
export type EditedFile = typeof EditedFileSchema.Type

export const QuestionChoiceSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.optional(Schema.String),
  recommended: Schema.Boolean,
})
export type QuestionChoice = typeof QuestionChoiceSchema.Type

const QuestionTextSchema = Schema.String.check(Schema.isMinLength(1))
export const InteractionQuestionChoiceSchema = Schema.Struct({
  id: QuestionTextSchema,
  label: QuestionTextSchema,
  description: QuestionTextSchema,
  recommended: Schema.Boolean,
})
export const InteractionQuestionSchema = Schema.Struct({
  id: QuestionTextSchema,
  header: QuestionTextSchema.check(Schema.isMaxLength(12)),
  prompt: QuestionTextSchema,
  choices: Schema.Array(InteractionQuestionChoiceSchema)
    .check(
      Schema.makeFilter((choices) => choices.length !== 1, {
        expected: 'zero or two to three choices',
      }),
    )
    .check(Schema.isMaxLength(3)),
  allowFreeform: Schema.Literal(true),
  required: Schema.Literal(true),
  minAnswers: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  maxAnswers: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
})
export const InteractionQuestionAnswerSchema = Schema.Struct({
  questionId: QuestionTextSchema,
  choiceIds: Schema.Array(QuestionTextSchema).check(Schema.isMaxLength(1)),
  text: Schema.optional(Schema.String),
  skipped: Schema.optional(Schema.Literal(true)),
})

/** 上下文来源分类；只用于展示占比，不是 token 账本。 */
export const ContextUsageBreakdownSourceSchema = Schema.Literals([
  'messages',
  'system_prompt',
  'system_tools',
  'mcp_tools',
  'skills',
  'memory',
  'project',
  'other',
])
export type ContextUsageBreakdownSource = typeof ContextUsageBreakdownSourceSchema.Type

/**
 * Agent 在模型请求前实测的来源字符量。各来源分别度量、互不叠加，
 * 占比按 chars 计算，不与同一条 usage 的 provider token 数换算。
 */
export const ContextUsageBreakdownEntrySchema = Schema.Struct({
  source: ContextUsageBreakdownSourceSchema,
  chars: Schema.Number,
})
export type ContextUsageBreakdownEntry = typeof ContextUsageBreakdownEntrySchema.Type

export const ModelUsageSchema = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  contextWindow: Schema.Number,
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  reasoning: Schema.Number,
  breakdown: Schema.optional(Schema.Array(ContextUsageBreakdownEntrySchema)),
})
export type ModelUsage = typeof ModelUsageSchema.Type

export const TextItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  type: Schema.Literal('text'),
  placement: Schema.Literals(['process', 'result']),
  text: Schema.String,
  status: Schema.Literals(['streaming', 'completed', 'interrupted']),
  usage: Schema.optional(ModelUsageSchema),
  /** Safe completion metadata reported by the provider for this response. */
  completion: Schema.optional(ToolCompletionMetadataSchema),
  ordinal: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
})
export type TextItem = typeof TextItemSchema.Type

export const ReasoningItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  type: Schema.Literal('reasoning'),
  text: Schema.String,
  status: Schema.Literals(['streaming', 'completed', 'interrupted']),
  ordinal: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
})
export type ReasoningItem = typeof ReasoningItemSchema.Type

export const ActivityCommandSchema = Schema.Struct({
  command: Schema.String,
  output: Schema.String,
  status: Schema.optional(Schema.Literals(['success', 'running', 'error', 'interrupted'])),
  truncated: Schema.optional(Schema.Boolean),
})
export type ActivityCommand = typeof ActivityCommandSchema.Type

export const ActivityItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  type: Schema.Literal('activity'),
  activity: Schema.Literals(['context-compression', 'file-edit', 'build', 'notice']),
  title: Schema.String,
  detail: Schema.optional(Schema.String),
  commands: Schema.optional(Schema.Array(ActivityCommandSchema)),
  status: Schema.Literals(['running', 'completed', 'error', 'interrupted']),
  ordinal: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
})
export type ActivityItem = typeof ActivityItemSchema.Type

export const ToolActivityTargetSchema = Schema.Struct({
  displayLabel: Schema.String,
  workspacePath: Schema.optional(Schema.String),
})
export type ToolActivityTarget = typeof ToolActivityTargetSchema.Type

export const ToolActivityFileChangeSchema = Schema.Struct({
  path: Schema.String,
  operation: Schema.Literals(['write', 'create', 'update', 'delete']),
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
})
export type ToolActivityFileChange = typeof ToolActivityFileChangeSchema.Type

/** Presentation-neutral semantic activity projected for tool timelines. */
export const ToolActivityDescriptorSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('read'),
    subject: Schema.Literals(['file', 'skill']),
    target: Schema.optional(ToolActivityTargetSchema),
  }),
  Schema.Struct({
    type: Schema.Literal('search'),
    query: Schema.optional(Schema.String),
    path: Schema.optional(ToolActivityTargetSchema),
    filesOnly: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal('list_files'),
    path: Schema.optional(ToolActivityTargetSchema),
  }),
  Schema.Struct({
    type: Schema.Literal('file_change'),
    changes: Schema.Array(ToolActivityFileChangeSchema),
  }),
  Schema.Struct({
    type: Schema.Literal('command'),
    kind: Schema.Literals([
      'generic',
      'format',
      'test',
      'lint',
      'noop',
      'current_time',
      'skill_script',
    ]),
    skillName: Schema.optional(Schema.String),
    scriptName: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal('web_search') }),
  Schema.Struct({
    type: Schema.Literal('integration'),
    source: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal('tool'),
    mode: Schema.Literals(['search', 'load', 'call']),
    name: Schema.optional(Schema.String),
  }),
])
export type ToolActivityDescriptor = typeof ToolActivityDescriptorSchema.Type

export const ToolItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  type: Schema.Literal('tool'),
  callID: Schema.String,
  tool: Schema.String,
  title: Schema.String,
  state: ToolStateSchema,
  input: Schema.Unknown,
  command: Schema.NullOr(Schema.String),
  output: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  durationMs: Schema.NullOr(Schema.Number),
  activity: Schema.optional(ToolActivityDescriptorSchema),
  mutationDiffPaths: Schema.optional(Schema.Array(Schema.String)),
  resultBlocks: Schema.optional(Schema.Array(ToolResultBlockSchema)),
  ordinal: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
})
export type ToolItem = typeof ToolItemSchema.Type

/** 结构化计划是 Plan 模式最终方案的权威表示，Markdown 只是它的确定性兼容投影。 */
export const STRUCTURED_PLAN_MAX_TITLE_LENGTH = 200
export const STRUCTURED_PLAN_MAX_TEXT_LENGTH = 4_000
export const STRUCTURED_PLAN_MAX_GROUPS = 20
export const STRUCTURED_PLAN_MAX_GROUP_ITEMS = 50
export const STRUCTURED_PLAN_MAX_LIST_ITEMS = 50

const structuredPlanText = (maxLength: number) =>
  Schema.String.check(Schema.isPattern(/\S/)).check(Schema.isMaxLength(maxLength))

export const StructuredPlanChangeSchema = Schema.Struct({
  area: structuredPlanText(STRUCTURED_PLAN_MAX_TITLE_LENGTH),
  items: Schema.Array(structuredPlanText(STRUCTURED_PLAN_MAX_TEXT_LENGTH))
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(STRUCTURED_PLAN_MAX_GROUP_ITEMS)),
})
export type StructuredPlanChange = typeof StructuredPlanChangeSchema.Type

const structuredPlanList = Schema.Array(structuredPlanText(STRUCTURED_PLAN_MAX_TEXT_LENGTH)).check(
  Schema.isMaxLength(STRUCTURED_PLAN_MAX_LIST_ITEMS),
)

/**
 * 固定领域 schema：模型只能提交内容，不能提交组件名、样式或任意 Renderer props。
 * `changes` 至少一组且每组至少一项；其余章节允许为空。
 */
export const StructuredPlanSchema = Schema.Struct({
  title: structuredPlanText(STRUCTURED_PLAN_MAX_TITLE_LENGTH),
  summary: structuredPlanText(STRUCTURED_PLAN_MAX_TEXT_LENGTH),
  changes: Schema.Array(StructuredPlanChangeSchema)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(STRUCTURED_PLAN_MAX_GROUPS)),
  interfaceChanges: structuredPlanList,
  tests: structuredPlanList,
  assumptions: structuredPlanList,
})
export type StructuredPlan = typeof StructuredPlanSchema.Type

const decodeStructuredPlanOption = Schema.decodeUnknownOption(StructuredPlanSchema, {
  onExcessProperty: 'error',
})

/** 校验存储或 RPC 中未知来源的结构化计划；非法对象返回 null，调用方回退到 Markdown。 */
export const decodeStructuredPlan = (value: unknown): StructuredPlan | null =>
  value === undefined || value === null ? null : Option.getOrNull(decodeStructuredPlanOption(value))

/** 结构化计划到 Markdown 的确定性投影，作为审批、复制和历史客户端的兼容表示。 */
export const formatStructuredPlanMarkdown = (plan: StructuredPlan): string => {
  const lines = [`# ${plan.title.trim()}`, '', plan.summary.trim(), '', '## 实现变更']
  for (const change of plan.changes) {
    lines.push(`### ${change.area.trim()}`)
    for (const item of change.items) lines.push(`- ${item.trim()}`)
  }
  const sections: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['接口变化', plan.interfaceChanges],
    ['测试', plan.tests],
    ['假设', plan.assumptions],
  ]
  for (const [heading, items] of sections) {
    if (items.length === 0) continue
    lines.push('', `## ${heading}`)
    for (const item of items) lines.push(`- ${item.trim()}`)
  }
  return lines.join('\n')
}

export const PlanItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  type: Schema.Literal('plan'),
  title: Schema.String,
  markdown: Schema.String,
  /** 新计划的结构化真源；历史纯 Markdown 计划缺少该字段时继续正常解码。 */
  structured: Schema.optional(StructuredPlanSchema),
  status: Schema.Literals(['streaming', 'completed', 'interrupted']),
  ordinal: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
})
export type PlanItem = typeof PlanItemSchema.Type

export const ExecutionPlanStepSchema = Schema.Struct({
  step: Schema.String,
  status: Schema.Literals(['pending', 'in_progress', 'completed']),
})
export type ExecutionPlanStep = typeof ExecutionPlanStepSchema.Type

export const ExecutionPlanItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  type: Schema.Literal('execution-plan'),
  explanation: Schema.optional(Schema.String),
  steps: Schema.Array(ExecutionPlanStepSchema),
  status: Schema.Literals(['streaming', 'completed', 'interrupted']),
  ordinal: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
})
export type ExecutionPlanItem = typeof ExecutionPlanItemSchema.Type

export const QuestionItemSchema = Schema.Struct({
  version: Schema.optional(Schema.Number),
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  type: Schema.Literal('question'),
  prompt: Schema.String,
  choices: Schema.Array(QuestionChoiceSchema),
  status: Schema.Literals(['pending', 'answered', 'ignored', 'cancelled']),
  answer: Schema.NullOr(Schema.String),
  questions: Schema.optional(Schema.Array(InteractionQuestionSchema)),
  answers: Schema.optional(Schema.Array(InteractionQuestionAnswerSchema)),
  toolCallId: Schema.optional(Schema.String),
  ordinal: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
})
export type QuestionItem = typeof QuestionItemSchema.Type

export const QuestionRequestSchema = QuestionItemSchema
export type QuestionRequest = typeof QuestionRequestSchema.Type

export const PatchItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  type: Schema.Literal('patch'),
  files: Schema.Array(EditedFileSchema),
  totalAdditions: Schema.Number,
  totalDeletions: Schema.Number,
  reversible: Schema.optional(Schema.Boolean),
  applyState: Schema.optional(Schema.Literals(['applied', 'undone'])),
  actionVersion: Schema.optional(Schema.Number),
  ordinal: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
})
export type PatchItem = typeof PatchItemSchema.Type

export const SubagentItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  type: Schema.Literal('subagent'),
  subagentTaskId: Schema.String,
  depth: Schema.optional(Schema.Number),
  waitingForDescendants: Schema.optional(Schema.Boolean),
  latestReport: Schema.optional(Schema.String),
  descendantCount: Schema.optional(Schema.Number),
  activeDescendantCount: Schema.optional(Schema.Number),
  runId: Schema.String,
  childThreadId: Schema.String,
  displayName: Schema.String,
  profile: SubagentProfileSchema,
  task: Schema.String,
  status: SubagentStatusSchema,
  queueReason: SubagentQueueReasonSchema,
  result: Schema.NullOr(SubagentResultSchema),
  ordinal: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
})
export type SubagentItem = typeof SubagentItemSchema.Type

export const ItemSchema = Schema.Union([
  TextItemSchema,
  ReasoningItemSchema,
  ActivityItemSchema,
  ToolItemSchema,
  PlanItemSchema,
  ExecutionPlanItemSchema,
  QuestionItemSchema,
  PatchItemSchema,
  SubagentItemSchema,
])
export type Item = typeof ItemSchema.Type

export const ToolAffectedPathSchema = Schema.Struct({
  path: Schema.String,
  operation: Schema.Literals(['create', 'update']),
})
export type ToolAffectedPath = typeof ToolAffectedPathSchema.Type

export const ToolReviewSummarySchema = Schema.Struct({
  fileCount: Schema.Number,
  hunkCount: Schema.Number,
  additions: Schema.Number,
  deletions: Schema.Number,
})
export type ToolReviewSummary = typeof ToolReviewSummarySchema.Type

export const ComputerAppApprovalSchema = Schema.Struct({
  name: Schema.String,
  allowPersistentApproval: Schema.Boolean,
})

export const ApprovalRequestSchema = Schema.Struct({
  grantOptions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        kind: Schema.Literals(['command', 'files', 'network', 'mcp', 'browser']),
        scope: Schema.Literals(['session', 'project', 'origin', 'all-sites']),
        label: Schema.String,
        requiresConfirmation: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
  toolIdentity: Schema.optional(Schema.Struct({ server: Schema.String, tool: Schema.String })),
  input: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  id: Schema.String,
  threadId: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  toolCallID: Schema.String,
  tool: Schema.String,
  command: Schema.NullOr(Schema.String),
  cwd: Schema.NullOr(Schema.String),
  paths: Schema.Array(Schema.String),
  affectedPaths: Schema.optional(Schema.Array(ToolAffectedPathSchema)),
  reviewSummary: Schema.optional(ToolReviewSummarySchema),
  computerApp: Schema.optional(ComputerAppApprovalSchema),
  requestedPermissions: AdditionalPermissionsSchema,
  review: Schema.NullOr(ShellReviewSchema),
  risk: Schema.Literals(['low', 'medium', 'high', 'critical']),
  reason: Schema.String,
  status: Schema.Literals(['pending', 'allowed', 'denied', 'cancelled']),
  createdAt: Schema.Number,
  // Optional dynamic permission-grant metadata for request_permissions; the
  // plain approval structure above stays untouched for ordinary approvals.
  permissionGrant: Schema.optional(
    Schema.Struct({
      requestedScope: PermissionGrantScopeSchema,
      allowedScopes: Schema.Array(PermissionGrantScopeSchema)
        .check(Schema.isMinLength(1))
        .check(Schema.isMaxLength(3)),
    }),
  ),
})
export type ApprovalRequest = typeof ApprovalRequestSchema.Type

export const AttachmentSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['text', 'image']),
  name: Schema.String,
  mediaType: Schema.String,
  sizeBytes: Schema.Number,
  sha256: Schema.String,
  createdAt: Schema.Number,
})
export type Attachment = typeof AttachmentSchema.Type

export const LocalContextReferenceSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  kind: Schema.Literals(['file', 'directory']),
  status: Schema.Literals(['available', 'missing']),
  createdAt: Schema.Number,
})
export type LocalContextReference = typeof LocalContextReferenceSchema.Type

export const ThreadTurnBundleSchema = Schema.Struct({
  turn: TurnSchema,
  inputs: Schema.Array(InputSchema),
  messages: Schema.Array(MessageSchema),
  agents: Schema.Array(AgentExecutionSchema),
  items: Schema.Array(ItemSchema),
  approvals: Schema.Array(ApprovalRequestSchema),
  attachments: Schema.Array(AttachmentSchema),
  contextReferences: Schema.optional(Schema.Array(LocalContextReferenceSchema)),
})
export type ThreadTurnBundle = typeof ThreadTurnBundleSchema.Type
