import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { AgentError } from '../Domain'

const MAX_PATCH_BYTES = 25 * 1024 * 1024
const MAX_DIAGNOSTIC_BYTES = 4_000
const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i

export type RepositoryMetadata =
  | {
      readonly kind: 'git'
      readonly rootPath: string
      readonly gitDir: string
      readonly headCommit: string | null
    }
  | { readonly kind: 'non-git'; readonly rootPath: string }

export interface BaselineMetadata {
  readonly id: string
  readonly mode: 'shared' | 'worktree'
  readonly repositoryKind: RepositoryMetadata['kind']
  readonly sourceRoot: string
  readonly workspacePath: string
  readonly createdAt: number
  readonly headCommit: string | null
  readonly snapshotCommit: string | null
  readonly snapshotTree: string | null
  readonly ref: string | null
}

export interface WorkspaceDiff {
  readonly baselineCommit: string
  readonly currentCommit: string
  readonly patch: string
  readonly sha256: string
  readonly empty: boolean
}

export interface WorkingTreeSnapshot {
  readonly headCommit: string
  readonly snapshotCommit: string
  readonly patch: string
  readonly sha256: string
  readonly empty: boolean
}

export interface WorkingTreeLayers {
  readonly headCommit: string
  readonly stagedPatch: string
  readonly unstagedPatch: string
  readonly untrackedFiles: readonly string[]
}

export type ThreeWayPreflightResult =
  | {
      readonly status: 'ready'
      readonly token: string
      readonly expectedTree: string
      readonly resultTree: string
      readonly patchSha256: string
    }
  | { readonly status: 'conflict'; readonly diagnostics: string; readonly patchSha256: string }

export type ThreeWayApplyResult =
  | { readonly status: 'applied'; readonly resultTree: string }
  | { readonly status: 'stale'; readonly expectedTree: string; readonly actualTree: string }
  | { readonly status: 'failed'; readonly diagnostics: string; readonly workspaceUnchanged: true }
  | { readonly status: 'partial'; readonly diagnostics: string; readonly workspaceUnchanged: false }

export interface WorkspaceCleanupResult {
  readonly workspaceID: string
  readonly disposition: 'completed' | 'discarded'
  readonly path: string
}

export interface WorkspaceIsolationOptions {
  readonly now?: () => number
  readonly id?: () => string
}

interface GitResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

interface Snapshot {
  readonly commit: string
  readonly tree: string
  readonly parent: string
}

interface PreparedApply {
  readonly expectedCommit: string
  readonly expectedTree: string
  readonly resultCommit: string
  readonly resultTree: string
}

const isWithin = (parent: string, child: string) => {
  const result = relative(parent, child)
  return result === '' || (!result.startsWith('..') && !isAbsolute(result))
}

const trimDiagnostic = (value: string) => value.slice(0, MAX_DIAGNOSTIC_BYTES).trim()
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

const validateWorkspaceID = (value: string) => {
  if (
    !WORKSPACE_ID.test(value) ||
    value === '.' ||
    value === '..' ||
    value.endsWith('.') ||
    WINDOWS_RESERVED_NAME.test(value)
  ) {
    throw new AgentError('SUBAGENT_WORKSPACE_ID_INVALID', '子智能体工作区 ID 不是安全的目录名', 400)
  }
}

const controlledDirectory = async (path: string) => {
  await mkdir(path, { recursive: true })
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new AgentError('SUBAGENT_DATA_DIR_INVALID', '子智能体数据目录必须是普通目录', 400)
  }
  return realpath(path)
}

/**
 * Owns Git-backed child worktrees without mutating the user's index. Non-Git
 * workspaces are identified but deliberately not copied: Git is the safety and
 * merge boundary for isolated execution.
 */
export class WorkspaceIsolationService {
  readonly repository: RepositoryMetadata

  private readonly worktreesRoot: string
  private readonly temporaryRoot: string
  private readonly hooksRoot: string
  private readonly now: () => number
  private readonly nextID: () => string
  private readonly worktrees = new Map<string, BaselineMetadata>()
  private readonly baselines = new Map<string, BaselineMetadata>()
  private readonly prepared = new Map<string, PreparedApply>()

  private constructor(
    repository: RepositoryMetadata,
    worktreesRoot: string,
    temporaryRoot: string,
    hooksRoot: string,
    options: WorkspaceIsolationOptions,
  ) {
    this.repository = repository
    this.worktreesRoot = worktreesRoot
    this.temporaryRoot = temporaryRoot
    this.hooksRoot = hooksRoot
    this.now = options.now ?? Date.now
    this.nextID = options.id ?? randomUUID
  }

  static async open(sourcePath: string, dataDir: string, options: WorkspaceIsolationOptions = {}) {
    const requestedSource = resolve(sourcePath)
    const source = await realpath(requestedSource).catch(() => {
      throw new AgentError('SUBAGENT_WORKSPACE_NOT_FOUND', '工作区目录不存在或不可访问', 404)
    })
    if (!(await stat(source)).isDirectory()) {
      throw new AgentError('SUBAGENT_WORKSPACE_NOT_DIRECTORY', '工作区路径必须是目录', 400)
    }

    const root = await controlledDirectory(resolve(dataDir, 'subagent-isolation'))
    if (isWithin(source, root) || isWithin(root, source)) {
      throw new AgentError('SUBAGENT_DATA_DIR_OVERLAP', '隔离数据目录不能与源工作区相互包含', 400)
    }
    const worktreesRoot = await controlledDirectory(join(root, 'worktrees'))
    const temporaryRoot = await controlledDirectory(join(root, 'tmp'))
    const hooksRoot = await controlledDirectory(join(root, 'empty-hooks'))

    const probe = await WorkspaceIsolationService.runRawGit(source, [
      'rev-parse',
      '--show-toplevel',
    ])
    let repository: RepositoryMetadata
    if (probe.code !== 0) {
      repository = { kind: 'non-git', rootPath: source }
    } else {
      const gitRoot = await realpath(probe.stdout.trim())
      const gitDirResult = await WorkspaceIsolationService.runRawGit(gitRoot, [
        'rev-parse',
        '--absolute-git-dir',
      ])
      if (gitDirResult.code !== 0) {
        throw new AgentError('SUBAGENT_GIT_INSPECTION_FAILED', '无法读取 Git 元数据', 500)
      }
      const head = await WorkspaceIsolationService.runRawGit(gitRoot, [
        'rev-parse',
        '--verify',
        'HEAD',
      ])
      if (isWithin(gitRoot, root) || isWithin(root, gitRoot)) {
        throw new AgentError(
          'SUBAGENT_DATA_DIR_OVERLAP',
          '隔离数据目录不能与 Git 仓库相互包含',
          400,
        )
      }
      repository = {
        kind: 'git',
        rootPath: gitRoot,
        gitDir: resolve(gitDirResult.stdout.trim()),
        headCommit: head.code === 0 ? head.stdout.trim() : null,
      }
    }

    const service = new WorkspaceIsolationService(
      repository,
      worktreesRoot,
      temporaryRoot,
      hooksRoot,
      options,
    )
    if (repository.kind === 'git') await service.rejectExecutableFilters()
    return service
  }

  private static async runRawGit(cwd: string, args: readonly string[]): Promise<GitResult> {
    const process = Bun.spawn(['git', ...args], {
      cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    return { code, stdout, stderr }
  }

  private async git(
    cwd: string,
    args: readonly string[],
    env?: Readonly<Record<string, string>>,
    input?: string,
  ): Promise<GitResult> {
    const command = [
      'git',
      '-c',
      `core.hooksPath=${this.hooksRoot}`,
      '-c',
      'core.fsmonitor=false',
      ...args,
    ]
    const process = Bun.spawn(command, {
      cwd,
      env: { ...processEnv(), ...env },
      stdin: input === undefined ? 'ignore' : new Blob([input]),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    return { code, stdout, stderr }
  }

  private gitRepository() {
    if (this.repository.kind !== 'git') {
      throw new AgentError(
        'SUBAGENT_GIT_REQUIRED',
        '非 Git 工作区不支持安全隔离、diff 或三方应用',
        400,
      )
    }
    if (!this.repository.headCommit) {
      throw new AgentError('SUBAGENT_GIT_HEAD_REQUIRED', 'Git 工作区必须至少包含一个提交', 400)
    }
    return this.repository
  }

  private async rejectExecutableFilters() {
    const repository = this.gitRepository()
    const result = await this.git(repository.rootPath, [
      'config',
      '--local',
      '--get-regexp',
      '^filter\\..*\\.(clean|smudge|process)$',
    ])
    if (result.code === 0 && result.stdout.trim()) {
      throw new AgentError(
        'SUBAGENT_GIT_FILTER_UNSAFE',
        '仓库配置了可执行 Git filter，无法安全创建隔离快照',
        400,
      )
    }
    if (result.code !== 0 && result.code !== 1) {
      throw new AgentError('SUBAGENT_GIT_INSPECTION_FAILED', '无法检查 Git filter 配置', 500)
    }
  }

  private async requireGit(
    cwd: string,
    args: readonly string[],
    code: string,
    input?: string,
    env?: Readonly<Record<string, string>>,
  ) {
    const result = await this.git(cwd, args, env, input)
    if (result.code !== 0) {
      throw new AgentError(code, trimDiagnostic(result.stderr) || 'Git 命令执行失败', 500)
    }
    return result.stdout.trim()
  }

  private async requireGitOutput(cwd: string, args: readonly string[], code: string) {
    const result = await this.git(cwd, args)
    if (result.code !== 0) {
      throw new AgentError(code, trimDiagnostic(result.stderr) || 'Git 命令执行失败', 500)
    }
    return result.stdout
  }

  private async snapshotCurrent(cwd: string, message: string): Promise<Snapshot> {
    this.gitRepository()
    const headCommit = await this.requireGit(
      cwd,
      ['rev-parse', '--verify', 'HEAD'],
      'SUBAGENT_SNAPSHOT_FAILED',
    )
    const temporary = await mkdtemp(join(this.temporaryRoot, 'index-'))
    const indexPath = join(temporary, 'index')
    const env = {
      GIT_INDEX_FILE: indexPath,
      GIT_AUTHOR_NAME: 'Pidex',
      GIT_AUTHOR_EMAIL: 'pidex@local.invalid',
      GIT_COMMITTER_NAME: 'Pidex',
      GIT_COMMITTER_EMAIL: 'pidex@local.invalid',
      GIT_AUTHOR_DATE: `@${Math.floor(this.now() / 1000)} +0000`,
      GIT_COMMITTER_DATE: `@${Math.floor(this.now() / 1000)} +0000`,
    }
    try {
      await this.requireGit(
        cwd,
        ['read-tree', headCommit],
        'SUBAGENT_SNAPSHOT_FAILED',
        undefined,
        env,
      )
      await this.requireGit(
        cwd,
        ['add', '-A', '--', '.'],
        'SUBAGENT_SNAPSHOT_FAILED',
        undefined,
        env,
      )
      const tree = await this.requireGit(
        cwd,
        ['write-tree'],
        'SUBAGENT_SNAPSHOT_FAILED',
        undefined,
        env,
      )
      const commit = await this.requireGit(
        cwd,
        ['commit-tree', tree, '-p', headCommit, '-m', message],
        'SUBAGENT_SNAPSHOT_FAILED',
        undefined,
        env,
      )
      return { commit, tree, parent: headCommit }
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  private async persistBaseline(mode: BaselineMetadata['mode'], workspacePath: string) {
    const repository = this.gitRepository()
    const id = this.nextID()
    if (!WORKSPACE_ID.test(id) || this.baselines.has(id)) {
      throw new AgentError('SUBAGENT_BASELINE_ID_INVALID', '基线 ID 生成器返回了无效或重复 ID', 500)
    }
    const snapshot = await this.snapshotCurrent(
      repository.rootPath,
      `Pidex ${mode} baseline ${id}`,
    )
    const ref = `refs/pidex/baselines/${id}`
    await this.requireGit(
      repository.rootPath,
      ['update-ref', ref, snapshot.commit],
      'SUBAGENT_BASELINE_FAILED',
    )
    const baseline: BaselineMetadata = {
      id,
      mode,
      repositoryKind: 'git',
      sourceRoot: repository.rootPath,
      workspacePath,
      createdAt: this.now(),
      headCommit: snapshot.parent,
      snapshotCommit: snapshot.commit,
      snapshotTree: snapshot.tree,
      ref,
    }
    this.baselines.set(id, baseline)
    return baseline
  }

  async captureSharedBaseline(): Promise<BaselineMetadata> {
    if (this.repository.kind === 'non-git') {
      const id = this.nextID()
      if (!WORKSPACE_ID.test(id) || this.baselines.has(id)) {
        throw new AgentError(
          'SUBAGENT_BASELINE_ID_INVALID',
          '基线 ID 生成器返回了无效或重复 ID',
          500,
        )
      }
      const baseline: BaselineMetadata = {
        id,
        mode: 'shared',
        repositoryKind: 'non-git',
        sourceRoot: this.repository.rootPath,
        workspacePath: this.repository.rootPath,
        createdAt: this.now(),
        headCommit: null,
        snapshotCommit: null,
        snapshotTree: null,
        ref: null,
      }
      this.baselines.set(baseline.id, baseline)
      return baseline
    }
    return this.persistBaseline('shared', this.repository.rootPath)
  }

  /**
   * Produces a binary patch from HEAD to the current index/worktree snapshot.
   * The temporary index preserves staged, unstaged and untracked regular Git
   * content without mutating the user's real index.
   */
  async captureWorkingTreeSnapshot(): Promise<WorkingTreeSnapshot> {
    const repository = this.gitRepository()
    const snapshot = await this.snapshotCurrent(
      repository.rootPath,
      'Pidex working-tree snapshot',
    )
    const patch = await this.requireGitOutput(
      repository.rootPath,
      [
        'diff',
        '--binary',
        '--full-index',
        '--no-ext-diff',
        '--no-textconv',
        snapshot.parent,
        snapshot.commit,
        '--',
      ],
      'SUBAGENT_DIFF_FAILED',
    )
    return {
      headCommit: snapshot.parent,
      snapshotCommit: snapshot.commit,
      patch,
      sha256: sha256(patch),
      empty: patch.length === 0,
    }
  }

  /** Captures Git layers without following or materializing untracked links. */
  async captureWorkingTreeLayers(): Promise<WorkingTreeLayers> {
    const repository = this.gitRepository()
    const [stagedPatch, unstagedPatch, untrackedOutput] = await Promise.all([
      this.requireGitOutput(
        repository.rootPath,
        [
          'diff',
          '--cached',
          '--binary',
          '--full-index',
          '--no-ext-diff',
          '--no-textconv',
          repository.headCommit!,
          '--',
        ],
        'SUBAGENT_DIFF_FAILED',
      ),
      this.requireGitOutput(
        repository.rootPath,
        ['diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--'],
        'SUBAGENT_DIFF_FAILED',
      ),
      this.requireGitOutput(
        repository.rootPath,
        ['ls-files', '--others', '--exclude-standard', '-z'],
        'SUBAGENT_DIFF_FAILED',
      ),
    ])
    const candidates = untrackedOutput.split('\0').filter(Boolean)
    const untrackedFiles: string[] = []
    for (const relativePath of candidates) {
      const target = resolve(repository.rootPath, relativePath)
      if (!isWithin(repository.rootPath, target)) continue
      const metadata = await lstat(target).catch(() => null)
      if (metadata?.isFile() && !metadata.isSymbolicLink())
        untrackedFiles.push(relativePath.replaceAll('\\', '/'))
    }
    return {
      headCommit: repository.headCommit!,
      stagedPatch,
      unstagedPatch,
      untrackedFiles: untrackedFiles.sort(),
    }
  }

  async createWorktree(workspaceID: string): Promise<BaselineMetadata> {
    validateWorkspaceID(workspaceID)
    const repository = this.gitRepository()
    if (this.worktrees.has(workspaceID)) {
      throw new AgentError('SUBAGENT_WORKSPACE_EXISTS', '子智能体工作区已存在', 409)
    }
    const target = resolve(this.worktreesRoot, workspaceID)
    if (!isWithin(this.worktreesRoot, target)) {
      throw new AgentError('SUBAGENT_WORKSPACE_PATH_DENIED', '子智能体工作区路径越界', 403)
    }
    try {
      await lstat(target)
      throw new AgentError('SUBAGENT_WORKSPACE_EXISTS', '子智能体工作区目录已存在', 409)
    } catch (error) {
      if (error instanceof AgentError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const baseline = await this.persistBaseline('worktree', target)
    try {
      await this.requireGit(
        repository.rootPath,
        ['worktree', 'add', '--detach', target, baseline.snapshotCommit!],
        'SUBAGENT_WORKTREE_CREATE_FAILED',
      )
      const canonical = await realpath(target)
      if (!isWithin(this.worktreesRoot, canonical) || (await lstat(target)).isSymbolicLink()) {
        throw new AgentError('SUBAGENT_WORKSPACE_PATH_DENIED', 'Git worktree 路径越界', 403)
      }
      const result = { ...baseline, workspacePath: canonical }
      this.baselines.set(result.id, result)
      this.worktrees.set(workspaceID, result)
      return result
    } catch (error) {
      await this.git(repository.rootPath, ['worktree', 'remove', '--force', target])
      await this.git(repository.rootPath, ['update-ref', '-d', baseline.ref!])
      this.baselines.delete(baseline.id)
      throw error
    }
  }

  async adoptBaseline(baseline: BaselineMetadata, workspaceID?: string) {
    if (
      resolve(baseline.sourceRoot) !== resolve(this.repository.rootPath) ||
      baseline.repositoryKind !== this.repository.kind
    ) {
      throw new AgentError('SUBAGENT_BASELINE_MISMATCH', '持久化基线不属于当前工作区', 409)
    }
    if (baseline.repositoryKind === 'git') {
      if (!baseline.ref || !baseline.snapshotCommit)
        throw new AgentError('SUBAGENT_BASELINE_INVALID', '持久化 Git 基线不完整', 409)
      const ref = await this.git(this.repository.rootPath, [
        'show-ref',
        '--verify',
        '--hash',
        baseline.ref,
      ])
      if (ref.code !== 0 || ref.stdout.trim() !== baseline.snapshotCommit)
        throw new AgentError('SUBAGENT_BASELINE_UNKNOWN', '持久化基线引用已不存在', 404)
    }
    this.baselines.set(baseline.id, baseline)
    if (baseline.mode === 'worktree') {
      if (!workspaceID)
        throw new AgentError('SUBAGENT_WORKSPACE_ID_INVALID', '恢复 worktree 时缺少工作区 ID', 400)
      validateWorkspaceID(workspaceID)
      const canonical = await realpath(baseline.workspacePath)
      if (!isWithin(this.worktreesRoot, canonical))
        throw new AgentError('SUBAGENT_WORKSPACE_PATH_DENIED', '持久化 worktree 路径越界', 403)
      this.worktrees.set(workspaceID, { ...baseline, workspacePath: canonical })
    }
  }

  async diff(baseline: BaselineMetadata): Promise<WorkspaceDiff> {
    const registered = this.baselines.get(baseline.id)
    if (
      !registered ||
      registered.snapshotCommit !== baseline.snapshotCommit ||
      !registered.snapshotCommit
    ) {
      throw new AgentError('SUBAGENT_BASELINE_UNKNOWN', '基线不存在、已释放或不属于当前服务', 404)
    }
    const current = await this.snapshotCurrent(
      registered.workspacePath,
      `Pidex diff ${registered.id}`,
    )
    const patch = await this.requireGitOutput(
      registered.workspacePath,
      [
        'diff',
        '--binary',
        '--full-index',
        '--no-ext-diff',
        '--no-textconv',
        registered.snapshotCommit,
        current.commit,
        '--',
      ],
      'SUBAGENT_DIFF_FAILED',
    )
    return {
      baselineCommit: registered.snapshotCommit,
      currentCommit: current.commit,
      patch,
      sha256: sha256(patch),
      empty: patch.length === 0,
    }
  }

  async preflightThreeWay(patch: string): Promise<ThreeWayPreflightResult> {
    const repository = this.gitRepository()
    if (Buffer.byteLength(patch, 'utf8') > MAX_PATCH_BYTES) {
      throw new AgentError('SUBAGENT_PATCH_TOO_LARGE', `补丁超过 ${MAX_PATCH_BYTES} 字节上限`, 413)
    }
    const patchSha256 = sha256(patch)
    const expected = await this.snapshotCurrent(repository.rootPath, 'Pidex three-way target')
    const temporary = await mkdtemp(join(this.worktreesRoot, '.preflight-'))
    await rm(temporary, { recursive: true, force: true })
    try {
      await this.requireGit(
        repository.rootPath,
        ['worktree', 'add', '--detach', temporary, expected.commit],
        'SUBAGENT_PREFLIGHT_FAILED',
      )
      const applied = await this.git(
        temporary,
        ['apply', '--3way', '--index', '--binary', '--whitespace=nowarn', '-'],
        undefined,
        patch,
      )
      if (applied.code !== 0) {
        return { status: 'conflict', diagnostics: trimDiagnostic(applied.stderr), patchSha256 }
      }
      const resultTree = await this.requireGit(
        temporary,
        ['write-tree'],
        'SUBAGENT_PREFLIGHT_FAILED',
      )
      const resultCommit = await this.requireGit(
        temporary,
        ['commit-tree', resultTree, '-p', expected.commit, '-m', 'Pidex three-way result'],
        'SUBAGENT_PREFLIGHT_FAILED',
        undefined,
        {
          GIT_AUTHOR_NAME: 'Pidex',
          GIT_AUTHOR_EMAIL: 'pidex@local.invalid',
          GIT_COMMITTER_NAME: 'Pidex',
          GIT_COMMITTER_EMAIL: 'pidex@local.invalid',
        },
      )
      const token = this.nextID()
      if (!WORKSPACE_ID.test(token) || this.prepared.has(token)) {
        throw new AgentError(
          'SUBAGENT_PREFLIGHT_ID_INVALID',
          '三方预检 ID 生成器返回了无效或重复 ID',
          500,
        )
      }
      this.prepared.set(token, {
        expectedCommit: expected.commit,
        expectedTree: expected.tree,
        resultCommit,
        resultTree,
      })
      return { status: 'ready', token, expectedTree: expected.tree, resultTree, patchSha256 }
    } finally {
      await this.git(repository.rootPath, ['worktree', 'remove', '--force', temporary])
      await rm(temporary, { recursive: true, force: true })
    }
  }

  async applyThreeWay(token: string): Promise<ThreeWayApplyResult> {
    const repository = this.gitRepository()
    const prepared = this.prepared.get(token)
    if (!prepared)
      throw new AgentError('SUBAGENT_PREFLIGHT_UNKNOWN', '三方预检结果不存在或已使用', 404)
    this.prepared.delete(token)

    const actual = await this.snapshotCurrent(repository.rootPath, 'Pidex apply target check')
    if (actual.tree !== prepared.expectedTree) {
      return { status: 'stale', expectedTree: prepared.expectedTree, actualTree: actual.tree }
    }
    const resultPatch = await this.requireGitOutput(
      repository.rootPath,
      [
        'diff',
        '--binary',
        '--full-index',
        '--no-ext-diff',
        '--no-textconv',
        prepared.expectedCommit,
        prepared.resultCommit,
        '--',
      ],
      'SUBAGENT_APPLY_FAILED',
    )
    const checked = await this.git(
      repository.rootPath,
      ['apply', '--check', '--binary', '-'],
      undefined,
      resultPatch,
    )
    if (checked.code !== 0) {
      return {
        status: 'failed',
        diagnostics: trimDiagnostic(checked.stderr),
        workspaceUnchanged: true,
      }
    }
    const applied = await this.git(
      repository.rootPath,
      ['apply', '--binary', '-'],
      undefined,
      resultPatch,
    )
    if (applied.code === 0) return { status: 'applied', resultTree: prepared.resultTree }

    const afterFailure = await this.snapshotCurrent(
      repository.rootPath,
      'Pidex failed apply check',
    )
    const diagnostics = trimDiagnostic(applied.stderr)
    return afterFailure.tree === prepared.expectedTree
      ? { status: 'failed', diagnostics, workspaceUnchanged: true }
      : { status: 'partial', diagnostics, workspaceUnchanged: false }
  }

  async releaseSharedBaseline(baseline: BaselineMetadata) {
    const registered = this.baselines.get(baseline.id)
    if (!registered || registered.mode !== 'shared') {
      throw new AgentError(
        'SUBAGENT_BASELINE_UNKNOWN',
        '共享基线不存在、已释放或不属于当前服务',
        404,
      )
    }
    if (registered.ref && this.repository.kind === 'git') {
      await this.requireGit(
        this.repository.rootPath,
        ['update-ref', '-d', registered.ref],
        'SUBAGENT_BASELINE_RELEASE_FAILED',
      )
    }
    this.baselines.delete(registered.id)
  }

  async complete(workspaceID: string) {
    return this.removeWorktree(workspaceID, 'completed')
  }

  async discard(workspaceID: string) {
    return this.removeWorktree(workspaceID, 'discarded')
  }

  private async removeWorktree(
    workspaceID: string,
    disposition: WorkspaceCleanupResult['disposition'],
  ): Promise<WorkspaceCleanupResult> {
    validateWorkspaceID(workspaceID)
    const repository = this.gitRepository()
    const baseline = this.worktrees.get(workspaceID)
    if (!baseline)
      throw new AgentError('SUBAGENT_WORKSPACE_UNKNOWN', '子智能体工作区不存在或已清理', 404)
    const canonical = await realpath(baseline.workspacePath).catch(() => baseline.workspacePath)
    if (!isWithin(this.worktreesRoot, canonical)) {
      throw new AgentError('SUBAGENT_WORKSPACE_PATH_DENIED', '拒绝清理隔离目录之外的路径', 403)
    }
    const metadata = await lstat(baseline.workspacePath).catch(() => null)
    if (metadata?.isSymbolicLink()) {
      throw new AgentError('SUBAGENT_WORKSPACE_PATH_DENIED', '拒绝清理符号链接工作区', 403)
    }
    await this.requireGit(
      repository.rootPath,
      ['worktree', 'remove', '--force', baseline.workspacePath],
      'SUBAGENT_WORKTREE_REMOVE_FAILED',
    )
    if (baseline.ref) await this.git(repository.rootPath, ['update-ref', '-d', baseline.ref])
    await this.git(repository.rootPath, ['worktree', 'prune'])
    this.worktrees.delete(workspaceID)
    this.baselines.delete(baseline.id)
    return { workspaceID, disposition, path: baseline.workspacePath }
  }
}

const processEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
