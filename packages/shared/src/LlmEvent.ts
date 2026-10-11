import { Schema } from 'effect'

const RunEventBase = {
  runID: Schema.String,
  createdAt: Schema.Number,
}

export const TextStartSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('text-start'),
  partID: Schema.String,
})
export const TextDeltaSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('text-delta'),
  partID: Schema.String,
  delta: Schema.String,
})
export const TextEndSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('text-end'),
  partID: Schema.String,
})

export const ReasoningStartSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('reasoning-start'),
  partID: Schema.String,
})
export const ReasoningDeltaSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('reasoning-delta'),
  partID: Schema.String,
  delta: Schema.String,
})
export const ReasoningEndSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('reasoning-end'),
  partID: Schema.String,
})

export const ToolInputStartSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('tool-input-start'),
  callID: Schema.String,
  tool: Schema.String,
})
export const ToolInputDeltaSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('tool-input-delta'),
  callID: Schema.String,
  delta: Schema.String,
})
export const ToolInputEndSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('tool-input-end'),
  callID: Schema.String,
})
export const ToolCallEventSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('tool-call'),
  callID: Schema.String,
  tool: Schema.String,
  input: Schema.Unknown,
})
export const ToolResultEventSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('tool-result'),
  callID: Schema.String,
  output: Schema.Unknown,
})
export const ToolErrorEventSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('tool-error'),
  callID: Schema.String,
  error: Schema.String,
})
export const StepStartSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('step-start'),
  step: Schema.Number,
})
export const StepFinishSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('step-finish'),
  step: Schema.Number,
  finishReason: Schema.String,
  hasToolCalls: Schema.Boolean,
})
export const FinishEventSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('finish'),
  finishReason: Schema.String,
  usage: Schema.optional(
    Schema.Struct({
      inputTokens: Schema.Number,
      outputTokens: Schema.Number,
      reasoningTokens: Schema.optional(Schema.Number),
    }),
  ),
})
export const ProviderErrorEventSchema = Schema.Struct({
  ...RunEventBase,
  type: Schema.Literal('provider-error'),
  providerID: Schema.String,
  code: Schema.optional(Schema.String),
  message: Schema.String,
  retryable: Schema.Boolean,
})

export const LLMEventSchema = Schema.Union([
  TextStartSchema,
  TextDeltaSchema,
  TextEndSchema,
  ReasoningStartSchema,
  ReasoningDeltaSchema,
  ReasoningEndSchema,
  ToolInputStartSchema,
  ToolInputDeltaSchema,
  ToolInputEndSchema,
  ToolCallEventSchema,
  ToolResultEventSchema,
  ToolErrorEventSchema,
  StepStartSchema,
  StepFinishSchema,
  FinishEventSchema,
  ProviderErrorEventSchema,
])
export type LLMEvent = typeof LLMEventSchema.Type
