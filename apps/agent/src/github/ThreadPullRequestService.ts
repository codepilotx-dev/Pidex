import { Effect } from 'effect'
import type {
  ThreadPullRequestList,
  ThreadPullRequestReason,
  ThreadPullRequestState,
  ThreadPullRequestSummary,
} from '@pidex/shared/thread'
import { AgentError, type EventEnvelope } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { ThreadPullRequestRecord } from '../storage/repositories/ThreadPullRequestRepository'
import type { EventHub } from '../storage/events/EventHub'
import { GitCommandRunner } from '../git/GitCommandRunner'
import type { GithubService } from './GithubService'
import { watchIdentity, watchReady } from './PullRequestWatchService'

/** Status freshness window, shared with the renderer's 60s sidebar refresh. */
const CACHE_TTL_MS = 60_000
/** Bounds GitHub API fan-out while the sidebar refreshes many threads at once. */
const MAX_CONCURRENT_REFRESHES = 4
const GIT_TIMEOUT_MS = 15_000

type WatchStatus = Awaited<ReturnType<GithubService['readWatch']>>

type ResolvedStatus = {
  state: ThreadPullRequestState
  reason: ThreadPullRequestReason | null
  stale: boolean
  checkedAt: number
}

type ThreadEnvironment = {
  repo: { owner: string; repository: string } | null
  branch: string | null
}

/** Minimal git surface used to read the execution directory's branch. */
export type ThreadPullRequestGitRunner = {
  run(input: {
    cwd: string
    args: readonly string[]
    env: Record<string, string>
    acceptedCodes: null
  }): Promise<{ code: number; stdout: string; stderr: string }>
}

const EMPTY_ENVIRONMENT: ThreadEnvironment = { repo: null, branch: null }

const identityKey = (input: { owner: string; repository: string; number: number }): string =>
  `${input.owner.toLowerCase()}/${input.repository.toLowerCase()}#${input.number}`

/**
 * Maps a GitHub PR snapshot onto the sidebar status. Closed/merged/draft win
 * first, then conflicts, then CI, then mergeability — mirroring the merge
 * conditions the PR watch service already enforces through `watchReady`.
 */
export const threadPullRequestStatus = (
  pr: WatchStatus,
): { state: ThreadPullRequestState; reason: ThreadPullRequestReason | null } => {
  if (pr.state === 'MERGED') return { state: 'merged', reason: null }
  if (pr.state === 'CLOSED') return { state: 'closed', reason: null }
  if (pr.isDraft) return { state: 'draft', reason: null }
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY')
    return { state: 'conflicts', reason: null }
  const checks = pr.statusCheckRollup?.state ?? null
  if (checks === 'FAILURE' || checks === 'ERROR') return { state: 'checks-failed', reason: null }
  if (watchReady(pr, pr.headRefOid)) return { state: 'mergeable', reason: null }
  if (checks === 'SUCCESS') return { state: 'checks-passing', reason: null }
  return { state: 'waiting', reason: waitingReason(pr) }
}

const waitingReason = (pr: WatchStatus): ThreadPullRequestReason => {
  if (pr.mergeStateStatus === 'BEHIND') return 'behind-base'
  if (pr.reviewDecision === 'CHANGES_REQUESTED' || pr.reviewDecision === 'REVIEW_REQUIRED')
    return 'review-required'
  const checks = pr.statusCheckRollup?.state ?? null
  if (checks === 'EXPECTED' || checks === 'PENDING') return 'checks-running'
  if (pr.mergeStateStatus === 'BLOCKED') return 'blocked'
  if (pr.mergeStateStatus === 'UNSTABLE') return 'unstable'
  return 'unknown'
}

const unknownStatus = (checkedAt: number): ResolvedStatus => ({
  state: 'unknown',
  reason: null,
  stale: true,
  checkedAt,
})

const runLimited = async <T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> => {
  const results = new Array<T>(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= tasks.length) return
      results[index] = await tasks[index]!()
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Owns thread↔pull-request associations: persisted explicit links, the 60s
 * status cache the sidebar reads, and the execution-directory probe that only
 * ranks those links. Never invents associations from a shared branch: two
 * threads in the same repo/branch would otherwise claim the same PR.
 *
 * ponytail: both caches are unbounded Maps keyed by thread/PR identity; add
 * eviction only if very long-lived sessions make the footprint matter.
 */
export class ThreadPullRequestService {
  private readonly git: ThreadPullRequestGitRunner
  private readonly now: () => number
  private readonly statusCache = new Map<string, ResolvedStatus>()
  private readonly statusInFlight = new Map<string, Promise<ResolvedStatus>>()
  private readonly environmentCache = new Map<string, { at: number; value: ThreadEnvironment }>()

  constructor(
    private readonly db: AgentDatabase,
    private readonly github: GithubService,
    private readonly hub: EventHub,
    options: { now?: () => number; git?: ThreadPullRequestGitRunner } = {},
  ) {
    this.now = options.now ?? Date.now
    this.git =
      options.git ?? new GitCommandRunner({ timeoutMs: GIT_TIMEOUT_MS, maxOutputBytes: 64 * 1024 })
  }

  private repository() {
    return this.db.repositories.threadPullRequests
  }

  private requireThread(threadId: string): void {
    if (!this.db.getThread(threadId)) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
  }

  private requireWritableStorage(): void {
    if (!this.repository().available()) {
      throw new AgentError('PERMISSION_DENIED', '当前存储不支持 Pull Request 关联写入', 403)
    }
  }

  private async publishStored(events: readonly EventEnvelope[]) {
    for (const event of events) await Effect.runPromise(this.hub.publish(event))
  }

  /**
   * Sidebar-visible associations. Historical `discovered` rows stay in the
   * database but never reach a read, mutation result or event; re-linking the
   * same PR upgrades the row to an explicit origin and it shows up again.
   */
  private visible(threadId: string): ThreadPullRequestRecord[] {
    return this.repository()
      .list(threadId)
      .filter((record) => record.origin !== 'discovered')
  }

  /** Persists associations and stages one durable event for the affected thread. */
  private publish(threadId: string): EventEnvelope {
    return this.db.insertEvent(threadId, null, 'thread/pull-requests/updated', {
      threadId,
      items: this.summaries(this.visible(threadId)),
    })
  }

  /** Fallback summary for persisted links without a live status read. */
  private summaries(records: readonly ThreadPullRequestRecord[]): ThreadPullRequestSummary[] {
    return records.map((record) => ({
      owner: record.owner,
      repository: record.repository,
      number: record.number,
      url: record.url,
      title: record.title,
      origin: record.origin,
      primary: false,
      status: this.statusCache.get(identityKey(record)) ?? unknownStatus(0),
    }))
  }

  async read(input: {
    threadIds: readonly string[]
    resolveCwd: (threadId: string) => Promise<string | null>
  }): Promise<{ threads: ThreadPullRequestList[] }> {
    const unique = [...new Set(input.threadIds)]
    const threads = await runLimited(
      unique.map((threadId) => () => this.readThread(threadId, input.resolveCwd)),
      MAX_CONCURRENT_REFRESHES,
    )
    return { threads }
  }

  private async readThread(
    threadId: string,
    resolveCwd: (threadId: string) => Promise<string | null>,
  ): Promise<ThreadPullRequestList> {
    if (!this.db.getThread(threadId) || !this.repository().available()) {
      return { threadId, items: [] }
    }
    const environment = await this.resolveEnvironment(threadId, resolveCwd)
    const records = this.visible(threadId)
    const statuses = await this.refresh(records)
    return { threadId, items: this.order(records, statuses, environment) }
  }

  private async resolveEnvironment(
    threadId: string,
    resolveCwd: (threadId: string) => Promise<string | null>,
  ): Promise<ThreadEnvironment> {
    const cached = this.environmentCache.get(threadId)
    if (cached && this.now() - cached.at < CACHE_TTL_MS) return cached.value
    const value = await this.probeEnvironment(threadId, resolveCwd)
    this.environmentCache.set(threadId, { at: this.now(), value })
    return value
  }

  private cachedEnvironment(threadId: string): ThreadEnvironment {
    return this.environmentCache.get(threadId)?.value ?? EMPTY_ENVIRONMENT
  }

  private async probeEnvironment(
    threadId: string,
    resolveCwd: (threadId: string) => Promise<string | null>,
  ): Promise<ThreadEnvironment> {
    let cwd: string | null = null
    try {
      cwd = await resolveCwd(threadId)
    } catch {
      cwd = null
    }
    if (!cwd) return EMPTY_ENVIRONMENT
    try {
      const repo = await this.github.repositoryIdentity(cwd)
      const branch = await this.currentBranch(cwd)
      return { repo, branch }
    } catch {
      return EMPTY_ENVIRONMENT
    }
  }

  private async currentBranch(cwd: string): Promise<string | null> {
    const result = await this.git.run({
      cwd,
      args: ['rev-parse', '--abbrev-ref', 'HEAD'],
      env: {},
      acceptedCodes: null,
    })
    const branch = result.stdout.trim()
    return result.code === 0 && branch && branch !== 'HEAD' ? branch : null
  }

  private async refresh(
    records: readonly ThreadPullRequestRecord[],
  ): Promise<Map<string, ResolvedStatus>> {
    const resolved = await runLimited(
      records.map((record) => () => this.statusFor(record)),
      MAX_CONCURRENT_REFRESHES,
    )
    const statuses = new Map<string, ResolvedStatus>()
    records.forEach((record, index) => statuses.set(identityKey(record), resolved[index]!))
    return statuses
  }

  private statusFor(record: ThreadPullRequestRecord): Promise<ResolvedStatus> {
    const key = identityKey(record)
    const cached = this.statusCache.get(key)
    if (cached && this.now() - cached.checkedAt < CACHE_TTL_MS) return Promise.resolve(cached)
    const inFlight = this.statusInFlight.get(key)
    if (inFlight) return inFlight
    const promise = this.fetchStatus(record)
      .then((status) => {
        this.statusCache.set(key, status)
        return status
      })
      .finally(() => this.statusInFlight.delete(key))
    this.statusInFlight.set(key, promise)
    return promise
  }

  private async fetchStatus(record: ThreadPullRequestRecord): Promise<ResolvedStatus> {
    const previous = this.statusCache.get(identityKey(record))
    try {
      const pr = await this.github.readWatch({
        owner: record.owner,
        repository: record.repository,
        number: record.number,
      })
      const { state, reason } = threadPullRequestStatus(pr)
      return { state, reason, stale: false, checkedAt: this.now() }
    } catch {
      // Rate limits, missing auth or a deleted PR must not keep a misleading green dot.
      return unknownStatus(previous?.checkedAt ?? 0)
    }
  }

  /** Primary association first, then most recently updated; marks exactly one primary. */
  private order(
    records: readonly ThreadPullRequestRecord[],
    statuses: Map<string, ResolvedStatus>,
    environment: ThreadEnvironment,
  ): ThreadPullRequestSummary[] {
    const rank = (record: ThreadPullRequestRecord): number => {
      if (!this.matchesEnvironment(record, environment)) return 2
      const state = statuses.get(identityKey(record))?.state
      if (state === 'draft') return 1
      if (state === 'merged' || state === 'closed') return 2
      return 0
    }
    return [...records]
      .sort((left, right) => rank(left) - rank(right) || right.updatedAt - left.updatedAt)
      .map((record, index) => ({
        owner: record.owner,
        repository: record.repository,
        number: record.number,
        url: record.url,
        title: record.title,
        origin: record.origin,
        primary: index === 0,
        status: statuses.get(identityKey(record)) ?? unknownStatus(0),
      }))
  }

  private matchesEnvironment(
    record: ThreadPullRequestRecord,
    environment: ThreadEnvironment,
  ): boolean {
    if (!environment.repo || !environment.branch) return false
    return (
      record.owner === environment.repo.owner.toLowerCase() &&
      record.repository === environment.repo.repository.toLowerCase() &&
      record.headRef === environment.branch
    )
  }

  /** Explicit user link; verifies the URL against GitHub before persisting. */
  async link(input: { threadId: string; url: string }): Promise<{ thread: ThreadPullRequestList }> {
    this.requireThread(input.threadId)
    this.requireWritableStorage()
    const identity = watchIdentity(input.url)
    const { pullRequest } = await this.github.readPullRequest(identity)
    const event = this.db.transaction(() => {
      this.repository().upsert({
        threadId: input.threadId,
        owner: identity.owner,
        repository: identity.repository,
        number: identity.number,
        url: identity.url,
        title: pullRequest.title,
        headRef: pullRequest.head.ref,
        origin: 'manual',
      })
      return this.publish(input.threadId)
    })
    await this.publishStored([event])
    return { thread: await this.readThreadView(input.threadId) }
  }

  async unlink(input: {
    threadId: string
    owner: string
    repository: string
    number: number
  }): Promise<{ thread: ThreadPullRequestList }> {
    this.requireThread(input.threadId)
    this.requireWritableStorage()
    const event = this.db.transaction(() => {
      const changed = this.repository().remove(input.threadId, input)
      return changed ? this.publish(input.threadId) : null
    })
    if (event) await this.publishStored([event])
    return { thread: await this.readThreadView(input.threadId) }
  }

  /** Records an association created by another flow (create PR, PR watch). */
  record(input: {
    threadId: string
    owner: string
    repository: string
    number: number
    url: string
    title: string | null
    headRef: string | null
    origin: 'created' | 'watch'
  }): void {
    if (!this.repository().available()) return
    const event = this.db.transaction(() => {
      this.repository().upsert(input)
      return this.publish(input.threadId)
    })
    // 通知失败不影响已经提交的关联，也不阻塞创建 PR / 开启监控。
    void this.publishStored([event]).catch(() => undefined)
  }

  /** Fresh read for a single thread, used as the mutation result. */
  private async readThreadView(threadId: string): Promise<ThreadPullRequestList> {
    const records = this.visible(threadId)
    const statuses = await this.refresh(records)
    return { threadId, items: this.order(records, statuses, this.cachedEnvironment(threadId)) }
  }
}
