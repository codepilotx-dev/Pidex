import type { DesktopGitStatus } from '../../../shared/Types.js'

export type ReviewAgentGitStatus = {
  branchName: string | null
  upstream: string | null
  ahead: number
  behind: number
  clean: boolean
  files: ReadonlyArray<{
    path: string
    previousPath: string | null
    stagedStatus: string
    unstagedStatus: string
    untracked: boolean
  }>
}

export function desktopGitStatus(status: ReviewAgentGitStatus): DesktopGitStatus {
  return {
    branchName: status.branchName,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    clean: status.clean,
    files: status.files.map((file) => ({
      path: file.path,
      ...(file.previousPath ? { originalPath: file.previousPath } : {}),
      status: `${file.stagedStatus}${file.unstagedStatus}`,
      stagedStatus: file.stagedStatus,
      unstagedStatus: file.unstagedStatus,
      additions: null,
      deletions: null,
      isUntracked: file.untracked,
    })),
  }
}
