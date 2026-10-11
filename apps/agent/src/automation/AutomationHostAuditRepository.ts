import type { Database } from 'bun:sqlite'
import { AgentError, type ToolInvocation } from '../Domain'
import type { TurnPatchMutationBatch } from '../patch/TurnPatchTypes'
import { secretScrubber } from '../security/SecretScrubber'

export const AUTOMATION_HOST_AUDIT_SCHEMA = [
  'CREATE TABLE automation_host_tool_calls (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE, thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL, name TEXT NOT NULL, invocation TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL, output TEXT, error TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, evidence TEXT, evidence_complete INTEGER NOT NULL DEFAULT 1)',
] as const

export class AutomationHostAuditRepository {
  constructor(private readonly sqlite: Database) {}
  record(
    invocation: ToolInvocation,
    status: string,
    output: unknown,
    error: string | null | undefined,
    startedAt: number | undefined,
  ) {
    const runId = invocation.turnID.replace(/^automation-host:/, '')
    const bound = this.sqlite
      .query(
        "SELECT 1 FROM automation_runs run JOIN pr_watches watch ON watch.automation_id = run.automation_id WHERE run.id = ? AND watch.thread_id = ? AND run.status IN ('preparing','queued','running')",
      )
      .get(runId, invocation.threadID)
    if (!bound) throw new AgentError('PERMISSION_DENIED', '宿主工具缺少活跃自动化运行上下文', 403)
    const safe = secretScrubber.scrub(invocation)
    this.sqlite
      .query(
        'INSERT INTO automation_host_tool_calls (id,run_id,thread_id,name,invocation,input,status,output,error,started_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,output=excluded.output,error=excluded.error,updated_at=excluded.updated_at',
      )
      .run(
        invocation.id,
        runId,
        invocation.threadID,
        invocation.name,
        JSON.stringify(safe),
        JSON.stringify(safe.input),
        status,
        output === undefined ? null : JSON.stringify(secretScrubber.scrub(output)),
        error ? secretScrubber.scrubText(error) : null,
        startedAt ?? Date.now(),
        Date.now(),
      )
  }
  completed(id: string) {
    if (
      !this.sqlite
        .query(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'automation_host_tool_calls'",
        )
        .get()
    )
      return null
    const row = this.sqlite
      .query(
        "SELECT name,input,output FROM automation_host_tool_calls WHERE id = ? AND status = 'completed'",
      )
      .get(id) as { name: string; input: string; output: string } | null
    return row
      ? {
          name: row.name,
          input: JSON.parse(row.input) as Record<string, unknown>,
          output: JSON.parse(row.output) as unknown,
        }
      : null
  }
  recordMutation(batch: TurnPatchMutationBatch) {
    const row = this.sqlite
      .query('UPDATE automation_host_tool_calls SET evidence = ? WHERE id = ? AND thread_id = ?')
      .run(JSON.stringify(secretScrubber.scrub(batch)), batch.toolCallID, batch.threadID)
    if (row.changes !== 1)
      throw new AgentError('PERMISSION_DENIED', '宿主变更证据缺少审计调用', 403)
  }
  discardMutationEvidence(turnID: string) {
    this.sqlite
      .query('UPDATE automation_host_tool_calls SET evidence_complete = 0 WHERE run_id = ?')
      .run(turnID.replace(/^automation-host:/, ''))
  }
}
