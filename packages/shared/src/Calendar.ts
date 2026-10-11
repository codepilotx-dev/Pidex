import { Schema } from 'effect'

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))

export const CalendarSourceKindSchema = Schema.Literals(['scheduled-task', 'automation'])
export type CalendarSourceKind = typeof CalendarSourceKindSchema.Type

export const CalendarSourceRefSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('scheduled-task'), id: NonEmptyStringSchema }),
  Schema.Struct({ kind: Schema.Literal('automation'), id: NonEmptyStringSchema }),
])
export type CalendarSourceRef = typeof CalendarSourceRefSchema.Type

export const CalendarOccurrenceStatusSchema = Schema.Literals([
  'scheduled',
  'paused',
  'claimed',
  'preparing',
  'queued',
  'running',
  'completed',
  'failed',
  'interrupted',
])
export type CalendarOccurrenceStatus = typeof CalendarOccurrenceStatusSchema.Type

export const CalendarOccurrenceSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  source: CalendarSourceRefSchema,
  definitionKind: Schema.Literals(['one-off', 'recurring']),
  title: NonEmptyStringSchema,
  scheduledFor: Schema.Number,
  status: CalendarOccurrenceStatusSchema,
  runId: Schema.NullOr(NonEmptyStringSchema),
  threadId: Schema.NullOr(NonEmptyStringSchema),
  proposalId: Schema.NullOr(NonEmptyStringSchema),
})
export type CalendarOccurrence = typeof CalendarOccurrenceSchema.Type
