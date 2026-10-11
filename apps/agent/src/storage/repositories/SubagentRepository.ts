import type { EventEnvelope } from '../../Domain'
import { now, parse } from './RepositoryCore'

import { InteractionRepositoryDatabase } from './InteractionRepository'

export abstract class SubagentRepositoryDatabase extends InteractionRepositoryDatabase {
  checkpointSubagentWait(input: {
    agentID: string
    turnID: string
    threadID: string
    state: string
    interruption: unknown
    runIDs: string[]
    mode: 'all' | 'any'
  }) {
    return this.transaction(() => {
      this.saveAgentTurnCheckpoint({
        agentID: input.agentID,
        turnID: input.turnID,
        threadID: input.threadID,
        state: 'waiting_subagents',
        payload: {
          kind: 'subagent-wait',
          state: input.state,
          interruption: input.interruption,
          runIDs: input.runIDs,
          mode: input.mode,
        },
        version: 1,
      })
      this.updateTurnStatus(input.turnID, 'waiting_subagents')
      const agent = this.updateAgentStatus(input.agentID, 'waiting_subagents')
      const events = [
        this.insertEvent(input.threadID, input.turnID, 'agent/upserted', { agent }),
        this.insertEvent(input.threadID, input.turnID, 'turn/statusChanged', {
          turnId: input.turnID,
          rootAgentId: input.agentID,
          status: 'waiting-subagents',
          runIds: input.runIDs,
          mode: input.mode,
        }),
      ]
      return { agent, events }
    })
  }

  resumeSatisfiedSubagentWaits() {
    return this.transaction(() => {
      const rows = this.sqlite
        .query(
          `
        SELECT agent_id, turn_id, thread_id, payload
        FROM agent_checkpoints
        WHERE state = 'waiting_subagents'
      `,
        )
        .all() as Array<{ agent_id: string; turn_id: string; thread_id: string; payload: string }>
      const resumed: Array<{
        agentID: string
        turnID: string
        threadID: string
        events: EventEnvelope[]
      }> = []
      for (const row of rows) {
        const payload = parse<Record<string, unknown>>(row.payload)
        const runIDs = Array.isArray(payload.runIDs)
          ? payload.runIDs.filter((value): value is string => typeof value === 'string')
          : []
        const mode = payload.mode === 'any' ? 'any' : 'all'
        if (runIDs.length === 0) continue
        const placeholders = runIDs.map(() => '?').join(',')
        const states = this.sqlite
          .query(`SELECT id, status FROM subagent_runs WHERE id IN (${placeholders})`)
          .all(...runIDs) as Array<{ id: string; status: string }>
        if (states.length !== runIDs.length) continue
        const terminal = new Set(['completed', 'failed', 'stopped', 'interrupted'])
        const satisfied =
          mode === 'all'
            ? states.every((run) => terminal.has(run.status))
            : states.some((run) => terminal.has(run.status))
        if (!satisfied) continue
        const timestamp = now()
        const claimed = this.sqlite
          .query(
            `
          UPDATE agent_checkpoints
          SET state = 'ready', payload = json_set(payload, '$.kind', 'subagent-wait'), updated_at = ?
          WHERE agent_id = ? AND state = 'waiting_subagents'
        `,
          )
          .run(timestamp, row.agent_id)
        if (claimed.changes !== 1) continue
        this.updateTurnStatus(row.turn_id, 'queued')
        const agent = this.updateAgentStatus(row.agent_id, 'queued')
        resumed.push({
          agentID: row.agent_id,
          turnID: row.turn_id,
          threadID: row.thread_id,
          events: [
            this.insertEvent(row.thread_id, row.turn_id, 'agent/upserted', { agent }),
            this.insertEvent(row.thread_id, row.turn_id, 'turn/statusChanged', {
              turnId: row.turn_id,
              status: 'queued',
              resumedFrom: 'waiting-subagents',
            }),
          ],
        })
      }
      return resumed
    })
  }

  recoverInterruptedSubagents(timestamp: number) {
    this.sqlite
      .query(
        "UPDATE subagent_runs SET status = 'queued', queue_reason = NULL, updated_at = ? WHERE status = 'waiting_permission' AND id IN (SELECT a.subagent_run_id FROM agent_executions AS a JOIN turns AS t ON t.id = a.turn_id WHERE t.status = 'queued' AND a.status = 'queued' AND a.subagent_run_id IS NOT NULL)",
      )
      .run(timestamp)
    this.sqlite
      .query(
        "UPDATE subagent_tasks SET status = 'queued', updated_at = ? WHERE current_run_id IN (SELECT id FROM subagent_runs WHERE status = 'queued')",
      )
      .run(timestamp)
    this.sqlite
      .query(
        "UPDATE items SET status = 'pending', data = json_set(data, '$.status', 'queued', '$.queueReason', NULL), updated_at = ? WHERE type = 'subagent' AND json_extract(data, '$.runId') IN (SELECT id FROM subagent_runs WHERE status = 'queued')",
      )
      .run(timestamp)
    this.sqlite
      .query(
        "UPDATE subagent_runs SET status = 'interrupted', error = COALESCE(error, 'Agent 重启时运行被中断'), finished_at = ?, updated_at = ? WHERE (status IN ('preparing', 'running', 'steering') AND NOT EXISTS (SELECT 1 FROM agent_executions a JOIN turns t ON t.id = a.turn_id WHERE a.subagent_run_id = subagent_runs.id AND t.status = 'waiting_subagents')) OR (status = 'waiting_permission' AND id IN (SELECT a.subagent_run_id FROM agent_executions AS a JOIN turns AS t ON t.id = a.turn_id WHERE t.status = 'interrupted' AND a.subagent_run_id IS NOT NULL))",
      )
      .run(timestamp, timestamp)
    this.sqlite
      .query(
        "UPDATE subagent_tasks SET status = 'interrupted', updated_at = ? WHERE current_run_id IN (SELECT id FROM subagent_runs WHERE status = 'interrupted')",
      )
      .run(timestamp)
    this.sqlite
      .query(
        "UPDATE items SET status = 'interrupted', data = json_set(data, '$.status', 'interrupted', '$.queueReason', NULL), updated_at = ? WHERE type = 'subagent' AND json_extract(data, '$.runId') IN (SELECT id FROM subagent_runs WHERE status = 'interrupted')",
      )
      .run(timestamp)
    this.sqlite
      .query(
        "DELETE FROM workspace_writer_leases WHERE run_id NOT IN (SELECT id FROM subagent_runs WHERE status IN ('preparing', 'running', 'steering', 'waiting_question', 'waiting_permission'))",
      )
      .run()
  }
}

export type SubagentRepositoryContract = SubagentRepositoryDatabase
export const subagentRepositoryDatabase = (
  database: SubagentRepositoryDatabase,
): SubagentRepositoryContract => database
