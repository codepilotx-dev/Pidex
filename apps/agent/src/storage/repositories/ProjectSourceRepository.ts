import type { AgentDatabase } from '../database/AgentDatabase'

export type StoredProjectSource = {
  id: string
  projectID: string
  storage: 'managed' | 'workspace-file'
  kind: 'text' | 'image'
  name: string
  mediaType: string
  sizeBytes: number
  sha256: string | null
  folderID: string | null
  relativePath: string | null
  createdAt: number
  updatedAt: number
}

const mapSource = (row: Record<string, string | number | null>): StoredProjectSource => ({
  id: String(row.id),
  projectID: String(row.project_id),
  storage: String(row.storage_kind) as StoredProjectSource['storage'],
  kind: String(row.content_kind) as StoredProjectSource['kind'],
  name: String(row.name),
  mediaType: String(row.media_type),
  sizeBytes: Number(row.size_bytes),
  sha256: row.sha256 === null ? null : String(row.sha256),
  folderID: row.folder_id === null ? null : String(row.folder_id),
  relativePath: row.relative_path === null ? null : String(row.relative_path),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
})

const SOURCE_COLUMNS = `
  id, project_id, storage_kind, content_kind, name, media_type,
  size_bytes, sha256, folder_id, relative_path, created_at, updated_at
`

export class ProjectSourceRepository {
  constructor(private readonly db: AgentDatabase) {}

  count(projectID: string) {
    return Number(
      (
        this.db.profileSqlite
          .query('SELECT COUNT(*) AS count FROM project_sources WHERE project_id = ?')
          .get(projectID) as { count: number }
      ).count,
    )
  }

  list(projectID: string, limit = 100, offset = 0) {
    return (
      this.db.profileSqlite
        .query(
          `
      SELECT ${SOURCE_COLUMNS}
      FROM project_sources
      WHERE project_id = ?
      ORDER BY created_at DESC, id
      LIMIT ? OFFSET ?
    `,
        )
        .all(projectID, limit, offset) as Array<Record<string, string | number | null>>
    ).map(mapSource)
  }

  get(projectID: string, sourceID: string) {
    const row = this.db.profileSqlite
      .query(
        `
      SELECT ${SOURCE_COLUMNS}
      FROM project_sources
      WHERE project_id = ? AND id = ?
    `,
      )
      .get(projectID, sourceID) as Record<string, string | number | null> | null
    return row ? mapSource(row) : null
  }

  insertManaged(input: {
    id: string
    projectID: string
    kind: 'text' | 'image'
    name: string
    mediaType: string
    sizeBytes: number
    sha256: string
    timestamp: number
  }) {
    this.db.profileSqlite
      .query(
        `
      INSERT INTO project_sources (
        id, project_id, storage_kind, content_kind, name, media_type,
        size_bytes, sha256, storage_path, folder_id, relative_path, created_at, updated_at
      ) VALUES (?, ?, 'managed', ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `,
      )
      .run(
        input.id,
        input.projectID,
        input.kind,
        input.name,
        input.mediaType,
        input.sizeBytes,
        input.sha256,
        input.sha256,
        input.timestamp,
        input.timestamp,
      )
    return this.get(input.projectID, input.id)!
  }

  insertWorkspaceFile(input: {
    id: string
    projectID: string
    folderID: string
    relativePath: string
    kind: 'text' | 'image'
    name: string
    mediaType: string
    sizeBytes: number
    sha256: string
    timestamp: number
  }) {
    this.db.profileSqlite
      .query(
        `
      INSERT INTO project_sources (
        id, project_id, storage_kind, content_kind, name, media_type,
        size_bytes, sha256, folder_id, relative_path, created_at, updated_at
      ) VALUES (?, ?, 'workspace-file', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        input.id,
        input.projectID,
        input.kind,
        input.name,
        input.mediaType,
        input.sizeBytes,
        input.sha256,
        input.folderID,
        input.relativePath,
        input.timestamp,
        input.timestamp,
      )
    return this.get(input.projectID, input.id)!
  }

  remove(projectID: string, sourceID: string) {
    const existing = this.get(projectID, sourceID)
    if (!existing) return null
    this.db.profileSqlite
      .query('DELETE FROM project_sources WHERE project_id = ? AND id = ?')
      .run(projectID, sourceID)
    return existing
  }

  blobReferenceCount(sha256: string) {
    const projectSources = Number(
      (
        this.db.profileSqlite
          .query(
            "SELECT COUNT(*) AS count FROM project_sources WHERE storage_kind = 'managed' AND sha256 = ?",
          )
          .get(sha256) as { count: number }
      ).count,
    )
    const inputAttachments = Number(
      (
        this.db.sqlite
          .query('SELECT COUNT(*) AS count FROM input_attachments WHERE sha256 = ?')
          .get(sha256) as { count: number }
      ).count,
    )
    return projectSources + inputAttachments
  }
}
