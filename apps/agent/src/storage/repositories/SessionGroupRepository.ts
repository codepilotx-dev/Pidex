import { createHash, randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type {
  SessionGroupChangedFile,
  SessionGroupContextEntry,
  SessionGroupContextSection,
  SessionGroupFailure,
  SessionGroupStep,
  SessionGroupStepStatus,
  SessionGroupValidation,
} from '@pidex/shared/session-group'
import type { RepositoryDatabase } from './RepositoryDatabase'

const parse = <T>(value: string): T => JSON.parse(value) as T
const stringify = (value: unknown) => JSON.stringify(value)
const hash = (value: unknown) => createHash('sha256').update(stringify(value), 'utf8').digest('hex')

type GroupRow = {
  id: string
  name: string
  description: string
  version: number
  member_count: number
  latest_step_at: number | null
  created_at: number
  updated_at: number
}

type StepRow = {
  id: string
  group_id: string
  sequence: number
  source_thread_id: string | null
  source_thread_title: string
  source_turn_id: string
  project_id: string | null
  workspace_label: string
  status: SessionGroupStepStatus
  summary: string
  checkpoints: string
  changed_files: string
  validations: string
  failure: string | null
  revision: number
  created_at: number
  updated_at: number
}

const stepRecord = (row: StepRow): SessionGroupStep => ({
  id: row.id,
  groupId: row.group_id,
  sequence: row.sequence,
  sourceThreadId: row.source_thread_id,
  sourceThreadTitle: row.source_thread_title,
  sourceTurnId: row.source_turn_id,
  projectId: row.project_id,
  workspaceLabel: row.workspace_label,
  status: row.status,
  summary: row.summary,
  checkpoints: parse(row.checkpoints),
  changedFiles: parse(row.changed_files),
  validations: parse(row.validations),
  failure: row.failure ? parse(row.failure) : null,
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class SessionGroupRepository {
  constructor(
    private readonly db: RepositoryDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  private group(row: GroupRow) {
    const workspaces = this.db.sqlite
      .query(
        `
      SELECT DISTINCT t.project_id AS projectId, t.workspace_cwd AS workspaceCwd
      FROM session_group_memberships m JOIN threads t ON t.id = m.thread_id
      WHERE m.group_id = ? ORDER BY t.workspace_cwd
    `,
      )
      .all(row.id) as Array<{ projectId: string | null; workspaceCwd: string }>
    const labels = [
      ...new Set(
        workspaces.map((workspace) =>
          workspace.projectId ? basename(workspace.workspaceCwd) || '项目' : '无项目',
        ),
      ),
    ]
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      version: row.version,
      memberCount: row.member_count,
      projectLabels: labels,
      latestStepAt: row.latest_step_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  list() {
    return (
      this.db.sqlite
        .query(
          `
      SELECT g.*, COUNT(DISTINCT m.thread_id) AS member_count, MAX(s.updated_at) AS latest_step_at
      FROM session_groups g
      LEFT JOIN session_group_memberships m ON m.group_id = g.id
      LEFT JOIN session_group_steps s ON s.group_id = g.id
      GROUP BY g.id ORDER BY COALESCE(MAX(s.updated_at), g.updated_at) DESC, g.id
    `,
        )
        .all() as GroupRow[]
    ).map((row) => this.group(row))
  }

  read(groupId: string) {
    const row = this.db.sqlite
      .query(
        `
      SELECT g.*, COUNT(DISTINCT m.thread_id) AS member_count, MAX(s.updated_at) AS latest_step_at
      FROM session_groups g
      LEFT JOIN session_group_memberships m ON m.group_id = g.id
      LEFT JOIN session_group_steps s ON s.group_id = g.id
      WHERE g.id = ? GROUP BY g.id
    `,
      )
      .get(groupId) as GroupRow | null
    return row ? this.group(row) : null
  }

  create(input: { name: string; description?: string; id?: string }) {
    const timestamp = this.now()
    const id = input.id ?? randomUUID()
    this.db.sqlite
      .query(
        'INSERT INTO session_groups (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, input.name, input.description ?? '', timestamp, timestamp)
    this.db.sqlite
      .query(
        'INSERT INTO session_group_context_state (group_id, created_at, updated_at) VALUES (?, ?, ?)',
      )
      .run(id, timestamp, timestamp)
    return this.read(id)!
  }

  update(groupId: string, input: { name?: string; description?: string; expectedVersion: number }) {
    const timestamp = this.now()
    const result = this.db.sqlite
      .query(
        `
      UPDATE session_groups SET name = COALESCE(?, name), description = COALESCE(?, description),
        version = version + 1, updated_at = ? WHERE id = ? AND version = ?
    `,
      )
      .run(input.name ?? null, input.description ?? null, timestamp, groupId, input.expectedVersion)
    if (result.changes === 0) return null
    return this.read(groupId)
  }

  delete(groupId: string) {
    return this.db.sqlite.query('DELETE FROM session_groups WHERE id = ?').run(groupId).changes > 0
  }

  membership(threadId: string) {
    return this.db.sqlite
      .query('SELECT group_id, joined_at FROM session_group_memberships WHERE thread_id = ?')
      .get(threadId) as { group_id: string; joined_at: number } | null
  }

  members(groupId: string) {
    return this.db.sqlite
      .query(
        `
      SELECT m.thread_id AS threadId, m.joined_at AS joinedAt, t.title, t.project_id AS projectId,
        t.workspace_cwd AS workspaceLabel, t.updated_at AS updatedAt
      FROM session_group_memberships m JOIN threads t ON t.id = m.thread_id
      WHERE m.group_id = ? ORDER BY t.updated_at DESC
    `,
      )
      .all(groupId)
  }

  setMembership(threadId: string, groupId: string | null, timestamp = this.now()) {
    this.db.sqlite.query('DELETE FROM session_group_memberships WHERE thread_id = ?').run(threadId)
    if (groupId)
      this.db.sqlite
        .query(
          `
      INSERT INTO session_group_memberships (group_id, thread_id, joined_at, updated_at) VALUES (?, ?, ?, ?)
    `,
        )
        .run(groupId, threadId, timestamp, timestamp)
    return groupId ? { groupId, threadId, joinedAt: timestamp } : null
  }

  listSteps(groupId: string, limit = 200) {
    return (
      this.db.sqlite
        .query(
          `
      SELECT * FROM session_group_steps WHERE group_id = ? ORDER BY sequence DESC LIMIT ?
    `,
        )
        .all(groupId, limit) as StepRow[]
    ).map(stepRecord)
  }

  step(groupId: string, stepId: string) {
    const row = this.db.sqlite
      .query('SELECT * FROM session_group_steps WHERE group_id = ? AND id = ?')
      .get(groupId, stepId) as StepRow | null
    return row ? stepRecord(row) : null
  }

  upsertStep(
    input: Omit<SessionGroupStep, 'id' | 'sequence' | 'revision' | 'createdAt' | 'updatedAt'>,
  ) {
    const timestamp = this.now()
    const existing = this.db.sqlite
      .query('SELECT id, sequence FROM session_group_steps WHERE source_turn_id = ?')
      .get(input.sourceTurnId) as { id: string; sequence: number } | null
    if (existing) {
      this.db.sqlite
        .query(
          `
        UPDATE session_group_steps SET status = ?, summary = ?, checkpoints = ?, changed_files = ?,
          validations = ?, failure = ?, revision = revision + 1, updated_at = ? WHERE id = ?
      `,
        )
        .run(
          input.status,
          input.summary,
          stringify(input.checkpoints),
          stringify(input.changedFiles),
          stringify(input.validations),
          input.failure ? stringify(input.failure) : null,
          timestamp,
          existing.id,
        )
      return this.step(input.groupId, existing.id)!
    }
    const sequence = Number(
      (
        this.db.sqlite
          .query(
            'SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM session_group_steps WHERE group_id = ?',
          )
          .get(input.groupId) as { value: number }
      ).value,
    )
    const id = randomUUID()
    this.db.sqlite
      .query(
        `
      INSERT INTO session_group_steps (id, group_id, sequence, source_thread_id, source_thread_title,
        source_turn_id, project_id, workspace_label, status, summary, checkpoints, changed_files,
        validations, failure, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        input.groupId,
        sequence,
        input.sourceThreadId,
        input.sourceThreadTitle,
        input.sourceTurnId,
        input.projectId,
        input.workspaceLabel,
        input.status,
        input.summary,
        stringify(input.checkpoints),
        stringify(input.changedFiles),
        stringify(input.validations),
        input.failure ? stringify(input.failure) : null,
        timestamp,
        timestamp,
      )
    return this.step(input.groupId, id)!
  }

  context(groupId: string) {
    const state = this.db.sqlite
      .query('SELECT * FROM session_group_context_state WHERE group_id = ?')
      .get(groupId) as {
      context_revision: number
      summarized_through_sequence: number
      digest: string
      created_at: number
      updated_at: number
    } | null
    const entries = this.db.sqlite
      .query(
        `
      SELECT id, group_id AS groupId, section, title, content, status, version, source_thread_id AS sourceThreadId,
        source_turn_id AS sourceTurnId, supersedes_entry_id AS supersedesEntryId,
        created_at AS createdAt, updated_at AS updatedAt
      FROM session_group_context_entries WHERE group_id = ? AND status = 'active'
      ORDER BY section, updated_at DESC
    `,
      )
      .all(groupId)
    const latestSequence = Number(
      (
        this.db.sqlite
          .query(
            'SELECT COALESCE(MAX(sequence), 0) AS value FROM session_group_steps WHERE group_id = ?',
          )
          .get(groupId) as { value: number }
      ).value,
    )
    return state
      ? {
          state: {
            groupId,
            contextRevision: state.context_revision,
            summarizedThroughSequence: state.summarized_through_sequence,
            latestSequence,
            digest: state.digest,
            createdAt: state.created_at,
            updatedAt: state.updated_at,
          },
          entries: entries as SessionGroupContextEntry[],
        }
      : null
  }

  updateContext(
    groupId: string,
    input: {
      digest?: string
      entries?: readonly { section: SessionGroupContextSection; title: string; content: string }[]
    },
  ) {
    const timestamp = this.now()
    if (input.digest !== undefined)
      this.db.sqlite
        .query(
          `
      UPDATE session_group_context_state SET digest = ?, context_revision = context_revision + 1, updated_at = ? WHERE group_id = ?
    `,
        )
        .run(input.digest, timestamp, groupId)
    for (const entry of input.entries ?? [])
      this.db.sqlite
        .query(
          `
      INSERT INTO session_group_context_entries (id, group_id, section, title, content, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `,
        )
        .run(randomUUID(), groupId, entry.section, entry.title, entry.content, timestamp, timestamp)
    return this.context(groupId)
  }

  completedOperation(operationId: string, method: string, request: unknown) {
    const row = this.db.sqlite
      .query(
        'SELECT method, request_hash, result FROM session_group_operations WHERE operation_id = ?',
      )
      .get(operationId) as { method: string; request_hash: string; result: string | null } | null
    if (!row) return null
    return {
      matches: row.method === method && row.request_hash === hash(request),
      result: row.result ? parse(row.result) : null,
    }
  }

  recordOperation(operationId: string, method: string, request: unknown, result: unknown) {
    const timestamp = this.now()
    this.db.sqlite
      .query(
        `
      INSERT INTO session_group_operations (operation_id, method, request_hash, result, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(operationId, method, hash(request), stringify(result), timestamp, timestamp)
  }
}
