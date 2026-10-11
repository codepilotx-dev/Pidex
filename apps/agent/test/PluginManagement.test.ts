import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PluginGetDetailsResultSchema, PluginListResultSchema } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { PluginManagementService } from '../src/plugin/PluginManagementService'
import { SkillService } from '../src/prompt/SkillService'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { DEFAULT_PERMISSION_CONFIG } from '@pidex/shared/thread'
import { extractPluginReferences, pluginReferenceData } from '../src/plugin/PluginReferences'
import type { RpcRouter } from '../src/transport/rpc/RpcRouter'
import { pluginHandlers } from '../src/transport/rpc/handlers/Plugins'
import {
  PluginSettingsConflictError,
  PluginSettingsRepository,
} from '../src/storage/repositories/PluginSettingsRepository'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-plugin-test-'))
  roots.push(root)
  return root
}

const settingsDatabase = () => {
  const values = new Map<string, unknown>()
  return {
    values,
    profileSqlite: {
      transaction<T>(work: () => T) {
        return work
      },
    },
    getSetting<T>(key: string) {
      return (values.get(key) as T | undefined) ?? null
    },
    setSetting(key: string, value: unknown) {
      values.set(key, value)
    },
  }
}

const writePlugin = async (input: {
  root: string
  id: string
  extension?: boolean
  details?: boolean
  skillsPath?: string
}) => {
  const pluginRoot = join(input.root, input.id)
  const skillRoot = join(pluginRoot, 'skills', input.id)
  await mkdir(join(pluginRoot, '.codex-plugin'), { recursive: true })
  await mkdir(skillRoot, { recursive: true })
  await writeFile(
    join(pluginRoot, '.codex-plugin', 'plugin.json'),
    JSON.stringify({
      name: input.id,
      version: '1.0.0',
      description: '测试插件',
      author: { name: 'Pidex' },
      skills: input.skillsPath ?? './skills/',
      interface: {
        displayName: '任务规划',
        shortDescription: '拆解和规划复杂工作',
        developerName: 'Pidex',
        category: 'Productivity',
        ...(input.details === false
          ? {}
          : {
              longDescription: '澄清目标与约束，将复杂工作拆分为里程碑和可执行任务。',
              capabilities: ['Planning'],
              defaultPrompt: [
                '帮我把这个目标拆解成可执行的任务计划。',
                '梳理这个项目的里程碑、依赖和主要风险。',
                '为这项工作补充清晰的验收标准。',
              ],
            }),
      },
    }),
    'utf8',
  )
  await writeFile(
    join(skillRoot, 'SKILL.md'),
    ['---', `name: ${input.id}`, 'description: 测试规划技能', '---', '', '生成任务规划。'].join(
      '\n',
    ),
    'utf8',
  )
  if (input.extension) {
    await mkdir(join(pluginRoot, '.cpx-plugin'), { recursive: true })
    await writeFile(
      join(pluginRoot, '.cpx-plugin', 'plugin.json'),
      JSON.stringify({
        schemaVersion: 1,
        installation: 'INSTALLED_BY_DEFAULT',
        capabilities: ['task-planning'],
      }),
      'utf8',
    )
  }
  return pluginRoot
}

describe('PluginManagementService', () => {
  test('rolls back plugin initialization and its marker together in the profile database', async () => {
    const db = new AgentDatabase(join(await temporaryRoot(), 'history.sqlite'))
    try {
      const repository = new PluginSettingsRepository({
        profileSqlite: db.profileSqlite,
        getSetting: <T>(key: string) => db.getSetting<T>(key),
        setSetting: (key, value) => {
          if (key === 'plugins.computer-use.initialized.v1') throw new Error('marker failed')
          db.setSetting(key, value)
        },
      })
      expect(() => repository.initializeComputerUse(false)).toThrow('marker failed')
      expect(db.getSetting('plugins.runtime.v1')).toBeNull()
      expect(db.getSetting('plugins.computer-use.initialized.v1')).toBeNull()
    } finally {
      db.close()
    }
  })

  test('initializes computer control once and preserves explicit plugin choices', () => {
    for (const enabled of [false, true]) {
      const database = settingsDatabase()
      const repository = new PluginSettingsRepository(database)
      repository.initializeComputerUse(enabled)
      expect(repository.state().disabledPluginIds.includes('computer-use')).toBe(!enabled)
      new PluginSettingsRepository(database).initializeComputerUse(!enabled)
      expect(repository.state().disabledPluginIds.includes('computer-use')).toBe(!enabled)
    }
    const repository = new PluginSettingsRepository(settingsDatabase())
    repository.setEnabled({ pluginId: 'computer-use', enabled: true, operationId: 'explicit' })
    repository.initializeComputerUse(false)
    expect(repository.state().disabledPluginIds).toEqual([])
  })

  test('resolves stable plugin references and rejects disabled or forged resource paths', async () => {
    const root = await temporaryRoot()
    await writePlugin({ root, id: 'computer-use', extension: true })
    const service = new PluginManagementService(new PluginSettingsRepository(settingsDatabase()), {
      builtinPluginsRoot: root,
      userHome: root,
    })
    const skills = new SkillService({ pluginSkillRoots: () => service.enabledSkillRoots() })
    await skills.scan({ workspaceRoot: root, dataRoot: root, userHome: root })
    const content = '[@名称](plugin://computer-use) [@名称](<plugin://computer-use>)'
    expect(extractPluginReferences(content)).toEqual(['computer-use'])
    expect(
      extractPluginReferences(
        '`[@名称](plugin://computer-use)`\n```md\n[@名称](plugin://computer-use)\n```',
      ),
    ).toEqual([])
    expect(
      extractPluginReferences(
        '[@名称](plugin://computer-use/../../secret) ![图](plugin://computer-use)',
      ),
    ).toEqual([])
    expect((await pluginReferenceData(content, service, root, skills.list())).join('')).toContain(
      'Read',
    )
    const selection = {
      name: 'computer-use',
      path: 'plugin://computer-use/skills/computer-use/SKILL.md',
    }
    await service.setEnabled({ pluginId: 'computer-use', enabled: false, operationId: 'disable' })
    // An already scanned service must not read a disabled plugin from its frozen catalog.
    await expect(skills.read('computer-use')).rejects.toThrow('插件技能已禁用')
    expect((await pluginReferenceData(content, service, root, skills.list())).join('')).toContain(
      '当前不可用',
    )
    await skills.scan({ workspaceRoot: root, dataRoot: root, userHome: root })
    expect(skills.resolveInvocations('继续', [selection])).toEqual([])
    expect((await skills.invocationData('继续', [selection])).join('')).toContain('当前不可用')
    expect(await service.enabledSkillRoots()).toEqual([])
  })

  test('discovers a default-installed bundled plugin and contributes its Skill root', async () => {
    const root = await temporaryRoot()
    const builtinPluginsRoot = join(root, 'plugins')
    const userHome = join(root, 'home')
    await mkdir(userHome, { recursive: true })
    await writePlugin({ root: builtinPluginsRoot, id: 'task-planning', extension: true })
    await mkdir(join(builtinPluginsRoot, 'invalid-plugin', '.codex-plugin'), { recursive: true })
    await writeFile(
      join(builtinPluginsRoot, 'invalid-plugin', '.codex-plugin', 'plugin.json'),
      '{}',
      'utf8',
    )
    const service = new PluginManagementService(new PluginSettingsRepository(settingsDatabase()), {
      builtinPluginsRoot,
      userHome,
    })

    const result = await service.list()
    expect(() => Schema.decodeUnknownSync(PluginListResultSchema)(result)).not.toThrow()
    expect(result.plugins).toContainEqual(
      expect.objectContaining({
        id: 'task-planning',
        installed: true,
        enabled: true,
        source: 'bundled',
        installationPolicy: 'INSTALLED_BY_DEFAULT',
        capabilities: ['task-planning'],
        skills: ['task-planning'],
      }),
    )
    const details = await service.getDetails({ pluginId: 'task-planning' })
    expect(() => Schema.decodeUnknownSync(PluginGetDetailsResultSchema)(details)).not.toThrow()
    expect(details.details).toEqual({
      pluginId: 'task-planning',
      longDescription: '澄清目标与约束，将复杂工作拆分为里程碑和可执行任务。',
      displayCapabilities: ['Planning'],
      defaultPrompts: [
        '帮我把这个目标拆解成可执行的任务计划。',
        '梳理这个项目的里程碑、依赖和主要风险。',
        '为这项工作补充清晰的验收标准。',
      ],
      skills: [
        {
          id: 'task-planning',
          name: 'task-planning',
          description: '测试规划技能',
        },
      ],
    })
    expect(result.plugins).toContainEqual(
      expect.objectContaining({
        id: 'invalid-plugin',
        status: 'invalid',
        installed: false,
      }),
    )

    const skillService = new SkillService({
      pluginSkillRoots: () => service.enabledSkillRoots(),
    })
    const catalog = await skillService.scan({
      workspaceRoot: userHome,
      dataRoot: userHome,
      userHome,
      includeWorkspace: false,
    })
    expect(catalog.skills).toEqual([
      expect.objectContaining({
        name: 'task-planning',
        path: 'plugin://task-planning/skills/task-planning/SKILL.md',
        format: 'codex',
      }),
    ])
  })

  test('项目插件随工作区进入运行时目录，无项目聊天与禁用后都不进入', async () => {
    const root = await temporaryRoot()
    const workspace = join(root, 'project')
    const marketplace = join(workspace, '.agents', 'plugins')
    await mkdir(marketplace, { recursive: true })
    await writePlugin({ root: marketplace, id: 'project-task-planning', extension: true })
    await writeFile(
      join(marketplace, 'marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'project-task-planning',
            source: { source: 'local', path: './.agents/plugins/project-task-planning' },
            policy: { installation: 'INSTALLED_BY_DEFAULT' },
          },
        ],
      }),
      'utf8',
    )
    const userHome = join(root, 'home')
    await mkdir(userHome, { recursive: true })
    const service = new PluginManagementService(new PluginSettingsRepository(settingsDatabase()), {
      builtinPluginsRoot: join(root, 'plugins'),
      userHome,
    })
    const pluginSkillRoots = (workspaceRoot?: string) => service.enabledSkillRoots(workspaceRoot)

    expect((await pluginSkillRoots(workspace)).map((item) => item.pluginId)).toEqual([
      'project-task-planning',
    ])
    expect(await pluginSkillRoots()).toEqual([])

    const projectSkills = new SkillService({ pluginSkillRoots })
    const projectChat = await projectSkills.scan({
      workspaceRoot: workspace,
      dataRoot: workspace,
      userHome,
      includeWorkspace: true,
    })
    expect(projectChat.skills).toContainEqual(
      expect.objectContaining({
        name: 'project-task-planning',
        path: 'plugin://project-task-planning/skills/project-task-planning/SKILL.md',
      }),
    )
    expect((await projectSkills.read('project-task-planning')).body).toContain('生成任务规划')
    const projectlessChat = await new SkillService({ pluginSkillRoots }).scan({
      workspaceRoot: workspace,
      dataRoot: workspace,
      userHome,
      includeWorkspace: false,
    })
    expect(projectlessChat.skills).toEqual([])

    await service.list({ workspace })
    await service.setEnabled({
      pluginId: 'project-task-planning',
      enabled: false,
      operationId: 'disable',
    })
    expect(await pluginSkillRoots(workspace)).toEqual([])
    await expect(projectSkills.read('project-task-planning')).rejects.toThrow(
      '插件技能已禁用或移除',
    )
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: root,
      authorizeShell: async () => {
        throw new Error('unexpected shell')
      },
    })
    await expect(
      executor.execute(
        'Read',
        { file_path: projectChat.skills[0]!.documentPath },
        {
          threadID: 'thread',
          turnID: 'turn',
          agentID: 'agent',
          taskMode: 'chat',
          signal: new AbortController().signal,
          permissionConfig: DEFAULT_PERMISSION_CONFIG,
          workspace: await WorkspaceService.open(workspace),
          onSkillDocumentRead: async (path) => {
            const skill = await projectSkills.documentSkill(resolve(workspace, path))
            return skill ? { name: skill.name } : undefined
          },
        },
      ),
    ).rejects.toThrow('插件技能已禁用或移除')
  })

  test('persists idempotent enablement state and rejects operation conflicts', async () => {
    const root = await temporaryRoot()
    const builtinPluginsRoot = join(root, 'plugins')
    const userHome = join(root, 'home')
    await mkdir(userHome, { recursive: true })
    await writePlugin({ root: builtinPluginsRoot, id: 'task-planning', extension: true })
    const database = settingsDatabase()
    const repository = new PluginSettingsRepository(database)
    const service = new PluginManagementService(repository, { builtinPluginsRoot, userHome })
    await service.list()
    const emitted: Array<{ method: string; params: unknown }> = []
    const runtime = {
      dependencies: { plugins: service },
      emit: async (method: string, params: unknown) => {
        emitted.push({ method, params })
      },
    } as unknown as RpcRouter
    service.subscribe((_id, generation) => {
      void runtime.emit('plugins/updated', { generation })
    })

    const handlerDetails = await pluginHandlers.handle(
      runtime,
      'plugin/getDetails',
      {
        pluginId: 'task-planning',
        workspace: userHome,
      },
      {},
    )
    expect(() =>
      Schema.decodeUnknownSync(PluginGetDetailsResultSchema)(handlerDetails),
    ).not.toThrow()

    const disabled = (await pluginHandlers.handle(
      runtime,
      'plugin/setEnabled',
      {
        pluginId: 'task-planning',
        enabled: false,
        operationId: 'operation-1',
      },
      {},
    )) as { plugin: { enabled: boolean }; generation: number }
    expect(disabled.plugin.enabled).toBe(false)
    expect(
      (database.values.get('plugins.runtime.v1') as { disabledPluginIds: string[] })
        .disabledPluginIds,
    ).toEqual(['task-planning'])
    await pluginHandlers.handle(
      runtime,
      'plugin/setEnabled',
      {
        pluginId: 'task-planning',
        enabled: false,
        operationId: 'operation-1',
      },
      {},
    )
    expect(emitted).toEqual([
      {
        method: 'plugins/updated',
        params: { generation: disabled.generation },
      },
    ])
    expect(await service.enabledSkillRoots()).toEqual([])

    expect(() =>
      repository.setEnabled({
        pluginId: 'task-planning',
        enabled: true,
        operationId: 'operation-1',
      }),
    ).toThrow(PluginSettingsConflictError)
  })

  test('falls back optional details and rejects out-of-root Skill paths without disclosure', async () => {
    const root = await temporaryRoot()
    const builtinPluginsRoot = join(root, 'plugins')
    const userHome = join(root, 'home')
    await mkdir(userHome, { recursive: true })
    await writePlugin({
      root: builtinPluginsRoot,
      id: 'fallback-planner',
      extension: true,
      details: false,
    })
    const outsideRoot = join(root, 'outside-skills')
    await mkdir(join(outsideRoot, 'unsafe'), { recursive: true })
    await writeFile(join(outsideRoot, 'unsafe', 'SKILL.md'), 'TOP_SECRET_SKILL_CONTENT', 'utf8')
    await writePlugin({
      root: builtinPluginsRoot,
      id: 'unsafe-planner',
      extension: true,
      skillsPath: '../../../outside-skills',
    })
    const service = new PluginManagementService(new PluginSettingsRepository(settingsDatabase()), {
      builtinPluginsRoot,
      userHome,
    })

    expect((await service.getDetails({ pluginId: 'fallback-planner' })).details).toMatchObject({
      longDescription: '拆解和规划复杂工作',
      displayCapabilities: [],
      defaultPrompts: [],
    })
    const unsafe = (await service.getDetails({ pluginId: 'unsafe-planner' })).details
    expect(unsafe.skills).toEqual([])
    expect(JSON.stringify(unsafe)).not.toContain('TOP_SECRET_SKILL_CONTENT')
    expect(JSON.stringify(unsafe)).not.toContain(root)
  })

  test('discovers local marketplace sources without marking them installed', async () => {
    const root = await temporaryRoot()
    const builtinPluginsRoot = join(root, 'bundled')
    const userHome = join(root, 'home')
    const personalPluginRoot = join(userHome, 'plugins')
    await mkdir(builtinPluginsRoot, { recursive: true })
    await writePlugin({ root: personalPluginRoot, id: 'personal-planner' })
    const marketplaceDirectory = join(userHome, '.agents', 'plugins')
    await mkdir(marketplaceDirectory, { recursive: true })
    await writeFile(
      join(marketplaceDirectory, 'marketplace.json'),
      JSON.stringify({
        name: 'personal',
        plugins: [
          {
            name: 'personal-planner',
            source: { source: 'local', path: './plugins/personal-planner' },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Productivity',
          },
        ],
      }),
      'utf8',
    )
    const service = new PluginManagementService(new PluginSettingsRepository(settingsDatabase()), {
      builtinPluginsRoot,
      userHome,
    })

    expect((await service.list()).plugins).toEqual([
      expect.objectContaining({
        id: 'personal-planner',
        source: 'personal',
        installed: false,
        enabled: false,
        status: 'ready',
      }),
    ])
  })
})
