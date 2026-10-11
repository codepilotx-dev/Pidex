import { Effect } from 'effect'
import type { BrowserVisit, BrowserDownload } from '@pidex/agent-protocol'
import { AgentError } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'
import { BrowserDataRepository } from '../storage/repositories/BrowserDataRepository'

export class BrowserDataService {
  revision = 0
  readonly repository: BrowserDataRepository
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly changed: () => void = () => {},
  ) {
    this.repository = new BrowserDataRepository(db)
  }
  private require() {
    if (!this.repository.available())
      throw new AgentError('CAPABILITY_REQUIRED', '浏览管理存储不可用', 409)
  }
  history(query?: string, cursor?: string, limit?: number) {
    this.require()
    let after: [number, string] | undefined
    if (cursor) {
      try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString())
        if (
          !Array.isArray(value) ||
          value.length !== 2 ||
          !Number.isFinite(value[0]) ||
          typeof value[1] !== 'string'
        )
          throw 0
        after = value as [number, string]
      } catch {
        throw new AgentError('INVALID_REQUEST', '历史分页游标无效', 400)
      }
    }
    return this.repository.visits(query, after, limit)
  }
  downloads() {
    this.require()
    return this.repository.downloads()
  }
  async change(collection: 'history' | 'downloads', write: () => void) {
    this.require()
    const event = this.db.sqlite.transaction(() => {
      write()
      return this.db.insertEvent(null, null, 'browser/dataChanged', { collection })
    })()
    this.revision++
    this.changed()
    await Effect.runPromise(this.hub.publish(event))
  }
  visit(visit: BrowserVisit, updateOnly = false) {
    return this.change('history', () => this.repository.saveVisit(visit, updateOnly))
  }
  download(download: BrowserDownload, filePath?: string) {
    this.require()
    const previous = this.repository.download(download.id)
    if (
      previous &&
      (previous.profileId !== download.profileId ||
        previous.runId !== download.runId ||
        previous.tabId !== download.tabId)
    )
      throw new AgentError('PERMISSION_DENIED', '下载任务归属不匹配', 403)
    return this.change('downloads', () =>
      this.repository.saveDownload({
        ...download,
        ...(filePath === undefined ? {} : { filePath }),
      }),
    )
  }
  path(id: string) {
    this.require()
    return this.repository.download(id)?.filePath ?? null
  }
}
