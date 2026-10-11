import type {
  DesktopReviewComment,
  DesktopReviewDiffFile,
  DesktopReviewDiffHunk,
  DesktopReviewSource,
} from '../../../../shared/Types.js'
import { expandReviewContext, unifiedPatchToDesktopHunks } from '../diff/ReviewDiffAdapter.js'
import { AgentRpcError } from '../../../services/AgentRpcClient.js'
import {
  desktopClient,
  type DesktopReviewAgentComment,
} from '../../../services/desktop-client/index.js'

export type ReviewFileSummary = {
  path: string
  previousPath: string | null
  status:
    | 'added'
    | 'modified'
    | 'deleted'
    | 'renamed'
    | 'copied'
    | 'untracked'
    | 'type-changed'
    | 'unknown'
  additions: number | null
  deletions: number | null
  changedLines: number
  changedBytes: number
  binary: boolean
  revision: string
}

export type ReviewSummarySnapshot = {
  projectId: string
  generation: string
  source: DesktopReviewSource
  repositoryRoot: string
  headSha: string | null
  baseSha: string | null
  files: ReviewFileSummary[]
  totals: {
    files: number
    additions: number
    deletions: number
    changedLines: number
    changedBytes: number
  }
  largeDiffMode: boolean
}

export type ReviewSummaryResult = {
  snapshot: ReviewSummarySnapshot
  cacheState: 'fresh' | 'stale'
}

export type ReviewFileDiff = {
  file: ReviewFileSummary
  revision: string
  patch: string
  contextPatch?: string
  hunks: Array<{
    id: string
    header: string
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    patch: string
  }>
  renderable: boolean
  tooLargeReason: 'changed-lines' | 'changed-bytes' | 'line-bytes' | null
}

export type ReviewFileDiffsResult =
  | {
      type: 'success'
      generation: string
      files: ReviewFileDiff[]
      changedBytes: number
    }
  | {
      type: 'large'
      generation: string
      reason: 'changed-bytes'
    }

export type ReviewBranch = {
  name: string
  sha: string
  current: boolean
  remote: boolean
  default?: boolean
}

export type ReviewCommit = {
  sha: string
  shortSha: string
  subject: string
  author: string
  authoredAt: string
}

export type ReviewLoadState =
  | 'loading'
  | 'success'
  | 'empty'
  | 'not-repository'
  | 'large-diff'
  | 'stale'
  | 'unsupported'
  | 'error'

export const reviewAgentClient = {
  async summary(
    workspacePath: string,
    source: DesktopReviewSource,
    refresh = false,
    projectId?: string,
  ): Promise<ReviewSummaryResult> {
    return desktopClient.getAgentReviewSummary({
      ...(projectId ? { projectId } : {}),
      workspacePath,
      source,
      refresh,
    })
  },

  async fileDiff(
    workspacePath: string,
    source: DesktopReviewSource,
    generation: string,
    path: string,
    hideWhitespace: boolean,
    projectId?: string,
    loadFullFiles = false,
  ): Promise<ReviewFileDiff> {
    return desktopClient.getAgentReviewFileDiff({
      ...(projectId ? { projectId } : {}),
      workspacePath,
      source,
      generation,
      path,
      hideWhitespace,
      loadFullFiles,
    })
  },

  async apply(
    workspacePath: string,
    input: {
      source: DesktopReviewSource
      generation: string
      expectedRevision: string
      action: 'stage' | 'unstage' | 'revert'
      target: { kind: 'file'; path: string } | { kind: 'hunk'; path: string; hunkId: string }
    },
    projectId?: string,
  ): Promise<void> {
    await desktopClient.applyAgentReviewOperation({
      ...(projectId ? { projectId } : {}),
      workspacePath,
      source: input.source,
      generation: input.generation,
      expectedRevision: input.expectedRevision,
      action: input.action,
      target: input.target,
    })
  },

  async fileDiffs(
    workspacePath: string,
    source: DesktopReviewSource,
    generation: string,
    paths: readonly string[],
    hideWhitespace: boolean,
    projectId?: string,
    loadFullFiles = false,
  ): Promise<ReviewFileDiffsResult> {
    const result = await desktopClient.getAgentReviewFileDiffs({
      ...(projectId ? { projectId } : {}),
      workspacePath,
      source,
      generation,
      paths,
      hideWhitespace,
      loadFullFiles,
    })
    return result.type === 'large'
      ? { ...result }
      : {
          ...result,
          files: result.files.map((file) => ({
            ...file,
            file: { ...file.file },
            hunks: file.hunks.map((hunk) => ({ ...hunk })),
          })),
        }
  },

  async applyBatch(
    workspacePath: string,
    input: {
      source: DesktopReviewSource
      generation: string
      action: 'stage' | 'unstage' | 'revert'
      items: [
        { path: string; expectedRevision: string },
        ...Array<{ path: string; expectedRevision: string }>,
      ]
    },
    projectId?: string,
  ): Promise<void> {
    await desktopClient.applyAgentReviewBatch({
      ...(projectId ? { projectId } : {}),
      workspacePath,
      source: input.source,
      generation: input.generation,
      action: input.action,
      items: input.items,
    })
  },

  async branches(workspacePath: string, projectId?: string): Promise<ReviewBranch[]> {
    return desktopClient.getAgentReviewBranches(workspacePath, projectId)
  },

  async commits(workspacePath: string, projectId?: string): Promise<ReviewCommit[]> {
    return desktopClient.getAgentReviewCommits(workspacePath, projectId)
  },

  async listComments(
    workspacePath: string,
    threadId: string,
    source: DesktopReviewSource,
    projectId?: string,
  ): Promise<DesktopReviewComment[]> {
    const sourceKey = reviewSourceKey(source)
    const comments = await desktopClient.listAgentReviewComments({
      ...(projectId ? { projectId } : {}),
      workspacePath,
      threadId,
      sourceKey,
    })
    return comments.map(toDesktopComment)
  },

  async saveComment(
    workspacePath: string,
    threadId: string,
    source: DesktopReviewSource,
    revision: string,
    input: {
      filePath: string
      side: 'left' | 'right'
      lineNumber: number
      body: string
      hunkId?: string | null
    },
    projectId?: string,
  ): Promise<DesktopReviewComment> {
    const comment = await desktopClient.saveAgentReviewComment({
      ...(projectId ? { projectId } : {}),
      workspacePath,
      threadId,
      sourceKey: reviewSourceKey(source),
      path: input.filePath,
      side: input.side === 'left' ? 'old' : 'new',
      line: input.lineNumber,
      hunkId: input.hunkId ?? null,
      revision,
      body: input.body,
    })
    return toDesktopComment(comment)
  },

  async resolveComment(
    workspacePath: string,
    threadId: string,
    id: string,
    projectId?: string,
  ): Promise<DesktopReviewComment> {
    return toDesktopComment(
      await desktopClient.resolveAgentReviewComment({
        ...(projectId ? { projectId } : {}),
        workspacePath,
        threadId,
        id,
      }),
    )
  },

  async deleteComment(
    workspacePath: string,
    threadId: string,
    id: string,
    projectId?: string,
  ): Promise<void> {
    await desktopClient.deleteAgentReviewComment({
      ...(projectId ? { projectId } : {}),
      workspacePath,
      threadId,
      id,
    })
  },

  async publishGithubComment(
    source: Extract<DesktopReviewSource, { kind: 'pull-request' }>,
    input: {
      body: string
      path: string
      side: 'left' | 'right'
      line: number
      expectedHeadRevision: string
      commitId?: string
    },
  ): Promise<{ id: number; nodeId: string; htmlUrl: string }> {
    return desktopClient.publishAgentGithubReviewComment({
      source,
      body: input.body,
      path: input.path,
      side: input.side === 'left' ? 'LEFT' : 'RIGHT',
      line: input.line,
      expectedHeadRevision: input.expectedHeadRevision,
      ...(input.commitId ? { commitId: input.commitId } : {}),
    })
  },

  async linkGithubComment(
    workspacePath: string,
    source: Extract<DesktopReviewSource, { kind: 'pull-request' }>,
    comment: DesktopReviewComment,
    github: { id: number },
    projectId?: string,
  ): Promise<DesktopReviewComment> {
    if (!comment.revision) {
      throw new Error('本地评论缺少 revision，无法建立 GitHub 映射')
    }
    return toDesktopComment(
      await desktopClient.saveAgentReviewComment({
        ...(projectId ? { projectId } : {}),
        id: comment.id,
        workspacePath,
        threadId: comment.sessionId,
        sourceKey: reviewSourceKey(source),
        path: comment.filePath,
        side: comment.side === 'left' ? 'old' : 'new',
        line: comment.lineNumber,
        hunkId: comment.hunkId ?? null,
        revision: comment.revision,
        body: comment.body,
        githubCommentId: String(github.id),
      }),
    )
  },

  async submitGithubReview(
    source: Extract<DesktopReviewSource, { kind: 'pull-request' }>,
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES',
    expectedHeadRevision: string,
    body?: string,
  ): Promise<{ id: number; state: string; htmlUrl: string }> {
    return desktopClient.submitAgentGithubReview({
      source,
      event,
      expectedHeadRevision,
      ...(body ? { body } : {}),
    })
  },

  isSnapshotExpired(error: unknown): boolean {
    return error instanceof AgentRpcError && error.errorCode === 'REVIEW_SNAPSHOT_EXPIRED'
  },

  isBatchPartial(error: unknown): boolean {
    return error instanceof AgentRpcError && error.errorCode === 'REVIEW_BATCH_PARTIAL'
  },

  isBatchUnsupported(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'AGENT_OPERATION_UNSUPPORTED',
    )
  },
}

type ReviewFileRequest = {
  key: string
  run: () => Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

/**
 * Shares queued and active file loads by generation/path/options, while keeping
 * viewport prefetches from flooding the local Agent with Git work.
 */
export class ReviewFileRequestCoordinator {
  readonly #maxConcurrency: number
  readonly #requests = new Map<string, Promise<void>>()
  readonly #queue: ReviewFileRequest[] = []
  #activeCount = 0

  constructor(maxConcurrency = 2) {
    this.#maxConcurrency = Math.max(1, Math.floor(maxConcurrency))
  }

  schedule(
    key: string,
    run: () => Promise<void>,
    priority: 'selected' | 'prefetch' = 'prefetch',
  ): Promise<void> {
    const existing = this.#requests.get(key)
    if (existing) {
      if (priority === 'selected') {
        const queuedIndex = this.#queue.findIndex((request) => request.key === key)
        if (queuedIndex > 0) {
          const [queued] = this.#queue.splice(queuedIndex, 1)
          if (queued) this.#queue.unshift(queued)
        }
      }
      return existing
    }

    let resolveRequest!: () => void
    let rejectRequest!: (error: unknown) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolveRequest = resolve
      rejectRequest = reject
    })
    const request = {
      key,
      run,
      resolve: resolveRequest,
      reject: rejectRequest,
    }
    this.#requests.set(key, promise)
    if (priority === 'selected') this.#queue.unshift(request)
    else this.#queue.push(request)
    this.#drain()
    return promise
  }

  #drain(): void {
    while (this.#activeCount < this.#maxConcurrency && this.#queue.length > 0) {
      const request = this.#queue.shift()
      if (!request) return
      this.#activeCount += 1
      void request
        .run()
        .then(request.resolve, request.reject)
        .finally(() => {
          this.#activeCount -= 1
          this.#requests.delete(request.key)
          this.#drain()
        })
    }
  }
}

export function retainCurrentReviewFileDiffs(
  nextSummary: ReviewSummarySnapshot,
  loadedDiffs: ReadonlyMap<string, ReviewFileDiff>,
): Map<string, ReviewFileDiff> {
  const revisions = new Map(nextSummary.files.map((file) => [file.path, file.revision] as const))
  return new Map(
    [...loadedDiffs].filter(([path, loaded]) => revisions.get(path) === loaded.revision),
  )
}

export function reviewSourceKey(source: DesktopReviewSource): string {
  switch (source.kind) {
    case 'uncommitted':
    case 'unstaged':
    case 'staged':
      return source.kind
    case 'branch':
      return `branch:${source.baseBranch}`
    case 'commit':
      return `commit:${source.commitSha}`
    case 'last-turn':
      return `last-turn:${source.threadId}:${source.turnId}`
    case 'pull-request':
      return `pull-request:${source.owner}/${source.repository}#${source.number}`
  }
}

export function reviewSourceLabel(source: DesktopReviewSource): string {
  switch (source.kind) {
    case 'uncommitted':
      return '未提交'
    case 'unstaged':
      return '未暂存'
    case 'staged':
      return '已暂存'
    case 'branch':
      return '分支'
    case 'commit':
      return '提交'
    case 'last-turn':
      return '上一轮'
    case 'pull-request':
      return `PR #${source.number}`
  }
}

export function pickDefaultReviewBaseBranch(branches: readonly ReviewBranch[]): string | null {
  if (branches.length === 0) return null
  const repositoryDefault = branches.find((branch) => branch.default)
  if (repositoryDefault) return repositoryDefault.name
  const preferredNames = [
    'origin/main',
    'upstream/main',
    'main',
    'origin/master',
    'upstream/master',
    'master',
  ]
  for (const name of preferredNames) {
    const match = branches.find((branch) => !branch.current && branch.name === name)
    if (match) return match.name
  }
  return (
    branches.find((branch) => !branch.current && branch.remote)?.name ??
    branches.find((branch) => !branch.current)?.name ??
    branches.find((branch) => branch.current)?.name ??
    branches[0]?.name ??
    null
  )
}

export function reviewLoadStateForError(error: unknown): ReviewLoadState {
  if (error instanceof AgentRpcError) {
    if (error.errorCode === 'REPOSITORY_NOT_FOUND') return 'not-repository'
    if (error.errorCode === 'REVIEW_SNAPSHOT_EXPIRED') return 'stale'
    if (error.errorCode === 'CAPABILITY_REQUIRED') return 'unsupported'
  }
  if (
    error instanceof Error &&
    (error.message.includes('AGENT_OPERATION_UNSUPPORTED') ||
      error.message.includes('Agent 版本过旧'))
  ) {
    return 'unsupported'
  }
  return 'error'
}

export function summaryFileToDesktop(
  file: ReviewFileSummary,
  loaded?: ReviewFileDiff,
): DesktopReviewDiffFile {
  return {
    partialHunks:
      loaded?.contextPatch !== undefined
        ? unifiedPatchToDesktopHunks(loaded.patch, loaded.hunks)
        : undefined,
    fullContext: loaded?.contextPatch !== undefined || file.status === 'untracked',
    path: file.path,
    ...(file.previousPath ? { originalPath: file.previousPath } : {}),
    status: file.status,
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    isUntracked: file.status === 'untracked',
    hunks: loaded ? parseReviewFileDiff(loaded) : [],
    revision: loaded?.revision ?? file.revision,
    renderable: loaded?.renderable,
    tooLargeReason: loaded?.tooLargeReason,
  }
}

function parseReviewFileDiff(diff: ReviewFileDiff): DesktopReviewDiffHunk[] {
  if (!diff.renderable) return []
  return expandReviewContext(unifiedPatchToDesktopHunks(diff.patch, diff.hunks), diff.contextPatch)
}

function toDesktopComment(comment: DesktopReviewAgentComment): DesktopReviewComment {
  return {
    id: comment.id,
    sessionId: comment.threadId,
    filePath: comment.path,
    side: comment.side === 'old' ? 'left' : 'right',
    lineNumber: comment.line,
    lineContent: '',
    body: comment.body,
    status: comment.status,
    revision: comment.revision,
    hunkId: comment.hunkId,
    githubCommentId: comment.githubCommentId,
    githubThreadId: comment.githubThreadId,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  }
}
