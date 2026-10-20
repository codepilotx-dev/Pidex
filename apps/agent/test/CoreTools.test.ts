import { ContextCompactionService } from '../src/context/ContextCompactionService'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentError } from '../src/Domain'
import { ToolExecutor, type ToolExecutorOptions } from '../src/tool/ToolExecutor'
import { lineChangeSummary, ToolRegistry, type ToolOrigin } from '../src/tool/ToolRegistry'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import type { ToolingResolver, ToolProcessRunner } from '../src/tool/ToolingRuntime'
import { adaptToolDefinition } from '../src/orchestration/pi/PiToolAdapter'
import { AgentRuntimeService } from '../src/orchestration/AgentRuntimeService'
import { Effect } from 'effect'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { RuntimeCompositionRepository } from '../src/storage/repositories/RuntimeCompositionRepository'
import { ThreadService } from '../src/session/ThreadService'
import { PromptComposer } from '../src/prompt/PromptComposer'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentTools,
  getInitialSystemMessage,
  type TranscriptContext,
} from '@earendil-works/pi-ai'

const temporary: string[] = []
afterEach(async () => removeFixturePaths(temporary.splice(0)))

const fixture = async (
  runtime: {
    resolveTooling?: ToolingResolver
    runToolProcess?: ToolProcessRunner
    authorizeShell?: ToolExecutorOptions['authorizeShell']
    validateConfigDocument?: ToolExecutorOptions['validateConfigDocument']
    hooks?: ToolExecutorOptions['hooks']
    logger?: ToolExecutorOptions['logger']
  } = {},
) => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-core-tools-'))
  temporary.push(root)
  const workspace = await WorkspaceService.open(root)
  const toolingCalls: string[][] = []
  const executor = new ToolExecutor(new ToolRegistry(), {
    dataDir: join(root, '.agent-data'),
    userConfigPath: join(root, 'config.json'),
    ...(runtime.validateConfigDocument
      ? { validateConfigDocument: runtime.validateConfigDocument }
      : {}),
    ...(runtime.hooks ? { hooks: runtime.hooks } : {}),
    ...(runtime.logger ? { logger: runtime.logger } : {}),
    authorizeShell:
      runtime.authorizeShell ?? (async () => ({ decision: 'allow', risk: 'low', reason: 'test' })),
    resolveTooling:
      runtime.resolveTooling ??
      (async (id) => ({ available: true, path: `${id}.exe`, source: 'system', version: 'test' })),
    runToolProcess:
      runtime.runToolProcess ??
      (async ({ args }) => {
        toolingCalls.push([...args])
        if (args.includes('--files'))
          return { exitCode: 0, stdout: Buffer.from('alpha.ts\0beta.ts\0'), stderr: '' }
        const pattern = args.at(-2)
        if (pattern === 'needle' || pattern === 'NEE.*') {
          const line = JSON.stringify({
            type: 'match',
            data: {
              path: { text: 'alpha.ts' },
              lines: { text: 'export const needle = true\n' },
              line_number: 1,
              submatches: [{}],
            },
          })
          return { exitCode: 0, stdout: Buffer.from(`${line}\n`), stderr: '' }
        }
        return { exitCode: 1, stdout: Buffer.alloc(0), stderr: '' }
      }),
  })
  const context = {
    threadID: 'thread',
    turnID: 'turn',
    taskMode: 'chat' as const,
    signal: new AbortController().signal,
    workspace,
  }
  return { root, workspace, executor, context, toolingCalls }
}

const registerDeferredTool = (
  registry: ToolRegistry,
  sdkName: string,
  description: string,
  origin?: ToolOrigin,
) =>
  registry.register({
    sdkName,
    description,
    schema: z.object({}).strict(),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    capabilities: {
      filesystem: 'none',
      network: 'none',
      process: false,
      externalState: false,
      userInteraction: false,
    },
    allowedModes: ['chat', 'plan'],
    allowedProfiles: ['main', 'default', 'explorer', 'worker'],
    approvalStrategy: 'never-review',
    visibility: 'deferred',
    executionMode: 'parallel',
    ...(origin ? { origin } : {}),
    execute: async () => ({ ok: true }),
  })

const deferredToolExecutor = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-core-tools-'))
  temporary.push(root)
  const workspace = await WorkspaceService.open(root)
  const registry = new ToolRegistry()
  const executor = new ToolExecutor(registry, {
    dataDir: join(root, '.agent-data'),
    authorizeShell: async () => ({ decision: 'allow', risk: 'low', reason: 'test' }),
  })
  return { root, workspace, registry, executor }
}

describe('核心工具面', () => {
  test('配置文件写入强制审批并按用户/项目作用域预校验', async () => {
    const reviewed: Array<Record<string, unknown>> = []
    const validated: Array<{ text: string; scope: 'user' | 'project' }> = []
    const { root, executor, context } = await fixture({
      authorizeShell: async (invocation) => {
        reviewed.push({ ...invocation.permissionFacts })
        return { decision: 'allow', risk: 'medium', reason: 'approved' }
      },
      validateConfigDocument: (text, scope) => validated.push({ text, scope }),
    })
    await writeFile(join(root, 'config.json'), '{\n  "model": "old"\n}\n', 'utf8')

    const userAuthorization = await executor.execute<{ decision: string }>(
      'Write',
      { file_path: '@pidex/config.json', content: '{\n  "model": "new"\n}\n' },
      {
        ...context,
        authorizationOnly: true,
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
      },
    )
    expect(userAuthorization.decision).toBe('allow')
    expect(reviewed.at(-1)?.ruleRequiresApproval).toBe(true)
    expect(validated.at(-1)).toEqual({
      text: '{\n  "model": "new"\n}\n',
      scope: 'user',
    })

    await executor.execute<{ decision: string }>(
      'Write',
      { file_path: '.pidex/config.json', content: '{\n  "model": "project"\n}\n' },
      {
        ...context,
        authorizationOnly: true,
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
      },
    )
    expect(validated.at(-1)?.scope).toBe('project')
    await expect(
      executor.execute(
        'Write',
        { file_path: '@pidex/config.json', content: '{\n  "model": "blocked"\n}\n' },
        {
          ...context,
          authorizationOnly: true,
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'TOOL_PERMISSION_DENIED' })

    await writeFile(
      join(root, 'config.json'),
      '{\r\n  "model": "old",\r\n  "reasoning": "high"\r\n}\r\n',
      'utf8',
    )
    await executor.execute(
      'Edit',
      {
        path: '@pidex/config.json',
        edits: [
          {
            oldText: '  "model": "old",\n  "reasoning": "high"',
            newText: '  "model": "new",\n  "reasoning": "medium"',
          },
        ],
      },
      {
        ...context,
        authorizationOnly: true,
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
      },
    )
    expect(validated.at(-1)).toEqual({
      text: '{\r\n  "model": "new",\r\n  "reasoning": "medium"\r\n}\r\n',
      scope: 'user',
    })

    await executor.execute('Read', { file_path: '@pidex/config.json' }, context)
    await executor.execute(
      'apply_patch',
      {
        patch: [
          '*** Begin Patch',
          '*** Update File: @pidex/config.json',
          '@@',
          '-  "model": "old",',
          '+  "model": "patched",',
          '*** End Patch',
        ].join('\n'),
      },
      {
        ...context,
        authorizationOnly: true,
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
      },
    )
    expect(validated.at(-1)).toEqual({
      text: '{\r\n  "model": "patched",\r\n  "reasoning": "high"\r\n}\r\n',
      scope: 'user',
    })
  })

  test('只暴露规范名称，并用同一计划收紧 Skill allowlist', async () => {
    const { executor, context } = await fixture()
    const plan = executor.exposurePlan({
      taskMode: 'chat',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      profile: 'main',
      allowedTools: ['Read', 'workspace_search'],
    })
    expect(plan.exposed).toEqual(['Read'])
    expect(executor.definition('workspace.read').sdkName).toBe('Read')
    const properties = (name: string) =>
      Object.keys(executor.definition(name).inputSchema.properties as Record<string, unknown>)
    const property = (name: string, key: string) =>
      (
        executor.definition(name).inputSchema.properties as Record<string, { description?: string }>
      )[key]
    expect(properties('Read')).toEqual(['file_path', 'offset', 'limit'])
    expect(properties('apply_patch')).toEqual(['patch'])
    expect(properties('Write')).toEqual(['file_path', 'content'])
    expect(properties('Edit')).toEqual(['path', 'edits'])
    expect(properties('PowerShell')).toEqual([
      'command',
      'cwd',
      'timeout',
      'description',
      'additionalPermissions',
    ])
    expect(properties('ToolSearch')).toEqual(['query', 'max_results', 'offset'])
    expect(property('Read', 'file_path')?.description).toContain('只接受文件')
    expect(property('Write', 'file_path')?.description).toContain('必须先成功 Read')
    expect(property('Edit', 'path')?.description).toContain('必须先成功 Read')
    expect(property('Glob', 'path')?.description).toContain('不得传文件路径')
    expect(property('Grep', 'path')?.description).toContain('限制文件范围请使用 glob')
    expect(property('apply_patch', 'patch')?.description).toContain('*** Begin Patch')
    expect(property('apply_patch', 'patch')?.description).toContain('*** End Patch')
    expect(property('apply_patch', 'patch')?.description).toContain('禁止 Markdown 代码围栏')
    await Bun.write(join(context.workspace.rootPath, 'internal.txt'), 'internal')
    await expect(
      executor
        .execute<any>('workspace.read', { file_path: 'internal.txt' }, context)
        .then((result) => result.content),
    ).resolves.toBe('internal')
    expect(() => executor.definition('workspace_read')).toThrow()
    expect(() => executor.definition('shell')).toThrow()
    const defaultPlan = executor.exposurePlan({
      taskMode: 'chat',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      profile: 'main',
    })
    expect(defaultPlan.eager).toContain('Edit')
    expect(defaultPlan.exposed).toContain('spawn_agents')
    expect(defaultPlan.eager).not.toContain('apply_patch')
    expect(defaultPlan.deferred).toContain('apply_patch')
    const sideChatPlan = executor.exposurePlan({
      taskMode: 'chat',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      profile: 'main',
      delegationEnabled: false,
    })
    expect(sideChatPlan.exposed).not.toContain('spawn_agents')
    expect(sideChatPlan.exposed).not.toContain('wait_agents')
    expect(sideChatPlan.exposed).not.toContain('send_agent')
    expect(sideChatPlan.exposed).not.toContain('stop_agent')
    const editSkillPlan = executor.exposurePlan({
      taskMode: 'chat',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      profile: 'main',
      allowedTools: ['Edit'],
    })
    expect(editSkillPlan.exposed).toContain('Edit')
    expect(editSkillPlan.exposed).not.toContain('apply_patch')
    await expect(
      executor.execute(
        'Edit',
        {
          file_path: 'legacy.txt',
          old_string: 'old',
          new_string: 'new',
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TOOL_INPUT' })
  })

  test('ToolSearch 返回延迟注册表激活提示，进度由定义回调统一上报', async () => {
    const { executor, context } = await fixture()
    const registry = new ToolRegistry()
    registry.register({
      sdkName: 'deferred_example',
      description: '延迟示例工具',
      schema: z.object({}).strict(),
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      capabilities: {
        filesystem: 'none',
        network: 'none',
        process: false,
        externalState: false,
        userInteraction: false,
      },
      allowedModes: ['chat', 'plan'],
      allowedProfiles: ['main', 'default', 'explorer', 'worker'],
      approvalStrategy: 'never-review',
      visibility: 'deferred',
      executionMode: 'parallel',
      execute: async () => ({ ok: true }),
    })
    registry.register({
      sdkName: 'new_deferred_example',
      description: '组合冻结后新增的延迟工具',
      schema: z.object({}).strict(),
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      capabilities: {
        filesystem: 'none',
        network: 'none',
        process: false,
        externalState: false,
        userInteraction: false,
      },
      allowedModes: ['chat', 'plan'],
      allowedProfiles: ['main', 'default', 'explorer', 'worker'],
      approvalStrategy: 'never-review',
      visibility: 'deferred',
      executionMode: 'parallel',
      execute: async () => ({ ok: true }),
    })
    const searchable = new ToolExecutor(registry)
    const frozenContext = { ...context, frozenDeferredToolNames: ['deferred_example'] }
    const result = await searchable.execute<any>(
      'ToolSearch',
      { query: 'select:deferred_example' },
      frozenContext,
    )
    expect(result.addedToolNames).toEqual(['deferred_example'])
    await expect(
      searchable.execute('ToolSearch', { query: 'select:new_deferred_example' }, frozenContext),
    ).rejects.toMatchObject({ code: 'DEFERRED_TOOL_NOT_FOUND' })

    // 普通搜索命中即激活，浏览与分页只覆盖冻结后的延迟信封。
    const searched = await searchable.execute<any>('ToolSearch', { query: '示例' }, frozenContext)
    expect(searched.addedToolNames).toEqual(['deferred_example'])
    expect(searched.total).toBe(1)
    const browsed = await searchable.execute<any>('ToolSearch', { query: '*' }, frozenContext)
    expect(browsed.addedToolNames).toEqual(['deferred_example'])
    expect(
      await searchable.execute<any>('ToolSearch', { query: '*', offset: 1 }, frozenContext),
    ).toMatchObject({ tools: [], total: 1, offset: 1, addedToolNames: [] })
    // 同一个注册表：冻结信封只暴露冻结项，未冻结的实时范围不参与本轮激活。
    await expect(
      searchable.execute<any>('ToolSearch', { query: 'select:new_deferred_example' }, context),
    ).resolves.toMatchObject({ addedToolNames: ['new_deferred_example'] })

    const progress: unknown[] = []
    await Bun.write(join(context.workspace.rootPath, 'progress.txt'), 'ok')
    await executor.execute(
      'Read',
      { file_path: 'progress.txt' },
      { ...context, onProgress: (item) => progress.push(item) },
    )
    expect(progress).toEqual([{ message: '正在读取 progress.txt' }])
  })

  test('能力目录把延迟工具名称、描述与 MCP 来源写入冻结提示词', async () => {
    const { registry, executor } = await deferredToolExecutor()
    registerDeferredTool(registry, 'browser.open', '打开并操作浏览器页面')
    registerDeferredTool(registry, 'mcp_report', '生成 MCP 报告', {
      kind: 'mcp',
      serverName: 'demo-server',
      rawToolName: 'report',
      generation: 1,
    })
    const runtime = new AgentRuntimeService({
      db: {} as never,
      hub: {} as never,
      models: {} as never,
      toolExecutor: executor,
      contextCompaction: {} as never,
    })
    const input = {
      taskMode: 'chat' as const,
      sandboxMode: 'workspace-write' as const,
      approvalPolicy: 'on-request' as const,
      profile: 'main' as const,
    }
    const section = runtime.capabilityCatalog(input)
    expect(section.id).toBe('capabilities.catalog')
    expect(section.content).toContain('- browser.open: 打开并操作浏览器页面')
    expect(section.content).toContain('- mcp_report: 生成 MCP 报告 [mcp:demo-server]')
    const bundle = new PromptComposer().compose({
      threadID: 'thread',
      mode: 'chat',
      profile: 'main',
      exposedTools: ['Read'],
      sections: [section],
    })
    expect(bundle.instructions).toContain('mcp_report')
    expect(bundle.instructions).toContain('offset')
    // 受限范围不能被搜索或目录扩大：allowlist 收紧后目录只保留允许发现的工具。
    expect(
      runtime.capabilityCatalog({ ...input, allowedTools: ['browser.open'] }).content,
    ).not.toContain('mcp_report')
  })

  test('真实运行时冻结能力目录、激活搜索结果，预览使用工作区 MCP 且恢复不扩大范围', async () => {
    const { root, workspace, executor } = await deferredToolExecutor()
    const registry = new ToolRegistry()
    registerDeferredTool(registry, 'mcp_report', '生成 MCP 报告', {
      kind: 'mcp',
      serverName: 'demo-server',
      rawToolName: 'report',
      generation: 1,
    })
    const db = new AgentDatabase({
      historyPath: join(root, 'history.sqlite'),
      profilePath: join(root, 'profile.sqlite'),
    })
    const faux = fauxProvider({ models: [{ id: 'test', input: ['text'], contextWindow: 64_000 }] })
    const models = createModels()
    models.setProvider(faux.provider)
    const permissionConfig = {
      sandboxMode: 'workspace-write' as const,
      approvalPolicy: 'on-request' as const,
      approvalsReviewer: 'user' as const,
    }
    const model = { providerID: faux.getModel().provider, id: 'test' } as never
    const thread = db.createThread()
    const turn = db.createTurn(thread.id, {
      content: 'find',
      model,
      permissionConfig,
      strategy: 'queue',
      taskMode: 'chat',
    })
    db.claimTurnExecution(turn.turnID)
    const runtime = new AgentRuntimeService({
      db,
      models,
      toolExecutor: executor,
      hub: { publish: () => Effect.succeed(undefined) } as never,
      contextCompaction: new ContextCompactionService(db),
    })
    const request = {
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      sessionID: crypto.randomUUID(),
      content: 'find',
      taskMode: 'chat' as const,
      fallbackModel: model,
      permissionConfig,
      signal: new AbortController().signal,
      workspace,
      toolCatalog: registry,
      promptSections: [],
      resolveModel: async () => ({ ref: model, model: faux.getModel() }),
      pause: async () => {
        throw new Error('unexpected pause')
      },
    }
    const prompts: string[] = []
    const capture = (context: TranscriptContext) => {
      const system = getInitialSystemMessage(context.messages)
      prompts.push(
        typeof system?.content === 'string' ? system.content : JSON.stringify(system?.content),
      )
      return fauxAssistantMessage('done')
    }
    faux.setResponses([
      (context: TranscriptContext) => {
        capture(context)
        return fauxAssistantMessage(fauxToolCall('ToolSearch', { query: 'report' }), {
          stopReason: 'toolUse',
        })
      },
      (context: TranscriptContext) => {
        expect(getCurrentTools(context.messages).map((tool) => tool.name)).toContain('mcp_report')
        return capture(context)
      },
    ])
    try {
      let releases = 0
      const threads = new ThreadService(
        db,
        {} as never,
        {} as never,
        {} as never,
        { setResumeHandler: () => undefined } as never,
        runtime,
        { setParentResumeHandler: () => undefined } as never,
        {} as never,
        { dataRoot: root, userHome: root },
        { recall: () => [] } as never,
        {} as never,
        {
          resolve: async () => ({
            kind: 'projectless',
            workspaceRoot: root,
            cwd: root,
            outputDirectory: root,
          }),
        } as never,
        undefined,
        undefined,
        {
          acquire: async (cwd: string) => {
            expect(cwd).toBe(root)
            return {
              catalog: registry,
              serverInstructions: [],
              release: async () => {
                releases++
              },
            }
          },
        } as never,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
      )
      const preview = await threads.promptPreview(thread.id)
      const previewCatalog = preview.sections.find(
        (section) => section.id === 'capabilities.catalog',
      )!
      expect(previewCatalog.content).toContain('mcp_report')
      expect(releases).toBe(1)
      await runtime.run(request)
      expect(prompts[0]).toContain('mcp_report')
      expect(prompts[0]).toContain('[mcp:demo-server]')
      const repository = new RuntimeCompositionRepository(db)
      const frozen = repository.get(turn.turnID)!.snapshot
      expect(frozen.prompt.instructions).toContain(previewCatalog.content)
      expect(frozen.tools.deferred).toContain('mcp_report')
      registerDeferredTool(registry, 'new_live_tool', '新工具')
      faux.setResponses([capture])
      await runtime.run({ ...request, resume: { state: '', interruption: null, answer: null } })
      expect(prompts.at(-1)).not.toContain('new_live_tool')
      expect(repository.get(turn.turnID)!.snapshot.identity.hash).toBe(frozen.identity.hash)
    } finally {
      await runtime.dispose()
      db.close()
    }
  })
  test('Pi 工具适配器归一化批量 Edit 参数并透传 apply_patch grammar', async () => {
    const { executor } = await fixture()
    const options = { executor, request: {} as never }
    const edit = adaptToolDefinition(executor.definition('Edit'), options)
    expect(
      edit.prepareArguments?.({
        path: 'source.txt',
        edits: JSON.stringify([{ oldText: 'before', newText: 'after' }]),
      }),
    ).toEqual({
      path: 'source.txt',
      edits: [{ oldText: 'before', newText: 'after' }],
    })

    const patch = adaptToolDefinition(executor.definition('apply_patch'), options)
    expect(patch.constrainedSampling).toMatchObject({
      type: 'grammar',
      variants: {
        openai_lark: expect.stringContaining('begin_patch: "*** Begin Patch" LF'),
      },
    })
  })

  test('Read 返回快照，Write 和 Edit 拒绝陈旧快照', async () => {
    const { root, executor, context } = await fixture()
    await writeFile(join(root, 'source.txt'), 'before', 'utf8')
    const read = await executor.execute<any>('Read', { file_path: 'source.txt' }, context)
    expect(read).toMatchObject({ content: 'before', snapshot: { sha256: expect.any(String) } })

    await writeFile(join(root, 'source.txt'), 'changed elsewhere', 'utf8')
    await expect(
      executor.execute('Write', { file_path: 'source.txt', content: 'overwrite' }, context),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FILE_STALE' })
    await expect(
      executor.execute(
        'Edit',
        {
          path: 'source.txt',
          edits: [{ oldText: 'changed', newText: 'edited' }],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FILE_STALE' })
  })

  test('Edit 基于同一原文原子应用多项编辑', async () => {
    const { root, executor, context } = await fixture()
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const path = join(root, 'batch.txt')
    await writeFile(path, Buffer.concat([bom, Buffer.from('first middle last', 'utf8')]))
    await executor.execute('Read', { file_path: 'batch.txt' }, context)
    await executor.execute(
      'Edit',
      {
        path: 'batch.txt',
        edits: [
          { oldText: 'first', newText: '1' },
          { oldText: 'last', newText: '3' },
        ],
      },
      context,
    )
    expect(
      await Bun.file(path)
        .arrayBuffer()
        .then((value) => Buffer.from(value)),
    ).toEqual(Buffer.concat([bom, Buffer.from('1 middle 3', 'utf8')]))
  })

  test('Write 和 Edit 返回准确的逐行增删统计及安全 Pi 摘要', async () => {
    const { root, executor, context } = await fixture()
    await writeFile(join(root, 'source.txt'), 'first\nbefore\nlast\n', 'utf8')
    await executor.execute('Read', { file_path: 'source.txt' }, context)
    const write = await executor.execute<{
      additions: number
      deletions: number
    }>(
      'Write',
      {
        file_path: 'source.txt',
        content: 'first\nafter\nnext\nlast\n',
      },
      context,
    )
    expect(write).toMatchObject({ additions: 2, deletions: 1 })

    await executor.execute('Read', { file_path: 'source.txt' }, context)
    const edit = await executor.execute<{
      additions: number
      deletions: number
    }>(
      'Edit',
      {
        path: 'source.txt',
        edits: [{ oldText: 'after\nnext', newText: 'done' }],
      },
      context,
    )
    expect(edit).toMatchObject({ additions: 1, deletions: 2 })
    expect(lineChangeSummary('same\n', 'same\n')).toEqual({ additions: 0, deletions: 0 })

    const formatted = executor.definition('Edit').formatResult?.(
      {
        operation: 'edit',
        path: 'source.txt',
        additions: 1,
        deletions: 2,
        beforeSha256: 'before-secret',
        afterSha256: 'after-secret',
      },
      {} as never,
    )
    expect(formatted).toEqual({
      content: '已编辑 source.txt（+1 -2）',
      details: {
        operation: 'edit',
        path: 'source.txt',
        additions: 1,
        deletions: 2,
      },
    })
  })

  test('Edit 在上下文不唯一或编辑范围重叠时保持文件不变', async () => {
    const { root, executor, context } = await fixture()
    const ambiguousPath = join(root, 'ambiguous.txt')
    await writeFile(ambiguousPath, 'same middle same', 'utf8')
    await executor.execute('Read', { file_path: 'ambiguous.txt' }, context)
    await expect(
      executor.execute(
        'Edit',
        {
          path: 'ambiguous.txt',
          edits: [{ oldText: 'same', newText: 'next' }],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PATCH_CONTEXT_AMBIGUOUS' })
    expect(await Bun.file(ambiguousPath).text()).toBe('same middle same')

    const overlapPath = join(root, 'overlap.txt')
    await writeFile(overlapPath, 'abcdef', 'utf8')
    await executor.execute('Read', { file_path: 'overlap.txt' }, context)
    await expect(
      executor.execute(
        'Edit',
        {
          path: 'overlap.txt',
          edits: [
            { oldText: 'abc', newText: 'left' },
            { oldText: 'bcd', newText: 'right' },
          ],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PATCH_OVERLAPPING_HUNKS' })
    expect(await Bun.file(overlapPath).text()).toBe('abcdef')
  })

  test('Edit 将 Read 返回的换行上下文应用到 CRLF 文件并保持原换行', async () => {
    const { root, executor, context } = await fixture()
    const path = join(root, 'crlf.txt')
    await writeFile(path, 'first\r\nalpha\r\nbeta\r\n--\r\nsecond\r\nalpha\r\nbeta\r\n', 'utf8')
    await executor.execute('Read', { file_path: 'crlf.txt' }, context)
    await executor.execute(
      'Edit',
      {
        path: 'crlf.txt',
        edits: [
          { oldText: 'first\nalpha\nbeta', newText: 'first\ngamma\ndelta' },
          { oldText: 'second\nalpha\nbeta', newText: 'second\ngamma\ndelta' },
        ],
      },
      context,
    )
    expect(await Bun.file(path).text()).toBe(
      'first\r\ngamma\r\ndelta\r\n--\r\nsecond\r\ngamma\r\ndelta\r\n',
    )
  })

  test('Edit 不会把裸 LF 精确命中到 CRLF 的中间位置', async () => {
    const { root, executor, context } = await fixture()
    const path = join(root, 'crlf-boundary.txt')
    await writeFile(path, 'a\r\nb\r\n', 'utf8')
    await executor.execute('Read', { file_path: 'crlf-boundary.txt' }, context)
    await executor.execute(
      'Edit',
      { path: 'crlf-boundary.txt', edits: [{ oldText: '\nb', newText: '\nc' }] },
      context,
    )
    expect(await Bun.file(path).text()).toBe('a\r\nc\r\n')
  })

  test('Read 与 Edit 使用同一文件的绝对和相对路径时共享快照', async () => {
    const { root, executor, context } = await fixture()
    const path = join(root, 'source.txt')
    await writeFile(path, 'before', 'utf8')
    await executor.execute('Read', { file_path: path }, context)
    await executor.execute(
      'Edit',
      {
        path: 'source.txt',
        edits: [{ oldText: 'before', newText: 'after' }],
      },
      context,
    )
    expect(await Bun.file(path).text()).toBe('after')
  })

  test('apply_patch 在一次调用中新增并更新文件，保留 BOM/CRLF 并刷新多文件快照', async () => {
    const { root, executor, context } = await fixture()
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const source = join(root, 'source.txt')
    await writeFile(
      source,
      Buffer.concat([bom, Buffer.from('alpha\r\nbefore\r\nomega\r\n', 'utf8')]),
    )
    await executor.execute('Read', { file_path: 'source.txt' }, context)

    const result = await executor.execute<any>(
      'apply_patch',
      {
        patch: [
          '*** Begin Patch',
          '*** Update File: source.txt',
          '@@',
          '-before',
          '+after',
          '*** Add File: created.txt',
          '+created',
          '*** End Patch',
        ].join('\n'),
      },
      context,
    )

    expect(result).toMatchObject({
      operation: 'apply_patch',
      files: [
        { operation: 'update', path: 'source.txt', additions: 1, deletions: 1 },
        { operation: 'create', path: 'created.txt', additions: 1, deletions: 0 },
      ],
      summary: { fileCount: 2, hunkCount: 1, additions: 2, deletions: 1 },
    })
    expect(
      await Bun.file(source)
        .arrayBuffer()
        .then((value) => Buffer.from(value)),
    ).toEqual(Buffer.concat([bom, Buffer.from('alpha\r\nafter\r\nomega\r\n', 'utf8')]))
    expect(await Bun.file(join(root, 'created.txt')).text()).toBe('created\n')

    await executor.execute(
      'apply_patch',
      {
        patch: [
          '*** Begin Patch',
          '*** Update File: source.txt',
          '@@',
          '-after',
          '+again',
          '*** End Patch',
        ].join('\n'),
      },
      context,
    )
    expect(
      await Bun.file(source)
        .arrayBuffer()
        .then((value) => Buffer.from(value)),
    ).toEqual(Buffer.concat([bom, Buffer.from('alpha\r\nagain\r\nomega\r\n', 'utf8')]))
  })

  test('apply_patch 任一 Update 缺少 Read 快照时整批零写入', async () => {
    const { root, executor, context } = await fixture()
    await writeFile(join(root, 'first.txt'), 'first\n', 'utf8')
    await writeFile(join(root, 'second.txt'), 'second\n', 'utf8')
    await executor.execute('Read', { file_path: 'first.txt' }, context)

    await expect(
      executor.execute(
        'apply_patch',
        {
          patch: [
            '*** Begin Patch',
            '*** Update File: first.txt',
            '@@',
            '-first',
            '+changed-first',
            '*** Update File: second.txt',
            '@@',
            '-second',
            '+changed-second',
            '*** End Patch',
          ].join('\n'),
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FILE_STALE' })

    expect(await Bun.file(join(root, 'first.txt')).text()).toBe('first\n')
    expect(await Bun.file(join(root, 'second.txt')).text()).toBe('second\n')
  })

  test('apply_patch 任一受保护目标会让整批进入审批并投影全部安全路径', async () => {
    const reviewed: any[] = []
    const { root, executor, context } = await fixture({
      authorizeShell: async (invocation) => {
        reviewed.push(invocation)
        return { decision: 'allow', risk: 'high', reason: 'approved' }
      },
    })
    await mkdir(join(root, '.git', 'hooks'), { recursive: true })
    await mkdir(join(root, 'vendor', 'repo', '.git', 'hooks'), { recursive: true })

    const result = await executor.execute<any>(
      'apply_patch',
      {
        patch: [
          '*** Begin Patch',
          '*** Add File: normal.txt',
          '+normal',
          '*** Add File: .git/hooks/pre-commit',
          '+hook',
          '*** Add File: vendor/repo/.git/hooks/pre-push',
          '+nested-hook',
          '*** End Patch',
        ].join('\n'),
      },
      {
        ...context,
        authorizationOnly: true,
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
      },
    )

    expect(result).toMatchObject({
      decision: 'allow',
      authorizationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(reviewed.at(-1)?.authorizationScope).toMatchObject({
      ruleRequiresApproval: true,
      affectedPaths: [
        { operation: 'create', path: 'normal.txt' },
        { operation: 'create', path: '.git/hooks/pre-commit' },
        { operation: 'create', path: 'vendor/repo/.git/hooks/pre-push' },
      ],
    })
    expect(reviewed.at(-1)?.permissionFacts).toMatchObject({ risk: 'high', ruleRequiresApproval: true })
    expect(reviewed.at(-1)?.fileDiffs).toEqual([
      expect.objectContaining({
        path: 'normal.txt',
        operation: 'create',
        renderable: true,
        patch: expect.stringContaining('+normal'),
      }),
    ])
    expect(await Bun.file(join(root, 'normal.txt')).exists()).toBe(false)
    expect(await Bun.file(join(root, '.git', 'hooks', 'pre-commit')).exists()).toBe(false)
    expect(await Bun.file(join(root, 'vendor', 'repo', '.git', 'hooks', 'pre-push')).exists()).toBe(
      false,
    )
  })

  test('apply_patch 在 .git 目录被用作工作区根时仍强制整批审批', async () => {
    const reviewed: any[] = []
    const { root, executor, context } = await fixture({
      authorizeShell: async (invocation) => {
        reviewed.push(invocation)
        return { decision: 'allow', risk: 'high', reason: 'approved' }
      },
    })
    const gitRoot = join(root, '.git')
    const hooksRoot = join(gitRoot, 'hooks')
    await mkdir(hooksRoot, { recursive: true })
    const permissionConfig = {
      sandboxMode: 'workspace-write' as const,
      approvalPolicy: 'on-request' as const,
      approvalsReviewer: 'user' as const,
    }

    const gitWorkspace = await WorkspaceService.open(gitRoot)
    await executor.execute(
      'apply_patch',
      {
        patch: [
          '*** Begin Patch',
          '*** Add File: normal.txt',
          '+normal',
          '*** Add File: hooks/pre-commit',
          '+hook',
          '*** End Patch',
        ].join('\n'),
      },
      {
        ...context,
        workspace: gitWorkspace,
        authorizationOnly: true,
        permissionConfig,
      },
    )
    expect(reviewed.at(-1)?.authorizationScope).toMatchObject({
      ruleRequiresApproval: true,
      affectedPaths: [
        { operation: 'create', path: 'normal.txt' },
        { operation: 'create', path: 'hooks/pre-commit' },
      ],
    })

    const multiRootWorkspace = await WorkspaceService.openRoots({
      primaryRoot: root,
      roots: [
        { path: root, role: 'primary' },
        { folderId: 'git-hooks', path: hooksRoot, role: 'secondary' },
      ],
    })
    await executor.execute(
      'apply_patch',
      {
        patch: [
          '*** Begin Patch',
          '*** Add File: workspace-normal.txt',
          '+normal',
          `*** Add File: ${join(hooksRoot, 'pre-push')}`,
          '+hook',
          '*** End Patch',
        ].join('\n'),
      },
      {
        ...context,
        workspace: multiRootWorkspace,
        authorizationOnly: true,
        permissionConfig,
      },
    )
    expect(reviewed.at(-1)?.authorizationScope).toMatchObject({
      ruleRequiresApproval: true,
      affectedPaths: [
        { operation: 'create', path: 'workspace-normal.txt' },
        { operation: 'create', path: '@workspace/git-hooks/pre-push' },
      ],
    })
  })

  test('apply_patch 快照失效失败不会遮蔽原始部分提交错误', async () => {
    const { root, workspace, executor, context } = await fixture()
    const target = join(root, 'source.txt')
    await writeFile(target, 'before\n', 'utf8')
    await executor.execute('Read', { file_path: 'source.txt' }, context)
    workspace.commitEditorMutations = async () => {
      await rm(target, { force: true })
      await mkdir(target)
      throw new AgentError('PATCH_PARTIAL_COMMIT', '内部部分提交错误', 500, {
        committed: ['source.txt'],
        pending: [],
      })
    }

    const error = await executor
      .execute(
        'apply_patch',
        {
          patch: [
            '*** Begin Patch',
            '*** Update File: source.txt',
            '@@',
            '-before',
            '+after',
            '*** End Patch',
          ].join('\n'),
        },
        context,
      )
      .catch((cause) => cause)

    expect(error).toBeInstanceOf(AgentError)
    if (!(error instanceof AgentError)) throw error
    expect(error.code).toBe('PATCH_PARTIAL_COMMIT')
    expect(error.details).toEqual({ committed: ['source.txt'], pending: [] })
    expect(error.message).not.toContain(root)
  })

  test('Glob 与 Grep 有界返回，Shell schema 禁止后台和绕过参数', async () => {
    const { root, executor, context, toolingCalls } = await fixture()
    await Bun.write(join(root, 'alpha.ts'), 'export const needle = true')
    await Bun.write(join(root, 'beta.ts'), 'export const other = true')
    const glob = await executor.execute<any>('Glob', { pattern: '*.ts', limit: 1 }, context)
    expect(glob.matches).toHaveLength(1)
    expect(glob.truncated).toBe(true)
    expect(glob.engine).toBe('ripgrep')
    const grep = await executor.execute<any>('Grep', { pattern: 'needle', head_limit: 1 }, context)
    expect(grep.matches).toHaveLength(1)
    expect(grep.engine).toBe('ripgrep')
    const regex = await executor.execute<any>(
      'Grep',
      { pattern: 'NEE.*', '-i': true, output_mode: 'files_with_matches', glob: '*.ts' },
      context,
    )
    expect(regex.files).toEqual(['alpha.ts'])
    expect(toolingCalls[0]).toEqual([
      '--files',
      '--null',
      '--color',
      'never',
      '--sort',
      'path',
      '--glob',
      '*.ts',
      '--',
      '.',
    ])
    expect(toolingCalls[2]).toContain('--ignore-case')
    expect(toolingCalls[2]).toContain('--glob')
    await expect(
      executor.execute('PowerShell', { command: 'Get-Date', run_in_background: true }, context),
    ).rejects.toMatchObject({ code: 'INVALID_TOOL_INPUT' })
    await expect(
      executor.execute('Bash', { command: 'pwd', dangerouslyDisableSandbox: true }, context),
    ).rejects.toMatchObject({ code: 'INVALID_TOOL_INPUT' })
  })

  test('Glob/Grep 接受绝对读取路径并拒绝未规范化的相对越界', async () => {
    const { root, executor, context, toolingCalls } = await fixture()
    await Bun.write(join(root, 'alpha.ts'), 'export const needle = true')
    await executor.execute('Glob', { pattern: '*.ts', path: root }, context)
    expect(toolingCalls.at(-1)?.at(-1)).toBe('.')

    const outside = await mkdtemp(join(tmpdir(), 'pidex-core-tools-outside-'))
    temporary.push(outside)
    await expect(
      executor.execute('Glob', { pattern: '*.ts', path: outside }, context),
    ).resolves.toHaveProperty('matches')
    await expect(
      executor.execute('Glob', { pattern: '*.ts', path: '../outside' }, context),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_DENIED' })
  })

  test('未指定路径时 Glob/Grep 搜索所有项目根并区分附加目录结果', async () => {
    const resolveTooling: ToolingResolver = async () => ({
      available: false,
      code: 'SYSTEM_TOOL_NOT_FOUND',
      reason: '未找到 ripgrep',
    })
    const { root, executor, context } = await fixture({ resolveTooling })
    const secondary = await mkdtemp(join(tmpdir(), 'pidex-core-tools-secondary-'))
    temporary.push(secondary)
    await Bun.write(join(root, 'primary.ts'), "export const needle = 'primary'")
    await Bun.write(join(secondary, 'secondary.ts'), "export const needle = 'secondary'")
    const workspace = await WorkspaceService.openRoots({
      primaryRoot: root,
      roots: [
        { path: root, role: 'primary' },
        { path: secondary, role: 'secondary' },
      ],
    })

    const glob = await executor.execute<any>('Glob', { pattern: '*.ts' }, { ...context, workspace })
    expect(glob.matches).toEqual(
      ['primary.ts', join(secondary, 'secondary.ts')].sort((left, right) =>
        left.localeCompare(right),
      ),
    )
    const grep = await executor.execute<any>(
      'Grep',
      { pattern: 'needle', output_mode: 'files_with_matches' },
      { ...context, workspace },
    )
    expect(grep.files).toEqual(['primary.ts', join(secondary, 'secondary.ts')])
  })

  test('ripgrep 不可用时 Glob/Grep 使用有界原生降级', async () => {
    const resolveTooling: ToolingResolver = async () => ({
      available: false,
      code: 'SYSTEM_TOOL_NOT_FOUND',
      reason: '未找到 ripgrep',
    })
    const runToolProcess: ToolProcessRunner = async () => {
      throw new Error('原生降级不得启动 ripgrep')
    }
    const { root, executor, context } = await fixture({ resolveTooling, runToolProcess })
    await mkdir(join(root, 'src'))
    await Bun.write(join(root, 'Main.java'), 'class Main {\n  String value = "needle";\n}\n')
    await Bun.write(join(root, 'other.txt'), 'needle\n')
    await Bun.write(join(root, 'src', 'Nested.java'), 'class Nested {}\n')

    const glob = await executor.execute<any>('Glob', { pattern: '**/*.{java,txt}' }, context)
    expect(glob).toMatchObject({
      matches: ['Main.java', 'other.txt', 'src/Nested.java'],
      engine: 'native-fallback',
    })

    const grep = await executor.execute<any>(
      'Grep',
      {
        pattern: 'NEE.*',
        '-i': true,
        type: 'java',
        context: 1,
      },
      context,
    )
    expect(grep.engine).toBe('native-fallback')
    expect(grep.matches).toEqual([
      {
        path: 'Main.java',
        line: 2,
        text: '  String value = "needle";',
        before: ['class Main {'],
        after: ['}'],
      },
    ])
  })

  test('原生 Grep 对未知 ripgrep type 明确拒绝', async () => {
    const resolveTooling: ToolingResolver = async () => ({
      available: false,
      code: 'TOOLING_UNAVAILABLE',
      reason: '下载失败',
    })
    const { executor, context } = await fixture({ resolveTooling })
    await expect(
      executor.execute('Grep', { pattern: 'needle', type: 'unknown-language' }, context),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_SEARCH_FALLBACK_UNSUPPORTED',
    })
  })

  test('ripgrep 解析取消和进程启动后的错误均不触发原生降级', async () => {
    const abortedResolver: ToolingResolver = async () => ({
      available: false,
      code: 'TOOLING_ABORTED',
      reason: '已取消',
    })
    const aborted = await fixture({ resolveTooling: abortedResolver })
    await expect(
      aborted.executor.execute('Glob', { pattern: '*.ts' }, aborted.context),
    ).rejects.toMatchObject({ code: 'RUN_ABORTED' })

    let processCalls = 0
    const runToolProcess: ToolProcessRunner = async () => {
      processCalls += 1
      throw new AgentError('WORKSPACE_SEARCH_TIMEOUT', 'ripgrep 超时', 408)
    }
    const started = await fixture({ runToolProcess })
    await Bun.write(join(started.root, 'would-match.ts'), 'needle')
    await expect(
      started.executor.execute('Grep', { pattern: 'needle' }, started.context),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_SEARCH_TIMEOUT',
    })
    expect(processCalls).toBe(1)
  })

  test('文件修改失败日志记录安全阶段和统计且不包含路径或正文', async () => {
    const warnings: Array<{ event: string; fields: Record<string, unknown> }> = []
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      error: () => undefined,
      warn: (event: string, fields: Record<string, unknown>) => warnings.push({ event, fields }),
    } as unknown as NonNullable<ToolExecutorOptions['logger']>
    const hooks = {
      run: async (event: string) => {
        if (event.startsWith('post_tool_')) throw new Error('post hook secret')
        return []
      },
    } as unknown as NonNullable<ToolExecutorOptions['hooks']>
    const { root, executor, context } = await fixture({ logger, hooks })

    await expect(
      executor.execute(
        'Write',
        {
          file_path: 'C:\\Users\\Alice\\private.txt',
          content: 7,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TOOL_INPUT' })

    await expect(
      executor.execute(
        'Write',
        {
          file_path: 'denied.txt',
          content: 'authorization-secret',
        },
        {
          ...context,
          permissionConfig: {
            sandboxMode: 'read-only',
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'TOOL_PERMISSION_DENIED' })

    await writeFile(join(root, 'existing.txt'), 'old', 'utf8')
    await expect(
      executor.execute(
        'Write',
        {
          file_path: 'existing.txt',
          content: 'execute-secret',
        },
        context,
      ),
    ).rejects.toBeInstanceOf(AgentError)

    await executor.execute(
      'Write',
      {
        file_path: 'created.txt',
        content: 'post-hook-secret',
      },
      context,
    )

    const fileFailures = warnings.filter(({ event }) => event === 'file-tool.execution.failed')
    const phases = fileFailures.map(({ fields }) => (fields.details as { phase: string }).phase)
    expect(phases).toContain('normalize')
    expect(phases).toContain('authorization')
    expect(phases).toContain('execute')
    expect(phases).toContain('post-hook')
    const serialized = JSON.stringify(fileFailures)
    expect(serialized).not.toContain('Alice')
    expect(serialized).not.toContain('authorization-secret')
    expect(serialized).not.toContain('execute-secret')
    expect(serialized).not.toContain('post-hook-secret')
    expect(serialized).not.toContain('post hook secret')
    expect(serialized).toContain('[outside-workspace]')
    expect(serialized).toContain('"inputBytes":')
  })
})
