import type { DesktopReviewDiffFile } from '../../../../shared/Types.js'

export type ReviewFileStatusKind =
  'added' | 'deleted' | 'modified' | 'renamed' | 'copied' | 'unknown'

export type ReviewFilter = 'all' | 'added' | 'modified' | 'removed'

export function normalizeReviewFileStatus(
  file: Pick<DesktopReviewDiffFile, 'isUntracked' | 'status'>,
): ReviewFileStatusKind {
  if (file.isUntracked) return 'added'

  const status = file.status.trim()
  switch (status.toLowerCase()) {
    case 'added':
    case 'untracked':
      return 'added'
    case 'deleted':
      return 'deleted'
    case 'modified':
    case 'type-changed':
      return 'modified'
    case 'renamed':
      return 'renamed'
    case 'copied':
      return 'copied'
    case 'unknown':
      return 'unknown'
  }

  if (status === '??' || status.startsWith('A')) return 'added'
  if (status.startsWith('D')) return 'deleted'
  if (status.startsWith('R')) return 'renamed'
  if (status.startsWith('C')) return 'copied'
  if (status.startsWith('M') || status.startsWith('T')) return 'modified'
  return 'unknown'
}

export function reviewFileStatusLabel(status: ReviewFileStatusKind): string {
  switch (status) {
    case 'added':
      return '新增'
    case 'deleted':
      return '删除'
    case 'modified':
      return '修改'
    case 'renamed':
      return '重命名'
    case 'copied':
      return '复制'
    case 'unknown':
      return '未知'
  }
}

export function filterStatusForFile(
  file: Pick<DesktopReviewDiffFile, 'isUntracked' | 'status'>,
): ReviewFilter {
  const status = normalizeReviewFileStatus(file)
  if (status === 'added') return 'added'
  if (status === 'deleted') return 'removed'
  return 'modified'
}
