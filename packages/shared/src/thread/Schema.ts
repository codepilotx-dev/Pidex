import { Model } from '@pidex/model-schema'
import { Schema } from 'effect'
import { ThreadExecutionEnvironmentSchema } from './Execution'
import { PermissionConfigSchema } from './Permission'
import { TaskModeSchema, ThreadSettingsSchema } from './Settings'

/**
 * Where new tasks for a project run. `auto` follows the project type (Git uses a
 * managed worktree, non-Git uses the local directory); `local` always stays local.
 */
export const ProjectExecutionEnvironmentSchema = Schema.Literals(['auto', 'local'])
export type ProjectExecutionEnvironment = typeof ProjectExecutionEnvironmentSchema.Type

export const ProjectSettingsSchema = Schema.Struct({
  defaultModel: Schema.NullOr(Model.Ref),
  instructions: Schema.String,
  /** Omitted by older writers, which means the automatic default. */
  executionEnvironment: Schema.optional(ProjectExecutionEnvironmentSchema),
  version: Schema.Number,
})
export type ProjectSettings = typeof ProjectSettingsSchema.Type

export const ProjectFolderSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  role: Schema.Literals(['primary', 'secondary']),
  availability: Schema.Literals(['available', 'missing']),
  order: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type ProjectFolder = typeof ProjectFolderSchema.Type

export const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  primaryFolderId: Schema.String,
  folders: Schema.Array(ProjectFolderSchema),
  removedAt: Schema.NullOr(Schema.Number),
  lastOpenedAt: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  settings: ProjectSettingsSchema,
})
export type Project = typeof ProjectSchema.Type

export const ProjectSourceRevisionSchema = Schema.Struct({
  mtimeMs: Schema.Number,
  sha256: Schema.String,
})
export type ProjectSourceRevision = typeof ProjectSourceRevisionSchema.Type

export const ProjectSourceSchema = Schema.Union([
  Schema.Struct({
    storage: Schema.Literal('managed'),
    id: Schema.String,
    projectId: Schema.String,
    kind: Schema.Literals(['text', 'image']),
    name: Schema.String,
    mediaType: Schema.String,
    sizeBytes: Schema.Number,
    sha256: Schema.String,
    status: Schema.Literal('available'),
  }),
  Schema.Struct({
    storage: Schema.Literal('workspace-file'),
    id: Schema.String,
    projectId: Schema.String,
    folderId: Schema.String,
    path: Schema.String,
    kind: Schema.Literals(['text', 'image']),
    name: Schema.String,
    status: Schema.Literals(['available', 'missing', 'denied', 'unsupported']),
    revision: Schema.NullOr(ProjectSourceRevisionSchema),
  }),
])
export type ProjectSource = typeof ProjectSourceSchema.Type

export const TurnStatusSchema = Schema.Literals([
  'queued',
  'running',
  'waiting-permission',
  'waiting-question',
  'waiting-subagents',
  'completed',
  'failed',
  'stopped',
  'interrupted',
  'cancelled',
])
export type TurnStatus = typeof TurnStatusSchema.Type

export const ThreadWorkspaceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('project'),
    projectID: Schema.String,
    cwd: Schema.String,
    runtimeWorkspaceRoots: Schema.Array(
      Schema.Struct({
        folderId: Schema.String,
        path: Schema.String,
        role: Schema.Literals(['primary', 'secondary']),
      }),
    ),
    instructionSources: Schema.Array(Schema.String),
    outputDirectory: Schema.Null,
  }),
  Schema.Struct({
    kind: Schema.Literal('projectless'),
    projectID: Schema.Null,
    workspaceRoot: Schema.String,
    cwd: Schema.String,
    outputDirectory: Schema.String,
  }),
])
export type ThreadWorkspace = typeof ThreadWorkspaceSchema.Type

export const ThreadCreationSurfaceSchema = Schema.Literals(['coding', 'working', 'chat'])
export type ThreadCreationSurface = typeof ThreadCreationSurfaceSchema.Type

export const ThreadSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  projectID: Schema.NullOr(Schema.String),
  /** Legacy read-only alias of `workflowId`; new clients use `workflowId` only. */
  sessionGroupId: Schema.optional(Schema.NullOr(Schema.String)),
  workflowId: Schema.optional(Schema.NullOr(Schema.String)),
  gitBranch: Schema.NullOr(Schema.String),
  /** Projected from the execution binding; clients never infer it from the workspace. */
  executionEnvironment: Schema.optional(ThreadExecutionEnvironmentSchema),
  creationSurface: Schema.optional(ThreadCreationSurfaceSchema),
  hasScheduledRun: Schema.optional(Schema.Boolean),
  isScheduledSession: Schema.optional(Schema.Boolean),
  isFork: Schema.optional(Schema.Boolean),
  workspace: Schema.optional(ThreadWorkspaceSchema),
  settings: ThreadSettingsSchema,
  archivedAt: Schema.optional(Schema.NullOr(Schema.Number)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type Thread = typeof ThreadSchema.Type

export const ThreadListItemSchema = Schema.Struct({
  id: Schema.String,
  storageSource: Schema.optional(Schema.Literal('local')),
  projectID: Schema.NullOr(Schema.String),
  /** Legacy read-only alias of `workflowId`; new clients use `workflowId` only. */
  sessionGroupId: Schema.optional(Schema.NullOr(Schema.String)),
  workflowId: Schema.optional(Schema.NullOr(Schema.String)),
  gitBranch: Schema.NullOr(Schema.String),
  /** Projected from the execution binding; clients never infer it from the workspace. */
  executionEnvironment: Schema.optional(ThreadExecutionEnvironmentSchema),
  creationSurface: Schema.optional(ThreadCreationSurfaceSchema),
  hasScheduledRun: Schema.optional(Schema.Boolean),
  isScheduledSession: Schema.optional(Schema.Boolean),
  isFork: Schema.optional(Schema.Boolean),
  workspace: Schema.optional(ThreadWorkspaceSchema),
  title: Schema.String,
  preview: Schema.NullOr(Schema.String),
  firstUserMessage: Schema.NullOr(Schema.String),
  messageCount: Schema.Number,
  latestTurnStatus: Schema.NullOr(TurnStatusSchema),
  archivedAt: Schema.NullOr(Schema.Number),
  unreadAt: Schema.optional(Schema.NullOr(Schema.Number)),
  pendingPlanApproval: Schema.optional(Schema.Boolean),
  settings: ThreadSettingsSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type ThreadListItem = typeof ThreadListItemSchema.Type

export const TurnSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  sourceInputID: Schema.String,
  status: TurnStatusSchema,
  mode: TaskModeSchema,
  model: Model.Ref,
  permissionConfig: PermissionConfigSchema,
  rootAgentId: Schema.String,
  mergedInputIDs: Schema.Array(Schema.String),
  queuePosition: Schema.optional(Schema.NullOr(Schema.Number)),
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  elapsedSeconds: Schema.Number,
  error: Schema.NullOr(Schema.String),
})
export type Turn = typeof TurnSchema.Type
