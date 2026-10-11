import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type {
  ManagedWorktree as PublicManagedWorktree,
  WorktreeOperation as PublicWorktreeOperation,
} from '@pidex/agent-protocol/worktree'
import { AgentError } from '../Domain'
import { GitCommandRunner } from '../git/GitCommandRunner'
import { WorkspaceIsolationService } from '../subagent/WorkspaceIsolationService'
import { WorktreeIncludeService } from './WorktreeIncludeService'
import { WorktreeOperationOutputBuffer } from './WorktreeOperationOutputBuffer'
import {
  WorktreeRestoreSnapshotStore,
  type WorktreeRestoreSnapshot,
} from './WorktreeRestoreSnapshot'
import type { WorktreeRepository } from './WorktreeRepository'
import {
  NOOP_WORKTREE_ENVIRONMENT,
  type ManagedWorktree,
  type WorktreeEnvironmentLifecycle,
  type WorktreeOperation,
  type WorktreeOperationKind,
  type WorktreeSetupResult,
} from './Types'

type ProjectRootResolver = (projectId: string) => string | null | Promise<string | null>
type AutoDeletePolicy = () => { enabled: boolean; limit: number }
type GitResult = { code: number; stdout: string; stderr: string }

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
const pathKey = (value: string) => {
  const normalized = resolve(value).replaceAll('\\', '/').replace(/\/$/, '')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}
const contained = (root: string, path: string) => {
  const value = relative(root, path)
  return value === '' || (!value.startsWith('..') && !isAbsolute(value))
}
const safeCode = (cause: unknown, fallback: string) =>
  cause instanceof AgentError ? cause.code : fallback

const publicWorktree = (value: ManagedWorktree): PublicManagedWorktree => ({
  id: value.id,
  projectId: value.projectId,
  status: value.status,
  branchName: value.branchName,
  baseCommit: value.baseCommit,
  headCommit: value.headCommit,
  permanent: value.permanent,
  pinned: value.pinned,
  setupStatus: value.setupStatus,
  continuedWithoutSetup: value.continuedWithoutSetup,
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
  lastUsedAt: value.lastUsedAt,
  deletedAt: value.deletedAt,
})

const publicOperation = (value: WorktreeOperation): PublicWorktreeOperation => ({
  operationId: value.operationId,
  worktreeId: value.worktreeId,
  projectId: value.projectId,
  kind: value.kind,
  step: value.step,
  status: value.status,
  revision: value.revision,
  errorCode: value.errorCode,
  warnings: value.warnings,
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
  completedAt: value.completedAt,
})

export type CreateManagedWorktreeInput = {
  projectId: string
  startingState: { type: 'branch'; branchName: string } | { type: 'working-tree' }
  operationId: string
  /** Agent-internal authoritative source. Never accepted from public RPC. */
  sourceWorkspacePath?: string
  snapshotMode?: 'head' | 'working-tree'
}

/** Windows-first owner of Git worktrees rooted exclusively below the configured managed directory. */
export class ManagedWorktreeService {
  private constructor(
    private readonly repository: WorktreeRepository,
    private readonly managedRoot: string,
    private readonly stateRoot: string,
    private readonly resolveProjectRoot: ProjectRootResolver,
    private readonly environment: WorktreeEnvironmentLifecycle,
    private readonly now: () => number,
    private readonly id: () => string,
    private readonly output: WorktreeOperationOutputBuffer,
    private readonly autoDeletePolicy: AutoDeletePolicy,
    private readonly settings: () => { root?: string; fetchUpstream?: boolean },
  ) {}

  static async open(input: {
    repository: WorktreeRepository
    managedRoot: string
    stateRoot: string
    resolveProjectRoot: ProjectRootResolver
    environment?: WorktreeEnvironmentLifecycle
    now?: () => number
    id?: () => string
    output?: WorktreeOperationOutputBuffer
    autoDeletePolicy?: AutoDeletePolicy
    settings?: () => { root?: string; fetchUpstream?: boolean }
  }) {
    await mkdir(input.managedRoot, { recursive: true })
    await mkdir(input.stateRoot, { recursive: true, mode: 0o700 })
    const managedRoot = await realpath(input.managedRoot)
    const stateRoot = await realpath(input.stateRoot)
    for (const root of [managedRoot, stateRoot]) {
      const metadata = await lstat(root)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new AgentError('WORKTREE_PATH_UNSAFE', '托管 worktree 根目录不是普通目录', 409)
      }
    }
    return new ManagedWorktreeService(
      input.repository,
      managedRoot,
      stateRoot,
      input.resolveProjectRoot,
      input.environment ?? NOOP_WORKTREE_ENVIRONMENT,
      input.now ?? Date.now,
      input.id ?? randomUUID,
      input.output ?? new WorktreeOperationOutputBuffer(input.now ?? Date.now),
      input.autoDeletePolicy ?? (() => ({ enabled: false, limit: 0 })),
      input.settings ?? (() => ({})),
    )
  }

  private async git(
    cwd: string,
    args: readonly string[],
    input?: string,
    environment?: Readonly<Record<string, string>>,
  ): Promise<GitResult> {
    const hooksPath = process.platform === 'win32' ? 'NUL' : '/dev/null'
    const processHandle = Bun.spawn(
      ['git', '-c', `core.hooksPath=${hooksPath}`, '-c', 'core.fsmonitor=false', ...args],
      {
        cwd,
        stdin: input === undefined ? 'ignore' : new Blob([input]),
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              (entry): entry is [string, string] => entry[1] !== undefined,
            ),
          ),
          ...environment,
        },
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
      processHandle.exited,
    ])
    return { code, stdout, stderr }
  }

  private async requireGit(
    cwd: string,
    args: readonly string[],
    code: string,
    input?: string,
    environment?: Readonly<Record<string, string>>,
  ) {
    const result = await this.git(cwd, args, input, environment)
    if (result.code !== 0) throw new AgentError(code, 'Git worktree 操作失败', 409)
    return result.stdout.trim()
  }

  private includeService() {
    return new WorktreeIncludeService(async (cwd, args) =>
      this.requireGit(cwd, args, 'WORKTREE_GIT_FAILED'),
    )
  }

  private snapshotStore() {
    return new WorktreeRestoreSnapshotStore(
      resolve(this.stateRoot, 'worktree-restore'),
      this.includeService(),
      this.id,
    )
  }

  private requireWorktree(id: string) {
    const value = this.repository.readWorktree(id)
    if (!value) throw new AgentError('WORKTREE_NOT_FOUND', '托管 worktree 不存在', 404)
    return value
  }

  private startOperation(input: {
    operationId: string
    projectId: string
    worktreeId: string | null
    kind: WorktreeOperationKind
    request: unknown
  }) {
    const requestHash = hash(input.request)
    const validateReplay = (existing: WorktreeOperation) => {
      if (existing.kind !== input.kind || existing.requestHash !== requestHash) {
        throw new AgentError(
          'WORKTREE_OPERATION_CONFLICT',
          'operationId 已用于不同的 worktree 请求',
          409,
        )
      }
      return { operation: existing, replay: true as const }
    }
    const existing = this.repository.operation(input.operationId)
    if (existing) return validateReplay(existing)
    const timestamp = this.now()
    try {
      return {
        operation: this.repository.insertOperation({
          operationId: input.operationId,
          worktreeId: input.worktreeId,
          projectId: input.projectId,
          kind: input.kind,
          requestHash,
          step: 'queued',
          status: 'pending',
          revision: 1,
          errorCode: null,
          warnings: [],
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: null,
        }),
        replay: false as const,
      }
    } catch (cause) {
      const raced = this.repository.operation(input.operationId)
      if (raced) return validateReplay(raced)
      throw cause
    }
  }

  private updateOperation(
    operationId: string,
    patch: Parameters<WorktreeRepository['updateOperation']>[1],
  ) {
    const operation = this.repository.updateOperation(operationId, {
      ...patch,
      updatedAt: patch.updatedAt ?? this.now(),
    })
    if (!operation)
      throw new AgentError('WORKTREE_OPERATION_CONFLICT', 'worktree operation 状态已变化', 409)
    return operation
  }

  private updateWorktree(
    current: ManagedWorktree,
    patch: Parameters<WorktreeRepository['updateWorktreeCas']>[2],
  ) {
    const requestedTimestamp = patch.updatedAt ?? this.now()
    const updatedAt = Math.max(requestedTimestamp, current.updatedAt + 1)
    const updated = this.repository.updateWorktreeCas(current.id, current.updatedAt, {
      ...patch,
      updatedAt,
    })
    if (!updated)
      throw new AgentError('WORKTREE_OPERATION_CONFLICT', 'worktree 状态已被其他操作修改', 409)
    return updated
  }

  private claimWorktreeOperation(operation: WorktreeOperation, worktreeId: string) {
    const claimed = this.repository.claimOperation(operation.operationId, worktreeId, this.now())
    if (claimed.status === 'claimed') return claimed.operation
    const current = this.repository.operation(operation.operationId)
    if (current?.status === 'pending') {
      this.updateOperation(operation.operationId, {
        step: 'conflict',
        status: 'failed',
        errorCode: 'WORKTREE_OPERATION_CONFLICT',
        completedAt: this.now(),
      })
      this.output.complete(operation.operationId)
    }
    throw new AgentError('WORKTREE_OPERATION_CONFLICT', '另一个 worktree 操作仍在进行', 409)
  }

  private result(worktreeId: string, operationId: string) {
    return {
      worktree: publicWorktree(this.requireWorktree(worktreeId)),
      operation: publicOperation(this.operation(operationId)),
    }
  }

  private async projectRepository(projectId: string) {
    const requested = await this.resolveProjectRoot(projectId)
    if (!requested) throw new AgentError('PROJECT_NOT_FOUND', '项目不存在或没有主目录', 404)
    const root = await realpath(requested).catch(() => {
      throw new AgentError('PROJECT_NOT_FOUND', '项目主目录不存在', 404)
    })
    const discovered = await this.requireGit(
      root,
      ['rev-parse', '--show-toplevel'],
      'WORKTREE_GIT_FAILED',
    )
    const canonical = await realpath(discovered)
    if (pathKey(canonical) !== pathKey(root)) {
      throw new AgentError('WORKTREE_PATH_UNSAFE', '项目主目录必须是 Git 根目录', 409)
    }
    return canonical
  }

  async eligibility(projectId: string) {
    const requested = await this.resolveProjectRoot(projectId)
    if (!requested) throw new AgentError('PROJECT_NOT_FOUND', '项目不存在或没有主目录', 404)
    try {
      await this.projectRepository(projectId)
      return {
        isGitRepository: true,
        availableModes: ['local', 'worktree'] as const,
        defaultMode: 'worktree' as const,
      }
    } catch (cause) {
      if (cause instanceof AgentError && cause.code === 'PROJECT_NOT_FOUND') throw cause
      return {
        isGitRepository: false,
        availableModes: ['local'] as const,
        defaultMode: 'local' as const,
      }
    }
  }

  private async sourceRepository(repositoryRoot: string, requested?: string) {
    if (!requested) return repositoryRoot
    const source = await realpath(requested).catch(() => {
      throw new AgentError('WORKTREE_PATH_UNSAFE', 'worktree 源目录不可用', 409)
    })
    const sourceTopLevel = await realpath(
      await this.requireGit(source, ['rev-parse', '--show-toplevel'], 'WORKTREE_GIT_FAILED'),
    )
    if (pathKey(sourceTopLevel) !== pathKey(source)) {
      throw new AgentError('WORKTREE_PATH_UNSAFE', 'worktree 源目录必须是 Git 根目录', 409)
    }
    const [sourceCommon, repositoryCommon] = await Promise.all([
      this.requireGit(
        source,
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        'WORKTREE_GIT_FAILED',
      ),
      this.requireGit(
        repositoryRoot,
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        'WORKTREE_GIT_FAILED',
      ),
    ])
    if (
      pathKey(resolve(source, sourceCommon)) !== pathKey(resolve(repositoryRoot, repositoryCommon))
    ) {
      throw new AgentError('WORKTREE_PATH_DENIED', 'worktree 源目录不属于当前项目仓库', 403)
    }
    return source
  }

  private targetPath(repositoryRoot: string, id: string, suffix = '', root = this.managedRoot) {
    const repositoryHash = createHash('sha256')
      .update(pathKey(repositoryRoot), 'utf8')
      .digest('hex')
      .slice(0, 16)
    const target = resolve(root, `${repositoryHash}-${id}${suffix}`)
    if (!contained(root, target))
      throw new AgentError('WORKTREE_PATH_DENIED', 'worktree 目标路径越界', 403)
    return target
  }

  private async assertNewTarget(target: string, root = this.managedRoot) {
    const directory = await lstat(root)
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      (await realpath(root)) !== resolve(root)
    )
      throw new AgentError('WORKTREE_PATH_UNSAFE', 'worktree 托管根目录已变化', 409)
    if (!contained(root, target))
      throw new AgentError('WORKTREE_PATH_DENIED', 'worktree 目标路径越界', 403)
    const existing = await lstat(target).catch((cause: NodeJS.ErrnoException) =>
      cause.code === 'ENOENT' ? null : Promise.reject(cause),
    )
    if (existing) throw new AgentError('WORKTREE_PATH_UNSAFE', 'worktree 目标已存在', 409)
  }

  async create(input: CreateManagedWorktreeInput) {
    const started = this.startOperation({
      operationId: input.operationId,
      projectId: input.projectId,
      worktreeId: null,
      kind: 'create',
      request: {
        projectId: input.projectId,
        startingState: input.startingState,
        snapshotMode: input.snapshotMode ?? 'working-tree',
      },
    })
    if (started.replay) {
      if (!started.operation.worktreeId) {
        if (started.operation.status === 'pending' || started.operation.status === 'running') {
          throw new AgentError('WORKTREE_OPERATION_CONFLICT', 'worktree 创建仍在进行', 409)
        }
        throw new AgentError('WORKTREE_OPERATION_CONFLICT', 'worktree 创建未建立可恢复资源', 409)
      }
      return this.result(started.operation.worktreeId, input.operationId)
    }

    let worktree: ManagedWorktree | null = null
    try {
      const repositoryRoot = await this.projectRepository(input.projectId)
      const sourceRoot = await this.sourceRepository(repositoryRoot, input.sourceWorkspacePath)
      const worktreeId = this.id()
      const preference = this.settings()
      const requestedRoot = preference.root?.trim() || this.managedRoot
      if (requestedRoot !== this.managedRoot && !this.repository.settingsAvailable())
        throw new AgentError('WORKTREE_NOT_READY', '当前存储不支持自定义工作树根目录', 409)
      if (!isAbsolute(requestedRoot))
        throw new AgentError('WORKTREE_PATH_UNSAFE', '工作树根目录必须为绝对路径', 400)
      if (
        contained(repositoryRoot, resolve(requestedRoot)) ||
        contained(resolve(requestedRoot), repositoryRoot)
      )
        throw new AgentError('WORKTREE_PATH_UNSAFE', '工作树根目录不能与项目目录相互包含', 409)
      await mkdir(requestedRoot, { recursive: true })
      const rootMetadata = await lstat(requestedRoot)
      if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink())
        throw new AgentError('WORKTREE_PATH_UNSAFE', '工作树根目录必须为普通目录', 409)
      const creationRoot = await realpath(requestedRoot)
      if (contained(repositoryRoot, creationRoot) || contained(creationRoot, repositoryRoot))
        throw new AgentError('WORKTREE_PATH_UNSAFE', '工作树根目录不能与项目目录相互包含', 409)
      let fetchWarning: string | null = null
      if (preference.fetchUpstream) {
        try {
          await new GitCommandRunner({ timeoutMs: 30_000, maxOutputBytes: 256 * 1024 }).run({
            cwd: repositoryRoot,
            args: [
              '-c',
              `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
              'fetch',
              '--all',
              '--prune',
            ],
            env: { GIT_TERMINAL_PROMPT: '0' },
          })
        } catch {
          fetchWarning = '上游获取失败，继续使用本地引用'
        }
      }
      const target = this.targetPath(repositoryRoot, worktreeId, '', creationRoot)
      await this.assertNewTarget(target, creationRoot)
      let branchName: string | null = null
      let baseCommit: string
      let layers: Awaited<
        ReturnType<WorkspaceIsolationService['captureWorkingTreeLayers']>
      > | null = null
      if (input.startingState.type === 'branch') {
        branchName = input.startingState.branchName
        baseCommit = await this.requireGit(
          repositoryRoot,
          ['rev-parse', '--verify', `${branchName}^{commit}`],
          'WORKTREE_BRANCH_NOT_FOUND',
        )
      } else if (input.snapshotMode === 'head') {
        baseCommit = await this.requireGit(
          sourceRoot,
          ['rev-parse', '--verify', 'HEAD^{commit}'],
          'WORKTREE_GIT_FAILED',
        )
      } else {
        const isolation = await WorkspaceIsolationService.open(sourceRoot, this.stateRoot)
        layers = await isolation.captureWorkingTreeLayers()
        baseCommit = layers.headCommit
      }
      const timestamp = this.now()
      worktree = this.repository.insertWorktree({
        id: worktreeId,
        projectId: input.projectId,
        repositoryRoot,
        path: target,
        status: 'creating',
        branchName,
        baseCommit,
        headCommit: baseCommit,
        permanent: false,
        pinned: false,
        boundOnce: false,
        setupStatus: 'pending',
        environmentRevision: 0,
        continuedWithoutSetup: false,
        restoreSnapshotPath: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastUsedAt: timestamp,
        deletedAt: null,
      })
      this.updateOperation(input.operationId, {
        worktreeId,
        step: 'create-worktree',
        status: 'running',
        ...(fetchWarning ? { warnings: [fetchWarning] } : {}),
      })
      this.repository.setOwnedRoot(worktreeId, creationRoot)
      await this.requireGit(
        repositoryRoot,
        ['worktree', 'add', '--detach', target, baseCommit],
        'WORKTREE_GIT_FAILED',
      )
      const canonical = await realpath(target)
      const metadata = await lstat(canonical)
      if (
        !contained(creationRoot, canonical) ||
        !metadata.isDirectory() ||
        metadata.isSymbolicLink()
      ) {
        throw new AgentError('WORKTREE_PATH_DENIED', 'Git 创建的 worktree 越界', 403)
      }
      worktree = this.updateWorktree(worktree, { path: canonical })
      if (layers) {
        this.updateOperation(input.operationId, { step: 'apply-working-tree' })
        if (layers.stagedPatch) {
          const checked = await this.git(
            canonical,
            ['apply', '--check', '--index', '--binary', '--whitespace=nowarn', '-'],
            layers.stagedPatch,
          )
          if (checked.code !== 0)
            throw new AgentError(
              'WORKTREE_APPLY_CONFLICT',
              'working tree staged 快照无法无冲突应用',
              409,
            )
          await this.requireGit(
            canonical,
            ['apply', '--index', '--binary', '--whitespace=nowarn', '-'],
            'WORKTREE_APPLY_CONFLICT',
            layers.stagedPatch,
          )
        }
        if (layers.unstagedPatch) {
          const checked = await this.git(
            canonical,
            ['apply', '--check', '--binary', '--whitespace=nowarn', '-'],
            layers.unstagedPatch,
          )
          if (checked.code !== 0)
            throw new AgentError(
              'WORKTREE_APPLY_CONFLICT',
              'working tree unstaged 快照无法无冲突应用',
              409,
            )
          await this.requireGit(
            canonical,
            ['apply', '--binary', '--whitespace=nowarn', '-'],
            'WORKTREE_APPLY_CONFLICT',
            layers.unstagedPatch,
          )
        }
        await this.includeService().copyRegularFiles(sourceRoot, canonical, layers.untrackedFiles)
      }
      const copyResult =
        input.snapshotMode === 'head'
          ? { copied: 0, skipped: 0 }
          : await this.includeService().copy(sourceRoot, canonical)
      const warnings =
        copyResult.skipped > 0 ? ['部分 worktree include 文件因安全边界或目标已存在而跳过'] : []
      this.updateOperation(input.operationId, { step: 'setup', warnings })
      const setup = await this.environment
        .setup({
          operationId: input.operationId,
          projectId: input.projectId,
          worktreeId,
          sourceWorkspacePath: sourceRoot,
          workspacePath: canonical,
          onOutput: (chunk) => this.output.append(input.operationId, chunk),
        })
        .catch((): WorktreeSetupResult => ({ status: 'failed', environmentRevision: 0 }))
      const status =
        setup.status === 'succeeded' ? ('ready' as const) : ('ready-with-setup-error' as const)
      worktree = this.updateWorktree(worktree, {
        status,
        setupStatus: setup.status,
        environmentRevision: setup.status === 'succeeded' ? setup.environmentRevision : 0,
      })
      const operation = this.updateOperation(input.operationId, {
        step: 'complete',
        status: 'completed',
        warnings: [...(fetchWarning ? [fetchWarning] : []), ...warnings, ...(setup.warnings ?? [])],
        completedAt: this.now(),
      })
      this.output.complete(input.operationId)
      return { worktree: publicWorktree(worktree), operation: publicOperation(operation) }
    } catch (cause) {
      if (worktree) {
        await this.removeManagedPath(worktree).catch(() => undefined)
        const latest = this.repository.readWorktree(worktree.id)
        if (latest && latest.updatedAt === worktree.updatedAt) {
          this.updateWorktree(latest, { status: 'cleaned', deletedAt: this.now() })
        }
      }
      this.updateOperation(input.operationId, {
        step: 'failed',
        status: 'failed',
        errorCode: safeCode(cause, 'WORKTREE_GIT_FAILED'),
        completedAt: this.now(),
      })
      this.output.complete(input.operationId)
      throw cause
    }
  }

  list(projectId?: string) {
    return { worktrees: this.repository.listWorktrees(projectId).map(publicWorktree) }
  }

  settingsList(projectId?: string) {
    return this.repository.listWorktrees(projectId).map((worktree) => ({
      worktree: publicWorktree(worktree),
      path: worktree.path,
      repositoryRoot: worktree.repositoryRoot,
      conversations: this.repository.conversations(worktree.id),
    }))
  }

  read(worktreeId: string) {
    return publicWorktree(this.requireWorktree(worktreeId))
  }

  operation(operationId: string) {
    const value = this.repository.operation(operationId)
    if (!value)
      throw new AgentError('WORKTREE_OPERATION_NOT_FOUND', 'worktree operation 不存在', 404)
    return value
  }

  operationStatus(operationId: string, afterOutputCursor = 0) {
    return {
      operation: publicOperation(this.operation(operationId)),
      output: this.output.read(operationId, afterOutputCursor),
    }
  }

  async retrySetup(input: {
    worktreeId: string
    operationId: string
    sourceWorkspacePath?: string
  }) {
    let worktree = this.requireWorktree(input.worktreeId)
    const started = this.startOperation({
      ...input,
      projectId: worktree.projectId,
      kind: 'retry-setup',
      request: { worktreeId: input.worktreeId },
    })
    if (started.replay) return this.result(worktree.id, input.operationId)
    this.claimWorktreeOperation(started.operation, worktree.id)
    worktree = this.requireWorktree(input.worktreeId)
    try {
      this.updateOperation(input.operationId, { step: 'setup', status: 'running' })
      const setup = await this.environment
        .setup({
          operationId: input.operationId,
          projectId: worktree.projectId,
          worktreeId: worktree.id,
          sourceWorkspacePath: input.sourceWorkspacePath ?? worktree.repositoryRoot,
          workspacePath: worktree.path,
          onOutput: (chunk) => this.output.append(input.operationId, chunk),
        })
        .catch((): WorktreeSetupResult => ({ status: 'failed', environmentRevision: 0 }))
      const updated = this.updateWorktree(worktree, {
        status: setup.status === 'succeeded' ? 'ready' : 'ready-with-setup-error',
        setupStatus: setup.status,
        environmentRevision:
          setup.status === 'succeeded' ? setup.environmentRevision : worktree.environmentRevision,
        continuedWithoutSetup: false,
      })
      const operation = this.updateOperation(input.operationId, {
        step: 'complete',
        status: 'completed',
        warnings: [...(setup.warnings ?? [])],
        completedAt: this.now(),
      })
      this.output.complete(input.operationId)
      return { worktree: publicWorktree(updated), operation: publicOperation(operation) }
    } catch (cause) {
      this.updateOperation(input.operationId, {
        step: 'failed',
        status: 'failed',
        errorCode: safeCode(cause, 'WORKTREE_SETUP_REQUIRED'),
        completedAt: this.now(),
      })
      this.output.complete(input.operationId)
      throw cause
    }
  }

  continueWithoutSetup(input: { worktreeId: string; operationId: string }) {
    let worktree = this.requireWorktree(input.worktreeId)
    if (worktree.status !== 'ready-with-setup-error')
      throw new AgentError('WORKTREE_NOT_READY', 'worktree 不处于 setup 失败状态', 409)
    const started = this.startOperation({
      ...input,
      projectId: worktree.projectId,
      kind: 'continue-without-setup',
      request: input,
    })
    if (started.replay) return this.result(worktree.id, input.operationId)
    this.claimWorktreeOperation(started.operation, worktree.id)
    worktree = this.requireWorktree(input.worktreeId)
    if (worktree.status !== 'ready-with-setup-error') {
      this.updateOperation(input.operationId, {
        step: 'failed',
        status: 'failed',
        errorCode: 'WORKTREE_NOT_READY',
        completedAt: this.now(),
      })
      this.output.complete(input.operationId)
      throw new AgentError('WORKTREE_NOT_READY', 'worktree 不处于 setup 失败状态', 409)
    }
    const updated = this.updateWorktree(worktree, {
      continuedWithoutSetup: true,
      setupStatus: 'skipped',
    })
    const operation = this.updateOperation(input.operationId, {
      step: 'complete',
      status: 'completed',
      completedAt: this.now(),
    })
    this.output.complete(input.operationId)
    return { worktree: publicWorktree(updated), operation: publicOperation(operation) }
  }

  setPermanent(input: { worktreeId: string; permanent: boolean; operationId: string }) {
    let worktree = this.requireWorktree(input.worktreeId)
    const started = this.startOperation({
      ...input,
      projectId: worktree.projectId,
      kind: 'set-permanent',
      request: input,
    })
    if (started.replay) return this.result(worktree.id, input.operationId)
    this.claimWorktreeOperation(started.operation, worktree.id)
    worktree = this.requireWorktree(input.worktreeId)
    const updated = this.updateWorktree(worktree, { permanent: input.permanent })
    const operation = this.updateOperation(input.operationId, {
      step: 'complete',
      status: 'completed',
      completedAt: this.now(),
    })
    this.output.complete(input.operationId)
    return { worktree: publicWorktree(updated), operation: publicOperation(operation) }
  }

  private async assertRegistered(worktree: ManagedWorktree) {
    const list = await this.requireGit(
      worktree.repositoryRoot,
      ['worktree', 'list', '--porcelain'],
      'WORKTREE_GIT_FAILED',
    )
    const registered = list
      .split(/\r?\n/)
      .filter((line) => line.startsWith('worktree '))
      .map((line) => pathKey(line.slice(9)))
    if (
      !registered.includes(pathKey(worktree.path)) ||
      !contained(this.repository.ownedRoot(worktree.id) ?? this.managedRoot, worktree.path)
    ) {
      throw new AgentError('WORKTREE_PATH_DENIED', '只允许删除已登记的托管 worktree', 403)
    }
  }

  private async removeManagedPath(worktree: ManagedWorktree) {
    const requested = resolve(worktree.path)
    const root = this.repository.ownedRoot(worktree.id) ?? this.managedRoot
    if (!contained(root, requested)) {
      throw new AgentError('WORKTREE_PATH_DENIED', 'worktree 删除路径越界', 403)
    }
    const canonical = await realpath(requested).catch((cause: NodeJS.ErrnoException) =>
      cause.code === 'ENOENT' ? null : Promise.reject(cause),
    )
    if (canonical && !contained(root, canonical)) {
      throw new AgentError('WORKTREE_PATH_DENIED', 'worktree 删除路径越界', 403)
    }
    await this.assertRegistered({ ...worktree, path: canonical ?? requested })
    await this.requireGit(
      worktree.repositoryRoot,
      ['worktree', 'remove', '--force', canonical ?? requested],
      'WORKTREE_GIT_FAILED',
    )
  }

  private async preflightRestore(workspacePath: string, snapshot: WorktreeRestoreSnapshot) {
    const temporary = await mkdtemp(join(this.stateRoot, 'restore-index-'))
    const environment = { GIT_INDEX_FILE: resolve(temporary, 'index') }
    try {
      await this.requireGit(
        workspacePath,
        ['read-tree', snapshot.headCommit],
        'WORKTREE_RESTORE_FAILED',
        undefined,
        environment,
      )
      for (const patch of [snapshot.stagedPatch, snapshot.unstagedPatch]) {
        if (!patch) continue
        const checked = await this.git(
          workspacePath,
          ['apply', '--cached', '--check', '--binary', '--whitespace=nowarn', '-'],
          patch,
          environment,
        )
        if (checked.code !== 0) return false
        await this.requireGit(
          workspacePath,
          ['apply', '--cached', '--binary', '--whitespace=nowarn', '-'],
          'WORKTREE_RESTORE_FAILED',
          patch,
          environment,
        )
      }
      const files = await this.includeService().preflightRegularFiles(
        snapshot.filesRoot,
        workspacePath,
        snapshot.files,
      )
      return files.ready
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  async delete(input: {
    worktreeId: string
    operationId: string
    kind?: 'delete' | 'auto-cleanup'
    archiveConversations?: () => Promise<void>
  }) {
    let worktree = this.requireWorktree(input.worktreeId)
    if (!input.archiveConversations && this.repository.hasUnarchivedBinding(worktree.id)) {
      throw new AgentError('WORKTREE_NOT_READY', '仍有未归档任务使用此 worktree', 409)
    }
    const kind = input.kind ?? 'delete'
    const started = this.startOperation({
      ...input,
      projectId: worktree.projectId,
      kind,
      request: { worktreeId: input.worktreeId, operationId: input.operationId, kind: input.kind },
    })
    if (started.replay) return this.result(worktree.id, input.operationId)
    this.claimWorktreeOperation(started.operation, worktree.id)
    try {
      await input.archiveConversations?.()
    } catch (cause) {
      this.updateOperation(input.operationId, {
        step: 'failed',
        status: 'failed',
        errorCode: safeCode(cause, 'WORKTREE_NOT_READY'),
        completedAt: this.now(),
      })
      this.output.complete(input.operationId)
      throw cause
    }
    worktree = this.requireWorktree(input.worktreeId)
    if (this.repository.hasUnarchivedBinding(worktree.id)) {
      this.updateOperation(input.operationId, {
        step: 'failed',
        status: 'failed',
        errorCode: 'WORKTREE_NOT_READY',
        completedAt: this.now(),
      })
      this.output.complete(input.operationId)
      throw new AgentError('WORKTREE_NOT_READY', '仍有未归档任务使用此 worktree', 409)
    }
    const originalStatus = worktree.status
    let removed = false
    try {
      this.updateOperation(input.operationId, { step: 'cleanup', status: 'running' })
      await this.assertRegistered(worktree)
      const cleanup = await this.environment
        .cleanup({
          operationId: input.operationId,
          projectId: worktree.projectId,
          worktreeId: worktree.id,
          workspacePath: worktree.path,
          onOutput: (chunk) => this.output.append(input.operationId, chunk),
        })
        .catch(() => {
          throw new AgentError('WORKTREE_CLEANUP_FAILED', 'worktree cleanup 失败，已保留目录', 409)
        })
      const snapshotPath = await this.snapshotStore().capture(worktree.id, worktree.path)
      worktree = this.updateWorktree(worktree, {
        status: 'deleting',
        restoreSnapshotPath: snapshotPath,
      })
      this.updateOperation(input.operationId, {
        step: 'remove-worktree',
        warnings: [...(cleanup.warnings ?? [])],
      })
      await this.removeManagedPath(worktree)
      removed = true
      const updated = this.updateWorktree(worktree, { status: 'cleaned', deletedAt: this.now() })
      const operation = this.updateOperation(input.operationId, {
        step: 'complete',
        status: 'completed',
        completedAt: this.now(),
      })
      this.output.complete(input.operationId)
      return { worktree: publicWorktree(updated), operation: publicOperation(operation) }
    } catch (cause) {
      const latest = this.repository.readWorktree(worktree.id)
      if (latest?.status === 'deleting') {
        this.updateWorktree(
          latest,
          removed ? { status: 'cleaned', deletedAt: this.now() } : { status: originalStatus },
        )
      }
      const currentOperation = this.repository.operation(input.operationId)
      if (
        currentOperation &&
        currentOperation.status !== 'completed' &&
        currentOperation.status !== 'failed'
      ) {
        this.updateOperation(input.operationId, {
          step: 'failed',
          status: 'failed',
          errorCode: safeCode(cause, 'WORKTREE_GIT_FAILED'),
          completedAt: this.now(),
        })
      }
      this.output.complete(input.operationId)
      throw cause
    }
  }

  async restore(input: { worktreeId: string; operationId: string }) {
    let worktree = this.requireWorktree(input.worktreeId)
    if (worktree.status !== 'cleaned' || !worktree.restoreSnapshotPath) {
      throw new AgentError('WORKTREE_RESTORE_FAILED', 'worktree 没有可恢复快照', 409)
    }
    const started = this.startOperation({
      ...input,
      projectId: worktree.projectId,
      kind: 'restore',
      request: input,
    })
    if (started.replay) return this.result(worktree.id, input.operationId)
    this.claimWorktreeOperation(started.operation, worktree.id)
    worktree = this.requireWorktree(input.worktreeId)
    if (worktree.status !== 'cleaned' || !worktree.restoreSnapshotPath) {
      this.updateOperation(input.operationId, {
        step: 'failed',
        status: 'failed',
        errorCode: 'WORKTREE_RESTORE_FAILED',
        completedAt: this.now(),
      })
      this.output.complete(input.operationId)
      throw new AgentError('WORKTREE_RESTORE_FAILED', 'worktree 没有可恢复快照', 409)
    }
    let canonical: string | null = null
    try {
      const snapshot = await this.snapshotStore().read(worktree.restoreSnapshotPath)
      const target = this.targetPath(
        worktree.repositoryRoot,
        worktree.id,
        `-r${this.now().toString(36)}-${this.id()}`,
        this.repository.ownedRoot(worktree.id) ?? this.managedRoot,
      )
      await this.assertNewTarget(target, this.repository.ownedRoot(worktree.id) ?? this.managedRoot)
      this.updateOperation(input.operationId, { step: 'restore-worktree', status: 'running' })
      await this.requireGit(
        worktree.repositoryRoot,
        ['worktree', 'add', '--detach', target, snapshot.headCommit],
        'WORKTREE_RESTORE_FAILED',
      )
      canonical = await realpath(target)
      const preflightPassed = await this.preflightRestore(canonical, snapshot)
      if (!preflightPassed) {
        const conflicted = this.updateWorktree(worktree, {
          path: canonical,
          status: 'restore-conflict',
        })
        const operation = this.updateOperation(input.operationId, {
          step: 'apply-conflict',
          status: 'failed',
          errorCode: 'WORKTREE_APPLY_CONFLICT',
          completedAt: this.now(),
        })
        this.output.complete(input.operationId)
        return { worktree: publicWorktree(conflicted), operation: publicOperation(operation) }
      }
      if (snapshot.stagedPatch) {
        await this.requireGit(
          canonical,
          ['apply', '--index', '--binary', '--whitespace=nowarn', '-'],
          'WORKTREE_RESTORE_FAILED',
          snapshot.stagedPatch,
        )
      }
      if (snapshot.unstagedPatch) {
        await this.requireGit(
          canonical,
          ['apply', '--binary', '--whitespace=nowarn', '-'],
          'WORKTREE_RESTORE_FAILED',
          snapshot.unstagedPatch,
        )
      }
      const copied = await this.includeService().copyRegularFiles(
        snapshot.filesRoot,
        canonical,
        snapshot.files,
      )
      if (copied.skipped > 0)
        throw new AgentError('WORKTREE_APPLY_CONFLICT', '恢复文件在预检后发生冲突', 409)
      const restored = this.updateWorktree(worktree, {
        path: canonical,
        headCommit: snapshot.headCommit,
        status: worktree.setupStatus === 'failed' ? 'ready-with-setup-error' : 'ready',
        deletedAt: null,
        lastUsedAt: this.now(),
      })
      this.repository.rebindWorktreePath(worktree.id, canonical, this.now())
      const operation = this.updateOperation(input.operationId, {
        step: 'complete',
        status: 'completed',
        completedAt: this.now(),
      })
      this.output.complete(input.operationId)
      return { worktree: publicWorktree(restored), operation: publicOperation(operation) }
    } catch (cause) {
      const latest = this.repository.readWorktree(worktree.id)
      if (latest && latest.updatedAt === worktree.updatedAt && canonical) {
        this.updateWorktree(latest, { path: canonical, status: 'restore-conflict' })
      }
      const current = this.operation(input.operationId)
      if (current.status !== 'failed' && current.status !== 'completed') {
        this.updateOperation(input.operationId, {
          step: 'failed',
          status: 'failed',
          errorCode: safeCode(cause, 'WORKTREE_RESTORE_FAILED'),
          completedAt: this.now(),
        })
      }
      this.output.complete(input.operationId)
      throw cause
    }
  }

  async autoCleanup(projectId: string) {
    const policy = this.autoDeletePolicy()
    if (!policy.enabled) return []
    const keepLimit = Math.max(0, Math.floor(policy.limit))
    const all = this.repository
      .listWorktrees(projectId)
      .filter((value) => value.status !== 'cleaned')
    const excess = Math.max(0, all.length - Math.max(0, keepLimit))
    const candidates = this.repository.cleanupCandidates(projectId, excess)
    const cleaned: string[] = []
    for (const worktree of candidates) {
      await this.delete({
        worktreeId: worktree.id,
        operationId: `auto-cleanup:${this.id()}`,
        kind: 'auto-cleanup',
      })
      cleaned.push(worktree.id)
    }
    return cleaned
  }
}
