import type { Database } from 'bun:sqlite'
import { AgentError } from '../../Domain'

export type StoredArtifact = {
  id: string
  threadId: string
  turnId: string
  itemId: string
  name: string
  mimeType: string
  sizeBytes: number
  storageKind: 'managed'
  storagePath: string
  sha256: string | null
  createdAt: number
}

export type NewArtifactRecord = {
  id: string
  threadId: string
  turnId: string
  itemId: string
  name: string
  mimeType: string
  sizeBytes: number
  storagePath: string
  sha256: string
  createdAt: number
}

/**
 * SQLite catalog for tool-result artifacts. Rows are written inside the same
 * transaction as the owning item and its events; the content-addressed blob is
 * stored separately by the caller through ContentBlobStore.
 */
export class ArtifactRepository {
  constructor(private readonly sqlite: Database) {}

  hasArtifactsTable(): boolean {
    return Boolean(
      this.sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'item_artifacts'")
        .get(),
    )
  }

  insert(input: NewArtifactRecord): void {
    this.sqlite
      .query(
        `
      INSERT INTO item_artifacts (
        id, thread_id, turn_id, item_id, name, mime_type, size_bytes,
        storage_kind, storage_path, sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'managed', ?, ?, ?)
    `,
      )
      .run(
        input.id,
        input.threadId,
        input.turnId,
        input.itemId,
        input.name,
        input.mimeType,
        input.sizeBytes,
        input.storagePath,
        input.sha256,
        input.createdAt,
      )
  }

  get(id: string): StoredArtifact | null {
    const row = this.sqlite
      .query(
        `
      SELECT id, thread_id, turn_id, item_id, name, mime_type, size_bytes,
        storage_kind, storage_path, sha256, created_at
      FROM item_artifacts
      WHERE id = ?
    `,
      )
      .get(id) as Record<string, string | number | null> | null
    return row ? artifactFromRow(row) : null
  }

  listByItem(itemId: string): StoredArtifact[] {
    const rows = this.sqlite
      .query(
        `
      SELECT id, thread_id, turn_id, item_id, name, mime_type, size_bytes,
        storage_kind, storage_path, sha256, created_at
      FROM item_artifacts
      WHERE item_id = ?
      ORDER BY created_at, id
    `,
      )
      .all(itemId) as Array<Record<string, string | number | null>>
    return rows.map(artifactFromRow)
  }

  listByThread(threadId: string): StoredArtifact[] {
    const rows = this.sqlite
      .query(
        `
      SELECT id, thread_id, turn_id, item_id, name, mime_type, size_bytes,
        storage_kind, storage_path, sha256, created_at
      FROM item_artifacts
      WHERE thread_id = ?
      ORDER BY created_at, id
    `,
      )
      .all(threadId) as Array<Record<string, string | number | null>>
    return rows.map(artifactFromRow)
  }

  /**
   * Resolves an artifact for a caller-scoped read. Rejects unknown IDs and any
   * request that would cross thread ownership boundaries.
   */
  requireForThread(id: string, threadId: string): StoredArtifact {
    const row = this.sqlite
      .query(
        `
      SELECT id, thread_id, turn_id, item_id, name, mime_type, size_bytes,
        storage_kind, storage_path, sha256, created_at
      FROM item_artifacts
      WHERE id = ?
    `,
      )
      .get(id) as Record<string, string | number | null> | null
    if (!row) throw new AgentError('ARTIFACT_NOT_FOUND', 'Artifact 不存在', 404)
    if (String(row.thread_id) !== threadId) {
      throw new AgentError('PERMISSION_DENIED', 'Artifact 不属于当前 Thread', 403)
    }
    const artifact = artifactFromRow(row)
    if (artifact.storageKind !== 'managed' || !/^[a-f\d]{64}$/.test(artifact.storagePath)) {
      throw new AgentError('ARTIFACT_LOCATION_INVALID', 'Artifact 存储定位无效', 500)
    }
    return artifact
  }
}

const artifactFromRow = (row: Record<string, string | number | null>): StoredArtifact => {
  const storageKind = String(row.storage_kind)
  if (storageKind !== 'managed') {
    throw new AgentError('ARTIFACT_LOCATION_INVALID', 'Artifact 存储类型不受支持', 500)
  }
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    turnId: String(row.turn_id),
    itemId: String(row.item_id),
    name: String(row.name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    storageKind,
    storagePath: String(row.storage_path),
    sha256: row.sha256 == null ? null : String(row.sha256),
    createdAt: Number(row.created_at),
  }
}
