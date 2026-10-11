import { AgentError } from '../../Domain'
import { now } from './RepositoryCore'

import { WorkspaceRepositoryDatabase } from './WorkspaceRepository'

export class ReviewRepositoryDatabase extends WorkspaceRepositoryDatabase {
  listReviewComments(input: { threadId: string; projectId: string; sourceKey: string }) {
    if (this.threadProjectID(input.threadId) !== input.projectId) {
      throw new AgentError('PROJECT_SCOPE_MISMATCH', 'Thread 与 Review 项目不匹配', 409)
    }
    const rows = this.sqlite
      .query(
        `
        SELECT id, thread_id, project_id, source_key, path, side, line, hunk_id,
               revision, body, status, github_comment_id, github_thread_id,
               created_at, updated_at
        FROM review_comments
        WHERE thread_id = ? AND project_id = ? AND source_key = ?
        ORDER BY created_at, id
      `,
      )
      .all(input.threadId, input.projectId, input.sourceKey) as Parameters<
      WorkspaceRepositoryDatabase['mapReviewComment']
    >[0][]
    return rows.map((row) => this.mapReviewComment(row))
  }

  saveReviewComment(input: {
    id?: string | undefined
    threadId: string
    projectId: string
    sourceKey: string
    path: string
    side: 'old' | 'new'
    line: number
    hunkId: string | null
    revision: string
    body: string
    githubCommentId?: string | undefined
    githubThreadId?: string | undefined
  }) {
    if (this.threadProjectID(input.threadId) !== input.projectId) {
      throw new AgentError('PROJECT_SCOPE_MISMATCH', 'Thread 与 Review 项目不匹配', 409)
    }
    const body = input.body.trim()
    if (!body) throw new AgentError('INVALID_REQUEST', 'Review 评论不能为空', 400)
    const timestamp = now()
    const id = input.id ?? crypto.randomUUID()
    const existing = this.sqlite
      .query('SELECT thread_id, project_id, created_at FROM review_comments WHERE id = ?')
      .get(id) as {
      thread_id: string
      project_id: string
      created_at: number
    } | null
    if (
      existing &&
      (existing.thread_id !== input.threadId || existing.project_id !== input.projectId)
    ) {
      throw new AgentError(
        'PROJECT_SCOPE_MISMATCH',
        '不能修改其他 Thread 或项目的 Review 评论',
        409,
      )
    }
    this.sqlite
      .query(
        `
        INSERT INTO review_comments (
          id, thread_id, project_id, source_key, path, side, line, hunk_id,
          revision, body, status, github_comment_id, github_thread_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source_key = excluded.source_key,
          path = excluded.path,
          side = excluded.side,
          line = excluded.line,
          hunk_id = excluded.hunk_id,
          revision = excluded.revision,
          body = excluded.body,
          github_comment_id = COALESCE(excluded.github_comment_id, review_comments.github_comment_id),
          github_thread_id = COALESCE(excluded.github_thread_id, review_comments.github_thread_id),
          updated_at = excluded.updated_at
      `,
      )
      .run(
        id,
        input.threadId,
        input.projectId,
        input.sourceKey,
        input.path,
        input.side,
        input.line,
        input.hunkId,
        input.revision,
        body,
        input.githubCommentId ?? null,
        input.githubThreadId ?? null,
        existing?.created_at ?? timestamp,
        timestamp,
      )
    return this.reviewComment(id)!
  }

  private reviewComment(id: string) {
    const row = this.sqlite
      .query(
        `
        SELECT id, thread_id, project_id, source_key, path, side, line, hunk_id,
               revision, body, status, github_comment_id, github_thread_id,
               created_at, updated_at
        FROM review_comments WHERE id = ?
      `,
      )
      .get(id) as Parameters<WorkspaceRepositoryDatabase['mapReviewComment']>[0] | null
    return row ? this.mapReviewComment(row) : null
  }

  resolveReviewComment(input: { id: string; threadId: string; projectId: string }) {
    const comment = this.reviewComment(input.id)
    if (!comment) throw new AgentError('REVIEW_COMMENT_NOT_FOUND', 'Review 评论不存在', 404)
    if (comment.threadId !== input.threadId || comment.projectId !== input.projectId) {
      throw new AgentError(
        'PROJECT_SCOPE_MISMATCH',
        '不能修改其他 Thread 或项目的 Review 评论',
        409,
      )
    }
    this.sqlite
      .query("UPDATE review_comments SET status = 'resolved', updated_at = ? WHERE id = ?")
      .run(now(), input.id)
    return this.reviewComment(input.id)!
  }

  deleteReviewComment(input: { id: string; threadId: string; projectId: string }) {
    const comment = this.reviewComment(input.id)
    if (!comment) throw new AgentError('REVIEW_COMMENT_NOT_FOUND', 'Review 评论不存在', 404)
    if (comment.threadId !== input.threadId || comment.projectId !== input.projectId) {
      throw new AgentError(
        'PROJECT_SCOPE_MISMATCH',
        '不能删除其他 Thread 或项目的 Review 评论',
        409,
      )
    }
    this.sqlite.query('DELETE FROM review_comments WHERE id = ?').run(input.id)
  }

  saveTurnGitSnapshot(input: {
    threadId: string
    turnId: string
    projectId: string
    repositoryRoot: string
    beforeTree?: string | null
    afterTree?: string | null
  }) {
    if (this.threadProjectID(input.threadId) !== input.projectId) {
      throw new AgentError('PROJECT_SCOPE_MISMATCH', 'Thread 与 Git 快照项目不匹配', 409)
    }
    const timestamp = now()
    this.sqlite
      .query(
        `
        INSERT INTO turn_git_snapshots (
          thread_id, turn_id, project_id, repository_root,
          before_tree, after_tree, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id, turn_id) DO UPDATE SET
          repository_root = excluded.repository_root,
          before_tree = COALESCE(excluded.before_tree, turn_git_snapshots.before_tree),
          after_tree = COALESCE(excluded.after_tree, turn_git_snapshots.after_tree),
          updated_at = excluded.updated_at
      `,
      )
      .run(
        input.threadId,
        input.turnId,
        input.projectId,
        input.repositoryRoot,
        input.beforeTree ?? null,
        input.afterTree ?? null,
        timestamp,
        timestamp,
      )
  }

  getTurnGitSnapshot(threadId: string, turnId: string) {
    const row = this.sqlite
      .query(
        `
        SELECT thread_id, turn_id, project_id, repository_root, before_tree,
               after_tree, created_at, updated_at
        FROM turn_git_snapshots WHERE thread_id = ? AND turn_id = ?
      `,
      )
      .get(threadId, turnId) as {
      thread_id: string
      turn_id: string
      project_id: string
      repository_root: string
      before_tree: string | null
      after_tree: string | null
      created_at: number
      updated_at: number
    } | null
    return row
      ? {
          threadId: row.thread_id,
          turnId: row.turn_id,
          projectId: row.project_id,
          repositoryRoot: row.repository_root,
          beforeTree: row.before_tree,
          afterTree: row.after_tree,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null
  }
}

export type ReviewRepository = ReviewRepositoryDatabase
export const reviewRepository = (database: ReviewRepositoryDatabase): ReviewRepository => database
