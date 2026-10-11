import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { Model, Provider } from '@pidex/model-schema'
import { DEFAULT_PERMISSION_CONFIG } from '@pidex/shared/thread'
import { createModels, fauxProvider } from '@earendil-works/pi-ai'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { RuntimeCompositionService } from '../src/runtime-composition/Service'
import {
  composeRuntimeComposition,
  createMcpGenerationBinding,
  rebindRuntimeComposition,
} from '../src/runtime-composition/Composer'
import type {
  RuntimeCompositionSnapshotV1,
  RuntimeCompositionSnapshotV2,
} from '../src/runtime-composition/Types'
import { SkillService } from '../src/prompt/SkillService'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await removeFixturePaths(paths.splice(0))
})

const snapshot = (turnID: string): RuntimeCompositionSnapshotV1 => ({
  version: 1,
  identity: { id: `rc:${turnID}`, version: 1, hash: `overall:${turnID}` },
  model: {
    providerID: 'openai',
    id: 'test',
    variant: null,
    contextWindow: 128_000,
    capabilities: { tools: true, input: ['text'], output: ['text'] },
  },
  workspace: {
    kind: 'project',
    cwd: 'C:/workspace',
    roots: ['C:/workspace'],
    outputDirectory: null,
    instructionSources: [],
  },
  permissions: {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
  },
  skills: { skills: [] },
  mcp: { workspaceKey: 'C:/workspace', bindingHash: 'mcp', serverInstructions: [] },
  tools: { eager: ['Read'], deferred: [], exposed: ['Read'] },
  prompt: {
    instructions: 'frozen prompt',
    stableContextText: 'frozen prompt',
    baseHash: 'base',
    contextHash: 'context',
    cacheHash: 'cache-hash',
    cacheKey: 'cache',
    diagnostics: [],
    contextItems: [],
    cacheSegments: [],
    cacheBoundaries: [],
  },
  context: { threadsActiveTurnID: turnID, sessionEntryID: null },
  capabilities: [{ id: 'agent.runtime-composition.v1', version: 1 }],
  hashes: {
    modelHash: 'model',
    permissionHash: 'permission',
    workspaceHash: 'workspace',
    skillsHash: 'skills',
    mcpHash: 'mcp',
    toolsHash: 'tools',
    promptHash: 'prompt',
    contextHash: 'context',
    overall: `overall:${turnID}`,
  },
})

const setup = () => {
  const path = join(tmpdir(), `pidex-runtime-composition-${crypto.randomUUID()}.sqlite`)
  paths.push(path)
  const db = new AgentDatabase(path)
  databases.push(db)
  const thread = db.createThread()
  const turn = db.createTurn(thread.id, {
    content: 'compose',
    model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    },
    strategy: 'queue',
    taskMode: 'chat',
  })
  db.claimTurnExecution(turn.turnID)
  const agent = db.sqlite
    .query('SELECT id FROM agent_executions WHERE turn_id = ?')
    .get(turn.turnID) as { id: string }
  return { db, turnID: turn.turnID, agentID: agent.id }
}

const runtime = (value: RuntimeCompositionSnapshotV1, release: () => void) => ({
  snapshot: value,
  bindings: { release: async () => release() } as never,
})

describe('RuntimeCompositionService', () => {
  test('首次 compose 在返回前持久化，resume 只 rebind 数据库权威 snapshot', async () => {
    const { db, turnID, agentID } = setup()
    const service = new RuntimeCompositionService({ db })
    let composeCalls = 0
    let rebindCalls = 0
    let releases = 0
    const first = await service.loadOrCompose({
      turnID,
      agentID,
      allowEphemeralFresh: false,
      compose: async () =>
        runtime(snapshot(turnID), () => {
          releases += 1
        }),
      rebind: async () => {
        throw new Error('fresh turn must not rebind')
      },
    })
    composeCalls += 1
    expect(service.repository.get(turnID)?.snapshot.prompt.instructions).toBe('frozen prompt')
    await first.release()
    await first.release()
    expect(releases).toBe(1)

    const resumed = await service.loadOrCompose({
      turnID,
      agentID,
      allowEphemeralFresh: false,
      compose: async () => {
        composeCalls += 1
        throw new Error('resume must not compose')
      },
      rebind: async (stored) => {
        rebindCalls += 1
        expect(stored.identity.id).toBe(`rc:${turnID}`)
        return { release: async () => undefined } as never
      },
    })
    expect(composeCalls).toBe(1)
    expect(rebindCalls).toBe(1)
    await resumed.release()
  })

  test('snapshot 行不可更新、hash 损坏时 fail-closed、删除 Turn 后级联删除', async () => {
    const { db, turnID, agentID } = setup()
    const repository = db.repositories.runtimeCompositions
    const first = snapshot(turnID)
    repository.insertOrGet({ turnID, agentID, compositionID: first.identity.id, snapshot: first })
    const changed = structuredClone(first)
    changed.prompt.instructions = 'new config must not replace old prompt'
    expect(() =>
      repository.insertOrGet({
        turnID,
        agentID,
        compositionID: changed.identity.id,
        snapshot: changed,
      }),
    ).not.toThrow()
    expect(repository.get(turnID)?.snapshot.prompt.instructions).toBe('frozen prompt')
    db.sqlite
      .query("UPDATE runtime_composition_plans SET snapshot_hash = 'tampered' WHERE turn_id = ?")
      .run(turnID)
    expect(() => repository.get(turnID)).toThrow('hash verification')
    db.sqlite.query('DELETE FROM turns WHERE id = ?').run(turnID)
    expect(
      db.sqlite
        .query('SELECT turn_id FROM runtime_composition_plans WHERE turn_id = ?')
        .get(turnID),
    ).toBeNull()
  })

  test('高版本缺表只允许 fresh ephemeral，恢复时 fail-closed 且不重组', async () => {
    const { db, turnID, agentID } = setup()
    db.sqlite.exec('DROP TABLE runtime_composition_plans')
    const service = new RuntimeCompositionService({ db })
    let composeCalls = 0
    const fresh = await service.loadOrCompose({
      turnID,
      agentID,
      allowEphemeralFresh: true,
      compose: async () => {
        composeCalls += 1
        return runtime(snapshot(turnID), () => undefined)
      },
      rebind: async () => {
        throw new Error('ephemeral fresh must not rebind')
      },
    })
    await fresh.release()
    await expect(
      service.loadOrCompose({
        turnID,
        agentID,
        allowEphemeralFresh: false,
        compose: async () => {
          composeCalls += 1
          return runtime(snapshot(turnID), () => undefined)
        },
        rebind: async () => {
          throw new Error('missing snapshot cannot rebind')
        },
      }),
    ).rejects.toMatchObject({ code: 'RUNTIME_COMPOSITION_UNAVAILABLE' })
    expect(composeCalls).toBe(1)
  })
})

describe('RuntimeCompositionSnapshotV2 Skills 引用冻结', () => {
  const writeSkill = async (root: string, name: string, body: string) => {
    const dir = join(root, '.pidex', 'skills', name)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}`,
      'utf8',
    )
  }
  const scan = async (workspace: string) => {
    const service = new SkillService()
    await service.scan({ workspaceRoot: workspace, dataRoot: workspace, userHome: workspace })
    return service
  }

  test('只冻结实际引用 Skill：无关变化不阻断恢复，引用变化 fail-closed', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pidex-rc-skill-'))
    paths.push(workspace)
    await writeSkill(workspace, 'alpha', 'alpha body')
    await writeSkill(workspace, 'beta', 'beta body')

    const skillService = await scan(workspace)
    await skillService.read('alpha')
    expect(skillService.referencedSkills().map(({ name }) => name)).toEqual(['alpha'])

    const faux = fauxProvider()
    const models = createModels()
    models.setProvider(faux.provider)
    const model = faux.getModel()
    const mcpBinding = createMcpGenerationBinding(workspace, {
      serverInstructions: [],
      definitions: [],
    })
    const promptBundle = {
      instructions: 'frozen prompt',
      stableContextText: 'frozen prompt',
      baseHash: 'base',
      contextHash: 'context',
      cacheHash: 'cache',
      cacheKey: 'cache',
      diagnostics: [],
      contextItems: [],
      cacheSegments: [],
      cacheBoundaries: [],
    }
    const toolContext = {
      threadID: 'thread-rc-skill',
      turnID: 'turn-rc-skill',
      agentID: 'agent-rc-skill',
      profile: 'main',
      taskMode: 'chat',
      signal: new AbortController().signal,
      workspace: {} as never,
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      model: { providerID: 'faux', id: 'test' } as never,
      taskSummary: 'x',
    } as never
    const modelRef = { providerID: 'faux', id: 'test' } as never
    const composeInput = {
      turnID: 'turn-rc-skill',
      threadID: 'thread-rc-skill',
      profile: 'main' as const,
      taskMode: 'chat' as const,
      model,
      modelRef,
      toolCatalog: {} as never,
      workspace: {} as never,
      workspaceScope: {
        kind: 'project' as const,
        cwd: workspace,
        roots: [workspace],
        outputDirectory: null,
        instructionSources: [],
      },
      sessionEntryID: null,
      skillService,
      mcpBinding,
      effectivePermissionConfig: DEFAULT_PERMISSION_CONFIG,
      toolContext,
      promptBundle,
      exposurePlan: { eager: [], deferred: [], exposed: [] },
    }
    const fresh = composeRuntimeComposition(composeInput)
    const snapshot = fresh.snapshot
    expect(snapshot.version).toBe(2)
    const v2 = snapshot as RuntimeCompositionSnapshotV2
    expect(v2.skills.referenced.map(({ name }) => name)).toEqual(['alpha'])
    expect(v2.skills.catalog.map(({ name }) => name).sort()).toEqual(['alpha', 'beta'])

    const rebindInput = {
      model,
      modelRef,
      workspace: {} as never,
      workspaceScope: composeInput.workspaceScope,
      skillService: await scan(workspace),
      mcpBinding,
      toolContext,
      toolCatalog: {} as never,
    }

    await writeSkill(workspace, 'beta', 'beta body changed')
    const rebound = rebindRuntimeComposition(snapshot, rebindInput)
    expect(rebound.skills.list()).toHaveLength(2)

    await writeSkill(workspace, 'alpha', 'alpha body changed')
    const stale = await scan(workspace)
    expect(() =>
      rebindRuntimeComposition(snapshot, { ...rebindInput, skillService: stale }),
    ).toThrow(/Frozen Skill alpha/)
  })
})

describe('RuntimeComposition rebind 生命周期工具', () => {
  const composeForRebind = async (workspace: string, exposed: readonly string[]) => {
    const skillService = new SkillService()
    await skillService.scan({ workspaceRoot: workspace, dataRoot: workspace, userHome: workspace })
    const faux = fauxProvider()
    const models = createModels()
    models.setProvider(faux.provider)
    const model = faux.getModel()
    const modelRef = { providerID: 'faux', id: 'test' } as never
    const mcpBinding = createMcpGenerationBinding(workspace, {
      serverInstructions: [],
      definitions: [],
    })
    const toolContext = {
      threadID: 'thread-rc-lifecycle',
      turnID: 'turn-rc-lifecycle',
      agentID: 'agent-rc-lifecycle',
      profile: 'main',
      taskMode: 'plan',
      signal: new AbortController().signal,
      workspace: {} as never,
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      model: { providerID: 'faux', id: 'test' } as never,
      taskSummary: 'x',
    } as never
    const input = {
      turnID: 'turn-rc-lifecycle',
      threadID: 'thread-rc-lifecycle',
      profile: 'main' as const,
      taskMode: 'plan' as const,
      model,
      modelRef,
      toolCatalog: {} as never,
      workspace: {} as never,
      workspaceScope: {
        kind: 'project' as const,
        cwd: workspace,
        roots: [workspace],
        outputDirectory: null,
        instructionSources: [],
      },
      sessionEntryID: null,
      skillService,
      mcpBinding,
      effectivePermissionConfig: DEFAULT_PERMISSION_CONFIG,
      toolContext,
      promptBundle: {
        instructions: 'frozen plan prompt',
        stableContextText: 'frozen plan prompt',
        baseHash: 'base',
        contextHash: 'context',
        cacheHash: 'cache',
        cacheKey: 'cache',
        diagnostics: [],
        contextItems: [],
        cacheSegments: [],
        cacheBoundaries: [],
      },
      exposurePlan: { eager: [], deferred: [], exposed: [...exposed] },
    }
    const fresh = composeRuntimeComposition(input)
    const rebindInput = {
      model,
      modelRef,
      workspace: {} as never,
      workspaceScope: input.workspaceScope,
      skillService,
      mcpBinding,
      toolContext,
      toolCatalog: {
        get: (name: string) => {
          if (name === 'Read') return { sdkName: 'Read' }
          throw new Error(`普通 catalog 未知工具: ${name}`)
        },
      } as never,
    }
    return { snapshot: fresh.snapshot, rebindInput }
  }

  test('Plan 快照恢复把 request_user_input 与 submit_plan 当作动态生命周期工具，不查询普通 catalog', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pidex-rc-lifecycle-'))
    paths.push(workspace)
    const { snapshot, rebindInput } = await composeForRebind(workspace, [
      'Read',
      'request_user_input',
      'submit_plan',
    ])

    // 普通工具 Read 仍走 catalog 校验；两个生命周期工具不在普通 catalog 中。
    const bindings = rebindRuntimeComposition(snapshot, rebindInput)
    expect(bindings.toolContext).toBe(rebindInput.toolContext)
    expect(bindings.toolCatalog).toBe(rebindInput.toolCatalog)
    expect(bindings.skills.list()).toEqual([])
  })

  test('快照包含未知的非生命周期工具时仍 fail-closed', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pidex-rc-lifecycle-unknown-'))
    paths.push(workspace)
    const { snapshot, rebindInput } = await composeForRebind(workspace, ['Read', 'Unknown.Tool'])

    expect(() => rebindRuntimeComposition(snapshot, rebindInput)).toThrow(
      /Frozen tool catalog is unavailable/,
    )
    try {
      rebindRuntimeComposition(snapshot, rebindInput)
    } catch (error) {
      expect(error).toMatchObject({ code: 'RUNTIME_COMPOSITION_UNAVAILABLE' })
    }
  })
})

describe('RuntimeCompositionSnapshotV2 引用证据持久化与组合身份', () => {
  const writeSkill = async (root: string, name: string, body: string) => {
    const dir = join(root, '.pidex', 'skills', name)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}`,
      'utf8',
    )
  }
  const scan = async (workspace: string) => {
    const service = new SkillService()
    await service.scan({ workspaceRoot: workspace, dataRoot: workspace, userHome: workspace })
    return service
  }
  const baseComposeInput = async (
    workspace: string,
    skillService: SkillService,
    overrides: Record<string, unknown> = {},
  ) => {
    const faux = fauxProvider()
    const models = createModels()
    models.setProvider(faux.provider)
    const model = faux.getModel()
    const mcpBinding = createMcpGenerationBinding(workspace, {
      serverInstructions: [],
      definitions: [],
    })
    const promptBundle = {
      instructions: 'frozen prompt',
      stableContextText: 'frozen prompt',
      baseHash: 'base',
      contextHash: 'context',
      cacheHash: 'cache',
      cacheKey: 'cache',
      diagnostics: [],
      contextItems: [],
      cacheSegments: [],
      cacheBoundaries: [],
    }
    const toolContext = {
      threadID: 'thread-rc-persist',
      turnID: 'turn-rc-persist',
      agentID: 'agent-rc-persist',
      profile: 'main',
      taskMode: 'chat',
      signal: new AbortController().signal,
      workspace: {} as never,
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      model: { providerID: 'faux', id: 'test' } as never,
      taskSummary: 'x',
    } as never
    return {
      turnID: 'turn-rc-persist',
      threadID: 'thread-rc-persist',
      profile: 'main' as const,
      taskMode: 'chat' as const,
      model,
      modelRef: { providerID: 'faux', id: 'test' } as never,
      toolCatalog: {} as never,
      workspace: {} as never,
      workspaceScope: {
        kind: 'project' as const,
        cwd: workspace,
        roots: [workspace],
        outputDirectory: null,
        instructionSources: [],
      },
      sessionEntryID: null,
      skillService,
      mcpBinding,
      effectivePermissionConfig: DEFAULT_PERMISSION_CONFIG,
      toolContext,
      promptBundle,
      exposurePlan: { eager: [], deferred: [], exposed: [] },
      ...overrides,
    }
  }

  test('引用证据持久化失败时 skill_read fail-closed，不静默成功', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pidex-rc-failclosed-'))
    paths.push(workspace)
    await writeSkill(workspace, 'alpha', 'alpha body')
    await writeSkill(workspace, 'beta', 'beta body')
    const skillService = await scan(workspace)
    await skillService.read('alpha')
    const input = await baseComposeInput(workspace, skillService)

    const failing = composeRuntimeComposition({
      ...input,
      recordReferenced: () => {
        throw new Error('durable write failed')
      },
    })
    await expect(failing.bindings.skills.read('beta')).rejects.toThrow('durable write failed')

    const ok = composeRuntimeComposition({ ...input, recordReferenced: () => undefined })
    await expect(ok.bindings.skills.read('beta')).resolves.toMatchObject({ name: 'beta' })
  })

  test('普通 Read 记录冻结 Skill 引用，正文变化与引用持久化失败不能报告加载成功', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-skill-read-'))
    paths.push(root)
    await writeSkill(root, 'alpha', 'alpha body')
    const service = await scan(root)
    const workspace = await WorkspaceService.open(root)
    const skill = service.list()[0]!
    const input = await baseComposeInput(root, service, { workspace })
    const recorded: string[] = []
    const composition = composeRuntimeComposition({
      ...input,
      recordReferenced: (name) => {
        recorded.push(name)
      },
    })
    const toolRecords: Array<{ status: string; output: unknown }> = []
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: root,
      authorizeShell: async () => {
        throw new Error('unexpected shell')
      },
      recordToolCall: (_invocation, status, output) => {
        toolRecords.push({ status, output })
      },
    })
    const context = {
      threadID: input.threadID,
      turnID: input.turnID,
      agentID: 'agent-test',
      taskMode: 'chat' as const,
      signal: new AbortController().signal,
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      workspace,
      onSkillDocumentRead: composition.bindings.skills.documentRead,
    }
    const result = await executor.execute<{ skill: { name: string; status: string } }>(
      'Read',
      { file_path: skill.documentPath },
      context,
    )
    expect(result.skill).toEqual({ name: 'alpha', status: 'loaded' })
    expect(toolRecords.at(-1)).toMatchObject({
      status: 'completed',
      output: { skill: { name: 'alpha' } },
    })
    expect(recorded).toEqual(['alpha'])
    const failing = composeRuntimeComposition({
      ...input,
      skillService: await scan(root),
      recordReferenced: () => {
        throw new Error('durable write failed')
      },
    })
    await expect(
      executor.execute(
        'Read',
        { file_path: skill.documentPath },
        { ...context, onSkillDocumentRead: failing.bindings.skills.documentRead },
      ),
    ).rejects.toThrow('durable write failed')
    expect(toolRecords.at(-1)?.status).toBe('error')
    await writeFile(skill.documentPath, 'changed', 'utf8')
    await expect(
      executor.execute('Read', { file_path: skill.documentPath }, context),
    ).rejects.toThrow('Skill snapshot is stale')
  })

  test('repository 持久化 V2 引用证据；缺表时 no-op 且 fresh ephemeral 仍可工作', async () => {
    const { db, turnID, agentID } = setup()
    const repository = db.repositories.runtimeCompositions
    const workspace = await mkdtemp(join(tmpdir(), 'pidex-rc-ephemeral-'))
    paths.push(workspace)
    await writeSkill(workspace, 'alpha', 'alpha body')
    await writeSkill(workspace, 'beta', 'beta body')
    const skillService = await scan(workspace)
    await skillService.read('alpha')
    const input = await baseComposeInput(workspace, skillService, { turnID })

    const fresh = composeRuntimeComposition(input)
    const inserted = repository.insertOrGet({
      turnID,
      agentID,
      compositionID: fresh.snapshot.identity.id,
      snapshot: fresh.snapshot,
    })
    expect(inserted.inserted).toBe(true)
    const beta = skillService.list().find((skill) => skill.name === 'beta')!
    repository.recordReferencedSkills(turnID, [{ name: beta.name, hash: beta.hash }])
    const after = repository.get(turnID)!
    expect(after.snapshot.version).toBe(2)
    expect(
      (after.snapshot as RuntimeCompositionSnapshotV2).skills.referenced
        .map(({ name }) => name)
        .sort(),
    ).toEqual(['alpha', 'beta'])

    db.sqlite.exec('DROP TABLE runtime_composition_plans')
    expect(() =>
      repository.recordReferencedSkills(turnID, [{ name: 'alpha', hash: 'stale' }]),
    ).not.toThrow()

    const ephemeral = composeRuntimeComposition({
      ...input,
      turnID: 'turn-rc-ephemeral',
      recordReferenced: (name: string, hash: string) =>
        repository.recordReferencedSkills('turn-rc-ephemeral', [{ name, hash }]),
    })
    await expect(ephemeral.bindings.skills.read('beta')).resolves.toMatchObject({ name: 'beta' })
  })

  test('thinking level / variant 参与组合 identity hash 且不携带凭据', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pidex-rc-identity-'))
    paths.push(workspace)
    const skillService = await scan(workspace)
    const input = await baseComposeInput(workspace, skillService)

    const off = composeRuntimeComposition({ ...input, thinkingLevel: 'off' })
    const high = composeRuntimeComposition({ ...input, thinkingLevel: 'high' })
    expect(high.snapshot.identity.hash).not.toBe(off.snapshot.identity.hash)

    const variantRef = { providerID: 'faux', id: 'test', variant: 'high' } as never
    const variant = composeRuntimeComposition({
      ...input,
      modelRef: variantRef,
      thinkingLevel: 'high',
    })
    expect(variant.snapshot.identity.hash).not.toBe(high.snapshot.identity.hash)
    const variantAgain = composeRuntimeComposition({
      ...input,
      modelRef: variantRef,
      thinkingLevel: 'high',
    })
    expect(variantAgain.snapshot.identity.hash).toBe(variant.snapshot.identity.hash)

    const secret = 'super-secret-credential'
    const leaking = composeRuntimeComposition({
      ...input,
      model: {
        ...input.model,
        credentials: { apiKey: secret },
        headers: { Authorization: `Bearer ${secret}` },
        metadata: { secret },
      } as never,
    })
    expect(JSON.stringify(leaking.snapshot)).not.toContain(secret)
  })
})
