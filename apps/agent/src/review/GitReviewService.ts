import { createReadStream, watch as watchFileSystem, type FSWatcher } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readlink, realpath, rm, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type {
  ReviewApplyBatchResult,
  ReviewApplyResult,
  ReviewComment,
  ReviewFileDiffResult,
  ReviewFileDiffsResult,
  ReviewFileSummary,
  ReviewSource,
  ReviewSummaryResult,
  ReviewSummarySnapshot,
} from '@pidex/agent-protocol'
import { AgentError } from '../Domain'
import { GitCommandRunner, type GitCommandResult } from '../git/GitCommandRunner'
import type { AgentLogger } from '../observability/AgentLogger'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import {
  normalizedPath,
  parseHunks,
  parseNumstat,
  parseRawNumstatDiff,
  parsePorcelainStatus,
  sha256,
  textFilePatch,
  validateRelativePath,
} from './diff/Parsers'
import {
  UNRENDERABLE_CHANGED_BYTES,
  UNRENDERABLE_CHANGED_LINES,
  UNRENDERABLE_LINE_BYTES,
} from './diff/Limits'
import { fileState } from './state/FileState'
import { reviewSourceKey } from './source/SourceKey'

const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024
const GIT_TIMEOUT_MS = 20_000
const LARGE_FILE_COUNT = 128
const LARGE_CHANGED_LINES = 9_000
const MAX_BATCH_DIFF_BYTES = 12 * 1024 * 1024
const MAX_BATCH_DIFF_PATHS = 128
const REVIEW_SLOW_MS = 3_000
const REVIEW_STALLED_MS = 15_000
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const decoder = new TextDecoder('utf-8', { fatal: true })
type ResolvedSource = {
  source: ReviewSource
  args: string[]
  headSha: string | null
  baseSha: string | null
}
type CachedReviewSnapshot = {
  rootPath: string
  gitDirectory: string
  resolved: ResolvedSource
  snapshot: ReviewSummarySnapshot
  worktreeStates: Map<string, string>
  indexState: string
  fileDiffs: Map<string, ReviewFileDiffResult>
  fileDiffRequests: Map<string, Promise<ReviewFileDiffResult>>
  fileDiffBatchRequests: Map<string, Promise<ReviewFileDiffsResult>>
  stale: boolean
}
type ProjectWatcher = {
  close: () => void
}
type ReviewLogger = Pick<AgentLogger, 'info' | 'warn' | 'error'>
type ReviewSnapshotPhase =
  'repository' | 'source' | 'pre-scan' | 'diff-scan' | 'post-scan' | 'finalize'

export const DEFAULT_MAX_REVIEW_SNAPSHOTS = 3

export class GitReviewService {
  private readonly watchers = new Map<string, ProjectWatcher>()
  private readonly watcherRequests = new Map<string, Promise<void>>()
  private readonly snapshots = new Map<string, CachedReviewSnapshot>()
  private readonly snapshotRequests = new Map<string, Promise<CachedReviewSnapshot>>()
  private readonly snapshotRequestStartedAt = new Map<string, number>()
  private readonly projectEpochs = new Map<string, number>()
  private readonly repositoryRoots = new Map<string, string>()
  private readonly maxSnapshots: number
  private disposed = false
  private readonly gitRunner: GitCommandRunner

  constructor(
    private readonly db: AgentDatabase,
    private readonly onChanged?: ((projectId: string) => void | Promise<void>) | undefined,
    private readonly resolvePullRequest?:
      | ((input: {
          workspaceRoot: string
          owner: string
          repository: string
          number: number
        }) => Promise<{ baseSha: string; headSha: string }>)
      | undefined,
    private readonly onGitCommand?: ((args: readonly string[]) => void) | undefined,
    private readonly logger?: ReviewLogger | undefined,
    options?: { maxSnapshots?: number } | undefined,
  ) {
    this.maxSnapshots = options?.maxSnapshots ?? DEFAULT_MAX_REVIEW_SNAPSHOTS
    this.gitRunner = new GitCommandRunner({
      maxOutputBytes: MAX_GIT_OUTPUT_BYTES,
      timeoutMs: GIT_TIMEOUT_MS,
      onCommand: this.onGitCommand,
    })
  }

  private touchSnapshot(key: string, entry: CachedReviewSnapshot): void {
    this.snapshots.delete(key)
    this.snapshots.set(key, entry)
  }

  private setSnapshot(key: string, entry: CachedReviewSnapshot): void {
    this.snapshots.delete(key)
    this.snapshots.set(key, entry)
    while (this.snapshots.size > this.maxSnapshots) {
      const oldestKey = this.snapshots.keys().next().value
      if (!oldestKey) break
      this.evictSnapshot(oldestKey)
    }
  }

  private evictSnapshot(key: string): void {
    const entry = this.snapshots.get(key)
    if (entry) {
      entry.fileDiffs.clear()
      entry.fileDiffRequests.clear()
      entry.fileDiffBatchRequests.clear()
      this.snapshots.delete(key)
    }
  }

  shrink(): void {
    while (this.snapshots.size > 1) {
      const oldestKey = this.snapshots.keys().next().value
      if (!oldestKey) break
      this.evictSnapshot(oldestKey)
    }
    this.watcherRequests.clear()
  }

  private reviewFailureDetails(cause: unknown) {
    const record =
      cause && typeof cause === 'object' ? (cause as { code?: unknown; status?: unknown }) : null
    return {
      errorName: cause instanceof Error ? cause.name : 'UnknownError',
      code: typeof record?.code === 'string' ? record.code : undefined,
      status: typeof record?.status === 'number' ? record.status : undefined,
      message: cause instanceof Error ? cause.message : String(cause),
    }
  }

  dispose() {
    this.disposed = true
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    this.watcherRequests.clear()
    for (const key of [...this.snapshots.keys()]) {
      this.evictSnapshot(key)
    }
  }

  private async git(
    cwd: string,
    args: readonly string[],
    input?: string,
    acceptedCodes: readonly number[] = [0],
    env?: Readonly<Record<string, string>>,
    literalPathspecs = false,
    maxOutputBytes?: number,
  ): Promise<GitCommandResult> {
    return this.gitRunner.run({
      cwd,
      args,
      input,
      acceptedCodes,
      env,
      literalPathspecs,
      maxOutputBytes,
    })
  }

  private async repository(projectId: string) {
    const project = this.db.getProject(projectId)
    if (!project) throw new AgentError('PROJECT_NOT_FOUND', '项目不存在', 404)
    const cachedRoot = this.repositoryRoots.get(projectId)
    if (cachedRoot) {
      void this.ensureWatcher(projectId, cachedRoot)
      return { project, rootPath: cachedRoot }
    }
    const rootResult = await this.git(
      project.rootPath,
      ['rev-parse', '--show-toplevel'],
      undefined,
      [0, 128],
    ).catch((cause) => {
      if (cause instanceof AgentError && cause.code === 'GIT_COMMAND_FAILED') {
        throw new AgentError('REPOSITORY_NOT_FOUND', '项目不在 Git 仓库中', 404)
      }
      throw cause
    })
    if (rootResult.code !== 0 || !rootResult.stdout.trim())
      throw new AgentError('REPOSITORY_NOT_FOUND', '项目不在 Git 仓库中', 404)
    const rootPath = await realpath(resolve(rootResult.stdout.trim()))
    const projectRoot = await realpath(resolve(project.rootPath))
    const containment = relative(projectRoot, rootPath)
    if (containment.startsWith('..') || isAbsolute(containment)) {
      throw new AgentError('PATH_DENIED', 'Git 仓库根目录超出已注册项目边界', 403)
    }
    this.repositoryRoots.set(projectId, rootPath)
    void this.ensureWatcher(projectId, rootPath)
    return { project, rootPath }
  }

  private async ensureWatcher(projectId: string, rootPath: string) {
    if (!this.onChanged || this.disposed || this.watchers.has(projectId)) return
    const active = this.watcherRequests.get(projectId)
    if (active) return active
    const request = this.installWatcher(projectId, rootPath).catch(() => undefined)
    this.watcherRequests.set(projectId, request)
    try {
      await request
    } finally {
      if (this.watcherRequests.get(projectId) === request) {
        this.watcherRequests.delete(projectId)
      }
    }
  }

  private async installWatcher(projectId: string, rootPath: string) {
    let debounce: ReturnType<typeof setTimeout> | undefined
    let maxWait: ReturnType<typeof setTimeout> | undefined
    let unknownPath = false
    let metadataChanged = false
    let closed = false
    const pendingPaths = new Set<string>()
    const watchers = new Set<FSWatcher>()
    const close = () => {
      if (closed) return
      closed = true
      if (debounce) clearTimeout(debounce)
      if (maxWait) clearTimeout(maxWait)
      debounce = undefined
      maxWait = undefined
      pendingPaths.clear()
      for (const watcher of watchers) watcher.close()
      watchers.clear()
      if (this.watchers.get(projectId)?.close === close) {
        this.watchers.delete(projectId)
      }
    }
    const flush = async () => {
      if (debounce) clearTimeout(debounce)
      if (maxWait) clearTimeout(maxWait)
      debounce = undefined
      maxWait = undefined
      const paths = [...pendingPaths]
      pendingPaths.clear()
      try {
        const invalidate =
          metadataChanged || unknownPath || (await this.shouldInvalidateWatchPaths(rootPath, paths))
        if (!invalidate || closed) return
        this.markProjectStale(projectId)
        // Every accepted batch notifies. Clients debounce the notification
        // themselves, so suppressing repeats here would only let their timer
        // expire mid-write and scan a repository that is still changing.
        await Promise.resolve(this.onChanged?.(projectId)).catch(() => undefined)
      } catch {
        // Watcher reconciliation is advisory; explicit refresh remains usable.
      } finally {
        unknownPath = false
        metadataChanged = false
      }
    }
    const schedule = () => {
      if (closed) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        void flush().catch(() => undefined)
      }, 250)
      maxWait ??= setTimeout(() => {
        void flush().catch(() => undefined)
      }, 1_000)
    }
    const addWatcher = (path: string, onEvent: (filename: string | null) => void) => {
      if (closed) return false
      try {
        const watcher = watchFileSystem(
          path,
          { persistent: false, recursive: true },
          (_event, filename) => {
            try {
              onEvent(filename == null ? null : normalizedPath(filename.toString()))
              schedule()
            } catch {
              // A malformed watcher event must not escape the callback boundary.
            }
          },
        )
        watchers.add(watcher)
        watcher.on('error', () => {
          watcher.close()
          watchers.delete(watcher)
        })
        return true
      } catch {
        return false
      }
    }

    this.watchers.set(projectId, { close })
    addWatcher(rootPath, (filename) => {
      if (filename == null) unknownPath = true
      else pendingPaths.add(filename)
    })
    if (this.disposed || closed) {
      close()
      return
    }

    const metadataResults = await Promise.allSettled([
      this.git(rootPath, ['rev-parse', '--absolute-git-dir']).then((result) =>
        result.stdout.trim(),
      ),
      this.git(rootPath, ['rev-parse', '--git-common-dir']).then((result) => result.stdout.trim()),
    ])
    const metadataDirectories = new Set<string>()
    for (const result of metadataResults) {
      if (result.status !== 'fulfilled' || !result.value) continue
      const absolute = isAbsolute(result.value)
        ? resolve(result.value)
        : resolve(rootPath, result.value)
      metadataDirectories.add(await realpath(absolute).catch(() => absolute))
    }
    for (const directory of metadataDirectories) {
      addWatcher(directory, (filename) => {
        if (filename == null || this.isRelevantGitMetadataPath(filename)) {
          metadataChanged = true
        }
      })
    }
    if (this.disposed) {
      close()
    }
  }

  private isRelevantGitMetadataPath(path: string) {
    const normalized = normalizedPath(path).replace(/^\.\/+/, '')
    return (
      normalized === 'HEAD' ||
      normalized === 'index' ||
      normalized === 'packed-refs' ||
      normalized === 'MERGE_HEAD' ||
      normalized === 'CHERRY_PICK_HEAD' ||
      normalized === 'REVERT_HEAD' ||
      normalized.startsWith('refs/') ||
      normalized.startsWith('rebase-') ||
      normalized.startsWith('sequencer/')
    )
  }

  private async shouldInvalidateWatchPaths(rootPath: string, paths: readonly string[]) {
    if (paths.length === 0) return false
    const worktreePaths: string[] = []
    for (const path of paths) {
      const relativePath = isAbsolute(path) ? relative(rootPath, path) : path
      const normalized = normalizedPath(relativePath).replace(/^\.\/+/, '')
      if (!normalized) return true
      if (normalized === '.git' || normalized.startsWith('.git/')) {
        const gitPath = normalized.slice(5)
        if (
          gitPath === 'HEAD' ||
          gitPath === 'index' ||
          gitPath.startsWith('refs/') ||
          gitPath === 'MERGE_HEAD' ||
          gitPath === 'CHERRY_PICK_HEAD' ||
          gitPath === 'REVERT_HEAD' ||
          gitPath.startsWith('rebase-')
        )
          return true
        continue
      }
      worktreePaths.push(normalized)
    }
    if (worktreePaths.length === 0) return false
    const ignored = await this.git(
      rootPath,
      ['check-ignore', '-z', '--stdin'],
      `${worktreePaths.join('\0')}\0`,
      [0, 1],
      undefined,
      false,
    )
    const ignoredPaths = new Set(ignored.stdout.split('\0').filter(Boolean).map(normalizedPath))
    return worktreePaths.some((path) => !ignoredPaths.has(path))
  }

  private markProjectStale(projectId: string) {
    this.projectEpochs.set(projectId, (this.projectEpochs.get(projectId) ?? 0) + 1)
    for (const [key, entry] of this.snapshots) {
      if (!key.startsWith(`${projectId}\0`)) continue
      entry.stale = true
    }
  }

  private async assertStableRepositoryState(rootPath: string, knownGitDirectory?: string) {
    const rawGitDirectory = knownGitDirectory
      ? null
      : await this.optionalGit(rootPath, ['rev-parse', '--git-dir'])
    const gitDirectory =
      knownGitDirectory ??
      (rawGitDirectory &&
        (isAbsolute(rawGitDirectory) ? rawGitDirectory : resolve(rootPath, rawGitDirectory)))
    if (!gitDirectory) return rootPath
    const operations = [
      ['MERGE_HEAD', 'merge'],
      ['CHERRY_PICK_HEAD', 'cherry-pick'],
      ['REVERT_HEAD', 'revert'],
      ['rebase-merge', 'rebase'],
      ['rebase-apply', 'rebase'],
    ] as const
    for (const [marker, operation] of operations) {
      const markerPath = resolve(gitDirectory, marker)
      if (await stat(markerPath).catch(() => null)) {
        throw new AgentError(
          'REVIEW_SOURCE_UNAVAILABLE',
          `Git 正在执行 ${operation}，完成或中止后再刷新审阅。`,
          503,
          { operation },
        )
      }
    }
    return gitDirectory
  }

  async captureTurnSnapshot(input: {
    projectId: string
    threadId: string
    turnId: string
    phase: 'before' | 'after'
  }) {
    const { rootPath } = await this.repository(input.projectId)
    const temporary = await mkdtemp(join(tmpdir(), 'pidex-review-index-'))
    const indexPath = join(temporary, 'index')
    const env = { GIT_INDEX_FILE: indexPath }
    try {
      const head = await this.optionalGit(rootPath, ['rev-parse', '--verify', 'HEAD'])
      if (head) await this.git(rootPath, ['read-tree', 'HEAD'], undefined, [0], env)
      else await this.git(rootPath, ['read-tree', '--empty'], undefined, [0], env)
      await this.git(rootPath, ['add', '-A'], undefined, [0], env)
      const tree = (await this.git(rootPath, ['write-tree'], undefined, [0], env)).stdout.trim()
      const snapshotRef = `refs/pidex/review/${input.threadId}/${input.turnId}/${input.phase}`
      const validRef = await this.git(
        rootPath,
        ['check-ref-format', snapshotRef],
        undefined,
        [0, 1],
      )
      if (validRef.code !== 0) {
        throw new AgentError('INVALID_REQUEST', 'Review 快照标识无法写入 Git 引用', 400)
      }
      await this.git(rootPath, ['update-ref', snapshotRef, tree])
      this.db.saveTurnGitSnapshot({
        threadId: input.threadId,
        turnId: input.turnId,
        projectId: input.projectId,
        repositoryRoot: rootPath,
        ...(input.phase === 'before' ? { beforeTree: tree } : { afterTree: tree }),
      })
      return tree
    } finally {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  prepareThreadSnapshotCleanup(threadId: string): () => Promise<void> {
    const rows = this.db.sqlite
      .query(
        `
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM threads WHERE id = ?
        UNION ALL
        SELECT child.id
        FROM threads AS child
        JOIN subtree AS parent ON child.parent_thread_id = parent.id
      )
      SELECT snapshot.thread_id, snapshot.turn_id, snapshot.repository_root,
             snapshot.before_tree, snapshot.after_tree
      FROM turn_git_snapshots AS snapshot
      JOIN subtree ON subtree.id = snapshot.thread_id
    `,
      )
      .all(threadId) as Array<{
      thread_id: string
      turn_id: string
      repository_root: string
      before_tree: string | null
      after_tree: string | null
    }>

    return async () => {
      for (const row of rows) {
        for (const phase of ['before', 'after'] as const) {
          if (phase === 'before' ? !row.before_tree : !row.after_tree) continue
          const ref = `refs/pidex/review/${row.thread_id}/${row.turn_id}/${phase}`
          await this.git(
            row.repository_root,
            ['update-ref', '-d', ref],
            undefined,
            [0, 1, 128],
          ).catch(() => undefined)
        }
      }
    }
  }

  private async optionalGit(cwd: string, args: readonly string[]) {
    const result = await this.git(cwd, args, undefined, [0, 1, 128])
    return result.code === 0 ? result.stdout.trim() || null : null
  }

  private gitPaths(
    cwd: string,
    args: readonly string[],
    paths: readonly string[],
    acceptedCodes: readonly number[] = [0],
  ) {
    return this.git(
      cwd,
      [...args, '--pathspec-from-file=-', '--pathspec-file-nul'],
      `${paths.join('\0')}\0`,
      acceptedCodes,
      undefined,
      true,
    )
  }

  async currentBranch(projectId: string): Promise<string | null> {
    const { rootPath } = await this.repository(projectId)
    return this.optionalGit(rootPath, ['branch', '--show-current'])
  }

  private async resolveSource(
    projectId: string,
    rootPath: string,
    source: ReviewSource,
  ): Promise<ResolvedSource> {
    const headSha = await this.optionalGit(rootPath, ['rev-parse', '--verify', 'HEAD'])
    switch (source.kind) {
      case 'uncommitted':
        return { source, args: [headSha ?? EMPTY_TREE_SHA], headSha, baseSha: headSha }
      case 'unstaged':
        return { source, args: [], headSha, baseSha: null }
      case 'staged':
        return { source, args: ['--cached'], headSha, baseSha: headSha }
      case 'branch': {
        if (!headSha)
          throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '空仓库无法与基础分支比较', 409)
        const baseSha = await this.optionalGit(rootPath, ['merge-base', source.baseBranch, 'HEAD'])
        if (!baseSha)
          throw new AgentError(
            'REVIEW_SOURCE_UNAVAILABLE',
            `无法解析基础分支 ${source.baseBranch}`,
            404,
          )
        return { source, args: [baseSha], headSha, baseSha }
      }
      case 'commit': {
        const line = await this.optionalGit(rootPath, [
          'rev-list',
          '--parents',
          '-n',
          '1',
          source.commitSha,
        ])
        if (!line) throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '指定提交不存在', 404)
        const [commitSha, parentSha] = line.split(/\s+/)
        return {
          source,
          args: [parentSha ?? EMPTY_TREE_SHA, commitSha!],
          headSha,
          baseSha: parentSha ?? null,
        }
      }
      case 'last-turn': {
        const snapshot = this.db.getTurnGitSnapshot(source.threadId, source.turnId)
        if (!snapshot?.beforeTree || !snapshot.afterTree) {
          throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '最近一轮没有可用的 Git 快照', 404)
        }
        const snapshotRoot = await realpath(resolve(snapshot.repositoryRoot)).catch(() => null)
        if (snapshot.projectId !== projectId || snapshotRoot !== rootPath) {
          throw new AgentError('PROJECT_SCOPE_MISMATCH', '最近一轮 Git 快照不属于当前项目', 409)
        }
        return {
          source,
          args: [snapshot.beforeTree, snapshot.afterTree],
          headSha,
          baseSha: snapshot.beforeTree,
        }
      }
      case 'pull-request': {
        if (!this.resolvePullRequest)
          throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', 'GitHub PR 来源尚未连接', 501)
        const comparison = await this.resolvePullRequest({
          workspaceRoot: rootPath,
          owner: source.owner,
          repository: source.repository,
          number: source.number,
        })
        return {
          source,
          args: [comparison.baseSha, comparison.headSha],
          headSha: comparison.headSha,
          baseSha: comparison.baseSha,
        }
      }
    }
    throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '未知 Review 来源', 400)
  }

  private async safeUntrackedEntry(rootPath: string, path: string) {
    const absolute = resolve(rootPath, validateRelativePath(path))
    const containment = relative(rootPath, absolute)
    if (containment.startsWith('..') || isAbsolute(containment)) {
      throw new AgentError('PATH_DENIED', '文件超出仓库边界', 403)
    }
    const metadata = await lstat(absolute).catch((cause) => {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT')
        return null
      throw cause
    })
    if (!metadata) return null
    if (metadata.isSymbolicLink()) {
      return {
        kind: 'symlink' as const,
        target: await readlink(absolute, 'utf8'),
      }
    }
    if (!metadata.isFile()) return null
    const canonical = await realpath(absolute)
    const canonicalContainment = relative(rootPath, canonical)
    if (canonicalContainment.startsWith('..') || isAbsolute(canonicalContainment)) {
      throw new AgentError('PATH_DENIED', '文件的真实路径超出仓库边界', 403)
    }
    return { kind: 'file' as const, path: canonical }
  }

  private symlinkPatch(path: string, target: string) {
    const normalizedTarget = target.replaceAll('\r\n', '\n')
    const lines = normalizedTarget.split('\n')
    const patch = [
      `diff --git a/${path} b/${path}`,
      'new file mode 120000',
      '--- /dev/null',
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
      '\\ No newline at end of file',
      '',
    ].join('\n')
    return {
      patch,
      additions: lines.length,
      binary: false,
      changedBytes: Buffer.byteLength(patch, 'utf8'),
      revision: sha256(`symlink\0${target}`),
    }
  }

  private async untrackedFile(rootPath: string, path: string) {
    const entry = await this.safeUntrackedEntry(rootPath, path)
    if (!entry) return null
    if (entry.kind === 'symlink') return this.symlinkPatch(path, entry.target)
    const file = Bun.file(entry.path)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const binary = bytes.includes(0)
    if (binary) {
      const patch = [
        `diff --git a/${path} b/${path}`,
        'new file mode 100644',
        `Binary files /dev/null and b/${path} differ`,
        '',
      ].join('\n')
      return { patch, additions: null, binary: true }
    }
    let content: string
    try {
      content = decoder.decode(bytes)
    } catch {
      const patch = [
        `diff --git a/${path} b/${path}`,
        'new file mode 100644',
        `Binary files /dev/null and b/${path} differ`,
        '',
      ].join('\n')
      return { patch, additions: null, binary: true }
    }
    const generated = textFilePatch(path, content)
    return { ...generated, binary: false }
  }

  private async hashWorktreeFiles(rootPath: string, paths: readonly string[]) {
    const hashable: string[] = []
    for (const path of paths) {
      const metadata = await lstat(resolve(rootPath, path)).catch((cause) => {
        if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT')
          return null
        throw cause
      })
      if (metadata?.isFile() || metadata?.isSymbolicLink()) hashable.push(path)
    }
    const hashes = new Map<string, string>()
    const regularPaths = hashable.filter((path) => !/[\r\n]/.test(path))
    if (regularPaths.length > 0) {
      const output = await this.git(
        rootPath,
        ['hash-object', '--no-filters', '--stdin-paths'],
        `${regularPaths.join('\n')}\n`,
        [0],
      )
      const oids = output.stdout.trim().split(/\r?\n/)
      regularPaths.forEach((path, index) => hashes.set(path, oids[index] ?? ''))
    }
    for (const path of hashable) {
      if (!/[\r\n]/.test(path)) continue
      const entry = await this.safeUntrackedEntry(rootPath, path)
      if (!entry) continue
      const hash = createHash('sha1')
      if (entry.kind === 'symlink') {
        const bytes = Buffer.from(entry.target, 'utf8')
        hash.update(`blob ${bytes.byteLength}\0`, 'utf8')
        hash.update(bytes)
      } else {
        const metadata = await stat(entry.path)
        hash.update(`blob ${metadata.size}\0`, 'utf8')
        for await (const chunk of createReadStream(entry.path)) hash.update(chunk)
      }
      hashes.set(path, hash.digest('hex'))
    }
    return hashes
  }

  private async untrackedSummaryStats(rootPath: string, path: string) {
    const entry = await this.safeUntrackedEntry(rootPath, path)
    if (!entry) return { additions: 0, deletions: 0, binary: false }
    if (entry.kind === 'symlink') {
      const normalized = entry.target.replaceAll('\r\n', '\n')
      return {
        additions: normalized.length === 0 ? 0 : normalized.split('\n').length,
        deletions: 0,
        binary: false,
      }
    }
    let lines = 0
    let bytes = 0
    let lastByte = -1
    let binary = false
    for await (const chunk of createReadStream(entry.path)) {
      bytes += chunk.byteLength
      if (!binary && chunk.includes(0)) binary = true
      for (const byte of chunk) {
        if (byte === 0x0a) lines += 1
        lastByte = byte
      }
    }
    if (binary) return { additions: null, deletions: null, binary: true }
    if (bytes > 0 && lastByte !== 0x0a) lines += 1
    return { additions: lines, deletions: 0, binary: false }
  }

  private async buildFileSummaries(rootPath: string, resolved: ResolvedSource) {
    const metadata = parseRawNumstatDiff(
      (
        await this.git(rootPath, [
          'diff',
          '--raw',
          '--numstat',
          '-z',
          '--no-abbrev',
          '--find-renames',
          ...resolved.args,
        ])
      ).stdout,
    )
    const rawEntries = metadata.rawEntries
    const numstats = metadata.numstats

    if (resolved.source.kind === 'branch' || resolved.source.kind === 'uncommitted') {
      const untracked = (
        await this.git(rootPath, ['ls-files', '--others', '--exclude-standard', '-z'])
      ).stdout
        .split('\0')
        .filter(Boolean)
      for (const path of untracked) {
        const directory = path.endsWith('/')
        const normalized = validateRelativePath(directory ? path.slice(0, -1) : path)
        if (directory) continue
        if (!rawEntries.some((entry) => entry.path === normalized)) {
          rawEntries.push({
            path: normalized,
            previousPath: null,
            status: 'untracked',
            oldMode: '000000',
            newMode: '100644',
            oldOid: '0'.repeat(40),
            newOid: '0'.repeat(40),
          })
        }
      }
    }

    const worktreeHashes =
      resolved.source.kind === 'uncommitted' ||
      resolved.source.kind === 'unstaged' ||
      resolved.source.kind === 'branch'
        ? await this.hashWorktreeFiles(
            rootPath,
            rawEntries.map((entry) => entry.path),
          )
        : new Map<string, string>()
    const files: ReviewFileSummary[] = []
    for (const entry of rawEntries) {
      let stats: { additions: number | null; deletions: number | null; binary: boolean }
      if (entry.status === 'untracked') {
        stats = await this.untrackedSummaryStats(rootPath, entry.path)
      } else {
        stats = numstats.get(entry.path) ?? parseNumstat('')
      }
      const additions = stats.additions
      const deletions = stats.deletions
      const revision = sha256(
        [
          reviewSourceKey(resolved.source),
          resolved.headSha ?? '',
          resolved.baseSha ?? '',
          entry.path,
          entry.previousPath ?? '',
          entry.status,
          entry.oldMode,
          entry.newMode,
          entry.oldOid,
          entry.newOid,
          worktreeHashes.get(entry.path) ?? '',
        ].join('\0'),
      )
      files.push({
        path: entry.path,
        previousPath: entry.previousPath,
        status: entry.status,
        additions,
        deletions,
        changedLines: (additions ?? 0) + (deletions ?? 0),
        changedBytes: 0,
        binary: stats.binary,
        revision,
      })
    }
    return files
  }

  private cacheKey(projectId: string, source: ReviewSource) {
    return `${projectId}\0${reviewSourceKey(source)}`
  }

  private async repositoryFingerprint(rootPath: string, gitDirectory: string) {
    const [indexState, status] = await Promise.all([
      fileState(resolve(gitDirectory, 'index')),
      this.git(rootPath, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']),
    ])
    const records = status.stdout.split('\0')
    const paths: string[] = []
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      if (!record || record.startsWith('# ')) continue
      if (record.startsWith('? ')) {
        paths.push(record.slice(2))
        continue
      }
      const ordinary = /^1 [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(record)
      if (ordinary?.[1]) {
        paths.push(ordinary[1])
        continue
      }
      const renamed = /^2 [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(record)
      if (renamed?.[1]) {
        paths.push(renamed[1])
        index += 1
        continue
      }
      const unmerged = /^u [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(record)
      if (unmerged?.[1]) paths.push(unmerged[1])
    }
    const worktreeStates = await Promise.all(
      paths.map(async (path) => {
        const normalized = normalizedPath(path)
        const absolute = resolve(rootPath, normalized)
        const containment = relative(rootPath, absolute)
        return containment.startsWith('..') || isAbsolute(containment)
          ? `${normalized}\0denied`
          : `${normalized}\0${await this.worktreeState(rootPath, normalized)}`
      }),
    )
    return sha256(`${indexState}\0${status.stdout}\0${worktreeStates.sort().join('\0')}`)
  }

  private async worktreeState(rootPath: string, path: string) {
    const absolute = resolve(rootPath, path)
    const containment = relative(rootPath, absolute)
    if (containment.startsWith('..') || isAbsolute(containment)) return 'denied'
    const metadata = await lstat(absolute, { bigint: true }).catch(() => null)
    if (!metadata) return 'missing'
    if (metadata.isSymbolicLink()) {
      const target = await readlink(absolute, 'utf8').catch(() => '')
      return `symlink:${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}:${target}`
    }
    const canonical = await realpath(absolute).catch(() => null)
    if (!canonical) return 'missing'
    const canonicalContainment = relative(rootPath, canonical)
    if (canonicalContainment.startsWith('..') || isAbsolute(canonicalContainment)) return 'denied'
    return `${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}`
  }

  private async buildSnapshotAttempt(
    projectId: string,
    source: ReviewSource,
    attempt: number,
  ): Promise<CachedReviewSnapshot> {
    const startedAt = performance.now()
    let phase: ReviewSnapshotPhase = 'repository'
    const slowTimer = setTimeout(() => {
      this.logger?.warn('review.snapshot.build.slow', {
        details: {
          sourceKind: source.kind,
          attempt,
          phase,
          durationMs: Math.round(performance.now() - startedAt),
        },
      })
    }, REVIEW_SLOW_MS)
    const stalledTimer = setTimeout(() => {
      this.logger?.warn('review.snapshot.build.stalled', {
        details: {
          sourceKind: source.kind,
          attempt,
          phase,
          durationMs: Math.round(performance.now() - startedAt),
        },
      })
    }, REVIEW_STALLED_MS)
    try {
      const epoch = this.projectEpochs.get(projectId) ?? 0
      const { rootPath } = await this.repository(projectId)
      const gitDirectory = await this.assertStableRepositoryState(rootPath)
      phase = 'source'
      const resolved = await this.resolveSource(projectId, rootPath, source)
      phase = 'pre-scan'
      const beforeFingerprint = await this.repositoryFingerprint(rootPath, gitDirectory)
      phase = 'diff-scan'
      const summaryFiles = await this.buildFileSummaries(rootPath, resolved)
      phase = 'post-scan'
      await this.assertStableRepositoryState(rootPath, gitDirectory)
      const worktreeStates = new Map(
        await Promise.all(
          summaryFiles.map(
            async (file) => [file.path, await this.worktreeState(rootPath, file.path)] as const,
          ),
        ),
      )
      const indexState = await fileState(resolve(gitDirectory, 'index'))
      const files = summaryFiles
      const additions = files.reduce((total, file) => total + (file.additions ?? 0), 0)
      const deletions = files.reduce((total, file) => total + (file.deletions ?? 0), 0)
      const changedBytes = files.reduce((total, file) => total + file.changedBytes, 0)
      const changedLines = additions + deletions
      const afterFingerprint = await this.repositoryFingerprint(rootPath, gitDirectory)
      phase = 'finalize'
      let sourceChanged = false
      if (source.kind === 'branch') {
        const currentHead = await this.optionalGit(rootPath, ['rev-parse', '--verify', 'HEAD'])
        const currentBase = currentHead
          ? await this.optionalGit(rootPath, ['merge-base', source.baseBranch, 'HEAD'])
          : null
        sourceChanged = currentHead !== resolved.headSha || currentBase !== resolved.baseSha
      }
      const generation = sha256(
        [
          reviewSourceKey(source),
          resolved.headSha ?? '',
          resolved.baseSha ?? '',
          ...files.map((file) => `${file.path}\0${file.status}\0${file.revision}`).sort(),
        ].join('\0'),
      )
      const snapshot: ReviewSummarySnapshot = {
        projectId,
        generation,
        source,
        repositoryRoot: rootPath,
        headSha: resolved.headSha,
        baseSha: resolved.baseSha,
        files,
        totals: { files: files.length, additions, deletions, changedLines, changedBytes },
        largeDiffMode:
          files.length > LARGE_FILE_COUNT ||
          changedLines > LARGE_CHANGED_LINES ||
          changedBytes > MAX_BATCH_DIFF_BYTES,
      }
      return {
        rootPath,
        gitDirectory,
        resolved,
        snapshot,
        worktreeStates,
        indexState,
        fileDiffs: new Map(),
        fileDiffRequests: new Map(),
        fileDiffBatchRequests: new Map(),
        stale:
          beforeFingerprint !== afterFingerprint ||
          sourceChanged ||
          (this.projectEpochs.get(projectId) ?? 0) !== epoch,
      }
    } catch (cause) {
      this.logger?.error('review.snapshot.build.failed', {
        details: {
          sourceKind: source.kind,
          attempt,
          phase,
          durationMs: Math.round(performance.now() - startedAt),
          ...this.reviewFailureDetails(cause),
        },
      })
      throw cause
    } finally {
      clearTimeout(slowTimer)
      clearTimeout(stalledTimer)
    }
  }

  private async buildSnapshot(
    projectId: string,
    source: ReviewSource,
  ): Promise<CachedReviewSnapshot> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const entry = await this.buildSnapshotAttempt(projectId, source, attempt)
      if (!entry.stale) return entry
      this.logger?.warn('review.snapshot.retry', {
        details: {
          sourceKind: source.kind,
          attempt,
          reason: 'repository-changed',
          willRetry: attempt < 3,
        },
      })
    }
    throw new AgentError('REVIEW_REPOSITORY_BUSY', '工作区持续变化，请稍后重试', 503, {
      retryable: true,
    })
  }

  private refreshSnapshot(projectId: string, source: ReviewSource) {
    const key = this.cacheKey(projectId, source)
    const active = this.snapshotRequests.get(key)
    if (active) {
      this.logger?.info('review.snapshot.refresh.joined', {
        details: {
          sourceKind: source.kind,
          ageMs: Math.round(
            performance.now() - (this.snapshotRequestStartedAt.get(key) ?? performance.now()),
          ),
        },
      })
      return active
    }
    // A filesystem change racing this refresh keeps its own watcher
    // notification, and the epoch check keeps the rebuilt result stale.
    this.snapshotRequestStartedAt.set(key, performance.now())
    const request = this.buildSnapshot(projectId, source).then((entry) => {
      this.setSnapshot(key, entry)
      return entry
    })
    this.snapshotRequests.set(key, request)
    void request.then(
      () => {
        if (this.snapshotRequests.get(key) === request) {
          this.snapshotRequests.delete(key)
          this.snapshotRequestStartedAt.delete(key)
        }
      },
      () => {
        if (this.snapshotRequests.get(key) === request) {
          this.snapshotRequests.delete(key)
          this.snapshotRequestStartedAt.delete(key)
        }
      },
    )
    return request
  }

  async summaryResult(
    projectId: string,
    source: ReviewSource,
    refresh = false,
  ): Promise<ReviewSummaryResult> {
    const startedAt = performance.now()
    const key = this.cacheKey(projectId, source)
    const cached = this.snapshots.get(key)
    if (cached) this.touchSnapshot(key, cached)
    const cacheHit = !refresh && cached !== undefined
    this.logger?.info('review.summary.started', {
      details: {
        sourceKind: source.kind,
        refresh,
        cacheHit,
      },
    })
    const slowTimer = setTimeout(() => {
      this.logger?.warn('review.summary.slow', {
        details: {
          sourceKind: source.kind,
          refresh,
          cacheHit,
          durationMs: Math.round(performance.now() - startedAt),
        },
      })
    }, REVIEW_SLOW_MS)
    try {
      let result: ReviewSummaryResult
      if (!refresh && cached) {
        if (cached.stale) void this.refreshSnapshot(projectId, source).catch(() => undefined)
        result = {
          snapshot: cached.snapshot,
          cacheState: cached.stale ? 'stale' : 'fresh',
        }
      } else {
        const entry = await this.refreshSnapshot(projectId, source)
        result = {
          snapshot: entry.snapshot,
          cacheState: entry.stale ? 'stale' : 'fresh',
        }
      }
      this.logger?.info('review.summary.completed', {
        details: {
          sourceKind: source.kind,
          refresh,
          cacheHit,
          cacheState: result.cacheState,
          fileCount: result.snapshot.files.length,
          largeDiffMode: result.snapshot.largeDiffMode,
          durationMs: Math.round(performance.now() - startedAt),
        },
      })
      return result
    } catch (cause) {
      this.logger?.error('review.summary.failed', {
        details: {
          sourceKind: source.kind,
          refresh,
          durationMs: Math.round(performance.now() - startedAt),
          ...this.reviewFailureDetails(cause),
        },
      })
      throw cause
    } finally {
      clearTimeout(slowTimer)
    }
  }

  async summary(projectId: string, source: ReviewSource): Promise<ReviewSummarySnapshot> {
    return (await this.summaryResult(projectId, source, true)).snapshot
  }

  private async snapshotForGeneration(
    projectId: string,
    source: ReviewSource,
    generation: string,
    paths?: string | readonly string[],
  ) {
    const key = this.cacheKey(projectId, source)
    let entry = this.snapshots.get(key)
    if (entry) this.touchSnapshot(key, entry)
    if (entry && !entry.stale) {
      const currentEntry = entry
      const indexChanged =
        source.kind === 'uncommitted' ||
        source.kind === 'unstaged' ||
        source.kind === 'staged' ||
        source.kind === 'branch'
          ? (await fileState(resolve(currentEntry.gitDirectory, 'index'))) !==
            currentEntry.indexState
          : false
      const worktreePaths = paths === undefined ? [] : typeof paths === 'string' ? [paths] : paths
      const worktreeChanged =
        (source.kind === 'uncommitted' || source.kind === 'unstaged' || source.kind === 'branch') &&
        (
          await Promise.all(
            worktreePaths.map(
              async (path) =>
                (await this.worktreeState(currentEntry.rootPath, path)) !==
                currentEntry.worktreeStates.get(path),
            ),
          )
        ).some(Boolean)
      if (indexChanged || worktreeChanged) this.markProjectStale(projectId)
    }
    if (!entry || entry.stale) entry = await this.refreshSnapshot(projectId, source)
    if (entry.snapshot.generation !== generation) {
      throw new AgentError('REVIEW_SNAPSHOT_EXPIRED', 'Review 快照已经过期，请刷新后重试', 409, {
        latestGeneration: entry.snapshot.generation,
        retryable: true,
      })
    }
    return entry
  }

  private fileDiffRequestKey(path: string, hideWhitespace: boolean) {
    return `${path}\0${hideWhitespace ? 'whitespace-hidden' : 'standard'}`
  }

  private defensiveFileDiff(
    file: ReviewFileSummary,
    reason: 'changed-lines' | 'changed-bytes' | 'line-bytes',
    measuredChangedBytes = file.changedBytes,
  ): ReviewFileDiffResult {
    return {
      file: { ...file, changedBytes: measuredChangedBytes },
      revision: file.revision,
      patch: '',
      hunks: [],
      renderable: false,
      tooLargeReason: reason,
    }
  }

  private fileDiffFromPatch(file: ReviewFileSummary, patch: string): ReviewFileDiffResult {
    const patchBytes = Buffer.byteLength(patch, 'utf8')
    const measuredFile = { ...file, changedBytes: patchBytes }
    const maximumLineBytes = patch
      .split('\n')
      .reduce((maximum, line) => Math.max(maximum, Buffer.byteLength(line, 'utf8')), 0)
    const tooLargeReason =
      file.changedLines > UNRENDERABLE_CHANGED_LINES
        ? ('changed-lines' as const)
        : patchBytes > UNRENDERABLE_CHANGED_BYTES
          ? ('changed-bytes' as const)
          : maximumLineBytes > UNRENDERABLE_LINE_BYTES
            ? ('line-bytes' as const)
            : null
    if (tooLargeReason) {
      return this.defensiveFileDiff(measuredFile, tooLargeReason, patchBytes)
    }
    return {
      file: measuredFile,
      revision: file.revision,
      patch,
      hunks: file.binary ? [] : parseHunks(patch),
      renderable: !file.binary,
      tooLargeReason: null,
    }
  }

  private splitPatchSections(patch: string): string[] {
    const starts = [...patch.matchAll(/^diff --git /gm)].map((match) => match.index!)
    return starts.map((start, index) => patch.slice(start, starts[index + 1] ?? patch.length))
  }

  private async trackedPatches(
    entry: CachedReviewSnapshot,
    files: readonly ReviewFileSummary[],
    hideWhitespace: boolean,
    maxOutputBytes: number,
    fullContext = false,
  ): Promise<Map<string, string>> {
    if (files.length === 0) return new Map()
    const whitespaceArgs = hideWhitespace ? ['-w'] : []
    const requestedPaths = new Set(files.map((file) => file.path))
    const orderedFiles = entry.snapshot.files.filter(
      (file) => file.status !== 'untracked' && requestedPaths.has(file.path),
    )
    const paths = orderedFiles.map((file) => file.path)
    const output = await this.git(
      entry.rootPath,
      [
        'diff',
        '--binary',
        '--no-ext-diff',
        '--no-color',
        '--full-index',
        ...whitespaceArgs,
        ...(fullContext ? ['--unified=2147483647'] : []),
        ...entry.resolved.args,
        '--',
        ...paths,
      ],
      undefined,
      [0, 1],
      undefined,
      true,
      maxOutputBytes,
    )
    const sections = this.splitPatchSections(output.stdout)
    return new Map(orderedFiles.map((file, index) => [file.path, sections[index] ?? '']))
  }

  private async loadFileDiffs(
    entry: CachedReviewSnapshot,
    files: readonly ReviewFileSummary[],
    hideWhitespace: boolean,
    maxOutputBytes: number,
  ): Promise<void> {
    const tracked: ReviewFileSummary[] = []
    let remainingBytes = maxOutputBytes
    for (const file of files) {
      const requestKey = this.fileDiffRequestKey(file.path, hideWhitespace)
      if (entry.fileDiffs.has(requestKey)) continue
      if (file.changedLines > UNRENDERABLE_CHANGED_LINES) {
        entry.fileDiffs.set(requestKey, this.defensiveFileDiff(file, 'changed-lines'))
        continue
      }
      if (file.status === 'untracked') {
        const untracked = await this.safeUntrackedEntry(entry.rootPath, file.path)
        if (
          untracked?.kind === 'file' &&
          Bun.file(untracked.path).size > UNRENDERABLE_CHANGED_BYTES
        ) {
          entry.fileDiffs.set(
            requestKey,
            this.defensiveFileDiff(file, 'changed-bytes', Bun.file(untracked.path).size),
          )
          continue
        }
      }
      if (file.status !== 'untracked') {
        tracked.push(file)
        continue
      }
      const patch = (await this.untrackedFile(entry.rootPath, file.path))?.patch ?? ''
      const result = this.fileDiffFromPatch(file, patch)
      entry.fileDiffs.set(requestKey, result)
      remainingBytes -= Buffer.byteLength(result.patch, 'utf8')
      if (remainingBytes < 0) {
        throw new AgentError('GIT_OUTPUT_TOO_LARGE', '批量 Review Diff 超过安全上限', 413)
      }
    }

    const patches = await this.trackedPatches(entry, tracked, hideWhitespace, remainingBytes)
    for (const file of tracked) {
      const result = this.fileDiffFromPatch(file, patches.get(file.path) ?? '')
      entry.fileDiffs.set(this.fileDiffRequestKey(file.path, hideWhitespace), result)
    }
  }

  private isGitOutputTooLarge(cause: unknown) {
    return cause instanceof AgentError && cause.code === 'GIT_OUTPUT_TOO_LARGE'
  }

  async fileDiff(input: {
    projectId: string
    source: ReviewSource
    generation: string
    path: string
    hideWhitespace?: boolean | undefined
    loadFullFiles?: boolean | undefined
  }): Promise<ReviewFileDiffResult> {
    if (input.loadFullFiles) {
      const result = await this.fileDiff({ ...input, loadFullFiles: false })
      if (!result.renderable || result.file.binary || result.file.status === 'untracked')
        return result
      const entry = await this.snapshotForGeneration(
        input.projectId,
        input.source,
        input.generation,
        input.path,
      )
      try {
        const patches = await this.trackedPatches(
          entry,
          [result.file],
          input.hideWhitespace === true,
          UNRENDERABLE_CHANGED_BYTES,
          true,
        )
        await this.snapshotForGeneration(
          input.projectId,
          input.source,
          input.generation,
          input.path,
        )
        const contextPatch = patches.get(result.file.path) ?? ''
        if (contextPatch.split('\n').length > UNRENDERABLE_CHANGED_LINES) return result
        return { ...result, contextPatch }
      } catch (cause) {
        if (!this.isGitOutputTooLarge(cause)) throw cause
        return result
      }
    }
    const startedAt = performance.now()
    let path: string | undefined
    let phase = 'validate'
    let succeeded = false
    let slow = false
    const slowTimer = setTimeout(() => {
      slow = true
      this.logger?.warn('review.file-diff.slow', {
        details: {
          sourceKind: input.source.kind,
          path,
          hideWhitespace: input.hideWhitespace === true,
          phase,
          durationMs: Math.round(performance.now() - startedAt),
        },
      })
    }, REVIEW_SLOW_MS)
    const stalledTimer = setTimeout(() => {
      this.logger?.warn('review.file-diff.stalled', {
        details: {
          sourceKind: input.source.kind,
          path,
          hideWhitespace: input.hideWhitespace === true,
          phase,
          durationMs: Math.round(performance.now() - startedAt),
        },
      })
    }, REVIEW_STALLED_MS)
    try {
      path = validateRelativePath(input.path)
      phase = 'snapshot'
      const entry = await this.snapshotForGeneration(
        input.projectId,
        input.source,
        input.generation,
        path,
      )
      const hideWhitespace = input.hideWhitespace === true
      const requestKey = this.fileDiffRequestKey(path, hideWhitespace)
      phase = 'cache'
      const cached = entry.fileDiffs.get(requestKey)
      if (cached) {
        succeeded = true
        return cached
      }
      const active = entry.fileDiffRequests.get(requestKey)
      if (active) {
        phase = 'join-existing'
        const result = await active
        succeeded = true
        return result
      }
      phase = 'load'
      const request = (async () => {
        const file = entry.snapshot.files.find((candidate) => candidate.path === path)
        if (!file)
          throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '文件不在当前 Review 来源中', 404)
        try {
          await this.loadFileDiffs(entry, [file], hideWhitespace, UNRENDERABLE_CHANGED_BYTES)
        } catch (cause) {
          if (!this.isGitOutputTooLarge(cause)) throw cause
          entry.fileDiffs.set(
            requestKey,
            this.defensiveFileDiff(file, 'changed-bytes', UNRENDERABLE_CHANGED_BYTES + 1),
          )
        }
        return entry.fileDiffs.get(requestKey)!
      })()
      entry.fileDiffRequests.set(requestKey, request)
      try {
        const result = await request
        succeeded = true
        return result
      } finally {
        if (entry.fileDiffRequests.get(requestKey) === request) {
          entry.fileDiffRequests.delete(requestKey)
        }
      }
    } catch (cause) {
      this.logger?.error('review.file-diff.failed', {
        details: {
          sourceKind: input.source.kind,
          path,
          hideWhitespace: input.hideWhitespace === true,
          durationMs: Math.round(performance.now() - startedAt),
          ...this.reviewFailureDetails(cause),
        },
      })
      throw cause
    } finally {
      clearTimeout(slowTimer)
      clearTimeout(stalledTimer)
      if (succeeded && slow) {
        this.logger?.info('review.file-diff.recovered', {
          details: {
            sourceKind: input.source.kind,
            path,
            hideWhitespace: input.hideWhitespace === true,
            phase,
            durationMs: Math.round(performance.now() - startedAt),
          },
        })
      }
    }
  }

  async fileDiffs(input: {
    projectId: string
    source: ReviewSource
    generation: string
    paths: readonly string[]
    hideWhitespace?: boolean | undefined
    loadFullFiles?: boolean | undefined
  }): Promise<ReviewFileDiffsResult> {
    if (input.loadFullFiles) {
      const result = await this.fileDiffs({ ...input, loadFullFiles: false })
      if (result.type !== 'success') return result
      const files: ReviewFileDiffResult[] = []
      let contextBytes = 0
      for (const file of result.files) {
        const expanded = await this.fileDiff({ ...input, path: file.file.path })
        contextBytes += Buffer.byteLength(expanded.contextPatch ?? expanded.patch, 'utf8')
        if (contextBytes > MAX_BATCH_DIFF_BYTES) return result
        files.push(expanded)
      }
      return { ...result, files }
    }
    const startedAt = performance.now()
    const hideWhitespace = input.hideWhitespace === true
    let phase = 'validate'
    let pathCount = input.paths.length
    let cachedFileCount = 0
    let resultType: ReviewFileDiffsResult['type'] | undefined
    let changedBytes: number | undefined
    let succeeded = false
    this.logger?.info('review.file-diffs.started', {
      details: {
        sourceKind: input.source.kind,
        pathCount,
        hideWhitespace,
      },
    })
    const slowTimer = setTimeout(() => {
      this.logger?.warn('review.file-diffs.slow', {
        details: {
          sourceKind: input.source.kind,
          pathCount,
          hideWhitespace,
          phase,
          durationMs: Math.round(performance.now() - startedAt),
        },
      })
    }, REVIEW_SLOW_MS)
    const stalledTimer = setTimeout(() => {
      this.logger?.warn('review.file-diffs.stalled', {
        details: {
          sourceKind: input.source.kind,
          pathCount,
          hideWhitespace,
          phase,
          durationMs: Math.round(performance.now() - startedAt),
        },
      })
    }, REVIEW_STALLED_MS)
    try {
      const paths = [...new Set(input.paths.map(validateRelativePath))]
      pathCount = paths.length
      if (paths.length === 0 || paths.length > MAX_BATCH_DIFF_PATHS) {
        throw new AgentError(
          'INVALID_REQUEST',
          '批量 Review Diff 路径数量必须在 1 到 128 之间',
          400,
        )
      }
      phase = 'snapshot'
      const entry = await this.snapshotForGeneration(
        input.projectId,
        input.source,
        input.generation,
        paths,
      )
      const batchKey = [hideWhitespace ? 'whitespace-hidden' : 'standard', ...paths].join('\0')
      const active = entry.fileDiffBatchRequests.get(batchKey)
      let result: ReviewFileDiffsResult
      if (active) {
        phase = 'join-existing'
        result = await active
      } else {
        const request = (async (): Promise<ReviewFileDiffsResult> => {
          phase = 'resolve-files'
          const filesByPath = new Map(entry.snapshot.files.map((file) => [file.path, file]))
          const files = paths.map((path) => {
            const file = filesByPath.get(path)
            if (!file) {
              throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '文件不在当前 Review 来源中', 404)
            }
            return file
          })
          phase = 'join-file-requests'
          await Promise.all(
            files.flatMap((file) => {
              const activeFile = entry.fileDiffRequests.get(
                this.fileDiffRequestKey(file.path, hideWhitespace),
              )
              return activeFile ? [activeFile] : []
            }),
          )
          const cachedResults = files.map((file) =>
            entry.fileDiffs.get(this.fileDiffRequestKey(file.path, hideWhitespace)),
          )
          cachedFileCount = cachedResults.filter(Boolean).length
          const cachedBytes = cachedResults.reduce(
            (total, cached) => total + (cached ? Buffer.byteLength(cached.patch, 'utf8') : 0),
            0,
          )
          if (cachedBytes > MAX_BATCH_DIFF_BYTES) {
            return {
              type: 'large',
              generation: entry.snapshot.generation,
              reason: 'changed-bytes',
            }
          }
          phase = 'load'
          try {
            await this.loadFileDiffs(
              entry,
              files,
              hideWhitespace,
              MAX_BATCH_DIFF_BYTES - cachedBytes,
            )
          } catch (cause) {
            if (!this.isGitOutputTooLarge(cause)) throw cause
            return {
              type: 'large',
              generation: entry.snapshot.generation,
              reason: 'changed-bytes',
            }
          }
          phase = 'finalize'
          const results = files.map((file) =>
            entry.fileDiffs.get(this.fileDiffRequestKey(file.path, hideWhitespace))!,
          )
          const totalChangedBytes = results.reduce(
            (total, fileResult) => total + Buffer.byteLength(fileResult.patch, 'utf8'),
            0,
          )
          if (totalChangedBytes > MAX_BATCH_DIFF_BYTES) {
            return {
              type: 'large',
              generation: entry.snapshot.generation,
              reason: 'changed-bytes',
            }
          }
          return {
            type: 'success',
            generation: entry.snapshot.generation,
            files: results,
            changedBytes: totalChangedBytes,
          }
        })()
        entry.fileDiffBatchRequests.set(batchKey, request)
        try {
          result = await request
        } finally {
          if (entry.fileDiffBatchRequests.get(batchKey) === request) {
            entry.fileDiffBatchRequests.delete(batchKey)
          }
        }
      }
      resultType = result.type
      changedBytes = result.type === 'success' ? result.changedBytes : undefined
      succeeded = true
      return result
    } catch (cause) {
      this.logger?.error('review.file-diffs.failed', {
        details: {
          sourceKind: input.source.kind,
          pathCount,
          hideWhitespace,
          phase,
          durationMs: Math.round(performance.now() - startedAt),
          ...this.reviewFailureDetails(cause),
        },
      })
      throw cause
    } finally {
      clearTimeout(slowTimer)
      clearTimeout(stalledTimer)
      if (succeeded) {
        this.logger?.info('review.file-diffs.completed', {
          details: {
            sourceKind: input.source.kind,
            pathCount,
            hideWhitespace,
            cachedFileCount,
            resultType,
            changedBytes,
            phase,
            durationMs: Math.round(performance.now() - startedAt),
          },
        })
      }
    }
  }

  async branches(projectId: string) {
    const { rootPath } = await this.repository(projectId)
    const current = await this.optionalGit(rootPath, ['branch', '--show-current'])
    const output = await this.git(rootPath, [
      'for-each-ref',
      '--format=%(refname)%00%(objectname)%00%(HEAD)',
      'refs/heads',
      'refs/remotes',
    ])
    const defaultRef = await this.optionalGit(rootPath, [
      'symbolic-ref',
      '--quiet',
      'refs/remotes/origin/HEAD',
    ])
    const branches = output.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        const [refname, sha, marker] = line.split('\0')
        if (!refname || !sha || refname.endsWith('/HEAD')) return []
        const remote = refname.startsWith('refs/remotes/')
        return [
          {
            name: refname.replace(remote ? /^refs\/remotes\// : /^refs\/heads\//, ''),
            sha,
            current: marker === '*',
            remote,
            default: refname === defaultRef,
          },
        ]
      })
    return { current, branches }
  }

  async commits(projectId: string, limit = 50, ref?: string) {
    const { rootPath } = await this.repository(projectId)
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
    let commit: string | undefined
    if (ref !== undefined) {
      if (!ref || ref.startsWith('-') || /[\x00-\x20]/.test(ref)) {
        throw new AgentError('INVALID_REQUEST', '无效的分支引用', 400)
      }
      const resolved = await this.git(
        rootPath,
        ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
        undefined,
        [0, 128],
      )
      if (resolved.code !== 0)
        throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '指定分支或提交不存在，请刷新后重试', 404)
      commit = resolved.stdout.trim()
    }
    const output = await this.git(
      rootPath,
      [
        'log',
        `-${safeLimit}`,
        '--format=%H%x00%h%x00%s%x00%an%x00%at',
        ...(commit ? [commit] : []),
        '--',
      ],
      undefined,
      [0, 128],
    )
    if (output.code !== 0) {
      if (commit)
        throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '提交历史暂不可用，请刷新后重试', 409)
      return { commits: [] }
    }
    return {
      commits: output.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          const [sha, shortSha, subject, author, authoredAt] = line.split('\0')
          if (
            !sha ||
            !shortSha ||
            subject === undefined ||
            author === undefined ||
            authoredAt === undefined
          )
            return []
          return [
            { sha, shortSha, subject, author, authoredAt: Number.parseInt(authoredAt, 10) * 1_000 },
          ]
        }),
    }
  }

  async status(projectId: string) {
    const { rootPath } = await this.repository(projectId)
    const branchName = await this.optionalGit(rootPath, ['branch', '--show-current'])
    const upstream = await this.optionalGit(rootPath, [
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{upstream}',
    ])
    let ahead = 0
    let behind = 0
    if (upstream) {
      const counts = await this.optionalGit(rootPath, [
        'rev-list',
        '--left-right',
        '--count',
        `HEAD...${upstream}`,
      ])
      if (counts) {
        const [rawAhead, rawBehind] = counts.split(/\s+/)
        ahead = Number.parseInt(rawAhead ?? '0', 10) || 0
        behind = Number.parseInt(rawBehind ?? '0', 10) || 0
      }
    }
    const porcelain = await this.git(rootPath, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ])
    const files = parsePorcelainStatus(porcelain.stdout)
    return {
      branchName,
      upstream,
      ahead,
      behind,
      clean: porcelain.stdout.length === 0,
      files,
    }
  }

  async commit(input: { projectId: string; message: string; paths: readonly string[] }) {
    const message = input.message.trim()
    if (!message) {
      throw new AgentError('INVALID_REQUEST', '提交信息不能为空', 400)
    }
    const { rootPath } = await this.repository(input.projectId)
    const paths = [...new Set(input.paths.map(validateRelativePath))]
    if (paths.length > 0) {
      await this.gitPaths(rootPath, ['add', '-A'], paths)
    }
    const staged = await this.git(
      rootPath,
      ['diff', '--cached', '--quiet', '--exit-code'],
      undefined,
      [0, 1],
    )
    if (staged.code === 0) {
      throw new AgentError('CONFLICT', '没有可提交的已暂存变更', 409)
    }
    const committed = await this.git(rootPath, ['commit', '-m', message])
    const headSha = await this.optionalGit(rootPath, ['rev-parse', 'HEAD'])
    if (!headSha) {
      throw new AgentError('GIT_COMMAND_FAILED', '提交完成后无法读取 HEAD', 500)
    }
    return {
      ok: true as const,
      headSha,
      output: committed.stdout.trim(),
      status: await this.status(input.projectId),
    }
  }

  async apply(input: {
    projectId: string
    source: ReviewSource
    generation: string
    expectedRevision: string
    action: 'stage' | 'unstage' | 'revert'
    target: { kind: 'file'; path: string } | { kind: 'hunk'; path: string; hunkId: string }
  }): Promise<ReviewApplyResult> {
    if (input.source.kind !== 'unstaged' && input.source.kind !== 'staged') {
      throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '当前来源是只读的', 409)
    }
    const path = validateRelativePath(input.target.path)
    const current = await this.fileDiff({
      projectId: input.projectId,
      source: input.source,
      generation: input.generation,
      path,
    })
    if (current.revision !== input.expectedRevision) {
      throw new AgentError('REVIEW_SNAPSHOT_EXPIRED', '文件内容已经变化，请刷新后重试', 409)
    }
    const { rootPath } = await this.repository(input.projectId)
    const targetHunkId = input.target.kind === 'hunk' ? input.target.hunkId : null
    const patch = targetHunkId
      ? current.hunks.find((hunk) => hunk.id === targetHunkId)?.patch
      : current.patch
    if (input.target.kind === 'hunk' && !patch)
      throw new AgentError('REVIEW_SNAPSHOT_EXPIRED', '目标 Hunk 已不存在', 409)

    if (input.action === 'stage') {
      if (input.source.kind !== 'unstaged')
        throw new AgentError('CONFLICT', '只能暂存未暂存的变更', 409)
      if (input.target.kind === 'file') await this.gitPaths(rootPath, ['add'], [path])
      else await this.git(rootPath, ['apply', '--cached', '--binary', '-'], patch)
    } else if (input.action === 'unstage') {
      if (input.source.kind !== 'staged')
        throw new AgentError('CONFLICT', '只能取消暂存已暂存的变更', 409)
      if (input.target.kind === 'file') {
        const head = await this.optionalGit(rootPath, ['rev-parse', '--verify', 'HEAD'])
        if (head) await this.gitPaths(rootPath, ['restore', '--staged'], [path])
        else await this.gitPaths(rootPath, ['rm', '--cached'], [path])
      } else {
        await this.git(rootPath, ['apply', '--cached', '--reverse', '--binary', '-'], patch)
      }
    } else if (input.source.kind === 'unstaged') {
      if (input.target.kind === 'file' && current.file.status === 'untracked') {
        const absolute = resolve(rootPath, path)
        const containment = relative(rootPath, absolute)
        if (containment.startsWith('..') || isAbsolute(containment))
          throw new AgentError('PATH_DENIED', '文件超出仓库边界', 403)
        await unlink(absolute)
      } else if (input.target.kind === 'file') {
        await this.gitPaths(rootPath, ['restore', '--worktree'], [path])
      } else {
        await this.git(rootPath, ['apply', '--reverse', '--binary', '-'], patch)
      }
    } else if (input.target.kind === 'file') {
      const head = await this.optionalGit(rootPath, ['rev-parse', '--verify', 'HEAD'])
      if (!head) throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '空仓库无法恢复已暂存内容', 409)
      await this.gitPaths(rootPath, ['restore', '--source=HEAD', '--staged', '--worktree'], [path])
    } else {
      await this.git(rootPath, ['apply', '--cached', '--reverse', '--binary', '-'], patch)
      await this.git(rootPath, ['apply', '--reverse', '--binary', '-'], patch)
    }

    this.markProjectStale(input.projectId)
    const refreshed = await this.refreshSnapshot(input.projectId, input.source)
    return {
      ok: true,
      action: input.action,
      path,
      generation: refreshed.snapshot.generation,
    }
  }

  async applyBatch(input: {
    projectId: string
    source: ReviewSource
    generation: string
    action: 'stage' | 'unstage' | 'revert'
    items: readonly { path: string; expectedRevision: string }[]
  }): Promise<ReviewApplyBatchResult> {
    if (input.source.kind !== 'unstaged' && input.source.kind !== 'staged') {
      throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '当前来源是只读的', 409)
    }
    if (input.items.length === 0) {
      throw new AgentError('INVALID_REQUEST', '批量 Review 操作至少需要一个文件', 400)
    }
    if (input.action === 'stage' && input.source.kind !== 'unstaged') {
      throw new AgentError('CONFLICT', '只能暂存未暂存的变更', 409)
    }
    if (input.action === 'unstage' && input.source.kind !== 'staged') {
      throw new AgentError('CONFLICT', '只能取消暂存已暂存的变更', 409)
    }

    const items = input.items.map((item) => ({
      path: validateRelativePath(item.path),
      expectedRevision: item.expectedRevision,
    }))
    if (new Set(items.map((item) => item.path)).size !== items.length) {
      throw new AgentError('INVALID_REQUEST', '批量 Review 操作包含重复文件', 400)
    }

    const entry = await this.snapshotForGeneration(
      input.projectId,
      input.source,
      input.generation,
      items.map((item) => item.path),
    )
    const filesByPath = new Map(entry.snapshot.files.map((file) => [file.path, file]))
    for (const item of items) {
      const file = filesByPath.get(item.path)
      if (!file || file.revision !== item.expectedRevision) {
        throw new AgentError('REVIEW_SNAPSHOT_EXPIRED', '文件内容已经变化，请刷新后重试', 409)
      }
    }

    const paths = items.map((item) => item.path)
    let appliedCount = 0
    if (input.action === 'stage') {
      await this.gitPaths(entry.rootPath, ['add'], paths)
      appliedCount = paths.length
    } else if (input.action === 'unstage') {
      const head = await this.optionalGit(entry.rootPath, ['rev-parse', '--verify', 'HEAD'])
      if (head) await this.gitPaths(entry.rootPath, ['restore', '--staged'], paths)
      else await this.gitPaths(entry.rootPath, ['rm', '--cached'], paths)
      appliedCount = paths.length
    } else if (input.source.kind === 'unstaged') {
      const untrackedPaths = paths.filter((path) => filesByPath.get(path)?.status === 'untracked')
      const untrackedAbsolutePaths = new Map<string, string>()
      for (const path of untrackedPaths) {
        const absolute = resolve(entry.rootPath, path)
        const containment = relative(entry.rootPath, absolute)
        if (containment.startsWith('..') || isAbsolute(containment)) {
          throw new AgentError('PATH_DENIED', '文件超出仓库边界', 403)
        }
        if (!(await lstat(absolute).catch(() => null))) {
          throw new AgentError('REVIEW_SNAPSHOT_EXPIRED', '文件内容已经变化，请刷新后重试', 409)
        }
        untrackedAbsolutePaths.set(path, absolute)
      }
      try {
        for (const path of paths) {
          const absolute = untrackedAbsolutePaths.get(path)
          if (absolute) await unlink(absolute)
          else await this.gitPaths(entry.rootPath, ['restore', '--worktree'], [path])
          appliedCount += 1
        }
      } catch (cause) {
        this.markProjectStale(input.projectId)
        if (appliedCount > 0) {
          throw new AgentError(
            'REVIEW_BATCH_PARTIAL',
            '部分文件已处理，请刷新后确认工作区状态',
            409,
            { appliedCount, totalCount: paths.length },
          )
        }
        throw cause
      }
    } else {
      const head = await this.optionalGit(entry.rootPath, ['rev-parse', '--verify', 'HEAD'])
      if (!head) throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '空仓库无法恢复已暂存内容', 409)
      try {
        for (const path of paths) {
          await this.gitPaths(
            entry.rootPath,
            ['restore', '--source=HEAD', '--staged', '--worktree'],
            [path],
          )
          appliedCount += 1
        }
      } catch (cause) {
        this.markProjectStale(input.projectId)
        if (appliedCount > 0) {
          throw new AgentError(
            'REVIEW_BATCH_PARTIAL',
            '部分文件已处理，请刷新后确认工作区状态',
            409,
            { appliedCount, totalCount: paths.length },
          )
        }
        throw cause
      }
    }

    this.markProjectStale(input.projectId)
    const refreshed = await this.refreshSnapshot(input.projectId, input.source)
    return {
      ok: true,
      action: input.action,
      paths,
      generation: refreshed.snapshot.generation,
      appliedCount,
    }
  }

  listComments(input: { threadId: string; projectId: string; sourceKey: string }) {
    return this.db.listReviewComments(input)
  }

  saveComment(input: {
    id?: string | undefined
    threadId: string
    projectId: string
    sourceKey: string
    path: string
    side: 'old' | 'new'
    line: number
    hunkId: string | null
    revision: string
    body: string
    githubCommentId?: string | undefined
    githubThreadId?: string | undefined
  }): ReviewComment {
    validateRelativePath(input.path)
    return this.db.saveReviewComment({ ...input, path: normalizedPath(input.path) })
  }

  resolveComment(input: { id: string; threadId: string; projectId: string }) {
    return this.db.resolveReviewComment(input)
  }

  deleteComment(input: { id: string; threadId: string; projectId: string }) {
    this.db.deleteReviewComment(input)
    return { ok: true as const }
  }
}
