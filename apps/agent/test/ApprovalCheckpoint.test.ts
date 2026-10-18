import { afterEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { Schema } from 'effect'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { Model, Provider } from '@pidex/model-schema'
import { EventManifest } from '@pidex/agent-protocol'
import { removeFixturePaths } from './FixtureCleanup'
import type { ToolInvocation } from '../src/Domain'
import { ApprovalService } from '../src/permission/ApprovalService'
import { PermissionDecisionEngine } from '../src/permission/PermissionDecisionEngine'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { recoverInterruptedRuns } from '../src/storage/recovery/InterruptedRunRecovery'
import { EventHub } from '../src/storage/events/EventHub'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { pausedSubagentStatus } from '../src/subagent/SubagentService'
import { InteractionService } from '../src/interaction/InteractionService'
import {
  ApprovalRules,
  simpleCommandArgv,
  commandPrefixMatches,
} from '../src/permission/ApprovalRules'
import { ConfigService } from '../src/config/ConfigService'
import { McpElicitationService } from '../src/mcp/McpElicitationService'
import { filterAdvertisedCapabilities } from '../src/transport/rpc/handlers/SystemCapabilities'

const paths: string[] = []
const databases: AgentDatabase[] = []
const configs: ConfigService[] = []
afterEach(async () => {
  for (const config of configs.splice(0)) await config.dispose()
  for (const database of databases.splice(0)) database.close()
  await removeFixturePaths(paths.splice(0))
}, 30_000)

const setup = (db: AgentDatabase, projectID?: string) => {
  const thread = db.createThread('审批', projectID)
  const input = {
    content: '执行命令',
    model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'untrusted',
      approvalsReviewer: 'user',
    },
    strategy: 'queue',
    taskMode: 'chat',
  } as const
  const turn = db.createTurn(thread.id, input)
  db.claimTurnExecution(turn.turnID)
  return { thread, turn, input }
}

async function scopedFixture() {
  const root = await mkdtemp(join(tmpdir(), 'cpx-scoped-approval-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'history.sqlite'))
  databases.push(db)
  const workspace = join(root, 'workspace')
  await mkdir(join(workspace, '.pidex'), { recursive: true })
  const projectFile = join(workspace, '.pidex', 'config.json')
  await writeFile(projectFile, '{ "future_key": { "keep": true } }\n', 'utf8')
  const config = new ConfigService(join(root, 'config.json'))
  configs.push(config)
  await config.initialize()
  await config.trustUpdate(workspace, 'trusted')
  const project = db.createProject({ rootPath: workspace })
  const { thread, turn, input } = setup(db, project.id)
  const hub = await Effect.runPromise(EventHub.make)
  const tools = new ToolRegistry()
  const invocation: ToolInvocation = {
    id: crypto.randomUUID(),
    threadID: thread.id,
    turnID: turn.turnID,
    agentID: turn.agentID,
    name: 'PowerShell',
    input: { command: 'git status', cwd: workspace },
    permissionConfig: input.permissionConfig,
    model: input.model,
    taskMode: 'chat',
    durableApproval: true,
  }
  return { db, hub, tools, config, project, projectFile, workspace, thread, turn, invocation }
}

describe('审批范围与外部交互', () => {
  test('持久规则保存失败仍恢复单次允许，不留下聊天白名单', async () => {
    const { db, hub, tools, config, invocation } = await scopedFixture()
    const service = new ApprovalService(db, hub, tools, null, config)
    const mcp: ToolInvocation = {
      ...invocation,
      name: 'mcp_tool',
      input: { value: 'data' },
      toolPolicy: {
        sdkName: 'mcp_tool',
        capabilities: tools.get('PowerShell').capabilities,
        allowedModes: ['chat'],
        approvalStrategy: 'always-review',
        origin: { kind: 'mcp', serverName: 'fixture', rawToolName: 'save', generation: 1 },
      },
    }
    await service.authorize(mcp, new AbortController().signal)
    await service.attachRunState(mcp.id, '{"version":1}', { name: mcp.name, callId: mcp.id })
    const checkpoint = db.approvalCheckpointForToolCall(mcp.id)!
    const option = service.rules.options(mcp).find((value) => value.scope === 'project')!
    service.rules.persistProject = async () => {
      throw new Error('fixture settings failure')
    }
    await service.respond(
      checkpoint.approvalID,
      'allow',
      undefined,
      undefined,
      undefined,
      option.id,
    )
    expect(db.getApprovalCheckpoint(checkpoint.approvalID)?.status).toBe('resolved')
    expect(await service.rules.matches(mcp)).toBe(false)
    expect(db.getItem(`approval-grant-error:${checkpoint.approvalID}`)?.data.title).toBe(
      '持久授权未保存',
    )
  })

  test('命令前缀按 argv 边界匹配，复杂 Shell 和脚本不提供候选', () => {
    expect(simpleCommandArgv('git status --short')).toEqual(['git', 'status', '--short'])
    expect(simpleCommandArgv('git "status" --short')).toEqual(['git', 'status', '--short'])
    expect(simpleCommandArgv('git "status"foo')).toBeNull()
    expect(simpleCommandArgv('git status"foo"')).toBeNull()
    expect(commandPrefixMatches(['git', 'status'], ['git', 'status-all'])).toBe(false)
    expect(commandPrefixMatches(['git', 'status'], ['git', 'status', '--short'])).toBe(true)
    for (const command of [
      'git status; git clean',
      'git status | cat',
      'git status > result',
      'git status $(pwd)',
      'git status %PATH%',
      'bun run build',
      'bun script.ts',
      'npm test',
      'yarn custom-script',
      'git custom-alias',
      'powershell -File script.ps1',
    ])
      expect(simpleCommandArgv(command)).toBeNull()
  })

  test('聊天命令授权可恢复且隔离 cwd、聊天、额外范围和硬拒绝', async () => {
    const { db, hub, tools, config, project, invocation, workspace } = await scopedFixture()
    const service = new ApprovalService(db, hub, tools, null, config)
    expect((await service.authorize(invocation, new AbortController().signal)).decision).toBe('ask')
    await service.attachRunState(invocation.id, '{"version":1}', {
      name: invocation.name,
      callId: invocation.id,
    })
    const stored = db.approvalCheckpointForToolCall(invocation.id)!
    const grant = service.rules.options(invocation)[0]!
    await service.respond(stored.approvalID, 'allow', undefined, undefined, undefined, grant.id)
    const recovered = new ApprovalService(db, hub, tools, null, config)
    expect(
      (
        await recovered.authorize(
          { ...invocation, id: 'next', input: { command: 'git status --short', cwd: workspace } },
          new AbortController().signal,
        )
      ).decision,
    ).toBe('allow')
    for (const changed of [
      { ...invocation, input: { command: 'git status-all', cwd: workspace } },
      { ...invocation, input: { command: 'git status', cwd: join(workspace, 'other') } },
      { ...invocation, threadID: db.createThread('另一聊天', project.id).id },
      { ...invocation, grantsForbidden: true },
      {
        ...invocation,
        input: { command: 'git status', additionalPermissions: { readPaths: ['C:/secret'] } },
      },
    ])
      expect(await recovered.rules.matches(changed)).toBe(false)
    await expect(
      service.respond(stored.approvalID, 'allow', undefined, undefined, undefined, grant.id),
    ).rejects.toThrow('已经处理')
  })

  test('项目 MCP 规则仅匹配特定 server/tool，撤销保留未知配置', async () => {
    const { db, config, tools, project, projectFile, invocation } = await scopedFixture()
    const rules = new ApprovalRules(db, tools, config)
    const mcp = {
      ...invocation,
      name: 'mcp_tool',
      input: { value: 'data' },
      toolPolicy: {
        ...tools.get('PowerShell'),
        origin: { kind: 'mcp' as const, serverName: 'fixture', rawToolName: 'save', generation: 1 },
      },
    }
    const grant = rules.candidates(mcp).find((rule) => rule.scope === 'project')!
    const futureRule = { id: grant.id, kind: 'future', target: ['keep'], scope: 'project' }
    await config.batchWrite({
      cwd: grant.workspace,
      target: { kind: 'project' },
      edits: [{ keyPath: ['approval_rules'], value: [futureRule] }],
    })
    await rules.persistProject(grant)
    expect(
      await rules.matches({ ...mcp, threadID: db.createThread('同一项目', project.id).id }),
    ).toBe(true)
    expect(
      await rules.matches({
        ...mcp,
        toolPolicy: {
          ...mcp.toolPolicy,
          origin: { ...mcp.toolPolicy.origin, rawToolName: 'delete' },
        },
      }),
    ).toBe(false)
    expect(await rules.matches({ ...mcp, threadID: db.createThread('无项目').id })).toBe(false)
    expect(await rules.list(mcp.threadID)).toEqual({
      rules: [
        {
          id: grant.id,
          effect: 'allow',
          scope: 'project',
          source: 'legacy',
          match: { kind: 'mcp', server: 'fixture', tool: 'save' },
          editable: true,
        },
      ],
    })
    expect(await rules.revoke(mcp.threadID, grant.id)).toEqual({ revoked: true })
    expect(await rules.matches(mcp)).toBe(false)
    expect(JSON.parse(await readFile(projectFile, 'utf8')).future_key).toEqual({ keep: true })
    expect(JSON.parse(await readFile(projectFile, 'utf8')).approval_rules).toEqual([futureRule])
  })

  test('网络精确域名规则不隐式批准命令前缀、不跨项目、不匹配子域名', async () => {
    const { db, config, tools, invocation, workspace } = await scopedFixture()
    const rules = new ApprovalRules(db, tools, config)
    const network = {
      ...invocation,
      input: {
        command: 'git fetch',
        cwd: workspace,
        additionalPermissions: { networkDomains: ['example.test'] },
      },
    }
    const grants = rules.candidates(network)
    await rules.persistProject(
      grants.find((rule) => rule.kind === 'network' && rule.scope === 'project')!,
    )
    expect(await rules.matches(network)).toBe(false)
    expect(
      await rules.matches({
        ...network,
        permissionConfig: { ...network.permissionConfig, approvalPolicy: 'on-request' },
      }),
    ).toBe(true)
    expect(
      await rules.matches({
        ...network,
        input: {
          ...network.input,
          additionalPermissions: { networkDomains: ['sub.example.test'] },
        },
      }),
    ).toBe(false)
    const other = db.createProject({ rootPath: join(workspace, 'other') })
    expect(
      await rules.matches({ ...network, threadID: db.createThread('其他项目', other.id).id }),
    ).toBe(false)
  })

  test('自动审查重试仅消费原参数一次，并继续调用 Guardian', async () => {
    const { db, hub, tools, config, invocation } = await scopedFixture()
    const reviewed: ToolInvocation[] = []
    const service = new ApprovalService(
      db,
      hub,
      tools,
      async (value) => {
        reviewed.push(value)
        return { decision: 'deny', risk: 'high', reason: '人工请求重试也需审查' }
      },
      config,
    )
    const automatic = {
      ...invocation,
      permissionConfig: {
        ...invocation.permissionConfig,
        approvalsReviewer: 'auto_review' as const,
      },
    }
    await service.authorize(automatic, new AbortController().signal)
    const denial = db.repositories.interactions.approvalReviewState(invocation.threadID).denials[0]!
    expect(service.requestRetry(invocation.threadID, denial.id, 'retry:1').input).toContain(
      'git status',
    )
    expect(service.requestRetry(invocation.threadID, denial.id, 'retry:1').input).toContain(
      'Guardian',
    )
    expect(
      db.repositories.interactions.approvalReviewState(invocation.threadID).denials[0]
        ?.retryOperationId,
    ).toBe('retry:1')
    expect(
      new ApprovalService(db, hub, tools, null, config).requestRetry(
        invocation.threadID,
        denial.id,
        'retry:1',
      ).input,
    ).toContain('git status')
    await service.authorize(
      { ...automatic, id: 'different', input: { command: 'git diff' } },
      new AbortController().signal,
    )
    expect(reviewed[1]?.retryAuthorization).toBeUndefined()
    expect(
      (await service.authorize({ ...automatic, id: 'retry' }, new AbortController().signal))
        .decision,
    ).toBe('deny')
    expect(reviewed[2]?.retryAuthorization?.reviewId).toBe(denial.id)
    await service.authorize({ ...automatic, id: 'again' }, new AbortController().signal)
    expect(reviewed[3]?.retryAuthorization).toBeUndefined()
    expect(() => service.requestRetry(invocation.threadID, denial.id, 'retry:1')).toThrow('失效')
  })

  test('自动审查连续拒绝后熔断并中断本轮，不再调用 Guardian', async () => {
    const { db, hub, tools, config, invocation } = await scopedFixture()
    const reviewed: ToolInvocation[] = []
    const interrupted: Array<[string, string]> = []
    const service = new ApprovalService(
      db,
      hub,
      tools,
      async (value) => {
        reviewed.push(value)
        return { decision: 'deny', risk: 'high', reason: '自动审查拒绝' }
      },
      config,
    )
    service.setTurnInterruptHandler((threadID, turnID) => interrupted.push([threadID, turnID]))
    const automatic = {
      ...invocation,
      permissionFacts: { ruleRequiresApproval: true },
      permissionConfig: {
        ...invocation.permissionConfig,
        approvalPolicy: 'on-request' as const,
        approvalsReviewer: 'auto_review' as const,
      },
    }
    for (let index = 0; index < 3; index += 1) {
      const result = await service.authorize(
        { ...automatic, id: `denied-${index}` },
        new AbortController().signal,
      )
      expect(result.decision).toBe('deny')
    }
    expect(interrupted).toEqual([[invocation.threadID, invocation.turnID]])
    const reopened = await service.authorize(
      { ...automatic, id: 'circuit-open' },
      new AbortController().signal,
    )
    expect(reopened.decision).toBe('deny')
    expect(reopened.guardian?.status).toBe('circuit_open')
    expect(reviewed).toHaveLength(3)
    expect(interrupted).toHaveLength(1)
    const state = db.repositories.interactions.approvalReviewState(invocation.threadID)
    expect(state.reviews[0]?.guardian.status).toBe('circuit_open')
  })

  test('MCP 表单校验、过期回复、拒绝、断连取消和重启取消分别保留语义', async () => {
    const { db, hub, invocation } = await scopedFixture()
    const service = new McpElicitationService(db, hub)
    const identity = {
      threadID: invocation.threadID,
      turnID: invocation.turnID,
      agentID: invocation.agentID,
      toolCallID: invocation.id,
    }
    const request = {
      message: '输入名称',
      requestedSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
    }
    for (const action of ['accept', 'decline', 'cancel'] as const) {
      const controller = new AbortController()
      const promise = service.request(
        'connection:1',
        'fixture',
        'save',
        identity,
        request,
        controller.signal,
      )
      const pending = db.repositories.interactions.pendingMcpElicitations()[0]!
      expect(db.getPendingInteractionCounts(invocation.threadID).approvals).toBe(1)
      await expect(
        service.respond(String(pending.interactionId), 99, {
          kind: 'mcp-elicitation',
          action: 'decline',
        }),
      ).rejects.toThrow('版本')
      if (action === 'accept') {
        await expect(
          service.respond(String(pending.interactionId), 1, {
            kind: 'mcp-elicitation',
            action,
            content: {},
          }),
        ).rejects.toThrow('schema')
        await service.respond(String(pending.interactionId), 1, {
          kind: 'mcp-elicitation',
          action,
          content: { name: 'valid' },
        })
      } else if (action === 'cancel') controller.abort()
      else
        await service.respond(String(pending.interactionId), 1, { kind: 'mcp-elicitation', action })
      expect(await promise).toEqual(
        action === 'accept' ? { action, content: { name: 'valid' } } : { action },
      )
      expect(db.repositories.interactions.pendingMcpElicitations()).toHaveLength(0)
      await expect(
        service.respond(String(pending.interactionId), 1, {
          kind: 'mcp-elicitation',
          action: 'cancel',
        }),
      ).rejects.toThrow('失效')
    }
    db.repositories.interactions.createMcpElicitation(
      {
        interactionId: 'orphan',
        threadId: identity.threadID,
        turnId: identity.turnID,
        agentId: identity.agentID,
        toolCallId: identity.toolCallID,
        kind: 'mcp-elicitation',
        server: 'fixture',
        tool: 'save',
        request,
        version: 1,
        createdAt: Date.now(),
      },
      'lost',
    )
    await new McpElicitationService(db, hub).restore()
    expect(db.repositories.interactions.pendingMcpElicitations()).toHaveLength(0)
    expect(
      db.sqlite.query('SELECT response FROM mcp_elicitations WHERE id = ?').get('orphan'),
    ).toEqual({ response: JSON.stringify({ kind: 'mcp-elicitation', action: 'cancel' }) })
  })

  test('高版本库缺少可选表时隐藏能力并保持库版本', async () => {
    const { db } = await scopedFixture()
    db.sqlite.exec('DROP TABLE mcp_elicitations')
    db.sqlite.exec('DROP TABLE approval_reviews')
    db.sqlite.exec('PRAGMA user_version = 999')
    expect(filterAdvertisedCapabilities(db)).not.toContain('mcp.elicitation.v1')
    expect(filterAdvertisedCapabilities(db)).not.toContain('approval.retry.v1')
    expect(db.repositories.interactions.pendingMcpElicitations()).toEqual([])
    expect(db.repositories.interactions.approvalReviewState(db.createThread().id)).toEqual({
      manualAllows: 0,
      denials: [],
      reviews: [],
    })
    expect(db.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: 999 })
  })
})

describe('可恢复审批 checkpoint', () => {
  test('子 Agent permission pause 不会被覆盖为 waiting_question', () => {
    expect(pausedSubagentStatus('permission')).toBe('waiting_permission')
    expect(pausedSubagentStatus('clarification')).toBe('waiting_question')
  })
  test('没有 SDK RunState 所有权的直接调用不会创建孤儿 checkpoint', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
    )
    const decision = await service.authorize(
      {
        id: 'direct-tool',
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
        name: 'PowerShell',
        input: { command: 'npm publish' },
        permissionConfig: input.permissionConfig,
        model: input.model,
        taskMode: 'chat',
      },
      new AbortController().signal,
    )
    expect(decision.decision).toBe('ask')
    expect(db.sqlite.query('SELECT COUNT(*) AS count FROM approval_requests').get()).toEqual({
      count: 0,
    })
    expect(db.sqlite.query('SELECT COUNT(*) AS count FROM approval_checkpoints').get()).toEqual({
      count: 0,
    })
  })

  test('多路径审批只向 Guardian 和人工请求投影安全范围，checkpoint 保留恢复输入', async () => {
    const path = join(tmpdir(), `pidex-approval-scope-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    let guardianInvocation: ToolInvocation | undefined
    const service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
      async (invocation) => {
        guardianInvocation = invocation
        return { decision: 'ask', risk: 'high', reason: '需要人工确认' }
      },
    )
    const authorizationScope = {
      affectedPaths: [
        { path: 'src/a.ts', operation: 'update' as const },
        { path: 'src/b.ts', operation: 'create' as const },
      ],
      fingerprint: 'a'.repeat(64),
      ruleRequiresApproval: true,
      reviewSummary: {
        fileCount: 2,
        hunkCount: 3,
        additions: 8,
        deletions: 2,
      },
    }
    const invocation: ToolInvocation = {
      id: 'scoped-tool',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'Write',
      input: { patch: 'raw-patch-body', __ruleRequiresApproval: true },
      permissionConfig: { ...input.permissionConfig, approvalsReviewer: 'auto_review' },
      model: input.model,
      taskMode: 'chat',
      authorizationScope,
      durableApproval: true,
    }
    expect(await service.authorize(invocation, new AbortController().signal)).toMatchObject({
      decision: 'ask',
    })
    expect(guardianInvocation?.input).toEqual({
      patchHash: authorizationScope.fingerprint,
      affectedPaths: authorizationScope.affectedPaths,
      summary: authorizationScope.reviewSummary,
    })
    const stored = db.approvalCheckpointForToolCall(invocation.id)
    expect(stored?.payload.invocation.input.patch).toBe('raw-patch-body')
    await service.attachRunState(invocation.id, JSON.stringify({ version: 1 }), {
      name: invocation.name,
      callId: invocation.id,
    })
    const eventRow = db.sqlite
      .query("SELECT params FROM events WHERE method = 'approval/requested' AND turn_id = ?")
      .get(turn.turnID) as { params: string }
    const eventParams = JSON.parse(eventRow.params)
    expect(eventParams).toMatchObject({
      affectedPaths: authorizationScope.affectedPaths,
      reviewSummary: authorizationScope.reviewSummary,
    })
    expect(eventRow.params).not.toContain('raw-patch-body')
    const requestRow = db.sqlite
      .query('SELECT request_payload FROM approval_requests WHERE tool_call_id = ?')
      .get(invocation.id) as { request_payload: string }
    expect(JSON.parse(requestRow.request_payload)).toMatchObject({
      affectedPaths: authorizationScope.affectedPaths,
      reviewSummary: authorizationScope.reviewSummary,
    })
    expect(requestRow.request_payload).not.toContain('raw-patch-body')
  })

  test('审批 durable resolution 后 live publish 失败不回滚响应', async () => {
    const path = join(tmpdir(), `pidex-approval-publish-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const invocation: ToolInvocation = {
      id: 'tool-publish-failure',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'npm test' },
      permissionConfig: input.permissionConfig,
      model: input.model,
      taskMode: 'chat',
      durableApproval: true,
    }
    const resolution = new PermissionDecisionEngine().evaluate(invocation, tools.get('PowerShell'))
    if (resolution.action !== 'review') throw new Error('测试需要 review 决策')
    const service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const prepared = service.prepare(
      invocation,
      { decision: 'ask', risk: 'high', reason: '需要确认' },
      resolution,
    )
    service.persist(prepared)
    await service.attachRunState(invocation.id, 'run-state', { callId: invocation.id })

    const failingHub = {
      publish: () => Effect.fail(new Error('subscriber unavailable')),
    } as unknown as EventHub
    const responder = new ApprovalService(db, failingHub, tools)
    await expect(responder.respond(prepared.approvalID, 'allow')).resolves.toMatchObject({
      status: 'resolved',
    })
    expect(db.getApprovalCheckpoint(prepared.approvalID)?.status).toBe('resolved')
  })

  test('审批跨重启加载、响应并且只能 claim 一次', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const invocation: ToolInvocation = {
      id: 'tool-1',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'api_key=super-secret; npm test' },
      permissionConfig: input.permissionConfig,
      model: input.model,
      taskMode: 'chat',
    }
    const resolved = new PermissionDecisionEngine().evaluate(invocation, tools.get('PowerShell'))
    if (resolved.action !== 'review') throw new Error('测试需要 review 决策')
    let service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const prepared = service.prepare(
      invocation,
      { decision: 'ask', risk: 'high', reason: '需要确认' },
      resolved,
    )
    service.persist(prepared)
    expect(service.load(prepared.approvalID)?.status).toBe('preparing')
    expect(
      db.sqlite
        .query("SELECT COUNT(*) AS count FROM events WHERE method = 'approval/requested'")
        .get(),
    ).toEqual({ count: 0 })
    await expect(service.respond(prepared.approvalID, 'allow')).rejects.toMatchObject({
      code: 'APPROVAL_NOT_READY',
    })
    await service.attachRunState('tool-1', JSON.stringify({ version: 1, command: 'npm test' }), {
      name: 'PowerShell',
      callId: 'tool-1',
    })
    expect(
      db.sqlite
        .query("SELECT COUNT(*) AS count FROM events WHERE method = 'approval/requested'")
        .get(),
    ).toEqual({ count: 1 })
    expect(service.load(prepared.approvalID)?.payload.invocation.input.command).toContain(
      '<redacted>',
    )
    expect(service.load(prepared.approvalID)?.payload.runState).not.toContain('super-secret')
    db.close()

    db = new AgentDatabase(path)
    databases.push(db)
    service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    expect(service.load(prepared.approvalID)?.status).toBe('pending')
    db.sqlite.exec(
      `CREATE TRIGGER fail_resolved_outbox BEFORE INSERT ON events WHEN NEW.method = 'interaction/resolved' BEGIN SELECT RAISE(ABORT, 'outbox unavailable'); END`,
    )
    await expect(service.respond(prepared.approvalID, 'allow')).rejects.toThrow(
      'outbox unavailable',
    )
    expect(service.load(prepared.approvalID)?.status).toBe('pending')
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'waiting_permission',
    })
    expect(
      db.sqlite.query('SELECT status FROM agent_executions WHERE id = ?').get(turn.agentID),
    ).toEqual({ status: 'waiting_permission' })
    db.sqlite.exec('DROP TRIGGER fail_resolved_outbox')
    await service.respond(prepared.approvalID, 'allow')
    const resolvedEvent = db.sqlite
      .query("SELECT params FROM events WHERE method = 'interaction/resolved' AND turn_id = ?")
      .get(turn.turnID) as { params: string }
    expect(JSON.parse(resolvedEvent.params)).toEqual({
      interactionId: prepared.approvalID,
      result: { kind: 'approval', decision: 'allow-once' },
      resolvedAt: expect.any(Number),
    })
    const claimed = service.claimResume(turn.turnID)
    expect(claimed).toMatchObject({ status: 'claimed', decision: 'allow', toolCallID: 'tool-1' })
    expect(service.claimResume(turn.turnID)).toBeNull()
  })

  test('旧 pending 审批没有 checkpoint 时 fail-closed', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn } = setup(db)
    db.sqlite
      .query(
        `INSERT INTO approval_requests (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, request_payload, created_at) VALUES ('legacy', ?, ?, ?, 'tool-old', 'high', 'legacy', 'pending', '{"version":1}', ?)`,
      )
      .run(thread.id, turn.turnID, turn.agentID, Date.now())
    db.updateTurnStatus(turn.turnID, 'waiting_permission')
    db.updateAgentStatus(turn.agentID, 'waiting_permission')
    const service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
    )
    db.sqlite.exec(
      `CREATE TRIGGER fail_cancelled_outbox BEFORE INSERT ON events WHEN NEW.method = 'approval/cancelled' BEGIN SELECT RAISE(ABORT, 'cancel outbox unavailable'); END`,
    )
    await expect(service.respond('legacy', 'allow')).rejects.toThrow('cancel outbox unavailable')
    expect(
      db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'legacy'").get(),
    ).toEqual({ status: 'pending' })
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'waiting_permission',
    })
    db.sqlite.exec('DROP TRIGGER fail_cancelled_outbox')
    await expect(service.respond('legacy', 'allow')).rejects.toMatchObject({
      code: 'APPROVAL_CHECKPOINT_MISSING',
    })
    expect(
      db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'legacy'").get(),
    ).toEqual({ status: 'cancelled' })
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'interrupted',
    })
    expect(
      db.sqlite
        .query("SELECT method FROM events WHERE method = 'approval/cancelled' AND turn_id = ?")
        .get(turn.turnID),
    ).toEqual({ method: 'approval/cancelled' })
    const cancelledEvent = db.sqlite
      .query("SELECT params FROM events WHERE method = 'approval/cancelled' AND turn_id = ?")
      .get(turn.turnID) as { params: string }
    expect(JSON.parse(cancelledEvent.params)).toEqual({
      interactionId: 'legacy',
      reason: '审批缺少可恢复 checkpoint',
      cancelledAt: expect.any(Number),
    })
  })

  test('重启扫描会取消不完整审批并写入 durable event', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn } = setup(db)
    db.sqlite
      .query(
        `INSERT INTO approval_requests (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, request_payload, created_at) VALUES ('restart-legacy', ?, ?, ?, 'tool-old', 'high', 'legacy', 'pending', '{"version":1}', ?)`,
      )
      .run(thread.id, turn.turnID, turn.agentID, Date.now())
    db.updateTurnStatus(turn.turnID, 'waiting_permission')
    db.updateAgentStatus(turn.agentID, 'waiting_permission')
    db.close()

    db = new AgentDatabase(path)
    databases.push(db)
    recoverInterruptedRuns(db)
    expect(
      db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'restart-legacy'").get(),
    ).toEqual({ status: 'cancelled' })
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'interrupted',
    })
    expect(
      db.sqlite
        .query("SELECT method FROM events WHERE method = 'approval/cancelled' AND turn_id = ?")
        .get(turn.turnID),
    ).toEqual({ method: 'approval/cancelled' })
    const cancelledEvent = db.sqlite
      .query("SELECT params FROM events WHERE method = 'approval/cancelled' AND turn_id = ?")
      .get(turn.turnID) as { params: string }
    expect(JSON.parse(cancelledEvent.params)).toEqual({
      interactionId: 'restart-legacy',
      reason: '审批缺少完整且可恢复的 SDK checkpoint，已安全取消',
      cancelledAt: expect.any(Number),
    })
  })

  test('deny 跨重启恢复且只能 claim 一次', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const invocation: ToolInvocation = {
      id: 'tool-deny',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'npm publish' },
      permissionConfig: input.permissionConfig,
      model: input.model,
      taskMode: 'chat',
      durableApproval: true,
    }
    const resolved = new PermissionDecisionEngine().evaluate(invocation, tools.get('PowerShell'))
    if (resolved.action !== 'review') throw new Error('测试需要 review 决策')
    let service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const prepared = service.prepare(
      invocation,
      { decision: 'ask', risk: 'high', reason: '需要确认' },
      resolved,
    )
    service.persist(prepared)
    await service.attachRunState('tool-deny', JSON.stringify({ version: 1 }), {
      name: 'PowerShell',
      callId: 'tool-deny',
    })
    db.close()

    db = new AgentDatabase(path)
    databases.push(db)
    service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    await service.respond(
      prepared.approvalID,
      'deny',
      '  Authorization: Bearer abc.def.ghi\n请改用只读命令  ',
    )
    expect(service.claimResume(turn.turnID)).toMatchObject({
      status: 'claimed',
      decision: 'deny',
      toolCallID: 'tool-deny',
      payload: {
        resolution: { decision: 'deny', feedback: 'Authorization: <redacted>\n请改用只读命令' },
      },
    })
    expect(service.claimResume(turn.turnID)).toBeNull()
  })

  test('checkpoint 内容被篡改时拒绝响应并中断恢复', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const invocation: ToolInvocation = {
      id: 'tool-tampered',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'npm test' },
      permissionConfig: input.permissionConfig,
      model: input.model,
      taskMode: 'chat',
    }
    const resolved = new PermissionDecisionEngine().evaluate(invocation, tools.get('PowerShell'))
    if (resolved.action !== 'review') throw new Error('测试需要 review 决策')
    const prepared = service.prepare(
      invocation,
      { decision: 'ask', risk: 'high', reason: '需要确认' },
      resolved,
    )
    service.persist(prepared)
    db.sqlite
      .query(
        "UPDATE approval_checkpoints SET payload = json_set(payload, '$.invocation.input.command', 'changed') WHERE approval_id = ?",
      )
      .run(prepared.approvalID)
    await expect(service.respond(prepared.approvalID, 'allow')).rejects.toMatchObject({
      code: 'APPROVAL_CHECKPOINT_INVALID',
    })
    expect(
      db.sqlite.query('SELECT status FROM approval_requests WHERE id = ?').get(prepared.approvalID),
    ).toEqual({ status: 'cancelled' })
  })

  test('动态权限请求携带真实风险，resolved 事件携带原始交互 ID', async () => {
    const path = join(tmpdir(), `pidex-permission-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
    )
    const invocation: ToolInvocation = {
      id: 'permission-call',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'request_permissions',
      input: {
        scope: 'turn',
        readPaths: ['C:\\workspace\\docs'],
        writePaths: ['C:\\workspace\\out'],
        networkDomains: ['api.example.com'],
        justification: '需要读取文档并写入产物',
      },
      permissionConfig: input.permissionConfig,
      model: input.model,
      taskMode: 'chat',
      durableApproval: true,
    }
    const resolved = new PermissionDecisionEngine().evaluate(
      invocation,
      new ToolRegistry().get('request_permissions'),
    )
    if (resolved.action !== 'review') throw new Error('测试需要 review 决策')
    const prepared = service.prepare(
      invocation,
      { decision: 'ask', risk: 'critical', reason: '需要额外权限' },
      resolved,
    )
    service.persist(prepared)
    await service.attachRunState('permission-call', JSON.stringify({ version: 1 }), {
      name: 'request_permissions',
      callId: 'permission-call',
    })

    const requestedEvent = db.sqlite
      .query("SELECT params FROM events WHERE method = 'permission/requested' AND turn_id = ?")
      .get(turn.turnID) as { params: string }
    const requestedParams = JSON.parse(requestedEvent.params)
    expect(requestedParams).toMatchObject({
      interactionId: prepared.approvalID,
      kind: 'permission',
      requestedScope: 'turn',
      allowedScopes: ['tool-call', 'turn'],
      risk: 'critical',
      requestedPermissions: {
        readPaths: ['C:\\workspace\\docs'],
        writePaths: ['C:\\workspace\\out'],
        networkDomains: ['api.example.com'],
      },
    })

    await service.respondPermission(prepared.approvalID, 'allow', {
      scope: 'tool-call',
      grantedPermissions: { readPaths: ['C:\\workspace\\docs'] },
    })
    const resolvedEvent = db.sqlite
      .query("SELECT params FROM events WHERE method = 'interaction/resolved' AND turn_id = ?")
      .get(turn.turnID) as { params: string }
    expect(JSON.parse(resolvedEvent.params)).toEqual({
      interactionId: prepared.approvalID,
      result: {
        kind: 'permission',
        decision: 'grant',
        scope: 'tool-call',
        grantedPermissions: { readPaths: ['C:\\workspace\\docs'] },
      },
      resolvedAt: expect.any(Number),
    })
    expect(
      service.permissionGrantResolution(db.getApprovalCheckpoint(prepared.approvalID)!),
    ).toEqual({
      scope: 'tool-call',
      grantedPermissions: { readPaths: ['C:\\workspace\\docs'] },
    })
  })

  test('sandbox escalation token 跨重启保持且只能 claim 一次', async () => {
    const path = join(tmpdir(), `pidex-escalation-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn, input } = setup(db)
    let service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
    )
    const invocation: ToolInvocation = {
      id: 'shell-failed',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'Write-Output once', cwd: tmpdir() },
      permissionConfig: { ...input.permissionConfig, approvalPolicy: 'on-failure' },
      model: input.model,
      taskMode: 'chat',
    }
    const escalation = service.prepareSandboxEscalation(invocation, 'sandbox denied')
    const permissionInput = {
      scope: 'tool-call',
      escalationToken: escalation.token,
      justification: 'sandbox failed',
    }
    const parsed = new ToolRegistry()
      .get('request_permissions')
      .schema.parse(permissionInput) as typeof permissionInput
    expect(parsed.escalationToken).toBe(escalation.token)
    const permissionInvocation: ToolInvocation = {
      ...invocation,
      id: 'permission-call',
      name: 'request_permissions',
      input: parsed,
      durableApproval: true,
    }
    const resolved = new PermissionDecisionEngine().evaluate(
      permissionInvocation,
      new ToolRegistry().get('request_permissions'),
    )
    if (resolved.action !== 'review') throw new Error('escalation request 必须进入 SDK approval')
    const prepared = service.prepare(
      permissionInvocation,
      { decision: 'ask', risk: 'high', reason: 'host escalation' },
      resolved,
    )
    expect(prepared.checkpoint.invocation.input.escalationToken).toBe(escalation.token)
    db.close()
    db = new AgentDatabase(path)
    databases.push(db)
    service = new ApprovalService(db, await Effect.runPromise(EventHub.make), new ToolRegistry())
    expect(
      service.claimSandboxEscalation(escalation.token, {
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
      })?.invocation.input.command,
    ).toBe('Write-Output once')
    expect(
      service.claimSandboxEscalation(escalation.token, {
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
      }),
    ).toBeNull()
    databases.pop()
    db.close()
    db = new AgentDatabase(path)
    databases.push(db)
    recoverInterruptedRuns(db)
    expect(db.getSandboxEscalation(escalation.token)?.status).toBe('cancelled')
  })

  test('sandbox escalation 持久化内容被篡改时 fail closed', async () => {
    const path = join(tmpdir(), `pidex-escalation-tamper-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
    )
    const invocation: ToolInvocation = {
      id: 'shell-tampered',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'Write-Output safe', cwd: tmpdir() },
      permissionConfig: { ...input.permissionConfig, approvalPolicy: 'on-failure' },
      model: input.model,
      taskMode: 'chat',
    }
    const escalation = service.prepareSandboxEscalation(invocation, 'sandbox denied')
    db.sqlite
      .query(
        "UPDATE sandbox_escalations SET invocation = json_set(invocation, '$.input.command', 'Remove-Item dangerous') WHERE token = ?",
      )
      .run(escalation.token)
    expect(
      service.claimSandboxEscalation(escalation.token, {
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
      }),
    ).toBeNull()
    expect(db.getSandboxEscalation(escalation.token)?.status).toBe('cancelled')
  })

  test('Hook trust 等待 checkpoint 跨重启保留', async () => {
    const path = join(tmpdir(), `pidex-hook-trust-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn } = setup(db)
    const pending = db.ensureHookTrustRequest({
      threadID: thread.id,
      turnID: turn.turnID,
      workspacePath: 'F:\\repo',
      configPath: 'F:\\repo\\.pidex\\hooks.json',
      configHash: 'hash',
      auditSummary: { hooks: [] },
    })
    expect(db.getAgentTurnCheckpoint(turn.turnID)?.state).toBe('waiting_hook_trust')
    db.close()
    db = new AgentDatabase(path)
    databases.push(db)
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'waiting_permission',
    })
    expect(db.getAgentTurnCheckpoint(turn.turnID)?.state).toBe('waiting_hook_trust')
    const resolved = db.resolveHookTrustRequest(pending.request.id, 'block')
    expect(resolved.resumed).toHaveLength(1)
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'queued',
    })
  })

  test('同一 Hook hash 的并发 turn 复用请求但各收到一次 durable 事件', () => {
    const path = join(tmpdir(), `pidex-hook-trust-waiters-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const first = setup(db)
    const secondThread = db.createThread()
    const second = db.createTurn(secondThread.id, first.input)
    db.claimTurnExecution(second.turnID)
    const trust = {
      workspacePath: 'F:\\repo',
      configPath: 'F:\\repo\\.pidex\\hooks.json',
      configHash: 'same-hash',
      auditSummary: { hooks: [] },
    }
    const initial = db.ensureHookTrustRequest({
      ...trust,
      threadID: first.thread.id,
      turnID: first.turn.turnID,
    })
    const reused = db.ensureHookTrustRequest({
      ...trust,
      threadID: secondThread.id,
      turnID: second.turnID,
    })
    expect(reused.request.id).toBe(initial.request.id)
    const reusedEvent = db.sqlite
      .query("SELECT params FROM events WHERE thread_id = ? AND method = 'hook/trust/requested'")
      .get(secondThread.id) as { params: string }
    const requestedPayload = JSON.parse(reusedEvent.params)
    expect(requestedPayload).toMatchObject({
      interactionId: initial.request.id,
      threadId: secondThread.id,
      turnId: second.turnID,
      agentId: second.agentID,
      kind: 'hookTrust',
      sha256: 'same-hash',
    })
    expect(() =>
      Schema.decodeUnknownSync(EventManifest['hook/trust/requested'].payload)(requestedPayload),
    ).not.toThrow()
    expect(
      db.ensureHookTrustRequest({ ...trust, threadID: secondThread.id, turnID: second.turnID })
        .event,
    ).toBeNull()
    expect(
      db.sqlite
        .query("SELECT COUNT(*) AS count FROM events WHERE method = 'hook/trust/requested'")
        .get(),
    ).toEqual({ count: 2 })
    const interactionService = new InteractionService({ db } as never)
    expect(interactionService.listPending({ threadId: secondThread.id }).interactions).toEqual([
      expect.objectContaining({
        interactionId: initial.request.id,
        threadId: secondThread.id,
        turnId: second.turnID,
        agentId: second.agentID,
      }),
    ])
    expect(
      interactionService
        .listPending({})
        .interactions.filter((interaction) => interaction.kind === 'hookTrust'),
    ).toHaveLength(2)
    expect(db.resolveHookTrustRequest(initial.request.id, 'allow').resumed).toHaveLength(2)
    const resolvedEvents = db.sqlite
      .query("SELECT params FROM events WHERE method = 'hook/trust/resolved'")
      .all() as Array<{ params: string }>
    expect(resolvedEvents).toHaveLength(2)
    for (const event of resolvedEvents) {
      expect(() =>
        Schema.decodeUnknownSync(EventManifest['hook/trust/resolved'].payload)(
          JSON.parse(event.params),
        ),
      ).not.toThrow()
    }
  })

  test('Turn 在 preparing 阶段停止会持久取消审批', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const invocation: ToolInvocation = {
      id: 'tool-stop',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'npm publish' },
      permissionConfig: input.permissionConfig,
      model: input.model,
      taskMode: 'chat',
      durableApproval: true,
    }
    const resolved = new PermissionDecisionEngine().evaluate(invocation, tools.get('PowerShell'))
    if (resolved.action !== 'review') throw new Error('测试需要 review 决策')
    const prepared = service.prepare(
      invocation,
      { decision: 'ask', risk: 'high', reason: '需要确认' },
      resolved,
    )
    service.persist(prepared)
    service.cancelTurn(turn.turnID)
    expect(
      db.sqlite.query('SELECT status FROM approval_requests WHERE id = ?').get(prepared.approvalID),
    ).toEqual({ status: 'cancelled' })
  })

  test('副作用 prompt recovery 持久中断后可重新排队', async () => {
    const path = join(tmpdir(), `pidex-recovery-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn } = setup(db)
    const persisted = db.interruptForSideEffectRecovery({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      payload: {
        kind: 'side-effect-prompt-recovery',
        attemptOrdinal: 2,
        completed: [{ toolCallID: 'call-1', tool: 'shell', summary: 'done' }],
        error: 'context too long',
      },
    })
    expect(persisted.events.map(({ method }) => method).sort()).toEqual([
      'agent/upserted',
      'context/recoveryRequired',
      'turn/interrupted',
    ])
    expect(
      db.sqlite
        .query(
          "SELECT method FROM events WHERE method = 'context/recoveryRequired' AND turn_id = ?",
        )
        .get(turn.turnID),
    ).toEqual({ method: 'context/recoveryRequired' })
    expect(db.getAgentTurnCheckpoint(turn.turnID)?.payload.kind).toBe('side-effect-prompt-recovery')
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'interrupted',
    })
    expect(db.queueSideEffectRecovery(turn.turnID)).toBe(true)
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'queued',
    })
  })
})
