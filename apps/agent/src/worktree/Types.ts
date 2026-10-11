export type ManagedWorktreeStatus =
  | 'creating'
  | 'ready'
  | 'ready-with-setup-error'
  | 'deleting'
  | 'cleaned'
  | 'restoring'
  | 'restore-conflict'

export type ManagedWorktree = {
  id: string
  projectId: string
  repositoryRoot: string
  path: string
  status: ManagedWorktreeStatus
  branchName: string | null
  baseCommit: string
  headCommit: string
  permanent: boolean
  pinned: boolean
  boundOnce: boolean
  setupStatus: 'pending' | 'succeeded' | 'failed' | 'skipped'
  environmentRevision: number
  continuedWithoutSetup: boolean
  restoreSnapshotPath: string | null
  createdAt: number
  updatedAt: number
  lastUsedAt: number
  deletedAt: number | null
}

export type TaskExecutionBinding = {
  threadId: string
  bindingId: string
  kind: 'local' | 'worktree'
  projectId: string | null
  cwd: string
  worktreeId: string | null
  revision: number
  environmentRevision: number
  createdAt: number
  updatedAt: number
}

export type WorktreeOperationKind =
  | 'create'
  | 'retry-setup'
  | 'continue-without-setup'
  | 'set-permanent'
  | 'delete'
  | 'restore'
  | 'auto-cleanup'

export type WorktreeOperation = {
  operationId: string
  worktreeId: string | null
  projectId: string
  kind: WorktreeOperationKind
  requestHash: string
  step: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  revision: number
  errorCode: string | null
  warnings: string[]
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export type WorktreeSetupResult = {
  status: 'succeeded' | 'failed'
  environmentRevision: number
  warnings?: readonly string[]
}

export interface WorktreeEnvironmentLifecycle {
  setup(input: {
    operationId: string
    projectId: string
    worktreeId: string
    sourceWorkspacePath: string
    workspacePath: string
    onOutput: (chunk: string) => void
  }): Promise<WorktreeSetupResult>
  cleanup(input: {
    operationId: string
    projectId: string
    worktreeId: string
    workspacePath: string
    onOutput: (chunk: string) => void
  }): Promise<{ warnings?: readonly string[] }>
}

export const NOOP_WORKTREE_ENVIRONMENT: WorktreeEnvironmentLifecycle = {
  setup: async () => ({ status: 'succeeded', environmentRevision: 0 }),
  cleanup: async () => ({}),
}
