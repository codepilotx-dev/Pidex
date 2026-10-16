import { Schema } from 'effect'

export const ContextBudgetSchema = Schema.Struct({
  contextWindowTokens: Schema.Number,
  inputBudgetTokens: Schema.Number,
  outputReserveTokens: Schema.Number,
  usedTokens: Schema.Number,
  fixedTokens: Schema.optional(Schema.Number),
  triggerTokens: Schema.Number,
  targetTokens: Schema.Number,
  source: Schema.Literals(['measured', 'estimated', 'compaction-estimate']),
  sampledAt: Schema.Number,
})
export type ContextBudget = typeof ContextBudgetSchema.Type

export const ContextCompactionOperationSchema = Schema.Struct({
  operationId: Schema.String,
  threadId: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  trigger: Schema.Literals(['manual', 'automatic', 'reactive']),
  phase: Schema.Literals(['pre-request', 'mid-turn', 'settled']),
  status: Schema.Literals([
    'queued',
    'running',
    'completed',
    'skipped',
    'failed',
    'cancelled',
    'interrupted',
  ]),
  compactionId: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(
    Schema.Literals([
      'already-compacted',
      'no-content',
      'budget-exceeded',
      'provider-failed',
      'stopped',
      'restart',
      'target-unmet',
    ]),
  ),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type ContextCompactionOperation = typeof ContextCompactionOperationSchema.Type
export const ThreadContextStateSchema = Schema.Struct({
  budget: Schema.NullOr(ContextBudgetSchema),
  operation: Schema.NullOr(ContextCompactionOperationSchema),
})
export type ThreadContextState = typeof ThreadContextStateSchema.Type
