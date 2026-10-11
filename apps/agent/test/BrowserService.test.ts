import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Effect } from 'effect'
import { BrowserService, browserUrl } from '../src/browser/BrowserService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import type { ConfigService, ConfigEdit } from '../src/config/ConfigService'
import { initializeSchema } from '../src/storage/database/SchemaInitializer'
import { SCHEMA_VERSION } from '../src/storage/database/Schema'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { browserToolDefinitions } from '../src/tool/Browser/Definition'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { removeFixturePaths } from './FixtureCleanup'
const paths: string[] = []
const cleanups: Array<() => void> = []
afterEach(async () => {
  cleanups.splice(0).forEach((fn) => fn())
  await removeFixturePaths(paths.splice(0))
}, 30_000)
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cpx-browser-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'history.sqlite'))
  const configuration: Record<string, any> = {
    desktop: { browserSitePermissions: [], browserAllowedSites: [], unknown: 'keep' },
  }
  const config = {
    snapshot: () => configuration,
    read: async () => ({
      config: configuration,
      layers: [{ kind: 'user', version: 'test', config: configuration }],
    }),
    batchWrite: async ({ edits }: { edits: ConfigEdit[] }) => {
      for (const edit of edits) configuration.desktop[edit.keyPath[1]!] = edit.value
    },
  } as unknown as ConfigService
  const hub = await Effect.runPromise(EventHub.make)
  const browser = new BrowserService(db, hub, config)
  cleanups.push(() => {
    browser.dispose()
    db.close()
  })
  await browser.register('window:test', 'host:test', 'connection:test')
  return { db, config, browser, configuration, hub, root }
}
describe('BrowserService', () => {
  test('单次操作只携带临时 origin；全站授权仍优先拒绝明确站点且可撤销', async () => {
    const { db, browser, configuration } = await fixture()
    const thread = db.createThread('临时授权')
    const tab = await browser.create({ sourceThreadId: thread.id, url: 'https://once.test/' })
    await browser.takeover(thread.id, tab.tabId)
    const result = browser.execute(
      thread.id,
      tab.tabId,
      { action: 'snapshot' },
      new AbortController().signal,
    )
    let next = await browser.next('window:test', 'host:test', 'connection:test')
    while (!next.command) next = await browser.next('window:test', 'host:test', 'connection:test')
    expect(next.command!.allowedOrigins).toContain('https://once.test')
    expect(next.command!.allowAllSites).toBe(false)
    expect(browser.permissions()).toEqual([])
    browser.complete(
      'window:test',
      'host:test',
      next.command!.requestId,
      next.command!.generation,
      { text: '完成' },
    )
    await result
    expect(configuration.desktop.browserSitePermissions).toEqual([])
    expect(browser.inspect(thread.id, tab.tabId, { action: 'snapshot' }).ruleRequiresApproval).toBe(
      true,
    )
    await browser.grant('https://once.test', 'all-sites')
    expect(browser.isGranted(thread.id, 'https://other.test')).toBe(true)
    await browser.setPermission('https://blocked.test', 'deny')
    expect(browser.isGranted(thread.id, 'https://blocked.test')).toBe(false)
    expect(() =>
      browser.inspect(thread.id, tab.tabId, { action: 'navigate', url: 'https://blocked.test/' }),
    ).toThrow('拒绝')
    await browser.setPermission(undefined, 'clear')
    expect(browser.allowsAllSites()).toBe(false)
    expect(configuration.desktop.unknown).toBe('keep')
  })
  test('browser tools use host inspection identity and origin policy; screenshot audit omits base64', async () => {
    const { db, browser, root } = await fixture()
    const thread = db.createThread('工具')
    const tools = new ToolRegistry()
    for (const definition of browserToolDefinitions(browser)) tools.register(definition)
    const audit: unknown[] = []
    const executor = new ToolExecutor(tools, {
      dataDir: root,
      authorizeShell: async () => ({ decision: 'deny', risk: 'high', reason: 'fixture' }),
      recordToolCall: (_invocation, phase, result) => {
        if (phase === 'completed') audit.push(result)
      },
    })
    const context = {
      threadID: thread.id,
      turnID: 'turn:test',
      taskMode: 'chat' as const,
      workspace: await WorkspaceService.open(root),
      signal: new AbortController().signal,
      permissionConfig: {
        sandboxMode: 'workspace-write' as const,
        approvalPolicy: 'never' as const,
        approvalsReviewer: 'user' as const,
      },
    }
    const tab = await browser.create({ sourceThreadId: null })
    expect(await executor.execute('BrowserTabs', { action: 'list' }, context)).toHaveLength(1)
    await expect(
      executor.execute('BrowserTabs', { action: 'takeover', tabId: tab.tabId }, context),
    ).resolves.toMatchObject({ controlThreadId: thread.id })
    const otherThread = db.createThread('其他聊天')
    await expect(
      executor.execute(
        'BrowserTabs',
        { action: 'takeover', tabId: tab.tabId },
        {
          ...context,
          threadID: otherThread.id,
        },
      ),
    ).rejects.toThrow('其他聊天')
    await expect(
      executor.execute(
        'BrowserTabs',
        { action: 'takeover', tabId: tab.tabId },
        {
          ...context,
          taskMode: 'plan',
        },
      ),
    ).rejects.toThrow('Plan 模式')
    await expect(
      executor.execute(
        'BrowserNavigate',
        { tabId: tab.tabId, operation: { action: 'navigate', url: 'https://example.test/' } },
        context,
      ),
    ).rejects.toThrow()
    expect(browser.permissions()).toEqual([])
    const result = executor.execute(
      'BrowserRead',
      { tabId: tab.tabId, operation: { action: 'screenshot' } },
      context,
    )
    const settled = result.then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    let next = await browser.next('window:test', 'host:test', 'connection:test')
    while (!next.command) next = await browser.next('window:test', 'host:test', 'connection:test')
    browser.complete('window:test', 'host:test', next.command.requestId, next.command.generation, {
      text: '截图',
      image: { mimeType: 'image/png', data: 'browser-image-fixture' },
    })
    expect(await settled).toMatchObject({
      value: { text: '截图', image: { data: 'browser-image-fixture' } },
    })
    expect(JSON.stringify(audit)).not.toContain('browser-image-fixture')
    expect(audit.at(-1)).toEqual({ text: '截图' })
    const controlled = browser.require(tab.tabId)
    expect(
      await executor.execute('BrowserTabs', { action: 'takeover', tabId: tab.tabId }, context),
    ).toMatchObject({ revision: controlled.revision })
    await browser.report('window:test', 'host:test', tab.tabId, controlled.generation, {
      url: 'https://denied.test/',
    })
    await browser.setPermission('https://denied.test', 'deny')
    await expect(
      executor.execute('BrowserTabs', { action: 'release', tabId: tab.tabId }, context),
    ).resolves.toMatchObject({ controlThreadId: null })
  })
  test('conversation takeover retains site authorization and unrelated config', async () => {
    const { db, browser, configuration } = await fixture()
    const thread = db.createThread('浏览器测试')
    const tab = await browser.create({ sourceThreadId: thread.id, url: 'https://example.test/' })
    expect(() => browser.inspect(thread.id, tab.tabId, { action: 'snapshot' })).toThrow(
      'BrowserTabs takeover',
    )
    await browser.takeover(thread.id, tab.tabId)
    expect(browser.inspect(thread.id, tab.tabId, { action: 'snapshot' }).ruleRequiresApproval).toBe(
      true,
    )
    await browser.setPermission('https://example.test', 'allow')
    expect(browser.inspect(thread.id, tab.tabId, { action: 'snapshot' }).ruleRequiresApproval).toBe(
      false,
    )
    expect(configuration.desktop.unknown).toBe('keep')
    await browser.setPermission('https://example.test', 'deny')
    expect(() => browser.inspect(thread.id, tab.tabId, { action: 'snapshot' })).toThrow('拒绝')
    configuration.desktop.browserAllowedSites.push('https://example.test/legacy-path')
    await browser.setPermission('https://example.test', 'remove')
    expect(browser.inspect(thread.id, tab.tabId, { action: 'snapshot' }).ruleRequiresApproval).toBe(
      true,
    )
  })
  test('dispatch binds generation; takeover cancels the operation and a late completion cannot revive it', async () => {
    const { db, browser } = await fixture()
    const thread = db.createThread('操作')
    const tab = await browser.create({ sourceThreadId: thread.id }, true)
    const operation = browser.execute(
      thread.id,
      tab.tabId,
      { action: 'snapshot' },
      new AbortController().signal,
    )
    const rejected = operation.catch((error) => error as Error)
    let next = await browser.next('window:test', 'host:test', 'connection:test')
    while (!next.command) next = await browser.next('window:test', 'host:test', 'connection:test')
    expect(next.command?.tabId).toBe(tab.tabId)
    expect(next.command?.generation).not.toBe(tab.generation)
    await browser.control(tab.tabId, null)
    const rejection = await rejected
    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).message).toContain('交接或关闭')
    browser.complete(
      'window:test',
      'host:test',
      next.command!.requestId,
      next.command!.generation,
      { text: 'late' },
    )
    expect(browser.require(tab.tabId)).toMatchObject({ controlThreadId: null, busy: false })
    expect(() => browser.host('window:test', 'old-host', 'connection:test')).toThrow('已失效')
    const generation = browser.require(tab.tabId).generation
    await browser.register('window:test', 'host:reloaded', 'connection:test')
    expect(browser.require(tab.tabId).state).toBe('suspended')
    expect(browser.require(tab.tabId).generation).not.toBe(generation)
    await expect(
      browser.report('window:test', 'host:reloaded', tab.tabId, generation, { title: 'stale' }),
    ).rejects.toThrow('已失效')
  })
  test('navigation and restore retain histories and unknown fields, without raw pageState', async () => {
    const { db, browser } = await fixture()
    const tab = await browser.create({ sourceThreadId: null })
    const row = db.sqlite.query('SELECT record FROM browser_tabs WHERE id = ?').get(tab.tabId) as {
      record: string
    }
    db.sqlite
      .query('UPDATE browser_tabs SET record = ? WHERE id = ?')
      .run(JSON.stringify({ ...JSON.parse(row.record), future: 'preserved' }), tab.tabId)
    await browser.report('window:test', 'host:test', tab.tabId, tab.generation, {
      history: [{ url: 'https://example.test/', title: 'example', pageState: 'do not store' }],
      historyIndex: 0,
    })
    const restored = await browser.restore('window:test', 'host:test', tab.tabId, tab.generation)
    expect(restored.history).toEqual([{ url: 'https://example.test/', title: 'example' }])
    expect(restored.generation).not.toBe(tab.generation)
    const saved = JSON.parse(
      (
        db.sqlite.query('SELECT record FROM browser_tabs WHERE id = ?').get(tab.tabId) as {
          record: string
        }
      ).record,
    )
    expect(saved.future).toBe('preserved')
    expect(JSON.stringify(saved)).not.toContain('pageState')
    await expect(
      browser.report('window:test', 'host:test', tab.tabId, tab.generation, { title: 'stale' }),
    ).rejects.toThrow('已失效')
    expect(
      db.sqlite.query("SELECT COUNT(*) AS n FROM events WHERE method = 'browser/changed'").get(),
    ).toMatchObject({ n: 3 })
  })
  test('forward migration adds only browser storage and a future user_version is preserved', async () => {
    const { db } = await fixture()
    const thread = db.createThread('保留聊天')
    db.sqlite.exec('DROP TABLE browser_tabs; PRAGMA user_version = 50')
    initializeSchema(db.sqlite)
    expect(db.getThread(thread.id)).not.toBeNull()
    expect(db.sqlite.query('PRAGMA user_version').get()).toMatchObject({
      user_version: SCHEMA_VERSION,
    })
    db.sqlite.exec(
      "ALTER TABLE browser_tabs ADD COLUMN future_note TEXT; INSERT INTO browser_tabs (id, record, future_note) VALUES ('future:tab', '{}', 'keep'); PRAGMA user_version = 50",
    )
    initializeSchema(db.sqlite)
    expect(db.sqlite.query('PRAGMA user_version').get()).toMatchObject({
      user_version: SCHEMA_VERSION,
    })
    expect(db.sqlite.query("SELECT * FROM browser_tabs WHERE id = 'future:tab'").get()).toEqual({
      id: 'future:tab',
      record: '{}',
      future_note: 'keep',
    })
    db.sqlite.exec('PRAGMA user_version = 72; CREATE TABLE future_browser_data (id TEXT)')
    initializeSchema(db.sqlite)
    expect(db.sqlite.query('PRAGMA user_version').get()).toMatchObject({ user_version: 72 })
    expect(
      db.sqlite.query("SELECT name FROM sqlite_master WHERE name = 'future_browser_data'").get(),
    ).not.toBeNull()
  })
  test('host and URL policy reject stale authority and unsafe navigation', async () => {
    const { browser } = await fixture()
    expect(() => browser.host('window:test', 'host:test', 'foreign')).toThrow('已失效')
    expect(browserUrl('localhost:3000')).toBe('http://localhost:3000/')
    for (const value of [
      'file:///C:/private',
      'javascript:alert(1)',
      'https://user:password@example.test/',
    ])
      expect(() => browserUrl(value)).toThrow()
  })
  test('global visits deduplicate title reports, paginate tied dates, and cannot reappear after clearing', async () => {
    const { browser, db } = await fixture()
    const tab = await browser.create({ sourceThreadId: null, url: 'https://example.test/' })
    const visit = {
      id: 'visit:a',
      tabId: tab.tabId,
      sourceThreadId: null,
      url: tab.url,
      title: 'first',
      visitedAt: 10,
    }
    const report = (value: typeof visit, epoch = 0, updateOnly = false) =>
      browser.recordVisit('window:test', 'host:test', tab.generation, epoch, value, updateOnly)
    await report(visit)
    await report({ ...visit, title: 'updated' }, 0, true)
    await report({ ...visit, id: 'visit:b', title: 'second' })
    await report({ ...visit, id: 'visit:c', visitedAt: 20, title: 'latest' })
    const first = browser.data.history('', undefined, 2)
    expect(first.visits.map((v) => v.id)).toEqual(['visit:c', 'visit:b'])
    expect(browser.data.history('', first.nextCursor!, 2).visits.map((v) => v.id)).toEqual([
      'visit:a',
    ])
    expect(browser.data.history('updated').visits).toHaveLength(1)
    expect(browser.data.history('%').visits).toHaveLength(0)
    await browser.removeHistory(visit.id)
    await report(visit, 0, true)
    expect(browser.data.history('updated').visits).toHaveLength(0)
    await browser.report('window:test', 'host:test', tab.tabId, tab.generation, {
      history: [
        { url: 'https://example.test/old', title: 'old' },
        { url: tab.url, title: 'current' },
      ],
      historyIndex: 1,
    })
    await browser.removeHistory()
    await report({ ...visit, id: 'visit:late' })
    await browser.report('window:test', 'host:test', tab.tabId, tab.generation, {
      historyEpoch: 0,
      history: [{ url: 'https://example.test/old', title: 'old' }],
      historyIndex: 0,
      canGoBack: true,
    })
    expect(browser.data.history().visits).toEqual([])
    expect(browser.list()[0]).toMatchObject({
      historyEpoch: 1,
      canGoBack: false,
      history: [{ url: tab.url, title: tab.title }],
    })
    await report({ ...visit, id: 'visit:new' }, 1)
    expect(browser.data.history().visits.map((v) => v.id)).toEqual(['visit:new'])
    expect(
      db.sqlite
        .query("SELECT COUNT(*) AS n FROM events WHERE method = 'browser/dataChanged'")
        .get(),
    ).toMatchObject({ n: 8 })
    await browser.register('window:other', 'host:other', 'connection:other')
    await expect(
      browser.recordVisit('window:other', 'host:other', tab.generation, 1, visit),
    ).rejects.toThrow('已失效')
    await expect(
      browser.recordVisit('window:test', 'host:test', 'stale', 1, visit),
    ).rejects.toThrow('已失效')
  })
  test('download recovery is profile-scoped, preserves paths, and removal touches only terminal records', async () => {
    const { browser, configuration } = await fixture()
    const record = {
      id: 'download:a',
      tabId: 'tab:a',
      profileId: 'profile:a',
      runId: 'run:old',
      fileName: 'file.txt',
      url: 'https://example.test/file',
      state: 'progressing' as const,
      receivedBytes: 10,
      totalBytes: 100,
      startedAt: 1,
      updatedAt: 1,
      resumable: true,
    }
    await browser.data.download(record, 'fixture-download.txt')
    await browser.data.download({ ...record, id: 'download:b', profileId: 'profile:b' })
    await browser.data.download({ ...record, id: 'download:c', runId: 'run:current' })
    await browser.data.change('downloads', () =>
      browser.data.repository.recoverDownloads('profile:a', 'run:current'),
    )
    expect(browser.data.downloads().find((v) => v.id === record.id)).toMatchObject({
      state: 'interrupted',
      resumable: false,
    })
    expect(browser.data.path(record.id)).toBe('fixture-download.txt')
    expect(browser.data.downloads().some((v) => 'filePath' in v)).toBe(false)
    await browser.data.change('downloads', () => browser.data.repository.removeDownloads())
    expect(
      browser.data
        .downloads()
        .map((v) => v.id)
        .sort(),
    ).toEqual(['download:b', 'download:c'])
    expect(browser.data.history().visits).toEqual([])
    expect(browser.preferences()).toEqual({ downloadSaveMode: 'downloads' })
    await browser.setPreferences('ask')
    expect(configuration.desktop).toMatchObject({ unknown: 'keep', browserDownloadSaveMode: 'ask' })
  })
  test('51→52 migration preserves unknown browser data; missing tables at a future version disable only management', async () => {
    const { db, browser } = await fixture()
    const tab = await browser.create({ sourceThreadId: null })
    db.sqlite.exec(
      "ALTER TABLE browser_tabs ADD COLUMN future_flag TEXT; UPDATE browser_tabs SET future_flag='keep'; DROP TABLE browser_visits; DROP TABLE browser_downloads; PRAGMA user_version=51",
    )
    initializeSchema(db.sqlite)
    expect(browser.data.repository.available()).toBe(true)
    expect(
      db.sqlite.query('SELECT future_flag FROM browser_tabs WHERE id=?').get(tab.tabId),
    ).toEqual({ future_flag: 'keep' })
    expect(db.sqlite.query('PRAGMA user_version').get()).toMatchObject({
      user_version: SCHEMA_VERSION,
    })
    db.sqlite.exec('DROP TABLE browser_downloads; PRAGMA user_version=72')
    initializeSchema(db.sqlite)
    expect(browser.available()).toBe(true)
    expect(browser.data.repository.available()).toBe(false)
    expect(() => browser.data.downloads()).toThrow('不可用')
    expect(db.sqlite.query('PRAGMA user_version').get()).toMatchObject({ user_version: 72 })
  })
  test('device and page zoom survive guest generation changes', async () => {
    const { browser } = await fixture()
    const tab = await browser.create({ sourceThreadId: null })
    const device = { mode: 'mobile', width: 390, height: 844 }
    await browser.report('window:test', 'host:test', tab.tabId, tab.generation, {
      device,
      viewport: { width: 390, height: 844 },
      zoomFactor: 1.25,
    })
    const restored = await browser.restore('window:test', 'host:test', tab.tabId, tab.generation)
    expect(restored).toMatchObject({
      device,
      viewport: { width: 390, height: 844 },
      zoomFactor: 1.25,
    })
    expect(restored.generation).not.toBe(tab.generation)
  })
})
