import { Schema } from 'effect'
import { StructuredPlanSchema } from './Items'

export const PlanApprovalSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  turnId: Schema.String,
  planItemId: Schema.String,
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  status: Schema.Literals(['pending', 'implemented', 'feedback', 'closed', 'superseded']),
  title: Schema.String,
  markdown: Schema.String,
  /** 与计划项共享同一结构化对象；历史审批缺少该字段时继续正常解码。 */
  structured: Schema.optional(StructuredPlanSchema),
  nextTurnId: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  resolvedAt: Schema.NullOr(Schema.Number),
})
export type PlanApproval = typeof PlanApprovalSchema.Type
