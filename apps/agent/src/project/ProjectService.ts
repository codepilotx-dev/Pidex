import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import type { ProjectExecutionEnvironment } from '@pidex/shared/thread'
import type { EventEnvelope, ModelRef } from '../Domain'
import { AgentError } from '../Domain'
import type { RepositoryDatabase } from '../storage/repositories/RepositoryDatabase'
import { projectPathKey } from '../storage/repositories/ProjectRepository'
import type { ProjectSourceService } from './ProjectSourceService'

type ProjectRemovalResult = {
  projectId: string
  removedAt: number
  archivedThreadCount: number
  removalOperationId?: string
  undoExpiresAt?: number
}

const requestHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

const requireDirectory = async (path: string) => {
  let canonical: string
  try {
    canonical = await realpath(path)
    if (!(await stat(canonical)).isDirectory()) throw new Error('not a directory')
  } catch {
    throw new AgentError('PATH_DENIED', '所选路径不是可访问的目录', 400)
  }
  return canonical
}

export class ProjectService {
  constructor(
    private readonly db: RepositoryDatabase,
    private readonly sources?: ProjectSourceService,
    private readonly publish?: (events: readonly EventEnvelope[]) => Promise<void>,
  ) {}

  list(input: { folderPath?: string } = {}) {
    return this.db.listProjects(input)
  }

  /**
   * A completed operation returns its saved result without touching disk again.
   * Reusing an operation id for a different request stays a conflict.
   */
  private completedOperation<T>(
    operationID: string,
    method: string,
    requestHash: string,
  ): T | null {
    const operation = this.db.projectOperation(operationID)
    if (!operation) return null
    if (operation.method !== method || operation.requestHash !== requestHash)
      throw new AgentError('CONFLICT', 'operationId 已用于不同的项目操作', 409)
    return operation.status === 'completed' ? (operation.result as T) : null
  }

  /**
   * Runs the mutation and its completion record in one profile transaction, so a
   * failure to record the result also rolls the mutation back. Disk checks stay
   * outside the transaction and the operation id/fingerprint is re-checked here.
   */
  private runOperation<T>(input: {
    operationID: string
    method: string
    requestHash: string
    projectID?: string
    run: (operation: { projectID: string | null }) => T
  }): T {
    return this.db.profileSqlite.transaction(() => {
      const operation = this.db.beginProjectOperation({
        operationID: input.operationID,
        method: input.method,
        requestHash: input.requestHash,
        ...(input.projectID !== undefined ? { projectID: input.projectID } : {}),
      })
      if (operation.status === 'completed') return operation.result as T
      const result = input.run(operation)
      this.db.completeProjectOperation(input.operationID, result)
      return result
    })()
  }

  async create(input: { name?: string; primaryPath: string; operationID: string }) {
    const primaryPath = await requireDirectory(input.primaryPath)
    const hash = requestHash({ name: input.name?.trim() || null, primaryPath })
    const duplicate = this.completedOperation<{
      project: NonNullable<ReturnType<RepositoryDatabase['getProject']>>
    }>(input.operationID, 'project/create', hash)
    if (duplicate) return duplicate
    const fallbackProjectID = crypto.randomUUID()
    return this.runOperation({
      operationID: input.operationID,
      method: 'project/create',
      requestHash: hash,
      projectID: fallbackProjectID,
      run: (operation) => {
        const projectID = operation.projectID ?? fallbackProjectID
        return {
          project:
            this.db.getProject(projectID) ??
            this.db.createProject({
              id: projectID,
              primaryPath,
              ...(input.name ? { name: input.name } : {}),
            }),
        }
      },
    })
  }

  open(input: { projectID: string; operationID: string }) {
    return this.runOperation({
      operationID: input.operationID,
      method: 'project/open',
      requestHash: requestHash({ projectID: input.projectID }),
      projectID: input.projectID,
      run: () => ({ project: this.db.touchProject(input.projectID) }),
    })
  }

  update(input: { projectID: string; name: string; expectedVersion: number; operationID: string }) {
    return this.runOperation({
      operationID: input.operationID,
      method: 'project/update',
      requestHash: requestHash(input),
      projectID: input.projectID,
      run: () => ({
        project: this.db.updateProject({
          projectID: input.projectID,
          name: input.name,
          expectedVersion: input.expectedVersion,
        }),
      }),
    })
  }

  async addFolder(input: { projectID: string; path: string; operationID: string }) {
    const path = await requireDirectory(input.path)
    const hash = requestHash({ projectID: input.projectID, path })
    const duplicate = this.completedOperation<ReturnType<RepositoryDatabase['addProjectFolder']>>(
      input.operationID,
      'project/folder/add',
      hash,
    )
    if (duplicate) return duplicate
    return this.runOperation({
      operationID: input.operationID,
      method: 'project/folder/add',
      requestHash: hash,
      projectID: input.projectID,
      run: () => this.db.addProjectFolder(input.projectID, path),
    })
  }

  removeFolder(input: { projectID: string; folderID: string; operationID: string }) {
    return this.runOperation({
      operationID: input.operationID,
      method: 'project/folder/remove',
      requestHash: requestHash(input),
      projectID: input.projectID,
      run: () => this.db.removeProjectFolder(input.projectID, input.folderID),
    })
  }

  setPrimaryFolder(input: { projectID: string; folderID: string; operationID: string }) {
    return this.runOperation({
      operationID: input.operationID,
      method: 'project/folder/set-primary',
      requestHash: requestHash(input),
      projectID: input.projectID,
      run: () => this.db.setPrimaryProjectFolder(input.projectID, input.folderID),
    })
  }

  updateSettings(input: {
    projectID: string
    settings: {
      defaultModel?: ModelRef | null
      instructions?: string
      executionEnvironment?: ProjectExecutionEnvironment
    }
    expectedVersion: number
    operationID: string
  }) {
    return this.runOperation({
      operationID: input.operationID,
      method: 'project/settings/update',
      requestHash: requestHash(input),
      projectID: input.projectID,
      run: () => {
        const current = this.db.getProjectSettings(input.projectID)
        const saved = this.db.saveProjectSettings(
          input.projectID,
          {
            defaultModel:
              input.settings.defaultModel === undefined
                ? current.defaultModel
                : input.settings.defaultModel,
            instructions: input.settings.instructions ?? current.instructions,
            executionEnvironment:
              input.settings.executionEnvironment ?? current.executionEnvironment,
          },
          input.expectedVersion,
        )
        return { projectId: input.projectID, settings: saved, version: saved.version }
      },
    })
  }

  async edit(input: {
    projectID: string
    name: string
    paths: string[]
    expectedVersion: number
    operationID: string
  }) {
    const hash = requestHash(input)
    const duplicate = this.completedOperation<{
      project: NonNullable<ReturnType<RepositoryDatabase['getProject']>>
    }>(input.operationID, 'project/edit', hash)
    if (duplicate) return duplicate
    const paths = [
      ...new Map(
        (await Promise.all(input.paths.map(requireDirectory))).map((path) => [
          projectPathKey(path),
          path,
        ]),
      ).values(),
    ]
    return this.runOperation({
      operationID: input.operationID,
      method: 'project/edit',
      requestHash: hash,
      projectID: input.projectID,
      run: () => ({
        project: this.db.editProject({
          projectID: input.projectID,
          name: input.name,
          paths,
          expectedVersion: input.expectedVersion,
        }),
      }),
    })
  }

  async remove(input: { projectID: string; operationID: string }): Promise<ProjectRemovalResult> {
    const operation = this.db.beginProjectOperation({
      operationID: input.operationID,
      method: 'project/remove',
      requestHash: requestHash({ projectID: input.projectID }),
      projectID: input.projectID,
    })
    if (operation.status === 'completed') return operation.result as ProjectRemovalResult
    const project = this.db.getProject(input.projectID)
    if (!project) throw new AgentError('PROJECT_NOT_FOUND', '项目不存在', 404)
    const checkpoint = operation.result as ProjectRemovalResult | null
    if (project.removedAt !== null && !checkpoint) {
      const result = {
        projectId: input.projectID,
        removedAt: project.removedAt,
        archivedThreadCount: 0,
      }
      this.db.completeProjectOperation(input.operationID, result)
      return result
    }
    const result = checkpoint ?? {
      projectId: input.projectID,
      removedAt: Math.max(Date.now(), project.updatedAt + 1),
      archivedThreadCount: 0,
      removalOperationId: input.operationID,
      undoExpiresAt: Date.now() + 60_000,
    }
    this.db.profileSqlite.transaction(() => {
      this.db.saveRemovalCheckpoint(input.operationID, result)
      this.db.hideProject(input.projectID, result.removedAt)
    })()
    const events = this.db.detachProjectThreads(input.projectID, input.operationID)
    this.db.completeProjectOperation(input.operationID, result)
    await this.publish?.(events)
    return this.db.projectOperation(input.operationID)!.result as ProjectRemovalResult
  }

  async restore(input: { projectID: string; removalOperationID: string; operationID: string }) {
    const operation = this.db.beginProjectOperation({
      operationID: input.operationID,
      method: 'project/restore',
      requestHash: requestHash(input),
      projectID: input.projectID,
    })
    if (operation.status === 'completed')
      return operation.result as {
        project: NonNullable<ReturnType<RepositoryDatabase['getProject']>>
      }
    const removal = this.db.projectOperation(input.removalOperationID)
    const result = removal?.result as ProjectRemovalResult | null
    if (
      removal?.method !== 'project/remove' ||
      removal.projectID !== input.projectID ||
      !result?.undoExpiresAt ||
      (!operation.result && Date.now() > result.undoExpiresAt)
    )
      throw new AgentError('CONFLICT', '项目撤销已过期', 409)
    const current = this.db.getProject(input.projectID)
    if (!current || (current.removedAt !== null && current.removedAt !== result.removedAt))
      throw new AgentError('VERSION_CONFLICT', '项目状态已改变', 409)
    this.db.saveRemovalCheckpoint(input.operationID, {
      removalOperationId: input.removalOperationID,
    })
    this.db.restoreProjectRecord(input.projectID)
    const events = this.db.restoreProjectThreads(input.projectID, input.removalOperationID)
    const restored = { project: this.db.getProject(input.projectID)! }
    this.db.completeProjectOperation(input.operationID, restored)
    await this.publish?.(events)
    return restored
  }

  async recoverPendingRemovals() {
    const operations = this.db.profileSqlite
      .query(
        `
      SELECT operation_id, project_id, method, result
      FROM project_operations
      WHERE method IN ('project/remove', 'project/restore') AND status = 'pending' AND project_id IS NOT NULL
      ORDER BY created_at, operation_id
    `,
      )
      .all() as Array<{
      operation_id: string
      project_id: string
      method: string
      result: string | null
    }>
    const recovered: string[] = []
    for (const operation of operations) {
      try {
        if (operation.method === 'project/restore') {
          if (!operation.result) continue
          const checkpoint = JSON.parse(operation.result) as { removalOperationId: string }
          await this.restore({
            projectID: operation.project_id,
            operationID: operation.operation_id,
            removalOperationID: checkpoint.removalOperationId,
          })
        } else
          await this.remove({
            projectID: operation.project_id,
            operationID: operation.operation_id,
          })
        recovered.push(operation.operation_id)
      } catch (cause) {
        if (!(cause instanceof AgentError) || cause.code !== 'PROJECT_BUSY') throw cause
      }
    }
    return recovered
  }
}
