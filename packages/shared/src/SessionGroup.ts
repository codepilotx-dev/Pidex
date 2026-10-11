import { Schema } from 'effect'

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))
const VersionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const NonNegativeIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const SESSION_GROUP_NAME_MAX_LENGTH = 120
export const SESSION_GROUP_DESCRIPTION_MAX_LENGTH = 4_000
export const SESSION_GROUP_DIGEST_MAX_LENGTH = 6_000
export const SESSION_GROUP_STEP_SUMMARY_MAX_LENGTH = 8_000
export const SESSION_GROUP_CONTEXT_TITLE_MAX_LENGTH = 120
export const SESSION_GROUP_CONTEXT_CONTENT_MAX_LENGTH = 2_000

export const SessionGroupSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  name: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(SESSION_GROUP_NAME_MAX_LENGTH),
  ),
  description: Schema.String.check(Schema.isMaxLength(SESSION_GROUP_DESCRIPTION_MAX_LENGTH)),
  version: VersionSchema,
  memberCount: NonNegativeIntSchema,
  projectLabels: Schema.Array(NonEmptyStringSchema),
  latestStepAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type SessionGroup = typeof SessionGroupSchema.Type

export const SessionGroupMembershipSchema = Schema.Struct({
  groupId: NonEmptyStringSchema,
  threadId: NonEmptyStringSchema,
  joinedAt: Schema.Number,
})
export type SessionGroupMembership = typeof SessionGroupMembershipSchema.Type

export const SessionGroupStepStatusSchema = Schema.Literals([
  'waiting_permission',
  'waiting_question',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
])
export type SessionGroupStepStatus = typeof SessionGroupStepStatusSchema.Type

export const SessionGroupCheckpointSchema = Schema.Struct({
  ordinal: NonNegativeIntSchema,
  kind: Schema.Literals(['goal', 'tool', 'decision', 'result']),
  summary: Schema.String,
  status: Schema.Literals(['pending', 'completed', 'failed']),
})
export type SessionGroupCheckpoint = typeof SessionGroupCheckpointSchema.Type

export const SessionGroupChangedFileSchema = Schema.Struct({
  workspaceLabel: NonEmptyStringSchema,
  path: NonEmptyStringSchema,
  oldPath: Schema.NullOr(NonEmptyStringSchema),
  operation: Schema.Literals(['create', 'update', 'delete', 'rename']),
  additions: NonNegativeIntSchema,
  deletions: NonNegativeIntSchema,
  evidence: Schema.Literals(['turn_patch', 'git_snapshot']),
})
export type SessionGroupChangedFile = typeof SessionGroupChangedFileSchema.Type

export const SessionGroupValidationSchema = Schema.Struct({
  name: NonEmptyStringSchema,
  status: Schema.Literals(['passed', 'failed', 'skipped']),
  summary: Schema.String,
})
export type SessionGroupValidation = typeof SessionGroupValidationSchema.Type

export const SessionGroupFailureSchema = Schema.Struct({
  stage: NonEmptyStringSchema,
  code: Schema.NullOr(NonEmptyStringSchema),
  message: NonEmptyStringSchema,
  retryable: Schema.Boolean,
})
export type SessionGroupFailure = typeof SessionGroupFailureSchema.Type

export const SessionGroupStepSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  groupId: NonEmptyStringSchema,
  sequence: VersionSchema,
  sourceThreadId: Schema.NullOr(NonEmptyStringSchema),
  sourceThreadTitle: Schema.String,
  sourceTurnId: NonEmptyStringSchema,
  projectId: Schema.NullOr(NonEmptyStringSchema),
  workspaceLabel: NonEmptyStringSchema,
  status: SessionGroupStepStatusSchema,
  summary: Schema.String.check(Schema.isMaxLength(SESSION_GROUP_STEP_SUMMARY_MAX_LENGTH)),
  checkpoints: Schema.Array(SessionGroupCheckpointSchema),
  changedFiles: Schema.Array(SessionGroupChangedFileSchema),
  validations: Schema.Array(SessionGroupValidationSchema),
  failure: Schema.NullOr(SessionGroupFailureSchema),
  revision: VersionSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type SessionGroupStep = typeof SessionGroupStepSchema.Type

export const SessionGroupContextSectionSchema = Schema.Literals([
  'objective',
  'code_map',
  'decision',
  'finding',
  'progress',
  'validation',
  'risk',
  'fix',
])
export type SessionGroupContextSection = typeof SessionGroupContextSectionSchema.Type

export const SessionGroupContextEntryStatusSchema = Schema.Literals([
  'active',
  'superseded',
  'retired',
])
export type SessionGroupContextEntryStatus = typeof SessionGroupContextEntryStatusSchema.Type

export const SessionGroupContextEntrySchema = Schema.Struct({
  id: NonEmptyStringSchema,
  groupId: NonEmptyStringSchema,
  section: SessionGroupContextSectionSchema,
  title: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(SESSION_GROUP_CONTEXT_TITLE_MAX_LENGTH),
  ),
  content: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(SESSION_GROUP_CONTEXT_CONTENT_MAX_LENGTH),
  ),
  status: SessionGroupContextEntryStatusSchema,
  version: VersionSchema,
  sourceThreadId: Schema.NullOr(NonEmptyStringSchema),
  sourceTurnId: Schema.NullOr(NonEmptyStringSchema),
  supersedesEntryId: Schema.NullOr(NonEmptyStringSchema),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type SessionGroupContextEntry = typeof SessionGroupContextEntrySchema.Type

export const SessionGroupContextStateSchema = Schema.Struct({
  groupId: NonEmptyStringSchema,
  contextRevision: VersionSchema,
  summarizedThroughSequence: NonNegativeIntSchema,
  latestSequence: NonNegativeIntSchema,
  digest: Schema.String.check(Schema.isMaxLength(SESSION_GROUP_DIGEST_MAX_LENGTH)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type SessionGroupContextState = typeof SessionGroupContextStateSchema.Type

export const SessionGroupContextChangeSchema = Schema.Union([
  Schema.Struct({
    op: Schema.Literal('add'),
    section: SessionGroupContextSectionSchema,
    title: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(SESSION_GROUP_CONTEXT_TITLE_MAX_LENGTH),
    ),
    content: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(SESSION_GROUP_CONTEXT_CONTENT_MAX_LENGTH),
    ),
  }),
  Schema.Struct({
    op: Schema.Literal('replace'),
    entryId: NonEmptyStringSchema,
    expectedEntryVersion: VersionSchema,
    title: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(SESSION_GROUP_CONTEXT_TITLE_MAX_LENGTH),
    ),
    content: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(SESSION_GROUP_CONTEXT_CONTENT_MAX_LENGTH),
    ),
  }),
  Schema.Struct({
    op: Schema.Literal('retire'),
    entryId: NonEmptyStringSchema,
    expectedEntryVersion: VersionSchema,
    reason: Schema.String,
  }),
])
export type SessionGroupContextChange = typeof SessionGroupContextChangeSchema.Type
