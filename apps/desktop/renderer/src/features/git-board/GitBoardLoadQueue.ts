/**
 * Git 看板仓库加载队列。
 *
 * 首次加载、自动刷新、手动刷新、切换分支后的刷新和提交补拉共用同一条串行队列：
 * 一个仓库本轮需要的状态、Diff、分支和提交处理完后，才开始下一个仓库。
 * 同一仓库同时只保留一项待执行任务，执行中再出现的新需求合并为一项后续任务。
 */

import type { DesktopWorkspace } from '../../../shared/Types.js'
import type { SessionListItem } from '../../UiTypes.js'
import { sortProjectsForSidebar } from '../layout/sidebar/SidebarViewModel.js'

/** 活跃仓库（主区域当前列、打开的提交详情、最近五分钟手动操作）的刷新间隔。 */
export const GIT_BOARD_ACTIVE_REFRESH_MS = 60_000
/** 不活跃仓库的刷新间隔。 */
export const GIT_BOARD_INACTIVE_REFRESH_MS = 300_000
/** 一次手动操作让仓库保持活跃的时长。 */
export const GIT_BOARD_MANUAL_ACTIVITY_MS = 300_000
/** 页面可见时检查到期仓库的间隔；比一分钟更短，避免整分钟对齐把活跃刷新推迟一轮。 */
export const GIT_BOARD_REFRESH_TICK_MS = 15_000

export type GitBoardLoadKind = 'full' | 'history'

export type GitBoardLoadTask = {
  projectId: string
  kind: GitBoardLoadKind
  /** 用户操作触发的加载（刷新、切换分支、补拉历史、仓库操作后的刷新）。 */
  manual: boolean
}

export type GitBoardLoadQueueOptions = {
  /**
   * 加载并应用单个仓库。`isCurrent` 在加载期间变为 false 时（仓库已失效、
   * 分支已切换或页面已离开）必须丢弃结果。
   */
  execute: (task: GitBoardLoadTask, isCurrent: () => boolean) => Promise<void> | void
  /** 等待中任务的活跃度排序：数值越小越靠前。 */
  activityRank: (projectId: string) => number
  /** 仓库是否因当前页面状态（主区域列、打开的详情）处于活跃状态。 */
  isActive?: (projectId: string) => boolean
  /** 可替换时钟，便于模拟一分钟／五分钟到期。 */
  now?: () => number
  /** 队列由忙转闲时回调；用于结束手动刷新状态。 */
  onIdle?: () => void
}

type PendingTask = GitBoardLoadTask & {
  /** 手动入队时间：多个手动任务之间优先最近操作的仓库。 */
  priorityAt: number
}

export class GitBoardLoadQueue {
  readonly #pending = new Map<string, PendingTask>()
  readonly #completedAt = new Map<string, number>()
  readonly #manualActivityAt = new Map<string, number>()
  /** 每仓库加载代际：切换分支等操作递增代际，旧响应不再覆盖新结果。 */
  readonly #revision = new Map<string, number>()
  readonly #idleWaiters: Array<() => void> = []
  #inFlight: GitBoardLoadTask | null = null
  #running = false
  #disposed = false

  constructor(private readonly options: GitBoardLoadQueueOptions) {}

  /**
   * 入队单个仓库。同一仓库已有待执行任务时合并需求：
   * 完整刷新吸收历史补拉，历史补拉不会覆盖已经排队的完整刷新。
   */
  request(
    projectId: string,
    kind: GitBoardLoadKind = 'full',
    options: { manual?: boolean; invalidate?: boolean } = {},
  ): void {
    if (this.#disposed) return
    this.#enqueue(projectId, kind, options)
    this.#pump()
  }

  /** 批量入队后统一开始执行，确保整轮仓库按活跃度挑选而不是按入队顺序。 */
  requestAll(projectIds: readonly string[], { manual = false } = {}): number {
    if (this.#disposed) return 0
    let count = 0
    for (const projectId of projectIds) {
      if (this.#disposed) break
      this.#enqueue(projectId, 'full', { manual })
      count += 1
    }
    this.#pump()
    return count
  }

  /**
   * 按一分钟／五分钟判断到期仓库并入队。
   * 上一轮仍未完成时不再追加整轮任务，避免长请求积压。
   */
  requestDue(projectIds: readonly string[]): number {
    if (this.#disposed || this.#hasWork()) return 0
    const now = this.#now()
    const due = projectIds.filter((projectId) => this.isDue(projectId, now))
    if (!due.length) return 0
    for (const projectId of due) this.#enqueue(projectId, 'full')
    this.#pump()
    return due.length
  }

  /** 仓库是否到期：首次加载立即到期，失败同样遵守一分钟／五分钟间隔。 */
  isDue(projectId: string, now = this.#now()): boolean {
    const completedAt = this.#completedAt.get(projectId)
    if (completedAt === undefined) return true
    const interval = this.#isActive(projectId, now)
      ? GIT_BOARD_ACTIVE_REFRESH_MS
      : GIT_BOARD_INACTIVE_REFRESH_MS
    return now - completedAt >= interval
  }

  /** 使仓库的在途结果失效；用于切换查看分支后丢弃旧分支响应。 */
  invalidate(projectId: string): void {
    if (this.#disposed) return
    this.#bumpRevision(projectId)
  }

  pendingProjectIds(): string[] {
    return [...this.#pending.keys()]
  }

  inFlightProjectId(): string | null {
    return this.#inFlight?.projectId ?? null
  }

  waitForIdle(): Promise<void> {
    if (this.#isIdle()) return Promise.resolve()
    return new Promise((resolve) => this.#idleWaiters.push(resolve))
  }

  activate(): void {
    this.#disposed = false
  }

  dispose(): void {
    this.#disposed = true
    this.#pending.clear()
    this.#resolveIdle()
  }

  #enqueue(
    projectId: string,
    kind: GitBoardLoadKind,
    { manual = false, invalidate = false }: { manual?: boolean; invalidate?: boolean } = {},
  ): void {
    const now = this.#now()
    if (invalidate) this.#bumpRevision(projectId)
    if (manual) this.#manualActivityAt.set(projectId, now)
    const pending = this.#pending.get(projectId)
    if (pending) {
      if (kind === 'full') pending.kind = 'full'
      if (manual) {
        pending.manual = true
        pending.priorityAt = now
      }
      return
    }
    this.#pending.set(projectId, { projectId, kind, manual, priorityAt: now })
  }

  #pump(): void {
    if (this.#running || this.#disposed) return
    this.#running = true
    void this.#drain()
  }

  async #drain(): Promise<void> {
    let executed = 0
    try {
      while (!this.#disposed) {
        const task = this.#takeNext()
        if (!task) break
        executed += 1
        await this.#run(task)
      }
    } catch {
      // 执行器内部的意外异常不能阻塞其他仓库；队列保持可继续工作。
    } finally {
      this.#running = false
      this.#resolveIdle()
      if (!this.#disposed && this.#pending.size > 0) this.#pump()
      else if (!this.#disposed && executed > 0) this.options.onIdle?.()
    }
  }

  async #run(task: GitBoardLoadTask): Promise<void> {
    const revision = this.#revision.get(task.projectId) ?? 0
    const running: GitBoardLoadTask = task
    this.#inFlight = running
    const isCurrent = () =>
      !this.#disposed &&
      this.#inFlight === running &&
      (this.#revision.get(task.projectId) ?? 0) === revision
    try {
      await this.options.execute(task, isCurrent)
    } catch {
      // 单仓库失败继续加载其他仓库；完成时间仍按失败计入间隔。
    } finally {
      this.#completedAt.set(task.projectId, this.#now())
      if (this.#inFlight === running) this.#inFlight = null
    }
  }

  #takeNext(): GitBoardLoadTask | null {
    let manual: PendingTask | null = null
    let activity: PendingTask | null = null
    let activityRank = Number.MAX_SAFE_INTEGER
    for (const task of this.#pending.values()) {
      if (task.manual) {
        if (!manual || task.priorityAt > manual.priorityAt) manual = task
        continue
      }
      const rank = this.options.activityRank(task.projectId)
      if (!activity || rank < activityRank) {
        activity = task
        activityRank = rank
      }
    }
    const next = manual ?? activity
    if (!next) return null
    this.#pending.delete(next.projectId)
    return { projectId: next.projectId, kind: next.kind, manual: next.manual }
  }

  #isActive(projectId: string, now: number): boolean {
    if (this.options.isActive?.(projectId)) return true
    const manualAt = this.#manualActivityAt.get(projectId)
    return manualAt !== undefined && now - manualAt <= GIT_BOARD_MANUAL_ACTIVITY_MS
  }

  #hasWork(): boolean {
    return this.#running || this.#inFlight !== null || this.#pending.size > 0
  }

  #isIdle(): boolean {
    return !this.#hasWork()
  }

  #bumpRevision(projectId: string): void {
    this.#revision.set(projectId, (this.#revision.get(projectId) ?? 0) + 1)
  }

  #resolveIdle(): void {
    if (!this.#isIdle()) return
    const waiters = this.#idleWaiters.splice(0)
    for (const resolve of waiters) resolve()
  }

  #now(): number {
    return this.options.now?.() ?? Date.now()
  }
}

/**
 * 看板仓库的加载顺序：复用侧栏项目排序，取“项目最后打开时间”和未归档聊天
 * 最近消息时间的较新值降序；同值沿用现有稳定排序（名称与项目键）。
 */
export function orderGitBoardProjectsByActivity(
  projects: readonly DesktopWorkspace[],
  sessions: readonly SessionListItem[],
): DesktopWorkspace[] {
  return sortProjectsForSidebar(projects, {
    manualOrderByScope: {},
    scopeKey: 'git-projects',
    sessions: sessions.filter((session) => !session.archivedAt),
  })
}

/**
 * 页面可见时才检查到期仓库的计时器；页面恢复可见时立即补一次检查。
 * 隐藏期间计时器继续存在但不再触发加载。
 */
export class GitBoardRefreshTicker {
  #timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly check: () => void,
    private readonly isHidden: () => boolean = () => false,
    private readonly intervalMs = GIT_BOARD_REFRESH_TICK_MS,
  ) {}

  start(): void {
    if (this.#timer !== null) return
    this.#timer = setInterval(() => {
      if (!this.isHidden()) this.check()
    }, this.intervalMs)
  }

  /** 窗口重新聚焦或页面恢复可见：只有可见时才补一次到期检查。 */
  resume(): void {
    if (this.#timer === null || this.isHidden()) return
    this.check()
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer)
    this.#timer = null
  }
}
