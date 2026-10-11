import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { SessionGroupService } from '../src/session-group/SessionGroupService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { projectWorkflowEvent } from '../src/transport/Server'
import { sessionGroupHandlers } from '../src/transport/rpc/handlers/SessionGroup'
import { workflowHandlers } from '../src/transport/rpc/handlers/Workflow'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-workflow-compat-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const service = new SessionGroupService(db, await Effect.runPromise(EventHub.make))
  // Both handler groups resolve the same service instance from the router.
  const runtime = {
    dependencies: {
      sessionGroups: service,
      turnPatches: { readDiff: () => ({ files: [] }) },
    },
  }
  return { db, service, runtime }
}

const storedEvent = (method: string, params: Record<string, unknown>) => ({
  id: 1,
  threadId: 'thread:1',
  turnId: null,
  method,
  params,
  createdAt: 1,
})

const changedParams = {
  groupId: 'session-group:1',
  reason: 'updated',
  revision: 2,
  changedAt: 1,
}

describe('workflow event compatibility projection', () => {
  test('canonical 客户端把旧事件投影为 workflow/changed 且不残留 groupId', () => {
    const projected = projectWorkflowEvent(
      storedEvent('session-group/changed', changedParams) as never,
      new Set(['workflow.v1']),
    )
    expect(projected.method).toBe('workflow/changed')
    expect(projected.params).toEqual({
      reason: 'updated',
      revision: 2,
      changedAt: 1,
      workflowId: 'session-group:1',
    })
    // The superseded key must be absent, not present-with-undefined, so a strict
    // exactResult decoder never rejects the payload.
    expect(Object.hasOwn(projected.params as Record<string, unknown>, 'groupId')).toBe(false)
  })

  test('legacy 客户端把新事件投影为 session-group/changed 且不残留 workflowId', () => {
    const projected = projectWorkflowEvent(
      storedEvent('workflow/changed', {
        ...changedParams,
        workflowId: 'session-group:1',
        groupId: undefined,
      }) as never,
      new Set(['session-group.v1']),
    )
    expect(projected.method).toBe('session-group/changed')
    expect(projected.params).toEqual({
      reason: 'updated',
      revision: 2,
      changedAt: 1,
      groupId: 'session-group:1',
    })
    expect(Object.hasOwn(projected.params as Record<string, unknown>, 'workflowId')).toBe(false)
  })

  test('兼容窗口内两侧各只得到一个对应事件，不会重复投影', () => {
    const canonical = projectWorkflowEvent(
      storedEvent('workflow/changed', {
        workflowId: 'session-group:1',
        reason: 'updated',
        revision: 2,
        changedAt: 1,
      }) as never,
      new Set(['workflow.v1', 'session-group.v1']),
    )
    expect(canonical.method).toBe('workflow/changed')

    const legacy = projectWorkflowEvent(
      storedEvent('session-group/changed', changedParams) as never,
      new Set(['session-group.v1']),
    )
    expect(legacy.method).toBe('session-group/changed')

    const neither = projectWorkflowEvent(
      storedEvent('session-group/changed', changedParams) as never,
      new Set(),
    )
    expect(neither.method).toBe('session-group/changed')
  })
})

describe('workflow RPC shares the session group storage', () => {
  test('workflow/* 创建的数据可由 session-group/* 读取，反之亦然', async () => {
    const { runtime } = await fixture()

    const created = (await workflowHandlers.handle(
      runtime as never,
      'workflow/create' as never,
      { name: '登录修复', description: '跨任务排查', operationId: 'operation:wf-create' },
      {} as never,
    )) as { workflow: { id: string; name: string } }
    expect(created.workflow.name).toBe('登录修复')

    const legacyList = (await sessionGroupHandlers.handle(
      runtime as never,
      'session-group/list' as never,
      { query: '登录修复' },
      {} as never,
    )) as { groups: Array<{ id: string; name: string }> }
    expect(legacyList.groups.map((group) => group.id)).toContain(created.workflow.id)

    const legacyCreated = (await sessionGroupHandlers.handle(
      runtime as never,
      'session-group/create' as never,
      { name: '后续修复', operationId: 'operation:sg-create' },
      {} as never,
    )) as { group: { id: string } }
    const canonicalRead = (await workflowHandlers.handle(
      runtime as never,
      'workflow/read' as never,
      { workflowId: legacyCreated.group.id },
      {} as never,
    )) as { workflow: { id: string; name: string } }
    expect(canonicalRead.workflow).toMatchObject({ id: legacyCreated.group.id, name: '后续修复' })
  })

  test('旧库中已有的 SessionGroup 行可直接通过 workflow/* 读取', async () => {
    const { db, runtime } = await fixture()
    // Simulate data written by an older client before the canonical API existed.
    db.sqlite
      .query(
        'INSERT INTO session_groups (id, name, description, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      )
      .run('session-group:legacy', '历史会话组', '旧客户端写入', 1_000, 1_000)

    const read = (await workflowHandlers.handle(
      runtime as never,
      'workflow/read' as never,
      { workflowId: 'session-group:legacy' },
      {} as never,
    )) as { workflow: { id: string; name: string; version: number } }
    expect(read.workflow).toMatchObject({
      id: 'session-group:legacy',
      name: '历史会话组',
      version: 1,
    })

    const list = (await workflowHandlers.handle(
      runtime as never,
      'workflow/list' as never,
      {},
      {} as never,
    )) as { workflows: Array<{ id: string }> }
    expect(list.workflows.map((workflow) => workflow.id)).toContain('session-group:legacy')
  })

  test('membership 结果按客户端代际使用对应字段名', async () => {
    const { db, runtime } = await fixture()
    const thread = db.createThread('工作流线程')
    const created = (await workflowHandlers.handle(
      runtime as never,
      'workflow/create' as never,
      { name: '成员组', operationId: 'operation:wf-membership' },
      {} as never,
    )) as { workflow: { id: string } }

    const canonical = (await workflowHandlers.handle(
      runtime as never,
      'workflow/membership/set' as never,
      {
        threadId: thread.id,
        workflowId: created.workflow.id,
        operationId: 'operation:wf-membership-set',
      },
      {} as never,
    )) as { membership: Record<string, unknown> }
    expect(canonical.membership).toMatchObject({
      workflowId: created.workflow.id,
      threadId: thread.id,
    })
    expect(Object.hasOwn(canonical.membership, 'groupId')).toBe(false)

    const legacy = (await sessionGroupHandlers.handle(
      runtime as never,
      'session-group/membership/set' as never,
      {
        threadId: thread.id,
        groupId: created.workflow.id,
        operationId: 'operation:sg-membership-set',
      },
      {} as never,
    )) as { membership: Record<string, unknown> }
    expect(legacy.membership).toMatchObject({ groupId: created.workflow.id, threadId: thread.id })
    expect(Object.hasOwn(legacy.membership, 'workflowId')).toBe(false)
  })
})
