import { Schema } from 'effect'
import {
  BrowserVisitSchema,
  BrowserDownloadSchema,
  type BrowserVisit,
  type BrowserDownload,
} from '@pidex/agent-protocol'
import type { AgentDatabase } from '../database/AgentDatabase'

export const BROWSER_DATA_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS browser_visits (id TEXT PRIMARY KEY, record TEXT NOT NULL, visited_at REAL NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS browser_visits_date ON browser_visits (visited_at DESC, id DESC)',
  'CREATE TABLE IF NOT EXISTS browser_downloads (id TEXT PRIMARY KEY, record TEXT NOT NULL, profile_id TEXT NOT NULL, run_id TEXT NOT NULL, state TEXT NOT NULL, updated_at REAL NOT NULL)',
  'CREATE INDEX IF NOT EXISTS browser_downloads_date ON browser_downloads (updated_at DESC, id DESC)',
]
type DownloadRecord = BrowserDownload & { filePath?: string }
export class BrowserDataRepository {
  constructor(private readonly db: AgentDatabase) {}
  available() {
    return [
      ['browser_visits', ['id', 'record', 'visited_at', 'url', 'title']],
      ['browser_downloads', ['id', 'record', 'profile_id', 'run_id', 'state', 'updated_at']],
    ].every(([table, fields]) => {
      const columns = this.db.sqlite.query(`PRAGMA table_info(${table})`).all() as {
        name: string
      }[]
      return (fields as string[]).every((field) => columns.some((c) => c.name === field))
    })
  }
  visits(query = '', cursor?: [number, string], limit = 50) {
    const escaped = `%${query.replace(/[!%_]/g, '!$&')}%`
    const rows = this.db.sqlite
      .query(
        "SELECT record FROM browser_visits WHERE (url LIKE ? ESCAPE '!' OR title LIKE ? ESCAPE '!') AND (visited_at < ? OR (visited_at = ? AND id < ?)) ORDER BY visited_at DESC, id DESC LIMIT ?",
      )
      .all(
        escaped,
        escaped,
        cursor?.[0] ?? Number.MAX_VALUE,
        cursor?.[0] ?? Number.MAX_VALUE,
        cursor?.[1] ?? '',
        limit + 1,
      ) as { record: string }[]
    const visits = rows.flatMap((row) => {
      try {
        return [Schema.decodeUnknownSync(BrowserVisitSchema)(JSON.parse(row.record))]
      } catch {
        return []
      }
    })
    const more = visits.length > limit
    visits.length = Math.min(visits.length, limit)
    const last = visits.at(-1)
    return {
      visits,
      nextCursor:
        more && last
          ? Buffer.from(JSON.stringify([last.visitedAt, last.id])).toString('base64url')
          : null,
    }
  }
  saveVisit(visit: BrowserVisit, updateOnly: boolean) {
    const row = this.db.sqlite
      .query('SELECT record FROM browser_visits WHERE id = ?')
      .get(visit.id) as { record: string } | null
    if (updateOnly && !row) return
    const next = row ? { ...JSON.parse(row.record), title: visit.title } : visit
    this.db.sqlite
      .query(
        'INSERT INTO browser_visits(id, record, visited_at, url, title) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET record=excluded.record, title=excluded.title',
      )
      .run(visit.id, JSON.stringify(next), next.visitedAt, next.url, next.title)
  }
  removeVisits(id?: string) {
    if (id) this.db.sqlite.query('DELETE FROM browser_visits WHERE id = ?').run(id)
    else this.db.sqlite.exec('DELETE FROM browser_visits')
  }
  downloads(): BrowserDownload[] {
    return (
      this.db.sqlite
        .query('SELECT record FROM browser_downloads ORDER BY updated_at DESC, id DESC')
        .all() as { record: string }[]
    ).flatMap((row) => {
      try {
        return [Schema.decodeUnknownSync(BrowserDownloadSchema)(JSON.parse(row.record))]
      } catch {
        return []
      }
    })
  }
  download(id: string): DownloadRecord | null {
    const row = this.db.sqlite
      .query('SELECT record FROM browser_downloads WHERE id = ?')
      .get(id) as { record: string } | null
    return row ? JSON.parse(row.record) : null
  }
  saveDownload(download: DownloadRecord) {
    const next = { ...this.download(download.id), ...download }
    this.db.sqlite
      .query(
        'INSERT INTO browser_downloads(id, record, profile_id, run_id, state, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET record=excluded.record, state=excluded.state, updated_at=excluded.updated_at',
      )
      .run(next.id, JSON.stringify(next), next.profileId, next.runId, next.state, next.updatedAt)
  }
  removeDownloads(id?: string) {
    this.db.sqlite
      .query(
        "DELETE FROM browser_downloads WHERE state IN ('completed', 'cancelled', 'interrupted') AND (? IS NULL OR id = ?)",
      )
      .run(id ?? null, id ?? null)
  }
  recoverDownloads(profileId: string, runId: string) {
    for (const item of this.downloads())
      if (
        item.profileId === profileId &&
        item.runId !== runId &&
        ['progressing', 'paused'].includes(item.state)
      )
        this.saveDownload({
          ...item,
          state: 'interrupted',
          resumable: false,
          updatedAt: Date.now(),
        })
  }
}
