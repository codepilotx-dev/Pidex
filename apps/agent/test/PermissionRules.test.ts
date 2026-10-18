import { afterEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { Model, Provider } from '@pidex/model-schema'
import type { ToolInvocation } from '../src/Domain'
import { ApprovalRules, permissionRuleMatches } from '../src/permission/ApprovalRules'
import { ApprovalService } from '../src/permission/ApprovalService'
import { PermissionDecisionEngine } from '../src/permission/PermissionDecisionEngine'
import { ConfigService } from '../src/config/ConfigService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { filterAdvertisedCapabilities } from '../src/transport/rpc/handlers/SystemCapabilities'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
const databases: AgentDatabase[] = []
const configs: ConfigService[] = []

afterEach(async () => {
  for (const config of configs.splice(0)) await config.dispose()
  for (const database of databases.splice(0)) database.close()
  await removeFixturePaths(paths.splice(0))
}, 30_000)

const model = Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') })
const permissionConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const

async function fixture(options: { project?: boolean; trusted?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cpx-permission-rules-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'history.sqlite'))
  databases.push(db)
  const workspace = join(root, 'workspace')
  await mkdir(join(workspace, '.pidex'), { recursive: true })
  const projectFile = join(workspace, '.pidex', 'config.json')
  await writeFile(projectFile, '{ "future_key": { "keep": true } }\n', 'utf8')
  const configPath = join(root, 'config.json')
  await writeFile(configPath, '{ "future_user_key": "keep" }\n', 'utf8')
  const config = new ConfigService(configPath)
  configs.push(config)
  await config.initialize()
  const project = options.project ? db.createProject({ rootPath: workspace }) : undefined
  if (project && options.trusted !== false) await config.trustUpdate(workspace, 'trusted')
  if (project && options.trusted === false) await config.trustUpdate(workspace, 'untrusted')
  const thread = db.createThread('规则', project?.id)
  const input = {
    content: '执行',
    model,
    permissionConfig,
    strategy: 'queue',
    taskMode: 'chat',
  } as const
  const turn = db.createTurn(thread.id, input)
  db.claimTurnExecution(turn.turnID)
  const tools = new ToolRegistry()
  const hub = await Effect.runPromise(EventHub.make)
  const invocation: ToolInvocation = {
    id: 'tool-1',
    threadID: thread.id,
    turnID: turn.turnID,
    agentID: turn.agentID,
    name: 'PowerShell',
    input: { command: 'git status', cwd: workspace },
    permissionConfig,
    model,
    taskMode: 'chat',
    durableApproval: true,
  }
  return {
    root,
    db,
    hub,
    config,
    configPath,
    workspace,
    project,
    projectFile,
    thread,
    turn,
    tools,
    invocation,
  }
}

describe('权限规则匹配', () => {
  test('Deny 高于 Ask 高于 Allow，项目规则仅在受信任时生效', async () => {
    const { db, config, tools, invocation, thread, workspace } = await fixture({ project: true })
    const rules = new ApprovalRules(db, tools, config)
    await rules.upsert(thread.id, {
      effect: 'allow',
      scope: 'chat',
      match: { kind: 'command', command: 'git status', argv: ['git', 'status'] },
    })
    await rules.upsert(thread.id, {
      effect: 'ask',
      scope: 'user',
      match: { kind: 'command', command: 'git status', argv: ['git', 'status'] },
    })
    expect((await rules.evaluate(invocation)).effect).toBe('ask')
    await rules.upsert(thread.id, {
      effect: 'deny',
      scope: 'chat',
      match: { kind: 'command', command: 'git status', argv: ['git', 'status'] },
    })
    expect((await rules.evaluate(invocation)).effect).toBe('deny')

    const untrusted = await fixture({ project: true, trusted: false })
    const untrustedRules = new ApprovalRules(untrusted.db, untrusted.tools, untrusted.config)
    await untrustedRules.upsert(untrusted.thread.id, {
      effect: 'allow',
      scope: 'chat',
      match: { kind: 'command', command: 'git status', argv: ['git', 'status'] },
    })
    // Project layer rules are written by another build; this untrusted store must
    // ignore them even if the file contains them.
    await untrusted.config.batchWrite({
      cwd: untrusted.workspace,
      target: { kind: 'project' },
      edits: [
        {
          keyPath: ['permission_rules'],
          value: [
            {
              id: 'project-rule',
              effect: 'deny',
              scope: 'project',
              match: { kind: 'command', command: 'git status', argv: ['git', 'status'] },
            },
          ],
        },
      ],
      migrationScope: 'project',
      filePath: join(untrusted.workspace, '.pidex', 'config.json'),
    })
    expect(
      (await untrustedRules.evaluate({ ...invocation, threadID: untrusted.thread.id })).effect,
    ).toBe('allow')
  })

  test('Ask 规则始终要求人工，never 与 granular 禁止时直接拒绝', () => {
    const engine = new PermissionDecisionEngine()
    const tools = new ToolRegistry()
    const tool = tools.get('Write')
    const invocation: ToolInvocation = {
      id: 'tool-1',
      threadID: 'thread-1',
      turnID: 'turn-1',
      agentID: 'agent-1',
      name: 'Write',
      input: { file_path: 'src/a.ts', content: 'x' },
      permissionConfig: permissionConfig,
      model,
      taskMode: 'chat',
      toolPolicy: tool,
      permissionFacts: { ruleEffect: 'ask' },
    }
    const autoReview = engine.evaluate(
      {
        ...invocation,
        permissionConfig: { ...permissionConfig, approvalsReviewer: 'auto_review' },
      },
      tool,
    )
    expect(autoReview).toMatchObject({
      action: 'review',
      reviewer: 'user',
      forceHumanApproval: true,
    })
    expect(
      engine.evaluate(
        { ...invocation, permissionConfig: { ...permissionConfig, approvalPolicy: 'never' } },
        tool,
      ),
    ).toMatchObject({ action: 'deny' })
    expect(
      engine.evaluate(
        {
          ...invocation,
          permissionConfig: {
            ...permissionConfig,
            approvalPolicy: {
              type: 'granular',
              sandboxApproval: true,
              rules: false,
              skillApproval: true,
              requestPermissions: true,
              mcpTools: true,
              mcpElicitations: true,
            },
          },
        },
        tool,
      ),
    ).toMatchObject({ action: 'deny' })
  })

  test('Allow 规则不能解除强制审批，Deny 规则优先于已有授权', () => {
    const engine = new PermissionDecisionEngine()
    const tools = new ToolRegistry()
    const tool = tools.get('Write')
    const invocation: ToolInvocation = {
      id: 'tool-1',
      threadID: 'thread-1',
      turnID: 'turn-1',
      agentID: 'agent-1',
      name: 'Write',
      input: { file_path: '.env', content: 'x' },
      permissionConfig,
      model,
      taskMode: 'chat',
      toolPolicy: tool,
      permissionFacts: {
        ruleEffect: 'allow',
        ruleRequiresApproval: true,
      },
    }
    expect(engine.evaluate({ ...invocation, grantsForbidden: true }, tool)).toMatchObject({
      action: 'review',
    })
    expect(
      engine.evaluate(
        { ...invocation, permissionFacts: { ...invocation.permissionFacts, ruleEffect: 'deny' } },
        tool,
      ),
    ).toMatchObject({ action: 'deny' })
  })

  test('精确域名、MCP server/tool、命令完整值与安全 argv 前缀按各自语义匹配', async () => {
    const { db, config, tools, invocation } = await fixture({ project: true })
    const rules = new ApprovalRules(db, tools, config)
    expect(
      permissionRuleMatches({ kind: 'network', domain: 'example.test' }, invocation, {
        networkDomains: ['example.test'],
      }),
    ).toBe(true)
    expect(
      permissionRuleMatches({ kind: 'network', domain: 'example.test' }, invocation, {
        networkDomains: ['sub.example.test'],
      }),
    ).toBe(false)
    const mcpInvocation: ToolInvocation = {
      ...invocation,
      name: 'mcp_tool',
      input: { value: 1 },
      toolPolicy: {
        sdkName: 'mcp_tool',
        capabilities: tools.get('PowerShell').capabilities,
        allowedModes: ['chat'],
        approvalStrategy: 'always-review',
        origin: { kind: 'mcp', serverName: 'fixture', rawToolName: 'save', generation: 1 },
      },
    }
    expect(
      permissionRuleMatches(
        { kind: 'mcp', server: 'fixture', tool: 'save' },
        mcpInvocation,
        undefined,
      ),
    ).toBe(true)
    expect(
      permissionRuleMatches(
        { kind: 'mcp', server: 'fixture', tool: 'delete' },
        mcpInvocation,
        undefined,
      ),
    ).toBe(false)
    expect(
      permissionRuleMatches(
        { kind: 'command', command: 'git status', argv: ['git', 'status'] },
        invocation,
        { command: 'git status --short', argv: ['git', 'status', '--short'] },
      ),
    ).toBe(true)
    expect(
      permissionRuleMatches({ kind: 'command', command: 'rm -rf /' }, invocation, {
        command: 'rm -rf /',
      }),
    ).toBe(true)
    expect(
      permissionRuleMatches(
        { kind: 'command', command: 'git status', argv: ['git', 'status'] },
        invocation,
        { command: 'git status', argv: null },
      ),
    ).toBe(false)
  })

  test('多路径写入必须全部落在文件规则范围内', () => {
    const invocation = {
      id: 'tool-1',
      threadID: 'thread-1',
      turnID: 'turn-1',
      agentID: 'agent-1',
      name: 'apply_patch',
      input: {},
      permissionConfig,
      model,
      taskMode: 'chat',
    } as ToolInvocation
    const rule = { kind: 'file' as const, access: 'write' as const, path: '/workspace/src' }
    expect(
      permissionRuleMatches(rule, invocation, {
        writePaths: ['/workspace/src/a.ts', '/workspace/src/b.ts'],
      }),
    ).toBe(true)
    expect(
      permissionRuleMatches(rule, invocation, {
        writePaths: ['/workspace/src/a.ts', '/workspace/other.ts'],
      }),
    ).toBe(false)
  })

  test('文件规则按宿主真实路径匹配，符号链接目录不扩大范围', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'cpx-rule-symlink-'))
    paths.push(parent)
    const workspaceRoot = join(parent, 'workspace')
    const outside = join(parent, 'outside')
    await Promise.all([mkdir(workspaceRoot), mkdir(outside)])
    const target = join(outside, 'file.txt')
    await writeFile(target, 'content', 'utf8')
    const link = join(workspaceRoot, 'linked')
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    const resolved = await realpath(join(link, 'file.txt'))
    const invocation = {
      id: 'tool-1',
      threadID: 'thread-1',
      turnID: 'turn-1',
      agentID: 'agent-1',
      name: 'Read',
      input: {},
      permissionConfig,
      model,
      taskMode: 'chat',
    } as ToolInvocation
    expect(
      permissionRuleMatches({ kind: 'file', access: 'read', path: outside }, invocation, {
        readPaths: [resolved],
      }),
    ).toBe(true)
    expect(
      permissionRuleMatches({ kind: 'file', access: 'read', path: link }, invocation, {
        readPaths: [resolved],
      }),
    ).toBe(false)
  })
})

describe('ToolExecutor 规则最终门禁', () => {
  test('Deny 规则在最终执行前拒绝且不进入审批', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'cpx-rule-final-'))
    paths.push(parent)
    const root = join(parent, 'workspace')
    await mkdir(root)
    const target = join(root, 'a.txt')
    await writeFile(target, 'content', 'utf8')
    let approvals = 0
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(parent, 'data'),
      authorizeShell: async () => {
        approvals += 1
        return { decision: 'allow', risk: 'low', reason: 'test' }
      },
      resolvePermissionRules: async () => ({ effect: 'deny', ids: ['rule'], matches: [] }),
    })
    const context = {
      threadID: 'thread',
      turnID: 'turn',
      agentID: 'agent',
      taskMode: 'chat' as const,
      signal: new AbortController().signal,
      workspace: await WorkspaceService.open(root),
    }
    await expect(executor.execute('Read', { file_path: target }, context)).rejects.toThrow(
      '权限规则拒绝',
    )
    expect(approvals).toBe(0)
  })

  test('Allow 规则只免除普通审批，不能覆盖 Deny 规则', async () => {
    const { db, hub, tools, config, invocation, thread } = await fixture({ project: true })
    const service = new ApprovalService(db, hub, tools, null, config)
    const shell: ToolInvocation = {
      ...invocation,
      permissionConfig: { ...permissionConfig, approvalPolicy: 'untrusted' },
    }
    await service.rules.upsert(thread.id, {
      effect: 'allow',
      scope: 'chat',
      match: { kind: 'command', command: 'git status', argv: ['git', 'status'] },
    })
    expect(await service.authorize(shell, new AbortController().signal)).toMatchObject({
      decision: 'allow',
    })
    await service.rules.upsert(thread.id, {
      effect: 'deny',
      scope: 'chat',
      match: { kind: 'command', command: 'git status', argv: ['git', 'status'] },
    })
    expect(await service.authorize(shell, new AbortController().signal)).toMatchObject({
      decision: 'deny',
    })
  })

  test('Ask 规则不会被自动审查或已有授权绕过', async () => {
    const { db, hub, tools, config, invocation, thread } = await fixture({ project: true })
    const reviewed: string[] = []
    const service = new ApprovalService(
      db,
      hub,
      tools,
      async () => {
        reviewed.push('called')
        return { decision: 'allow', risk: 'low', reason: 'guardian allow' }
      },
      config,
    )
    const shell: ToolInvocation = {
      ...invocation,
      permissionConfig: {
        ...permissionConfig,
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
    }
    await service.rules.upsert(thread.id, {
      effect: 'ask',
      scope: 'chat',
      match: { kind: 'command', command: 'git status', argv: ['git', 'status'] },
    })
    const decision = await service.authorize(shell, new AbortController().signal)
    expect(decision.decision).toBe('ask')
    expect(reviewed).toHaveLength(0)
  })
})

describe('权限规则存储', () => {
  test('用户与项目规则使用 permission_rules 局部编辑并保留未知内容', async () => {
    const { db, config, tools, thread, configPath, projectFile, workspace } = await fixture({
      project: true,
    })
    const rules = new ApprovalRules(db, tools, config)
    const saved = await rules.upsert(thread.id, {
      effect: 'deny',
      scope: 'user',
      match: { kind: 'network', domain: 'evil.test' },
    })
    expect(saved.source).toBe('user')
    expect(saved.version).toBeTruthy()
    expect(JSON.parse(await readFile(configPath, 'utf8')).future_user_key).toBe('keep')
    const projectRule = await rules.upsert(thread.id, {
      effect: 'ask',
      scope: 'project',
      match: { kind: 'tool', tool: 'Bash' },
    })
    expect(projectRule.source).toBe('project')
    const projectJson = JSON.parse(await readFile(projectFile, 'utf8'))
    expect(projectJson.future_key).toEqual({ keep: true })
    expect(projectJson.approval_rules).toBeUndefined()
    expect(JSON.parse(await readFile(configPath, 'utf8')).approval_rules).toBeUndefined()
    const listed = await rules.list(thread.id)
    expect(listed.rules.some((rule) => rule.id === saved.id && rule.effect === 'deny')).toBe(true)
    expect(
      listed.rules.some(
        (rule) => rule.id === projectRule.id && rule.scope === 'project' && rule.effect === 'ask',
      ),
    ).toBe(true)
    expect(
      JSON.parse(await readFile(join(workspace, '.pidex', 'config.json'), 'utf8')).permission_rules,
    ).toHaveLength(1)
  })

  test('聊天规则新增、编辑、撤销并校验版本冲突', async () => {
    const { db, config, tools, thread, invocation } = await fixture()
    const rules = new ApprovalRules(db, tools, config)
    const created = await rules.upsert(thread.id, {
      effect: 'allow',
      scope: 'chat',
      match: { kind: 'command', command: 'git status', argv: ['git', 'status'] },
    })
    expect(created.version).toBe('1')
    expect((await rules.evaluate(invocation)).effect).toBe('allow')
    const edited = await rules.upsert(
      thread.id,
      {
        id: created.id,
        effect: 'ask',
        scope: 'chat',
        match: { kind: 'command', command: 'git status', argv: ['git', 'status'] },
      },
      created.version,
    )
    expect(edited.version).toBe('2')
    await expect(
      rules.upsert(
        thread.id,
        {
          id: created.id,
          effect: 'deny',
          scope: 'chat',
          match: { kind: 'command', command: 'git status', argv: ['git', 'status'] },
        },
        created.version,
      ),
    ).rejects.toThrow('版本已变化')
    expect(await rules.revoke(thread.id, created.id, '2')).toEqual({ revoked: true })
    expect((await rules.list(thread.id)).rules).toEqual([])
  })

  test('旧聊天授权可列出、撤销且不会删除审批历史', async () => {
    const { db, hub, tools, config, invocation } = await fixture({ project: true })
    const service = new ApprovalService(db, hub, tools, null, config)
    const approved: ToolInvocation = {
      ...invocation,
      permissionConfig: { ...permissionConfig, approvalPolicy: 'untrusted' },
    }
    await service.authorize(approved, new AbortController().signal)
    await service.attachRunState(approved.id, '{"version":1}', {
      name: approved.name,
      callId: approved.id,
    })
    const checkpoint = db.approvalCheckpointForToolCall(approved.id)!
    const option = service.rules.options(approved).find((rule) => rule.kind === 'command')
    expect(option).toBeTruthy()
    await service.respond(
      checkpoint.approvalID,
      'allow',
      undefined,
      undefined,
      undefined,
      option!.id,
    )
    const legacy = (await service.rules.list(approved.threadID)).rules.find(
      (rule) => rule.source === 'legacy' && rule.scope === 'chat',
    )
    expect(legacy).toMatchObject({ effect: 'allow', editable: true })
    expect(await service.rules.matches(approved)).toBe(true)
    expect(await service.rules.revoke(approved.threadID, legacy!.id)).toEqual({ revoked: true })
    expect(await service.rules.matches(approved)).toBe(false)
    expect(db.getApprovalCheckpoint(checkpoint.approvalID)?.status).toBe('resolved')
  })

  test('高版本库缺少权限规则表时隐藏 capability 且不修改库', async () => {
    const { db } = await fixture()
    db.sqlite.exec('DROP TABLE permission_chat_rules; DROP TABLE permission_grant_revocations;')
    expect(filterAdvertisedCapabilities(db)).not.toContain('permission.rules.v1')
    expect(db.sqlite.query('PRAGMA user_version').get() as { user_version: number }).toEqual({
      user_version: 65,
    })
  })
})
