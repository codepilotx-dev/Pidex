import type { GitBoardRepository } from './GitBoardRepository.js'
import { hasGitBoardConflicts } from './GitBoardStatus.js'

export type GitBoardFilter = 'all' | 'attention' | 'changed' | 'ahead' | 'behind' | 'conflict'

export type GitBoardFilterOption = {
  value: GitBoardFilter
  label: string
  emptyMessage: string
}

export const GIT_BOARD_FILTERS: readonly GitBoardFilterOption[] = [
  { value: 'all', label: '全部', emptyMessage: '当前分组没有仓库' },
  { value: 'attention', label: '待处理', emptyMessage: '没有待处理的仓库' },
  { value: 'changed', label: '有改动', emptyMessage: '没有带未提交改动的仓库' },
  { value: 'ahead', label: '待推送', emptyMessage: '没有待推送提交的仓库' },
  { value: 'behind', label: '待拉取', emptyMessage: '没有待拉取提交的仓库' },
  { value: 'conflict', label: '有冲突', emptyMessage: '没有存在冲突的仓库' },
]

export function gitBoardFilterLabel(filter: GitBoardFilter): string {
  return GIT_BOARD_FILTERS.find((option) => option.value === filter)?.label ?? filter
}

export function gitBoardFilterEmptyMessage(filter: GitBoardFilter): string {
  return GIT_BOARD_FILTERS.find((option) => option.value === filter)?.emptyMessage ?? ''
}

function gitBoardHasChanges(repository: GitBoardRepository): boolean {
  const result = repository.result
  return result.ok && (!result.status.clean || result.status.files.length > 0)
}

/** 待处理 = 有改动、ahead、behind、冲突，或仓库加载失败。 */
export function gitBoardRepositoryNeedsAttention(
  repository: GitBoardRepository | undefined,
): boolean {
  if (!repository) return false
  const result = repository.result
  if (!result.ok) return true
  const status = result.status
  return (
    gitBoardHasChanges(repository) ||
    status.ahead > 0 ||
    status.behind > 0 ||
    hasGitBoardConflicts(status.files)
  )
}

/**
 * 未加载（repositories[projectId] 不存在）的仓库在任何筛选下都保留加载占位；
 * 加载失败的仓库只在“全部”和“待处理”中可见。
 */
export function matchesGitBoardFilter(
  repository: GitBoardRepository | undefined,
  filter: GitBoardFilter,
): boolean {
  if (!repository) return true
  const result = repository.result
  if (!result.ok) return filter === 'all' || filter === 'attention'
  if (filter === 'all') return true
  const status = result.status
  switch (filter) {
    case 'attention':
      return gitBoardRepositoryNeedsAttention(repository)
    case 'changed':
      return gitBoardHasChanges(repository)
    case 'ahead':
      return status.ahead > 0
    case 'behind':
      return status.behind > 0
    case 'conflict':
      return hasGitBoardConflicts(status.files)
  }
}

export function filterGitBoardProjectIds(
  projectIds: readonly string[],
  repositories: Readonly<Record<string, GitBoardRepository>>,
  filter: GitBoardFilter,
): string[] {
  if (filter === 'all') return [...projectIds]
  return projectIds.filter((projectId) => matchesGitBoardFilter(repositories[projectId], filter))
}
