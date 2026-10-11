import { Effect } from 'effect'
import {
  decodeApprovalPolicy,
  type ThreadListItem,
  type ThreadSettingsPatch,
} from '@pidex/shared/thread'
import { AgentError } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'
import { normalizeThreadTitle } from './ThreadTitleService'
import { THREAD_ORIGIN_PROJECTION_SQL } from '../storage/repositories/ThreadRepository'

export type ThreadMetadataPatch = {
  title?: string | null
  archived?: boolean
}

type ThreadRow = {
  id: string
  project_id: string | null
  git_branch: string | null
  title: string
  preview: string | null
  first_user_message: string | null
  message_count: number
  latest_turn_status: string | null
  archived_at: number | null
  unread_at: number | null
  has_scheduled_run: number
  is_scheduled_session: number
  is_fork: number
  task_mode: ThreadListItem['settings']['taskMode']
  sandbox_mode: ThreadListItem['settings']['permissionConfig']['sandboxMode']
  approval_policy: string
  approvals_reviewer: ThreadListItem['settings']['permissionConfig']['approvalsReviewer']
  created_at: number
  updated_at: number
}

const turnStatus = (status: string | null): ThreadListItem['latestTurnStatus'] => {
  if (!status) return null
  if (status === 'waiting_permission') return 'waiting-permission'
  if (status === 'waiting_question') return 'waiting-question'
  if (
    status === 'queued' ||
    status === 'running' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'interrupted'
  )
    return status
  return 'stopped'
}

export class ThreadHistoryService {
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly prepareThreadCleanup?: (threadID: string) => () => Promise<void>,
  ) {}

  getListItem(threadID: string): ThreadListItem | null {
    const row = this.db.sqlite
      .query(
        `
      SELECT t.id, t.project_id, t.git_branch, t.title, t.preview, t.first_user_message, t.message_count, t.archived_at,
        t.task_mode, t.sandbox_mode, t.approval_policy, t.approvals_reviewer, t.created_at, t.updated_at,
        read_state.unread_at, ${THREAD_ORIGIN_PROJECTION_SQL},
        (SELECT u.status FROM turns AS u WHERE u.thread_id = t.id ORDER BY u.created_at DESC, u.id DESC LIMIT 1) AS latest_turn_status
      FROM threads AS t
      LEFT JOIN thread_read_state AS read_state ON read_state.thread_id = t.id
      WHERE t.id = ?
    `,
      )
      .get(threadID) as ThreadRow | null
    if (!row) return null
    const workspace = this.db.threadWorkspace(threadID)
    return {
      id: row.id,
      storageSource: 'local',
      projectID: this.db.projectMembership(threadID),
      gitBranch: row.git_branch,
      hasScheduledRun: Boolean(row.has_scheduled_run),
      isScheduledSession: Boolean(row.is_scheduled_session),
      isFork: Boolean(row.is_fork),
      ...(workspace ? { workspace } : {}),
      title: row.title,
      preview: row.preview,
      firstUserMessage: row.first_user_message,
      messageCount: row.message_count,
      latestTurnStatus: turnStatus(row.latest_turn_status),
      archivedAt: row.archived_at,
      unreadAt: row.unread_at,
      settings: {
        taskMode: row.task_mode,
        permissionConfig: {
          sandboxMode: row.sandbox_mode,
          approvalPolicy: decodeApprovalPolicy(row.approval_policy),
          approvalsReviewer: row.approvals_reviewer,
        },
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  markRead(threadID: string, readThroughAt: number) {
    return this.db.transaction(() => {
      if (!this.getListItem(threadID))
        throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
      this.db.markThreadReadThrough(threadID, readThroughAt)
      const thread = this.getListItem(threadID)
      if (!thread) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
      return thread
    })
  }

  markUnread(threadID: string, unreadAt: number) {
    return this.db.transaction(() => {
      if (!this.getListItem(threadID))
        throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
      this.db.markThreadUnread(threadID, unreadAt)
      const thread = this.getListItem(threadID)
      if (!thread) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
      return thread
    })
  }

  async patch(threadID: string, patch: ThreadMetadataPatch) {
    const existing = this.getListItem(threadID)
    if (!existing) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)

    const updates: string[] = []
    const values: Array<string | number | null> = []
    const updatesActivity = typeof patch.archived === 'boolean'
    const updatedAt = updatesActivity ? Date.now() : existing.updatedAt
    if ('title' in patch) {
      const title =
        patch.title === null
          ? normalizeThreadTitle(existing.firstUserMessage ?? '')
          : patch.title?.trim()
      if (!title) throw new AgentError('INVALID_REQUEST', 'title 参数无效', 400)
      updates.push('title = ?')
      values.push(title)
    }
    if (typeof patch.archived === 'boolean') {
      if (
        patch.archived === false &&
        existing.projectID &&
        this.db.getProject(existing.projectID)?.removedAt
      ) {
        throw new AgentError('PROJECT_REMOVED', '已移除项目的归档任务不能恢复', 409)
      }
      updates.push('archived_at = ?')
      values.push(patch.archived ? updatedAt : null)
    }
    if (!updates.length) return existing

    if (updatesActivity) {
      updates.push('updated_at = ?')
      values.push(updatedAt)
    }
    values.push(threadID)
    this.db.sqlite.query(`UPDATE threads SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const next = this.getListItem(threadID)
    if (!next) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
    const event = this.db.insertEvent(threadID, null, 'thread/updated', {
      threadId: threadID,
      patch,
      updatedAt: next.updatedAt,
    })
    await Effect.runPromise(this.hub.publish(event))
    return next
  }

  async patchTitleIfCurrent(threadID: string, expectedTitle: string, nextTitle: string) {
    const normalizedTitle = nextTitle.trim()
    if (!normalizedTitle) return null
    const result = this.db.transaction(() => {
      const updated = this.db.updateThreadTitleIfCurrent({
        threadID,
        expectedTitle,
        nextTitle: normalizedTitle,
      })
      if (!updated) return null
      const thread = this.getListItem(threadID)
      if (!thread) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
      const event = this.db.insertEvent(threadID, null, 'thread/updated', {
        threadId: threadID,
        patch: { title: normalizedTitle },
        updatedAt: thread.updatedAt,
      })
      return { thread, event }
    })
    if (!result) return null
    await Effect.runPromise(this.hub.publish(result.event))
    return result.thread
  }

  async patchSettings(threadID: string, patch: ThreadSettingsPatch) {
    if (!this.getListItem(threadID)) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
    const result = this.db.updateThreadSettings(threadID, patch)
    if (result.event) await Effect.runPromise(this.hub.publish(result.event))
    return { threadId: threadID, settings: result.settings, version: result.version }
  }

  async remove(threadID: string) {
    const existing = this.getListItem(threadID)
    if (!existing) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
    const cleanup = this.prepareThreadCleanup?.(threadID)
    const event = this.db.transaction(() => {
      const active = this.db.sqlite
        .query(
          `
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM threads WHERE id = ?
          UNION ALL
          SELECT child.id FROM threads AS child JOIN subtree AS parent ON child.parent_thread_id = parent.id
        )
        SELECT turns.id AS turn_id
        FROM turns
        JOIN subtree ON subtree.id = turns.thread_id
        WHERE turns.status IN ('running', 'waiting_permission', 'waiting_question', 'waiting_subagents')
        LIMIT 1
      `,
        )
        .get(threadID) as { turn_id: string } | null
      if (active)
        throw new AgentError('THREAD_ACTIVE', '运行中的 Thread 或子 Agent Thread 不能删除', 409)
      this.db.sqlite.query('DELETE FROM threads WHERE id = ?').run(threadID)
      return this.db.insertEvent(null, null, 'thread/deleted', {
        threadId: threadID,
        deletedAt: Date.now(),
      })
    })
    try {
      await Effect.runPromise(this.hub.publish(event))
    } finally {
      await cleanup?.()
    }
  }
}
