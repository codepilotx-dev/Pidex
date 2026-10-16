import type { EventEnvelope } from '../../Domain'
import type {
  ContextFragment,
  ContextUsageSample,
  ContextUsageSource,
  PromptSessionState,
} from '../../context/ContextManager'
import type { AgentDatabase } from '../database/AgentDatabase'
import type {
  ContextBudget,
  ContextCompactionOperation,
  ThreadContextState,
} from '@pidex/shared/thread'
import type { ContextUsageAnchor } from '../../context/ContextBudget'

export const CONTEXT_LIFECYCLE_SCHEMA = [
  'CREATE TABLE context_runtime_state (thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE, budget TEXT, anchor TEXT)',
  'CREATE TABLE context_compaction_operations (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, payload TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL)',
  'CREATE TABLE context_compaction_requests (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, operation_id TEXT NOT NULL REFERENCES context_compaction_operations(id) ON DELETE CASCADE)',
  'CREATE INDEX context_operations_thread ON context_compaction_operations(thread_id, created_at)',
  "CREATE UNIQUE INDEX context_operations_active ON context_compaction_operations(thread_id) WHERE status IN ('queued','running')",
]

type ContextStateRow = {
  thread_id: string
  baseline_version: number
  prompt_version: string
  base_hash: string
  context_hash: string
  cache_key: string
  fragments: string
  context_window_tokens: number
  usage_tokens: number
  usage_source: string
  usage_sample_id: string | null
  needs_compaction: number
  auto_compact_failures: number
  auto_compact_suspended: number
  created_at: number
  updated_at: number
}

type ContextUsageRow = {
  id: string
  thread_id: string
  turn_id: string | null
  session_id: string | null
  context_fingerprint: string
  context_window_tokens: number
  input_tokens: number
  output_tokens: number
  source: string
  created_at: number
}

export type PiCompactionReferenceEnvelope = {
  version: 1
  kind: 'pi-compaction-reference'
  sessionID: string
  entryID: string
  firstKeptEntryID: string | null
  trigger: 'manual' | 'automatic' | 'reactive'
  afterTokensSource: 'compaction-estimate'
}

export type StoredContextCompaction = {
  id: string
  threadID: string
  beforeCount: number
  afterCount: number
  beforeTokens: number
  afterTokens: number
  targetTokens: number
  usageSampleID: string
  baselineVersion: number
  reference: PiCompactionReferenceEnvelope
}

export type StoredPiCompactionEntry = {
  sessionID: string
  threadID: string
  entryID: string
  payload: string
}

export type InsertCompactionInput = {
  id: string
  threadID: string
  turnID: string | null
  baselineVersion: number
  beforeCount: number
  afterCount: number
  summary: string
  reference: PiCompactionReferenceEnvelope
  beforeTokens: number
  afterTokens: number
  targetTokens: number
  usageSampleID: string
  createdAt: number
}

const parsePiCompactionReference = (value: string): PiCompactionReferenceEnvelope | null => {
  try {
    const parsed = JSON.parse(value) as Partial<PiCompactionReferenceEnvelope>
    return parsed.version === 1 &&
      parsed.kind === 'pi-compaction-reference' &&
      typeof parsed.sessionID === 'string' &&
      typeof parsed.entryID === 'string' &&
      (parsed.firstKeptEntryID === null || typeof parsed.firstKeptEntryID === 'string') &&
      (parsed.trigger === 'manual' ||
        parsed.trigger === 'automatic' ||
        parsed.trigger === 'reactive') &&
      parsed.afterTokensSource === 'compaction-estimate'
      ? (parsed as PiCompactionReferenceEnvelope)
      : null
  } catch {
    return null
  }
}

const stateFromRow = (row: ContextStateRow): PromptSessionState => ({
  threadID: row.thread_id,
  baselineVersion: row.baseline_version,
  promptVersion: row.prompt_version,
  baseHash: row.base_hash,
  contextHash: row.context_hash,
  cacheKey: row.cache_key,
  fragments: JSON.parse(row.fragments) as ContextFragment[],
  contextWindowTokens: row.context_window_tokens,
  usageTokens: row.usage_tokens,
  usageSource: row.usage_source as ContextUsageSource,
  usageSampleID: row.usage_sample_id,
  needsCompaction: Boolean(row.needs_compaction),
  autoCompactFailures: row.auto_compact_failures,
  autoCompactSuspended: Boolean(row.auto_compact_suspended),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const usageFromRow = (row: ContextUsageRow): ContextUsageSample => ({
  id: row.id,
  threadID: row.thread_id,
  turnID: row.turn_id,
  sessionID: row.session_id,
  contextFingerprint: row.context_fingerprint,
  contextWindowTokens: row.context_window_tokens,
  inputTokens: row.input_tokens,
  outputTokens: row.output_tokens,
  source: row.source as ContextUsageSource,
  createdAt: row.created_at,
})

/** SQL boundary for prompt state, usage samples and compaction records. */
export class ContextRepository {
  constructor(private readonly db: AgentDatabase) {}

  supportsLifecycle() {
    return (
      (
        this.db.sqlite
          .query(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('context_runtime_state','context_compaction_operations','context_compaction_requests')",
          )
          .get() as { count: number }
      ).count === 3
    )
  }

  runtimeState(threadID: string): ThreadContextState {
    if (!this.supportsLifecycle()) return { budget: null, operation: null }
    const row = this.db.sqlite
      .query('SELECT budget FROM context_runtime_state WHERE thread_id = ?')
      .get(threadID) as { budget: string | null } | null
    return {
      budget: row?.budget ? JSON.parse(row.budget) : null,
      operation: this.latestOperation(threadID),
    }
  }

  anchor(threadID: string): ContextUsageAnchor | null {
    if (!this.supportsLifecycle()) return null
    const row = this.db.sqlite
      .query('SELECT anchor FROM context_runtime_state WHERE thread_id = ?')
      .get(threadID) as { anchor: string | null } | null
    return row?.anchor ? JSON.parse(row.anchor) : null
  }

  saveRuntimeState(threadID: string, budget: ContextBudget, anchor?: ContextUsageAnchor | null) {
    this.db.sqlite
      .query(
        'INSERT INTO context_runtime_state(thread_id, budget) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET budget = excluded.budget',
      )
      .run(threadID, JSON.stringify(budget))
    if (anchor !== undefined)
      this.db.sqlite
        .query('UPDATE context_runtime_state SET anchor = ? WHERE thread_id = ?')
        .run(anchor ? JSON.stringify(anchor) : null, threadID)
  }

  requestedOperation(id: string): ContextCompactionOperation | null {
    const row = this.db.sqlite
      .query('SELECT operation_id FROM context_compaction_requests WHERE id = ?')
      .get(id) as { operation_id: string } | null
    return row ? this.operation(row.operation_id) : null
  }

  bindRequest(id: string, operation: ContextCompactionOperation) {
    this.db.sqlite
      .query(
        'INSERT INTO context_compaction_requests(id, thread_id, operation_id) VALUES (?, ?, ?)',
      )
      .run(id, operation.threadId, operation.operationId)
  }

  latestSession(threadID: string) {
    return this.db.sqlite
      .query(
        "SELECT session_id, model_ref, turn_id FROM agent_executions WHERE thread_id = ? AND profile = 'main' ORDER BY created_at DESC LIMIT 1",
      )
      .get(threadID) as { session_id: string; model_ref: string; turn_id: string } | null
  }

  operation(id: string): ContextCompactionOperation | null {
    const row = this.db.sqlite
      .query('SELECT payload FROM context_compaction_operations WHERE id = ?')
      .get(id) as { payload: string } | null
    return row ? JSON.parse(row.payload) : null
  }

  latestOperation(threadID: string, active = false): ContextCompactionOperation | null {
    if (!this.supportsLifecycle()) return null
    const row = this.db.sqlite
      .query(
        `SELECT payload FROM context_compaction_operations WHERE thread_id = ? ${active ? "AND status IN ('queued','running')" : ''} ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(threadID) as { payload: string } | null
    return row ? JSON.parse(row.payload) : null
  }

  saveOperation(operation: ContextCompactionOperation) {
    this.db.sqlite
      .query(
        'INSERT INTO context_compaction_operations(id, thread_id, payload, status, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, status = excluded.status',
      )
      .run(
        operation.operationId,
        operation.threadId,
        JSON.stringify(operation),
        operation.status,
        operation.createdAt,
      )
  }

  unfinishedOperations(): ContextCompactionOperation[] {
    if (!this.supportsLifecycle()) return []
    return (
      this.db.sqlite
        .query(
          "SELECT payload FROM context_compaction_operations WHERE status IN ('queued','running')",
        )
        .all() as { payload: string }[]
    ).map((row) => JSON.parse(row.payload))
  }

  state(threadID: string): PromptSessionState | null {
    const row = this.db.sqlite
      .query(
        `
      SELECT thread_id, baseline_version, prompt_version, base_hash, context_hash,
        cache_key, fragments, context_window_tokens, usage_tokens, usage_source,
        usage_sample_id, needs_compaction, auto_compact_failures,
        auto_compact_suspended, created_at, updated_at
      FROM prompt_session_state WHERE thread_id = ?
    `,
      )
      .get(threadID) as ContextStateRow | null
    return row ? stateFromRow(row) : null
  }

  establishBaseline(input: {
    threadID: string
    baselineVersion: number
    promptVersion: string
    baseHash: string
    contextHash: string
    cacheKey: string
    fragments: ContextFragment[]
    createdAt: number
    updatedAt: number
  }) {
    this.db.sqlite
      .query(
        `
      INSERT INTO prompt_session_state (
        thread_id, baseline_version, prompt_version, base_hash, context_hash,
        cache_key, fragments, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        baseline_version = excluded.baseline_version,
        prompt_version = excluded.prompt_version,
        base_hash = excluded.base_hash,
        context_hash = excluded.context_hash,
        cache_key = excluded.cache_key,
        fragments = excluded.fragments,
        usage_tokens = 0,
        usage_source = 'estimated',
        usage_sample_id = NULL,
        needs_compaction = 0,
        auto_compact_failures = 0,
        auto_compact_suspended = 0,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        input.threadID,
        input.baselineVersion,
        input.promptVersion,
        input.baseHash,
        input.contextHash,
        input.cacheKey,
        JSON.stringify(input.fragments),
        input.createdAt,
        input.updatedAt,
      )
  }

  updateFragments(input: {
    threadID: string
    fragments: ContextFragment[]
    contextHash: string
    updatedAt: number
  }) {
    this.db.sqlite
      .query(
        `
      UPDATE prompt_session_state
      SET fragments = ?, context_hash = ?, usage_tokens = 0,
        usage_source = 'estimated', usage_sample_id = NULL, updated_at = ?
      WHERE thread_id = ?
    `,
      )
      .run(JSON.stringify(input.fragments), input.contextHash, input.updatedAt, input.threadID)
  }

  usageSamples(threadID: string, limit: number): ContextUsageSample[] {
    const rows = this.db.sqlite
      .query(
        `
      SELECT id, thread_id, turn_id, session_id, context_fingerprint,
        context_window_tokens, input_tokens, output_tokens, source, created_at
      FROM context_usage_samples
      WHERE thread_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?
    `,
      )
      .all(threadID, limit) as ContextUsageRow[]
    return rows.map(usageFromRow)
  }

  measuredUsage(threadID: string, contextFingerprint: string) {
    const row = this.db.sqlite
      .query(
        `
      SELECT id, thread_id, turn_id, session_id, context_fingerprint,
        context_window_tokens, input_tokens, output_tokens, source, created_at
      FROM context_usage_samples
      WHERE thread_id = ? AND context_fingerprint = ? AND source = 'measured'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `,
      )
      .get(threadID, contextFingerprint) as ContextUsageRow | null
    return row ? usageFromRow(row) : null
  }

  insertUsageSample(sample: ContextUsageSample) {
    this.db.sqlite
      .query(
        `
      INSERT INTO context_usage_samples (
        id, thread_id, turn_id, session_id, context_fingerprint,
        context_window_tokens, input_tokens, output_tokens, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        sample.id,
        sample.threadID,
        sample.turnID,
        sample.sessionID,
        sample.contextFingerprint,
        sample.contextWindowTokens,
        sample.inputTokens,
        sample.outputTokens,
        sample.source,
        sample.createdAt,
      )
    return sample
  }

  updateBudgetState(input: {
    threadID: string
    contextWindowTokens: number
    usageTokens: number
    usageSource: ContextUsageSource
    usageSampleID: string
    needsCompaction: boolean
    clearAutoCompactCircuit: boolean
    updatedAt: number
  }) {
    const circuit = input.clearAutoCompactCircuit
      ? ', auto_compact_failures = 0, auto_compact_suspended = 0'
      : ''
    return this.db.sqlite
      .query(
        `
      UPDATE prompt_session_state
      SET context_window_tokens = ?, usage_tokens = ?, usage_source = ?,
        usage_sample_id = ?, needs_compaction = ?, updated_at = ?${circuit}
      WHERE thread_id = ?
    `,
      )
      .run(
        input.contextWindowTokens,
        input.usageTokens,
        input.usageSource,
        input.usageSampleID,
        input.needsCompaction ? 1 : 0,
        input.updatedAt,
        input.threadID,
      ).changes
  }

  recordAutoCompactFailure(threadID: string, updatedAt: number) {
    const result = this.db.sqlite
      .query(
        `
      UPDATE prompt_session_state
      SET auto_compact_failures = auto_compact_failures + 1,
        auto_compact_suspended = CASE
          WHEN auto_compact_failures + 1 >= 3 THEN 1
          ELSE auto_compact_suspended
        END,
        updated_at = ?
      WHERE thread_id = ?
    `,
      )
      .run(updatedAt, threadID)
    if (!result.changes) throw new Error(`Thread ${threadID} 尚未建立 prompt baseline`)
    return this.state(threadID)!
  }

  persistedPiCompaction(sessionID: string, entryID: string): StoredPiCompactionEntry | null {
    const row = this.db.sqlite
      .query(
        `
      SELECT entry.session_id, session.thread_id, entry.id, entry.payload
      FROM pi_session_entries AS entry
      JOIN pi_sessions AS session ON session.id = entry.session_id
      WHERE entry.session_id = ? AND entry.id = ? AND entry.type = 'compaction'
    `,
      )
      .get(sessionID, entryID) as {
      session_id: string
      thread_id: string
      id: string
      payload: string
    } | null
    return row
      ? {
          sessionID: row.session_id,
          threadID: row.thread_id,
          entryID: row.id,
          payload: row.payload,
        }
      : null
  }

  insertCompaction(input: InsertCompactionInput) {
    this.db.sqlite
      .query(
        `
      INSERT INTO agent_compactions (
        id, thread_id, turn_id, baseline_version, before_count, after_count,
        summary, replacement_history, created_at, before_tokens, after_tokens,
        target_tokens, usage_sample_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        input.id,
        input.threadID,
        input.turnID,
        input.baselineVersion,
        input.beforeCount,
        input.afterCount,
        input.summary,
        JSON.stringify(input.reference),
        input.createdAt,
        input.beforeTokens,
        input.afterTokens,
        input.targetTokens,
        input.usageSampleID,
      )
  }

  compactionByID(id: string): StoredContextCompaction | null {
    const row = this.db.sqlite
      .query(
        `
      SELECT id, thread_id, baseline_version, before_count, after_count,
        before_tokens, after_tokens, target_tokens, usage_sample_id,
        replacement_history
      FROM agent_compactions WHERE id = ?
    `,
      )
      .get(id) as {
      id: string
      thread_id: string
      baseline_version: number
      before_count: number
      after_count: number
      before_tokens: number
      after_tokens: number
      target_tokens: number
      usage_sample_id: string | null
      replacement_history: string
    } | null
    if (!row || row.usage_sample_id === null) return null
    const reference = parsePiCompactionReference(row.replacement_history)
    return reference
      ? {
          id: row.id,
          threadID: row.thread_id,
          baselineVersion: row.baseline_version,
          beforeCount: row.before_count,
          afterCount: row.after_count,
          beforeTokens: row.before_tokens,
          afterTokens: row.after_tokens,
          targetTokens: row.target_tokens,
          usageSampleID: row.usage_sample_id,
          reference,
        }
      : null
  }

  latestCompaction(threadID: string): StoredContextCompaction | null {
    const row = this.db.sqlite
      .query(
        `
      SELECT id FROM agent_compactions
      WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 1
    `,
      )
      .get(threadID) as { id: string } | null
    return row ? this.compactionByID(row.id) : null
  }

  compactionsForTurns(threadID: string, turnIDs: readonly string[]) {
    if (!turnIDs.length) return []
    const rows = this.db.sqlite
      .query(
        `
      SELECT c.id, t.id AS turn_id, c.before_count, c.after_count,
        c.before_tokens, c.after_tokens, c.target_tokens, c.baseline_version,
        c.usage_sample_id, c.replacement_history, c.created_at
      FROM agent_compactions AS c
      JOIN turns AS t ON t.id = COALESCE(c.turn_id, (
        SELECT id FROM turns WHERE thread_id = c.thread_id AND created_at <= c.created_at
        ORDER BY created_at DESC, id DESC LIMIT 1
      ))
      WHERE c.thread_id = ? AND t.id IN (${turnIDs.map(() => '?').join(',')})
      ORDER BY c.created_at, c.id
    `,
      )
      .all(threadID, ...turnIDs) as Array<{
      id: string
      turn_id: string
      before_count: number
      after_count: number
      before_tokens: number
      after_tokens: number
      target_tokens: number
      baseline_version: number
      usage_sample_id: string | null
      replacement_history: string
      created_at: number
    }>
    return rows.flatMap((row) => {
      const reference = parsePiCompactionReference(row.replacement_history)
      if (!reference || !row.usage_sample_id) return []
      return [
        {
          turnID: row.turn_id,
          createdAt: row.created_at,
          payload: {
            compactionId: row.id,
            trigger: reference.trigger,
            beforeCount: row.before_count,
            afterCount: row.after_count,
            beforeTokens: row.before_tokens,
            afterTokens: row.after_tokens,
            afterTokensSource: reference.afterTokensSource,
            targetTokens: row.target_tokens,
            baselineVersion: row.baseline_version,
            usageSampleId: row.usage_sample_id,
          },
        },
      ]
    })
  }

  insertCompactedEvent(
    threadID: string,
    turnID: string | null,
    params: Record<string, unknown>,
  ): EventEnvelope {
    return this.db.insertEvent(threadID, turnID, 'context/compacted', params)
  }
}
