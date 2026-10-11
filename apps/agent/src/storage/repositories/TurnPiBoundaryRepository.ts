import type { AgentDatabase } from '../database/AgentDatabase'

export type TurnPiBoundary = {
  turnID: string
  sessionID: string
  entryID: string
}

/** Durable mapping from a completed product turn to its final Pi assistant entry. */
export class TurnPiBoundaryRepository {
  constructor(private readonly db: AgentDatabase) {}

  get(turnID: string): TurnPiBoundary | null {
    const row = this.db.sqlite
      .query(
        `
      SELECT turn_id, session_id, entry_id
      FROM turn_pi_boundaries
      WHERE turn_id = ?
    `,
      )
      .get(turnID) as {
      turn_id: string
      session_id: string
      entry_id: string
    } | null
    return row ? { turnID: row.turn_id, sessionID: row.session_id, entryID: row.entry_id } : null
  }

  upsert(input: TurnPiBoundary) {
    this.db.sqlite
      .query(
        `
      INSERT INTO turn_pi_boundaries (turn_id, session_id, entry_id)
      VALUES (?, ?, ?)
      ON CONFLICT(turn_id) DO UPDATE SET
        session_id = excluded.session_id,
        entry_id = excluded.entry_id
    `,
      )
      .run(input.turnID, input.sessionID, input.entryID)
  }
}
