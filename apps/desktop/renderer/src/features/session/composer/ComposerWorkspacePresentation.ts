import type { DesktopWorkspace } from '../../../../shared/Types.js'

export function getDesktopComposerBranchName(workspace: DesktopWorkspace | null): string {
  if (!workspace) return '无项目'
  if (workspace.isGitRepo === false) return '未检测到 Git 分支'
  return workspace.branchName ?? '未检测到 Git 分支'
}
