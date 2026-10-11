import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { NonEmptyStringSchema, OpaqueIDSchema, TimestampSchema } from '../wire/Primitives'

export const TaskSuggestionCategoryIdSchema = Schema.Literals([
  'codex-explore',
  'codex-create',
  'codex-review',
  'codex-fix',
  'create',
  'research',
  'automate',
])

export const TaskSuggestionSurfaceSchema = Schema.Literals(['coding', 'working'])

export const TaskSuggestionSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  categoryId: TaskSuggestionCategoryIdSchema,
  label: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema,
})

export const TaskSuggestionWorkspaceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('project'),
    projectId: OpaqueIDSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('projectless'),
  }),
])

export const TaskSuggestionRecentTaskSchema = Schema.Struct({
  id: OpaqueIDSchema,
  title: NonEmptyStringSchema,
  firstPrompt: Schema.NullOr(Schema.String),
  status: Schema.Literals([
    'idle',
    'queued',
    'waiting',
    'running',
    'done',
    'error',
    'interrupted',
    'cancelled',
  ]),
  updatedAt: TimestampSchema,
})

export const TaskSuggestionGitContextSchema = Schema.Struct({
  clean: Schema.Boolean,
  ahead: Schema.Number,
  behind: Schema.Number,
  totalFiles: Schema.Number,
  files: Schema.Array(
    Schema.Struct({
      path: NonEmptyStringSchema,
      status: Schema.String,
      stagedStatus: Schema.String,
      unstagedStatus: Schema.String,
    }),
  ),
})

export const TaskSuggestionGenerateParamsSchema = Schema.Struct({
  surface: Schema.optional(TaskSuggestionSurfaceSchema),
  workspace: TaskSuggestionWorkspaceSchema,
  context: Schema.Struct({
    workspaceName: Schema.NullOr(Schema.String),
    branchName: Schema.NullOr(Schema.String),
    git: Schema.NullOr(TaskSuggestionGitContextSchema),
    recentTasks: Schema.Array(TaskSuggestionRecentTaskSchema),
    localCandidates: Schema.Array(TaskSuggestionSchema),
  }),
})

export const TaskSuggestionGenerateResultSchema = Schema.Struct({
  contextKey: NonEmptyStringSchema,
  generatedAt: TimestampSchema,
  suggestions: Schema.Array(TaskSuggestionSchema),
})

const TaskSuggestionErrors = [
  'PROJECT_NOT_FOUND',
  'SUGGESTION_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const

export const SuggestionRpcMethods = {
  'task-suggestion/generate': defineMethod({
    params: TaskSuggestionGenerateParamsSchema,
    result: TaskSuggestionGenerateResultSchema,
    errors: TaskSuggestionErrors,
    capability: 'task-suggestions.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type TaskSuggestion = typeof TaskSuggestionSchema.Type
export type TaskSuggestionCategoryId = typeof TaskSuggestionCategoryIdSchema.Type
export type TaskSuggestionSurface = typeof TaskSuggestionSurfaceSchema.Type
export type TaskSuggestionGenerateParams = typeof TaskSuggestionGenerateParamsSchema.Type
export type TaskSuggestionGenerateResult = typeof TaskSuggestionGenerateResultSchema.Type
