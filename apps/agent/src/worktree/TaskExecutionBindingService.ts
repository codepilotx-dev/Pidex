import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { AgentError } from '../Domain'
import type { StoredThreadWorkspace } from '../storage/repositories/RepositoryCore'
import type { WorktreeRepository } from './WorktreeRepository'
import type { TaskExecutionBinding } from './Types'

const bindingDigest = (...parts: string[]) =>
  createHash('sha256').update(parts.join('\0'), 'utf8').digest('hex')

/** Owns the execution identity independently from the immutable thread workspace descriptor. */
export class TaskExecutionBindingService {
  constructor(
    private readonly repository: WorktreeRepository,
    private readonly now: () => number = Date.now,
    private readonly id: () => string = randomUUID,
  ) {}

  read(threadId: string) {
    return this.repository.binding(threadId)
  }

  resolve(threadId: string, workspace: StoredThreadWorkspace): TaskExecutionBinding {
    const stored = this.repository.binding(threadId)
    if (stored) return stored
    const cwd = resolve(workspace.cwd)
    return {
      threadId,
      bindingId: `local:${bindingDigest(threadId, workspace.kind, cwd)}`,
      kind: 'local',
      projectId: workspace.projectID,
      cwd,
      worktreeId: null,
      revision: 1,
      environmentRevision: 0,
      createdAt: 0,
      updatedAt: 0,
    }
  }

  allocateBindingId() {
    return this.id()
  }

  bindLocal(input: {
    threadId: string
    projectId: string | null
    cwd: string
    bindingId?: string
    environmentRevision?: number
  }) {
    const current = this.repository.binding(input.threadId)
    const timestamp = this.now()
    return this.repository.bind({
      threadId: input.threadId,
      bindingId: current?.bindingId ?? input.bindingId ?? this.id(),
      kind: 'local',
      projectId: input.projectId,
      cwd: resolve(input.cwd),
      worktreeId: null,
      revision: (current?.revision ?? 0) + 1,
      environmentRevision: input.environmentRevision ?? current?.environmentRevision ?? 0,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
  }

  bindWorktree(input: {
    threadId: string
    projectId: string
    worktreeId: string
    bindingId?: string
    environmentRevision?: number
  }) {
    const worktree = this.validateWorktree(input.projectId, input.worktreeId)
    const current = this.repository.binding(input.threadId)
    const timestamp = this.now()
    const binding = this.repository.bind({
      threadId: input.threadId,
      bindingId: current?.bindingId ?? input.bindingId ?? this.id(),
      kind: 'worktree',
      projectId: input.projectId,
      cwd: worktree.path,
      worktreeId: worktree.id,
      revision: (current?.revision ?? 0) + 1,
      environmentRevision: input.environmentRevision ?? worktree.environmentRevision,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
    this.repository.markBound(worktree.id, timestamp)
    return binding
  }

  validateWorktree(projectId: string, worktreeId: string) {
    const worktree = this.repository.readWorktree(worktreeId)
    if (!worktree || worktree.projectId !== projectId || worktree.status === 'cleaned') {
      throw new AgentError('WORKTREE_NOT_FOUND', '托管 worktree 不存在', 404)
    }
    if (worktree.status === 'ready-with-setup-error' && !worktree.continuedWithoutSetup) {
      throw new AgentError(
        'WORKTREE_SETUP_REQUIRED',
        'worktree setup 失败，必须先重试或明确跳过',
        409,
      )
    }
    if (worktree.status !== 'ready' && worktree.status !== 'ready-with-setup-error') {
      throw new AgentError('WORKTREE_NOT_READY', 'worktree 尚未可用于任务执行', 409)
    }
    return worktree
  }

  updateEnvironmentRevision(threadId: string, environmentRevision: number) {
    const binding = this.repository.bumpEnvironmentRevision(
      threadId,
      environmentRevision,
      this.now(),
    )
    if (!binding) throw new AgentError('THREAD_NOT_FOUND', '任务执行绑定不存在', 404)
    return binding
  }
}
