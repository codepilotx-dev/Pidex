import type { DesktopGitFileChange } from '../../../shared/Types.js'

export type GitBoardFileStatus = { code: string; label: string }

/**
 * 冲突判定只有一个来源：未跟踪文件永远不是冲突，其余看 XY 状态里是否存在
 * 未合并状态（U）或双向删除/双向新增（DD / AA）。
 */
export function isGitBoardFileConflict(file: DesktopGitFileChange): boolean {
  if (file.isUntracked) return false
  const pair = `${file.stagedStatus}${file.unstagedStatus}`
  return pair.includes('U') || pair === 'DD' || pair === 'AA'
}

export function hasGitBoardConflicts(files: readonly DesktopGitFileChange[]): boolean {
  return files.some(isGitBoardFileConflict)
}

export function gitBoardFileStatuses(file: DesktopGitFileChange): GitBoardFileStatus[] {
  if (file.isUntracked) return [{ code: 'U', label: '未跟踪' }]
  if (isGitBoardFileConflict(file)) return [{ code: '!', label: '冲突' }]
  const labels: Record<string, string> = {
    M: '修改',
    A: '新增',
    D: '删除',
    R: '重命名',
    C: '复制',
    T: '类型变更',
  }
  return [
    { code: file.stagedStatus.trim(), area: '已暂存' },
    { code: file.unstagedStatus.trim(), area: '未暂存' },
  ]
    .filter(({ code }) => code && code !== '?')
    .map(({ code, area }) => ({ code, label: `${area}：${labels[code] ?? code}` }))
}
