import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import {
  PR_WATCH_SCHEMA,
  PullRequestWatchService,
  watchIdentity,
  watchReady,
} from '../src/github/PullRequestWatchService'
import type { GithubService } from '../src/github/GithubService'
import { AgentError } from '../src/Domain'
import { PermissionDecisionEngine } from '../src/permission/PermissionDecisionEngine'
import {
  AUTOMATION_HOST_AUDIT_SCHEMA,
  AutomationHostAuditRepository,
} from '../src/automation/AutomationHostAuditRepository'

const databases: Database[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
const fixture = () => {
  const sqlite = new Database(':memory:')
  databases.push(sqlite)
  sqlite.exec(PR_WATCH_SCHEMA.join(';'))
  const url = 'https://github.com/owner/repository/pull/1'
  const id = `pr-watch:${createHash('sha256')
    .update(JSON.stringify(['project', url]))
    .digest('hex')}`
  sqlite
    .query(
      'INSERT INTO pr_watches (id,project_id,pr_url,automation_id,thread_id,worktree_id) VALUES (?,?,?,?,?,?)',
    )
    .run(id, 'project', url, 'automation', 'thread', 'worktree')
  let pr = {
    id: 'pr',
    state: 'OPEN',
    isDraft: false,
    headRefOid: 'a'.repeat(40),
    headRefName: 'feature',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    headRepository: { name: 'repository', owner: { login: 'owner' } },
    statusCheckRollup: { state: 'SUCCESS' },
    reviews: { nodes: [] },
  } as Awaited<ReturnType<GithubService['readWatch']>>
  let repairs = 0,
    writes = 0,
    paused = 0,
    denied = false
  const work = {
    kind: 'thread',
    projectId: null,
    execution: null,
    targetThreadId: 'thread',
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
    },
  }
  const automation = { ...work, id: 'automation', status: 'active', revision: 1 }
  const dependencies = {
    sqlite,
    github: { readWatch: async () => pr, readWatchChecks: async () => ({ checks: [] }) },
    automation: {
      read: () => automation,
      pause: async () => {
        paused++
        automation.status = 'paused'
      },
    },
    repository: { readRun: () => ({ automationId: 'automation' }), bindExecution: () => ({}) },
    executor: {
      start: async () => {
        repairs++
        return { threadId: 'thread', turnId: 'turn' }
      },
    },
    preferences: () => ({ autoMerge: false, instructions: '', mergeMethod: 'merge' }),
    execute: async () => {
      if (denied) throw new AgentError('TOOL_PERMISSION_DENIED', '拒绝', 403)
      writes++
    },
  }
  const service = () => new PullRequestWatchService(dependencies as never)
  return {
    id,
    sqlite,
    dependencies,
    work,
    service,
    pr: () => pr,
    set: (value: Partial<typeof pr>) => {
      pr = { ...pr, ...value }
    },
    deny: () => {
      denied = true
    },
    counts: () => ({ repairs, writes, paused }),
  }
}

test('同项目 PR 去重；无变化不调用模型；持久指纹在重启后继续生效', async () => {
  const value = fixture()
  const first = value.service()
  expect(
    (
      await first.start({
        projectId: 'project',
        url:
          value.pr().headRefName === 'feature' ? 'https://github.com/owner/repository/pull/1/' : '',
        model: {} as never,
        permissionConfig: {} as never,
      })
    ).id,
  ).toBe(value.id)
  await first.run(value.work as never, { id: 'run' })
  expect(value.counts().repairs).toBe(0)
  value.set({ statusCheckRollup: { state: 'FAILURE' }, mergeStateStatus: 'UNSTABLE' })
  await first.run(value.work as never, { id: 'run2' })
  expect(value.counts().repairs).toBe(1)
  await value.service().run(value.work as never, { id: 'run3' })
  expect(value.counts().repairs).toBe(1)
  value.set({ headRefOid: 'b'.repeat(40) })
  await value.service().run(value.work as never, { id: 'run4' })
  expect(value.counts().repairs).toBe(2)
})

test('SHA、草稿、CI 与审查门槛阻止不满足条件的自动合并', () => {
  const value = fixture()
  expect(watchReady(value.pr(), 'a'.repeat(40))).toBe(true)
  expect(watchReady(value.pr(), 'b'.repeat(40))).toBe(false)
  for (const patch of [
    { isDraft: true },
    { mergeable: 'CONFLICTING' },
    { mergeStateStatus: 'BLOCKED' },
    { reviewDecision: 'CHANGES_REQUESTED' },
    { statusCheckRollup: { state: 'PENDING' } },
  ])
    expect(watchReady({ ...value.pr(), ...patch }, 'a'.repeat(40))).toBe(false)
  expect(() => watchIdentity('https://github.com.attacker.test/owner/repository/pull/1')).toThrow()
})

test('最终判权拒绝时监控暂停，不启动修复；内部工具也受只读与 Plan 上限约束', async () => {
  const value = fixture()
  value.set({ statusCheckRollup: { state: 'FAILURE' } })
  value.deny()
  await expect(value.service().run(value.work as never, { id: 'run' })).rejects.toMatchObject({
    code: 'PR_WATCH_PAUSED',
  })
  expect(value.counts()).toEqual({ repairs: 0, writes: 0, paused: 1 })
  expect(value.service().read(value.id).reason).toContain('TOOL_PERMISSION_DENIED')
  const definition = value
    .service()
    .definitions()
    .find((definition) => definition.sdkName === 'pr_watch_sync')!
  const engine = new PermissionDecisionEngine()
  const invocation = {
    id: 'tool',
    threadID: 'thread',
    turnID: 'turn',
    agentID: 'main',
    name: definition.sdkName,
    input: {},
    taskMode: 'chat',
    model: {},
    permissionConfig: {
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
    },
  }
  expect(engine.evaluate(invocation as never, definition).decision).toBe('deny')
  expect(engine.evaluate({ ...invocation, taskMode: 'plan' } as never, definition).decision).toBe(
    'deny',
  )
})
test('宿主工具审计保留完成缓存和变更证据，拒绝无运行绑定并去除敏感输出', () => {
  const value = fixture()
  value.sqlite.exec(
    'CREATE TABLE automation_runs (id TEXT PRIMARY KEY, automation_id TEXT, status TEXT); CREATE TABLE threads (id TEXT PRIMARY KEY)',
  )
  value.sqlite.exec(AUTOMATION_HOST_AUDIT_SCHEMA.join(';'))
  value.sqlite
    .query('INSERT INTO automation_runs VALUES (?,?,?)')
    .run('run', 'automation', 'preparing')
  const audit = new AutomationHostAuditRepository(value.sqlite)
  const invocation = {
    id: 'tool-call',
    threadID: 'thread',
    turnID: 'automation-host:run',
    name: 'pr_watch_sync',
    input: { watchId: value.id },
    permissionConfig: value.work.permissionConfig,
    taskMode: 'chat',
    agentID: 'main',
    model: {},
  } as never
  audit.record(invocation, 'running', null, null, 1)
  audit.record(
    invocation,
    'completed',
    { accessToken: 'sensitive-value', completed: true },
    null,
    1,
  )
  expect(audit.completed('tool-call')!.output).toEqual({
    accessToken: '<redacted>',
    completed: true,
  })
  audit.recordMutation({
    threadID: 'thread',
    turnID: 'automation-host:run',
    agentID: 'main',
    toolCallID: 'tool-call',
    files: [],
  })
  audit.discardMutationEvidence('automation-host:run')
  expect(
    value.sqlite.query('SELECT evidence,evidence_complete FROM automation_host_tool_calls').get(),
  ).toMatchObject({ evidence_complete: 0 })
  expect(() =>
    audit.record(
      { ...(invocation as object), threadID: 'wrong-thread' } as never,
      'running',
      null,
      null,
      1,
    ),
  ).toThrow()
})
