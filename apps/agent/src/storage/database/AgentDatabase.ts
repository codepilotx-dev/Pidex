import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { RepositoryDatabase } from '../repositories/RepositoryDatabase'
import { PlanApprovalRepository } from '../repositories/PlanApprovalRepository'
import { credentialRepositoryDatabase } from '../repositories/CredentialRepository'
import { ContextRepository } from '../repositories/ContextRepository'
import { executionRepository } from '../repositories/ExecutionRepository'
import { interactionRepository } from '../repositories/InteractionRepository'
import { projectRepository } from '../repositories/ProjectRepository'
import { reviewRepository } from '../repositories/ReviewRepository'
import { subagentRepositoryDatabase } from '../repositories/SubagentRepository'
import { SideChatRepository } from '../repositories/SideChatRepository'
import { threadRepository } from '../repositories/ThreadRepository'
import { AutomationRepository } from '../repositories/AutomationRepository'
import {
  SchedulePlanProposalRepository,
  ScheduledTaskRepository,
} from '../repositories/ScheduledTaskRepository'
import { TurnPatchRepository } from '../repositories/TurnPatchRepository'
import { ArtifactRepository } from '../repositories/ArtifactRepository'
import { workspaceRepository } from '../repositories/WorkspaceRepository'
import { RuntimeCompositionRepository } from '../repositories/RuntimeCompositionRepository'
import { SessionGroupRepository } from '../repositories/SessionGroupRepository'
import { ThreadGoalRepository } from '../repositories/ThreadGoalRepository'
import { ThreadGoalLedgerRepository } from '../repositories/ThreadGoalLedgerRepository'
import { ThreadGoalContinuationRepository } from '../repositories/ThreadGoalContinuationRepository'
import { ThreadBookmarkRepository } from '../repositories/ThreadBookmarkRepository'
import { ThreadWorktreeOperationRepository } from '../repositories/ThreadWorktreeOperationRepository'
import { configureConnection, shrinkDatabaseMemory } from './Connection'
import { backfillProjectThreadWorkspaces, initializeSchema } from './SchemaInitializer'
import { HISTORY_APPLICATION_ID } from './Schema'
import { prepareStorage, type StoragePaths } from './Reset'

export { DATA_EPOCH, HISTORY_APPLICATION_ID, SCHEMA_VERSION } from './Schema'
export * from '../repositories/RepositoryDatabase'

export type AgentDatabasePaths = {
  historyPath: string
  profilePath: string
  legacyPath?: string
}

export class AgentDatabase extends RepositoryDatabase {
  constructor(input: string | AgentDatabasePaths) {
    const paths: StoragePaths =
      typeof input === 'string'
        ? {
            historyPath: input,
            profilePath: `${input}.profile`,
            legacyPath: `${input}.legacy`,
          }
        : {
            historyPath: input.historyPath,
            profilePath: input.profilePath,
            legacyPath: input.legacyPath ?? `${input.historyPath}.legacy`,
          }
    mkdirSync(dirname(paths.historyPath), { recursive: true })
    mkdirSync(dirname(paths.profilePath), { recursive: true })
    prepareStorage(paths)
    const sqlite = new Database(paths.historyPath, { create: true, strict: true })
    const profileSqlite = new Database(paths.profilePath, { create: true, strict: true })
    configureConnection(sqlite)
    configureConnection(profileSqlite)
    try {
      initializeSchema(profileSqlite, 'profile')
      initializeSchema(sqlite, 'history')
      backfillProjectThreadWorkspaces(sqlite, profileSqlite)
    } catch (cause) {
      sqlite.close()
      profileSqlite.close()
      throw cause
    }
    super(sqlite, profileSqlite)
    this.repositories = {
      threads: threadRepository(this),
      planApprovals: new PlanApprovalRepository(this),
      executions: executionRepository(this),
      interactions: interactionRepository(this),
      subagents: subagentRepositoryDatabase(this),
      sideChats: new SideChatRepository(this),
      projects: projectRepository(this),
      workspaces: workspaceRepository(this),
      reviews: reviewRepository(this),
      credentials: credentialRepositoryDatabase(this),
      context: new ContextRepository(this),
      turnPatches: new TurnPatchRepository(this),
      runtimeCompositions: new RuntimeCompositionRepository(this),
      sessionGroups: new SessionGroupRepository(this),
      threadGoals: new ThreadGoalRepository(this),
      threadGoalLedger: new ThreadGoalLedgerRepository(this),
      threadGoalContinuations: new ThreadGoalContinuationRepository(this),
      threadBookmarks: new ThreadBookmarkRepository(this),
      threadWorktreeOperations: new ThreadWorktreeOperationRepository(this),
      automations: new AutomationRepository(this),
      scheduledTasks: new ScheduledTaskRepository(this),
      schedulePlanProposals: new SchedulePlanProposalRepository(this),
    }
    this.artifacts = new ArtifactRepository(sqlite)
    this.repositories.planApprovals.recover()
    sqlite.exec(`PRAGMA application_id = ${HISTORY_APPLICATION_ID}`)
  }

  readonly repositories

  /** Tool-result artifact catalog over the same history connection. */
  readonly artifacts: ArtifactRepository

  shrinkMemory(): void {
    shrinkDatabaseMemory(this.sqlite)
    if (this.profileSqlite !== this.sqlite) shrinkDatabaseMemory(this.profileSqlite)
  }

  close() {
    this.sqlite.close()
    if (this.profileSqlite !== this.sqlite) this.profileSqlite.close()
  }
}
