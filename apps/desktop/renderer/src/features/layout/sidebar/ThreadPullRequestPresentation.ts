import type { ThreadPullRequestStatus } from '@pidex/shared/thread'
import type { LucideIcon } from 'lucide-react'
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'

/** 语义色 + 中文文案；Agent 只产出状态，渲染层负责外观。 */
export type ThreadPullRequestVisual = {
  className: string
  label: string
}

const STATUS_CLASS: Record<ThreadPullRequestStatus['state'], string> = {
  merged: 'tw:text-app-skill',
  closed: 'tw:text-app-danger',
  draft: 'tw:text-app-text-meta',
  conflicts: 'tw:text-app-danger',
  'checks-failed': 'tw:text-app-danger',
  mergeable: 'tw:text-app-success',
  'checks-passing': 'tw:text-app-success',
  waiting: 'tw:text-app-warning',
  unknown: 'tw:text-app-text-meta',
}

const WAITING_LABEL: Record<string, string> = {
  'review-required': '等待审查',
  'checks-running': '检查进行中',
  'behind-base': '落后于目标分支',
  blocked: '合并被阻止',
  unstable: '状态不稳定',
}

const STATE_LABEL: Record<ThreadPullRequestStatus['state'], string> = {
  merged: '已合并',
  closed: '已关闭',
  draft: '草稿',
  conflicts: '存在合并冲突',
  'checks-failed': '检查失败',
  mergeable: '可合并',
  'checks-passing': '检查通过，尚不可合并',
  waiting: '等待中',
  unknown: '状态未知',
}

export function threadPullRequestVisual(status: ThreadPullRequestStatus): ThreadPullRequestVisual {
  const className = STATUS_CLASS[status.state]
  if (status.state === 'waiting') {
    const reason = status.reason ? WAITING_LABEL[status.reason] : undefined
    return { className, label: reason ? `等待中：${reason}` : STATE_LABEL.waiting }
  }
  if (status.state === 'unknown') {
    return { className, label: status.stale ? '状态未知／待刷新' : STATE_LABEL.unknown }
  }
  return { className, label: STATE_LABEL[status.state] }
}

export function threadPullRequestIcon(status: ThreadPullRequestStatus): LucideIcon {
  if (status.state === 'merged') return GitMerge
  if (status.state === 'closed') return GitPullRequestClosed
  if (status.state === 'draft') return GitPullRequestDraft
  return GitPullRequest
}

/** 侧栏尾部标记的悬停提示：PR 标题 + 状态。 */
export function threadPullRequestTitle(
  number: number,
  title: string | null,
  status: ThreadPullRequestStatus,
): string {
  const label = threadPullRequestVisual(status).label
  return title ? `#${number} ${title} · ${label}` : `#${number} · ${label}`
}
