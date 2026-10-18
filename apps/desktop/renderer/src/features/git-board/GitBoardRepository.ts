import type { DesktopGitStatusResult, DesktopWorkspace } from '../../../shared/Types.js'
import { AgentRpcError } from '../../services/AgentRpcClient.js'
import { hasGitBoardConflicts } from './GitBoardStatus.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import {
  reviewAgentClient,
  type ReviewCommit,
  type ReviewBranch,
} from '../review/source/ReviewAgentClient.js'

export type GitBoardRepository = {
  result: DesktopGitStatusResult
  diffStats?: { additions: number; deletions: number }
  summaryUnavailable?: boolean
  commits?: ReviewCommit[]
  /**
   * 提交历史是否已取完：服务端返回条数少于本次请求上限即视为没有更多。
   * 侧栏“展开显示”据此决定是否还能继续补拉，避免只有 11 条时按钮永久消失。
   */
  commitsComplete?: boolean
  branches?: ReviewBranch[]
  branchError?: string
  historyError?: string
  /** 刷新失败但保留旧数据时设置，界面据此展示重试入口。 */
  refreshError?: string
}

export type GitBoardRepositoryLoadOptions = {
  selectedRef?: string
  background?: boolean
  previousRepository?: GitBoardRepository
  /** 历史引用下拉是否可用（git.review.commit-ref.v1）。 */
  supportsCommitRef: boolean
  /** 是否加载分支列表（列可见且支持 git.review.v1）。 */
  supportsBranches: boolean
  /**
   * 是否加载提交历史。主区域列不再展示提交，历史只为侧栏中出现的仓库加载；
   * 分支列表仍由 `supportsBranches` 决定，避免未展开的仓库额外拉取分支。
   */
  loadHistory?: boolean
  /** 展开已有历史时不重复读取状态、Diff 和分支。 */
  historyOnly?: boolean
  refreshStatus?: boolean
  /** 本次请求的提交条数（侧栏按 10 条递增补拉，缺省 10）。 */
  commitLimit?: number
  visible: boolean
  isCancelled: () => boolean
}

/** 侧栏每次补拉的提交步长：先加载 10 条，之后按需 20、30……递增。 */
export const GIT_BOARD_COMMIT_LIMIT_STEP = 10
export const GIT_BOARD_DEFAULT_COMMIT_LIMIT = GIT_BOARD_COMMIT_LIMIT_STEP

/** 需求条数向上取整到步长倍数；同时作为服务端允许的范围（1..200）。 */
export function gitBoardCommitLimitFor(requiredCount: number): number {
  const required = Number.isFinite(requiredCount) ? Math.max(1, Math.ceil(requiredCount)) : 1
  return Math.min(
    200,
    Math.max(
      GIT_BOARD_DEFAULT_COMMIT_LIMIT,
      Math.ceil(required / GIT_BOARD_COMMIT_LIMIT_STEP) * GIT_BOARD_COMMIT_LIMIT_STEP,
    ),
  )
}

export function gitBoardRefreshTargets(
  projects: readonly DesktopWorkspace[],
  projectIds?: readonly string[],
) {
  return projectIds === undefined
    ? [...projects]
    : projects.filter((project) => projectIds.includes(project.projectId!))
}

export function gitBoardPollingTargets(
  projects: readonly DesktopWorkspace[],
  repositories: Readonly<Record<string, GitBoardRepository>>,
) {
  return projects.filter((project) => {
    const result = repositories[project.projectId!]?.result
    if (!result || result.ok !== false) return true
    return !['PROJECT_NOT_FOUND', 'PATH_DENIED'].includes(result.errorCode ?? '')
  })
}

export async function loadGitBoardRepository(
  project: DesktopWorkspace,
  {
    selectedRef,
    background = false,
    previousRepository,
    supportsCommitRef,
    supportsBranches,
    loadHistory = false,
    historyOnly = false,
    refreshStatus = false,
    commitLimit = GIT_BOARD_DEFAULT_COMMIT_LIMIT,
    visible,
    isCancelled,
  }: GitBoardRepositoryLoadOptions,
): Promise<GitBoardRepository | null> {
  if (isCancelled()) return null
  const id = project.projectId!
  let repository: GitBoardRepository
  try {
    const result =
      historyOnly && previousRepository
        ? previousRepository.result
        : await desktopClient.getWorkspaceGitStatus(project.path, id, { refresh: refreshStatus })
    repository = historyOnly && previousRepository ? { ...previousRepository } : { result }
    if (result.ok && visible && !historyOnly && !isCancelled()) {
      if (result.status.clean) {
        repository.diffStats = { additions: 0, deletions: 0 }
      } else if (
        hasGitBoardConflicts(result.status.files) ||
        (background &&
          previousRepository?.summaryUnavailable &&
          JSON.stringify(previousRepository.result) === JSON.stringify(result))
      ) {
        repository.summaryUnavailable = true
      } else {
        try {
          const { snapshot } = await reviewAgentClient.summary(
            project.path,
            { kind: 'uncommitted' },
            false,
            id,
          )
          repository.diffStats = {
            additions: snapshot.totals.additions,
            deletions: snapshot.totals.deletions,
          }
        } catch (error) {
          // 不稳定的仓库状态在变化或手动刷新前不重复构建 Review。
          repository.summaryUnavailable =
            error instanceof AgentRpcError &&
            ['REVIEW_SOURCE_UNAVAILABLE', 'REVIEW_REPOSITORY_BUSY'].includes(error.errorCode ?? '')
        }
      }
      if (isCancelled()) return null
      if (supportsBranches) {
        try {
          repository.branches = await reviewAgentClient.branches(project.path, id)
        } catch {
          repository.branchError = '分支列表加载失败'
        }
      }
    }
    if (result.ok && loadHistory && !isCancelled()) {
      try {
        const ref = selectedRef
        const commits = await reviewAgentClient.commits(
          project.path,
          id,
          supportsCommitRef && ref && ref !== 'HEAD' ? ref : undefined,
          commitLimit,
        )
        repository.historyError = undefined
        repository.commits = commits
        repository.commitsComplete = commits.length < commitLimit
      } catch {
        repository.historyError = '提交历史加载失败'
      }
    }
  } catch {
    // 刷新失败保留旧数据并标记重试入口；首次加载失败仍返回可重试的错误状态。
    repository = previousRepository
      ? { ...previousRepository, refreshError: '仓库状态刷新失败' }
      : { result: { ok: false, error: '仓库状态加载失败' } }
  }

  return isCancelled() ? null : repository
}
