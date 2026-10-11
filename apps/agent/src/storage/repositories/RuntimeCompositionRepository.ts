import { createHash } from 'node:crypto'
import type { AgentDatabase } from '../database/AgentDatabase'
import type {
  RuntimeCompositionSnapshot,
  RuntimeCompositionSnapshotV1,
  RuntimeCompositionSnapshotV2,
} from '../../runtime-composition/Types'

export type StoredRuntimeCompositionPlan = {
  turnID: string
  agentID: string
  compositionID: string
  snapshotVersion: number
  snapshot: RuntimeCompositionSnapshot
  snapshotHash: string
  createdAt: number
}

const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>()
  const walk = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== 'object') return entry
    if (seen.has(entry as object)) return null
    seen.add(entry as object)
    if (Array.isArray(entry)) return entry.map(walk)
    const record = entry as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      next[key] = walk(record[key] ?? null)
    }
    return next
  }
  return JSON.stringify(walk(value))
}

export const hashRuntimeCompositionSnapshot = (snapshot: RuntimeCompositionSnapshot) =>
  createHash('sha256').update(stableStringify(snapshot), 'utf8').digest('hex')

const isV1 = (snapshot: RuntimeCompositionSnapshot): snapshot is RuntimeCompositionSnapshotV1 =>
  snapshot.version === 1

const isV2 = (snapshot: RuntimeCompositionSnapshot): snapshot is RuntimeCompositionSnapshotV2 =>
  snapshot.version === 2

export class RuntimeCompositionRepository {
  constructor(private readonly db: AgentDatabase) {}

  hasTable(): boolean {
    return Boolean(
      this.db.sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_composition_plans'",
        )
        .get(),
    )
  }

  /**
   * Insert the snapshot if absent; never UPDATE the durable row. Returns the
   * existing or newly-persisted record and whether it was newly inserted.
   */
  insertOrGet(input: {
    turnID: string
    agentID: string
    compositionID: string
    snapshot: RuntimeCompositionSnapshot
  }): { plan: StoredRuntimeCompositionPlan; inserted: boolean } {
    if (!this.hasTable()) {
      throw new Error('runtime_composition_plans 表不存在，ephemeral composition 必须直接返回')
    }
    if (!isV1(input.snapshot) && !isV2(input.snapshot)) {
      throw new Error('Runtime composition snapshot version is unsupported')
    }
    const snapshotHash = hashRuntimeCompositionSnapshot(input.snapshot)
    const createdAt = Date.now()
    const inserted =
      this.db.sqlite
        .query(
          `
      INSERT INTO runtime_composition_plans (
        turn_id, agent_id, composition_id, snapshot_version, snapshot_json, snapshot_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(turn_id) DO NOTHING
    `,
        )
        .run(
          input.turnID,
          input.agentID,
          input.compositionID,
          input.snapshot.version,
          JSON.stringify(input.snapshot),
          snapshotHash,
          createdAt,
        ).changes > 0
    const authoritative = this.get(input.turnID)
    if (!authoritative) throw new Error('Runtime composition persistence failed')
    if (authoritative.compositionID !== input.compositionID) {
      throw new Error('Runtime composition identity conflict')
    }
    if (inserted && authoritative.snapshotHash !== snapshotHash) {
      throw new Error('Runtime composition persistence verification failed')
    }
    return { plan: authoritative, inserted }
  }

  get(turnID: string): StoredRuntimeCompositionPlan | null {
    if (!this.hasTable()) return null
    const row = this.db.sqlite
      .query(
        `
      SELECT turn_id, agent_id, composition_id, snapshot_version, snapshot_json, snapshot_hash, created_at
      FROM runtime_composition_plans
      WHERE turn_id = ?
    `,
      )
      .get(turnID) as
      | {
          turn_id: string
          agent_id: string
          composition_id: string
          snapshot_version: number
          snapshot_json: string
          snapshot_hash: string
          created_at: number
        }
      | undefined
    if (!row) return null
    let snapshot: RuntimeCompositionSnapshot
    try {
      snapshot = JSON.parse(row.snapshot_json) as RuntimeCompositionSnapshot
    } catch {
      throw new Error('Runtime composition snapshot is invalid')
    }
    if (row.snapshot_version !== snapshot.version || (!isV1(snapshot) && !isV2(snapshot))) {
      throw new Error('Runtime composition snapshot version is unsupported')
    }
    if (snapshot.identity.id !== row.composition_id) {
      throw new Error('Runtime composition identity verification failed')
    }
    if (snapshot.identity.hash !== snapshot.hashes.overall) {
      throw new Error('Runtime composition overall hash verification failed')
    }
    if (hashRuntimeCompositionSnapshot(snapshot) !== row.snapshot_hash) {
      throw new Error('Runtime composition snapshot hash verification failed')
    }
    return {
      turnID: row.turn_id,
      agentID: row.agent_id,
      compositionID: row.composition_id,
      snapshotVersion: row.snapshot_version,
      snapshot,
      snapshotHash: row.snapshot_hash,
      createdAt: row.created_at,
    }
  }

  /**
   * Durable evidence for a successfully read Skill. Only mutates V2 snapshots;
   * V1 remains full-catalog fail-closed and is left untouched. Recomputes the
   * row hash so tamper detection stays sound.
   */
  recordReferencedSkills(
    turnID: string,
    referenced: readonly { name: string; hash: string }[],
  ): void {
    if (referenced.length === 0 || !this.hasTable()) return
    const existing = this.get(turnID)
    if (!existing || !isV2(existing.snapshot)) return
    const snapshot = existing.snapshot
    const merged = new Map(snapshot.skills.referenced.map((item) => [item.name, item]))
    let changed = false
    for (const item of referenced) {
      const current = merged.get(item.name)
      if (!current || current.hash !== item.hash) {
        merged.set(item.name, { name: item.name, hash: item.hash })
        changed = true
      }
    }
    if (!changed) return
    const next: RuntimeCompositionSnapshotV2 = {
      ...snapshot,
      skills: {
        ...snapshot.skills,
        referenced: [...merged.values()],
      },
    }
    this.db.sqlite
      .query(
        `
      UPDATE runtime_composition_plans
      SET snapshot_json = ?, snapshot_hash = ?
      WHERE turn_id = ?
    `,
      )
      .run(JSON.stringify(next), hashRuntimeCompositionSnapshot(next), turnID)
  }
}
