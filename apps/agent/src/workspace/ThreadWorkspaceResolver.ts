import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'
import { AgentError } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { TaskExecutionBindingService } from '../worktree/TaskExecutionBindingService'
import type { TaskExecutionBinding } from '../worktree/Types'
import { ManagedProjectlessWorkspaceService } from './ManagedProjectlessWorkspaceService'
import type {
  AllocateManagedProjectlessWorkspaceInput,
  ManagedProjectlessWorkspaceAllocation,
} from './ManagedProjectlessWorkspaceService'
import { WorkspaceService } from './WorkspaceService'

type ResolvedWorkspaceBase = {
  workspaceRoot: string
  cwd: string
  runtimeWorkspaceRoots: Array<{
    folderId: string
    path: string
    role: 'primary' | 'secondary'
  }>
  instructionSources: string[]
  workspace: WorkspaceService
  executionBinding: TaskExecutionBinding
}

export type ResolvedThreadWorkspace =
  | (ResolvedWorkspaceBase & {
      kind: 'project'
      projectID: string
      outputDirectory: null
    })
  | (ResolvedWorkspaceBase & {
      kind: 'projectless'
      projectID: null
      outputDirectory: string
      ownerThreadID: string
    })

type RuntimeProject = {
  rootPath?: string
  removedAt?: number | null
  primaryFolderId?: string
  folders?: Array<{
    id: string
    path: string
    role: 'primary' | 'secondary'
    availability?: 'available' | 'missing'
  }>
}

type ProjectWorkspaceDescriptor = {
  cwd?: string
  instructionSources?: string[]
}

export class ThreadWorkspaceResolver {
  constructor(
    private readonly db: AgentDatabase,
    private readonly projectless: ManagedProjectlessWorkspaceService,
    private readonly bindings?: TaskExecutionBindingService,
  ) {}

  private resolveExecutionBinding(
    threadID: string,
    descriptor: Parameters<TaskExecutionBindingService['resolve']>[1],
  ): TaskExecutionBinding {
    if (this.bindings) return this.bindings.resolve(threadID, descriptor)
    const cwd = resolve(descriptor.cwd)
    const digest = createHash('sha256')
      .update(`${threadID}\0${descriptor.kind}\0${cwd}`, 'utf8')
      .digest('hex')
    return {
      threadId: threadID,
      bindingId: `local:${digest}`,
      kind: 'local',
      projectId: descriptor.projectID,
      cwd,
      worktreeId: null,
      revision: 1,
      environmentRevision: 0,
      createdAt: 0,
      updatedAt: 0,
    }
  }

  allocateProjectless(input: AllocateManagedProjectlessWorkspaceInput) {
    return this.projectless.allocate(input)
  }

  activateProjectless(allocation: ManagedProjectlessWorkspaceAllocation) {
    return this.projectless.activate(allocation)
  }

  rollbackProjectless(allocation: ManagedProjectlessWorkspaceAllocation) {
    return this.projectless.rollback(allocation)
  }

  async resolve(threadID: string): Promise<ResolvedThreadWorkspace> {
    const descriptor = this.db.threadWorkspace(threadID)
    if (!descriptor) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
    if (descriptor.kind === 'project') {
      const executionBinding = this.resolveExecutionBinding(threadID, descriptor)
      const project = this.db.getProject(descriptor.projectID) as RuntimeProject | null
      if (!project) throw new AgentError('PROJECT_NOT_FOUND', '当前项目不存在', 404)
      const folders =
        descriptor.runtimeWorkspaceRoots.length > 0
          ? descriptor.runtimeWorkspaceRoots.map((root) => ({ ...root, id: root.folderId }))
          : (project.folders?.filter((folder) => folder.availability !== 'missing') ?? [])
      const primary =
        folders.find((folder) => folder.role === 'primary') ??
        folders.find((folder) => folder.id === project.primaryFolderId)
      const primaryPath = primary?.path ?? descriptor.cwd ?? project.rootPath
      if (!primaryPath) throw new AgentError('PROJECT_FOLDER_NOT_FOUND', '项目主目录不存在', 409)
      const executionPrimary =
        executionBinding.kind === 'worktree' ? executionBinding.cwd : primaryPath
      const workspace = await WorkspaceService.openRoots({
        primaryRoot: executionPrimary,
        roots:
          folders.length > 0
            ? folders.map((folder) => ({
                folderId: folder.id,
                path: folder.id === primary?.id ? executionPrimary : folder.path,
                role: folder.role,
              }))
            : [{ path: executionPrimary, role: 'primary' }],
      })
      const saved = descriptor as typeof descriptor & ProjectWorkspaceDescriptor
      const requestedCwd =
        executionBinding.kind === 'worktree'
          ? executionBinding.cwd
          : (executionBinding.cwd ?? saved.cwd ?? workspace.rootPath)
      const cwd = await workspace.resolveDirectory(requestedCwd).catch((cause) => {
        if (requestedCwd !== workspace.rootPath) {
          throw new AgentError(
            'THREAD_WORKSPACE_UNAVAILABLE',
            'Thread 持久化 cwd 已不在当前项目目录内或不可访问',
            409,
          )
        }
        throw cause
      })
      const instructionSources = (saved.instructionSources ?? []).map((source) => {
        if (executionBinding.kind !== 'worktree') return source
        const sourceRelative = relative(primaryPath, source)
        return sourceRelative === '' ||
          (!sourceRelative.startsWith('..') && !isAbsolute(sourceRelative))
          ? resolve(executionPrimary, sourceRelative)
          : source
      })
      return {
        kind: 'project',
        projectID: descriptor.projectID,
        workspaceRoot: workspace.rootPath,
        cwd,
        runtimeWorkspaceRoots: workspace.workspaceRoots.map((root) => ({
          folderId: root.folderId ?? root.path,
          path: root.path,
          role: root.role,
        })),
        instructionSources,
        outputDirectory: null,
        workspace,
        executionBinding,
      }
    }
    try {
      const ownerThreadID = this.db.projectlessWorkspaceOwner(threadID)
      const validated = await this.projectless.ensureActivePersisted({
        threadID: ownerThreadID,
        sessionRoot: descriptor.workspaceRoot,
        cwd: descriptor.cwd,
        outputDirectory: descriptor.outputDirectory,
      })
      const workspace = await WorkspaceService.open(validated.sessionRoot)
      const executionBinding = this.resolveExecutionBinding(threadID, descriptor)
      return {
        kind: 'projectless',
        ownerThreadID,
        projectID: null,
        workspaceRoot: workspace.rootPath,
        cwd: validated.cwd,
        runtimeWorkspaceRoots: [],
        instructionSources: [],
        outputDirectory: validated.outputDirectory,
        workspace,
        executionBinding,
      }
    } catch (cause) {
      if (cause instanceof AgentError && cause.code === 'THREAD_NOT_FOUND') throw cause
      throw new AgentError(
        'PROJECTLESS_WORKSPACE_UNAVAILABLE',
        cause instanceof Error
          ? `无项目会话工作目录不可用：${cause.message}`
          : '无项目会话工作目录不可用',
        409,
      )
    }
  }
}
