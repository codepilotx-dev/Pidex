import type { DesktopGitStatusResult, DesktopWorkspace } from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import {
  reviewAgentClient,
  type ReviewCommit,
  type ReviewBranch,
} from '../review/source/ReviewAgentClient.js'

export type GitBoardRepository = {
  result: DesktopGitStatusResult
  diffStats?: { additions: number; deletions: number }
  commits?: ReviewCommit[]
  branches?: ReviewBranch[]
  branchError?: string
  historyError?: string
}

export function gitBoardRefreshTargets(
  projects: readonly DesktopWorkspace[],
  projectIds?: readonly string[],
) {
  return projectIds === undefined
    ? [...projects]
    : projects.filter((project) => projectIds.includes(project.projectId!))
}

export async function loadGitBoardRepository(
  project: DesktopWorkspace,
  selectedRef: string | undefined,
  supportsRef: boolean,
  visible: boolean,
  isCancelled: () => boolean,
): Promise<GitBoardRepository | null> {
  const id = project.projectId!
  let repository: GitBoardRepository
  try {
    const result = await desktopClient.getWorkspaceGitStatus(project.path, id)
    repository = { result }
    if (result.ok && visible && !isCancelled()) {
      if (result.status.clean) {
        repository.diffStats = { additions: 0, deletions: 0 }
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
        } catch {
          // Keep unavailable statistics distinct from a clean diff.
        }
      }
      if (supportsRef) {
        try {
          repository.branches = await reviewAgentClient.branches(project.path, id)
        } catch {
          repository.branchError = '分支列表加载失败'
        }
      }
      try {
        const ref = selectedRef
        repository.commits = await reviewAgentClient.commits(
          project.path,
          id,
          supportsRef && ref && ref !== 'HEAD' ? ref : undefined,
        )
      } catch {
        repository.historyError = '提交历史加载失败'
      }
    }
  } catch {
    repository = { result: { ok: false, error: '仓库状态加载失败' } }
  }

  return isCancelled() ? null : repository
}
