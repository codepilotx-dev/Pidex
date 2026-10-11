import { Schema } from 'effect'
import { BrowserTabSchema, type BrowserTab } from '@pidex/agent-protocol'
import type { AgentDatabase } from '../database/AgentDatabase'

export const BROWSER_SCHEMA = [
  'CREATE TABLE browser_tabs (id TEXT PRIMARY KEY, record TEXT NOT NULL)',
]
const decode = Schema.decodeUnknownSync(BrowserTabSchema)
export class BrowserRepository {
  constructor(private readonly db: AgentDatabase) {}
  available(): boolean {
    const columns = this.db.sqlite.query('PRAGMA table_info(browser_tabs)').all() as Array<{
      name: string
    }>
    return ['id', 'record'].every((name) => columns.some((column) => column.name === name))
  }
  list(): BrowserTab[] {
    if (!this.available()) return []
    return (
      this.db.sqlite.query('SELECT record FROM browser_tabs').all() as Array<{ record: string }>
    ).flatMap((row) => {
      try {
        return [decode(JSON.parse(row.record))]
      } catch {
        return []
      }
    })
  }
  save(tab: BrowserTab) {
    const row = this.db.sqlite
      .query('SELECT record FROM browser_tabs WHERE id = ?')
      .get(tab.tabId) as { record: string } | null
    const record = row ? { ...JSON.parse(row.record), ...tab } : tab
    this.db.sqlite
      .query(
        'INSERT INTO browser_tabs (id, record) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record',
      )
      .run(tab.tabId, JSON.stringify(record))
  }
  normalizeHistory(entries: unknown[], activeIndex: number) {
    const offset = Math.max(0, entries.length - 500)
    const history = entries.slice(-500).flatMap((entry) => {
      const e = entry as { url?: unknown; title?: unknown }
      if (typeof e?.url !== 'string' || typeof e.title !== 'string') return []
      try {
        const url = new URL(e.url)
        if (
          (!['http:', 'https:'].includes(url.protocol) && url.href !== 'about:blank') ||
          url.username ||
          url.password
        )
          return []
        return [{ url: url.href, title: e.title.slice(0, 500) }]
      } catch {
        return []
      }
    })
    return {
      history,
      historyIndex: Number.isSafeInteger(activeIndex)
        ? Math.max(0, Math.min(activeIndex - offset, history.length - 1))
        : 0,
    }
  }
  remove(tabId: string) {
    this.db.sqlite.query('DELETE FROM browser_tabs WHERE id = ?').run(tabId)
  }
}
