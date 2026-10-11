import { app, shell, type Session, type DownloadItem, type WebContents } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { access } from 'node:fs/promises'
import type { BrowserDownload } from '@pidex/agent-protocol'
import type { DesktopBrowserDownload } from '@pidex/shared/desktop-browser-ipc'
import { reserveBrowserDownloadPath, browserDownloadFileName } from './BrowserDownloadPath.js'
import type { BrowserHostRpcClient } from './BrowserHostRpcClient.js'

type DownloadSource = { tabId: string; allowed(url: string): boolean }
type Job = {
  item: DownloadItem
  record: BrowserDownload
  reporting: Promise<void>
  timer?: ReturnType<typeof setTimeout>
}
export class BrowserDownloads {
  private readonly jobs = new Map<string, Job>()
  private readonly sessions = new Map<
    Session,
    (event: Electron.Event, item: DownloadItem, contents: WebContents) => void
  >()
  private readonly attaching = new Map<Session, Promise<void>>()
  private readonly runId = randomUUID()
  private readonly profileId = createHash('sha256').update(app.getPath('userData')).digest('hex')
  private saveMode: 'downloads' | 'ask' = 'downloads'
  constructor(
    private readonly rpc: BrowserHostRpcClient,
    private readonly host: () => { windowId: string; instanceId: string },
    private readonly source: (id: number) => DownloadSource | undefined,
    private readonly changed: () => void,
  ) {}
  async attach(session: Session) {
    if (this.sessions.has(session)) return
    let pending = this.attaching.get(session)
    if (!pending) {
      pending = this.initialize(session).finally(() => this.attaching.delete(session))
      this.attaching.set(session, pending)
    }
    await pending
  }
  private async initialize(session: Session) {
    if (!this.rpc.capabilities.has('browser.data.v1')) return
    this.saveMode = (await this.rpc.call('browser/preferences/get', {})).downloadSaveMode
    await this.rpc.call('browser/host/download-recover', {
      ...this.host(),
      profileId: this.profileId,
      runId: this.runId,
    })
    const listener = (_event: Electron.Event, item: DownloadItem, contents: WebContents) => {
      const source = contents && this.source(contents.id)
      if (!source || !source.allowed(item.getURL())) {
        item.cancel()
        return
      }
      const fileName = browserDownloadFileName(item.getFilename())
      try {
        if (this.saveMode === 'downloads')
          item.setSavePath(reserveBrowserDownloadPath(app.getPath('downloads'), fileName))
        else item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), fileName) })
      } catch {
        item.cancel()
        return
      }
      const id = randomUUID()
      const now = Date.now()
      const job: Job = {
        item,
        reporting: Promise.resolve(),
        record: {
          id,
          tabId: source.tabId,
          profileId: this.profileId,
          runId: this.runId,
          fileName,
          url: item.getURL(),
          state: 'progressing',
          receivedBytes: 0,
          totalBytes: item.getTotalBytes(),
          startedAt: now,
          updatedAt: now,
          resumable: false,
        },
      }
      this.jobs.set(id, job)
      this.report(job)
      item.on('updated', (_event, state) => {
        job.record = {
          ...job.record,
          state: item.isPaused() || state === 'interrupted' ? 'paused' : 'progressing',
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          resumable: item.canResume(),
          updatedAt: Date.now(),
        }
        job.timer ??= setTimeout(() => {
          job.timer = undefined
          this.report(job)
        }, 500)
      })
      item.once('done', (_event, state) => {
        clearTimeout(job.timer)
        job.record = {
          ...job.record,
          state,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          resumable: false,
          updatedAt: Date.now(),
          fileName: basename(item.getSavePath()) || fileName,
        }
        this.jobs.delete(id)
        this.report(job)
      })
    }
    this.sessions.set(session, listener)
    session.on('will-download', listener)
  }
  setSaveMode(mode: 'downloads' | 'ask') {
    this.saveMode = mode
  }
  decorate(downloads: readonly BrowserDownload[]): DesktopBrowserDownload[] {
    return downloads.map((item) => ({
      ...item,
      controllable: this.jobs.has(item.id),
      resumable:
        this.jobs.get(item.id)?.item.isPaused() ||
        (this.jobs.get(item.id)?.item.canResume() ?? false),
    }))
  }
  private report(job: Job) {
    const record = { ...job.record }
    const filePath = job.item.getSavePath() || undefined
    job.reporting = job.reporting
      .catch(() => {})
      .then(async () => {
        await this.rpc.call('browser/host/download', {
          ...this.host(),
          download: record,
          ...(filePath ? { filePath } : {}),
        })
        this.changed()
      })
      .catch(() => {})
  }
  async action(id: string, command: 'pause' | 'resume' | 'cancel' | 'open' | 'reveal' | 'remove') {
    if (command === 'remove') {
      if (this.jobs.has(id)) throw new Error('请先取消正在进行的下载')
      await this.rpc.call('browser/downloads/remove', { id })
      this.changed()
      return
    }
    if (command === 'open' || command === 'reveal') {
      const records = (await this.rpc.call('browser/downloads/list', {})).downloads
      const record = records.find((item) => item.id === id)
      if (!record || record.state !== 'completed') throw new Error('下载尚未完成')
      const { filePath } = await this.rpc.call('browser/host/download-path', { ...this.host(), id })
      if (!filePath) throw new Error('下载文件不可用')
      try {
        await access(filePath)
      } catch {
        throw new Error('下载文件已移动或删除')
      }
      if (command === 'reveal') shell.showItemInFolder(filePath)
      else if (await shell.openPath(filePath)) throw new Error('无法打开下载文件')
      return
    }
    const job = this.jobs.get(id)
    if (!job) throw new Error('下载任务不在当前桌面实例中')
    if (command === 'cancel') job.item.cancel()
    else if (command === 'pause') {
      job.item.pause()
      job.record = { ...job.record, state: 'paused', updatedAt: Date.now() }
      this.report(job)
    } else if (job.item.isPaused() || job.item.canResume()) {
      job.item.resume()
      job.record = { ...job.record, state: 'progressing', updatedAt: Date.now() }
      this.report(job)
    } else throw new Error('此下载不能继续')
  }
  activeForTab(tabId: string) {
    return [...this.jobs.values()].some((job) => job.record.tabId === tabId)
  }
  dispose() {
    for (const [session, listener] of this.sessions) session.off('will-download', listener)
    for (const job of this.jobs.values()) clearTimeout(job.timer)
    this.sessions.clear()
  }
}
