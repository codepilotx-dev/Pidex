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
import type { WorkspaceRoot } from './WorkspaceService'

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
    if (this.bindings) {
      // 派生线程（子 Agent）没有自己的执行绑定，复用工作区归属线程的绑定，
      // 让子 Agent 与父线程落在同一个 checkout（含托管 worktree）。
      const ownerThreadID = this.db.threadWorkspaceOwner(threadID)
      if (ownerThreadID && ownerThreadID !== threadID) {
        const inherited = this.bindings.read(ownerThreadID)
        if (inherited) return { ...inherited, threadId: threadID }
      }
      return this.bindings.resolve(threadID, descriptor)
    }
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
      // Persisted roots are the source of the execution scope. Explicitly empty
      // roots stay on the persisted cwd instead of widening to every project
      // folder, so project edits never grow an existing thread's permissions.
      const folders = descriptor.runtimeWorkspaceRoots.map((root) => ({
        ...root,
        id: root.folderId,
      }))
      const primary =
        folders.find((folder) => folder.role === 'primary') ??
        folders.find((folder) => folder.id === project.primaryFolderId)
      const primaryPath = primary?.path ?? descriptor.cwd ?? project.rootPath
      if (!primaryPath) throw new AgentError('PROJECT_FOLDER_NOT_FOUND', '项目主目录不存在', 409)
      const executionPrimary =
        executionBinding.kind === 'worktree' ? executionBinding.cwd : primaryPath
      // Missing secondary roots only drop out of this execution view. The
      // unfiltered list is what callers persist, so a recovered directory stays
      // usable in later turns.
      const requestedRoots: WorkspaceRoot[] =
        folders.length > 0
          ? folders.map((folder) => ({
              folderId: folder.id,
              path: folder.id === primary?.id ? executionPrimary : folder.path,
              role: folder.role,
            }))
          : [{ path: executionPrimary, role: 'primary' }]
      const workspace = await WorkspaceService.openRoots({
        primaryRoot: executionPrimary,
        roots: requestedRoots,
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
        runtimeWorkspaceRoots: requestedRoots.map((root) => {
          const opened =
            workspace.workspaceRoots.find((candidate) => candidate.folderId === root.folderId) ??
            workspace.workspaceRoots.find((candidate) => candidate.path === root.path)
          return {
            folderId: root.folderId ?? root.path,
            path: opened?.path ?? root.path,
            role: root.role,
          }
        }),
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
