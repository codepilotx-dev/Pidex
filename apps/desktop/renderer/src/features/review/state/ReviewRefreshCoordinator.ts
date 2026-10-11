import type { DesktopReviewSource } from '../../../../shared/Types.js'
import { reviewSourceKey } from '../source/ReviewAgentClient.js'

export type ReviewRefreshResult = {
  cacheState: 'fresh' | 'stale'
}

export type ReviewRequestStamp = {
  identity: string
  generation: string
  requestId: number
}

type ReviewRefreshCycle<TResult> = {
  identity: string
  queuedForce: boolean
  promise: Promise<TResult | null>
}

export const REVIEW_REFRESH_MAX_ATTEMPTS = 3
export const REVIEW_REPOSITORY_BUSY_MESSAGE = '工作区持续变化，请稍后重试'
/** 文件变化停止后等待多久才自动刷新，收到新变化会重新计时。 */
export const REVIEW_AUTO_REFRESH_DELAY_MS = 60_000

export class ReviewRepositoryBusyError extends Error {
  constructor() {
    super(REVIEW_REPOSITORY_BUSY_MESSAGE)
    this.name = 'ReviewRepositoryBusyError'
  }
}

export type ReviewRefreshReason = 'auto' | 'immediate'

/** 同时识别 Agent 的 RPC busy 错误和协调器自己抛出的 busy 错误。 */
export function isReviewRepositoryBusyError(error: unknown): boolean {
  if (error instanceof ReviewRepositoryBusyError) return true
  return (
    error instanceof Error &&
    (error as Error & { errorCode?: unknown }).errorCode === 'REVIEW_REPOSITORY_BUSY'
  )
}

/**
 * 自动刷新遇到 busy 时静默退避并保留现有内容；手动刷新和其他错误继续反馈。
 */
export function shouldDeferReviewRefresh(reason: ReviewRefreshReason, error: unknown): boolean {
  return reason === 'auto' && isReviewRepositoryBusyError(error)
}

export function isReviewRequestCurrent(
  request: ReviewRequestStamp,
  current: ReviewRequestStamp | null | undefined,
): boolean {
  return (
    current !== null &&
    current !== undefined &&
    request.identity === current.identity &&
    request.generation === current.generation &&
    request.requestId === current.requestId
  )
}

export function createReviewSummaryIdentity(
  projectId: string | null,
  workspacePath: string | null,
  source: DesktopReviewSource,
): string {
  return `${projectId ?? ''}\0${workspacePath ?? ''}\0${reviewSourceKey(source)}`
}

export function createReviewCommentIdentity(
  summaryIdentity: string,
  activeSessionId: string | null,
): string {
  return `${summaryIdentity}\0${activeSessionId ?? ''}`
}

export function reviewGitChangeMatchesProject(detail: unknown, projectId: string | null): boolean {
  return (
    typeof projectId === 'string' &&
    projectId.length > 0 &&
    typeof detail === 'object' &&
    detail !== null &&
    'projectId' in detail &&
    detail.projectId === projectId
  )
}

/**
 * Serializes summary refreshes for the active source. A force request arriving
 * during an active request, or a stale result, schedules exactly one trailing
 * force refresh so the view eventually converges without parallel Git scans.
 */
export class ReviewRefreshCoordinator<TResult extends ReviewRefreshResult> {
  #current: ReviewRefreshCycle<TResult> | null = null
  #disposed = false
  readonly #maxAttempts: number

  constructor(maxAttempts = REVIEW_REFRESH_MAX_ATTEMPTS) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeError('maxAttempts must be a positive integer')
    }
    this.#maxAttempts = maxAttempts
  }

  request(
    identity: string,
    force: boolean,
    execute: (force: boolean) => Promise<TResult | null>,
  ): Promise<TResult | null> {
    if (this.#disposed) return Promise.resolve(null)

    const active = this.#current
    if (active?.identity === identity) {
      if (force) active.queuedForce = true
      return active.promise
    }

    const cycle: ReviewRefreshCycle<TResult> = {
      identity,
      queuedForce: false,
      promise: Promise.resolve<TResult | null>(null),
    }
    this.#current = cycle
    cycle.promise = this.#runCycle(cycle, force, execute)
    return cycle.promise
  }

  invalidate(identity?: string): void {
    if (!identity || this.#current?.identity === identity) {
      this.#current = null
    }
  }

  activate(): void {
    this.#disposed = false
  }

  dispose(): void {
    this.#disposed = true
    this.#current = null
  }

  async #runCycle(
    cycle: ReviewRefreshCycle<TResult>,
    initialForce: boolean,
    execute: (force: boolean) => Promise<TResult | null>,
  ): Promise<TResult | null> {
    let force = initialForce
    let result: TResult | null = null
    let attempts = 0

    while (!this.#disposed && this.#current === cycle) {
      attempts += 1
      cycle.queuedForce = false
      try {
        result = await execute(force)
      } catch (error) {
        if (this.#current === cycle) this.#current = null
        throw error
      }
      if (result?.cacheState === 'stale') cycle.queuedForce = true
      if (!cycle.queuedForce || this.#current !== cycle) break
      if (attempts >= this.#maxAttempts) {
        if (this.#current === cycle) this.#current = null
        throw new ReviewRepositoryBusyError()
      }
      force = true
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }

    if (this.#current === cycle) this.#current = null
    return result
  }
}

/**
 * Trailing debounce for filesystem-driven Review refreshes. Each change only
 * restarts the countdown, so the callback runs once the workspace has been
 * quiet for `delayMs` instead of scanning during a write burst.
 */
export class ReviewAutoRefreshScheduler {
  #timer: ReturnType<typeof setTimeout> | null = null
  #callback: (() => void) | null = null
  #disposed = false

  constructor(private readonly delayMs = REVIEW_AUTO_REFRESH_DELAY_MS) {}

  schedule(callback: () => void): void {
    if (this.#disposed) return
    this.#callback = callback
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = null
      const run = this.#callback
      this.#callback = null
      run?.()
    }, this.delayMs)
  }

  cancel(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    this.#callback = null
  }

  activate(): void {
    this.#disposed = false
  }

  dispose(): void {
    this.#disposed = true
    this.cancel()
  }
}
