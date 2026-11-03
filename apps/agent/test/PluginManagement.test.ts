import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import extractZip from 'extract-zip'
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
import { marketplacePath, parseCatalog } from '../src/plugin/PluginMarketplace'
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

// Stored ZIP fixtures keep the download/extraction test independent of OS archive tools.
function pluginZip(files: Record<string, string | Buffer>, symlink?: string) {
  const local: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const [path, content] of Object.entries(files)) {
    const name = Buffer.from(path)
    const data = Buffer.from(content)
    const crc = Bun.hash.crc32(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(path === symlink ? 0xa1ff0000 : 0x81a40000, 38)
    central.writeUInt32LE(offset, 42)
    local.push(header, name, data)
    directory.push(central, name)
    offset += header.length + name.length + data.length
  }
  const central = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(directory.length / 2, 8)
  end.writeUInt16LE(directory.length / 2, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, central, end])
}

async function downloadablePlugin() {
  const root = await temporaryRoot()
  const source = await writePlugin({ root: join(root, 'source'), id: 'pidex-demo' })
  const commit = 'a'.repeat(40)
  const prefix = `Pidex-Plugins-${commit}/plugins/pidex-demo`
  const manifest = await readFile(join(source, '.codex-plugin/plugin.json'), 'utf8')
  const files = {
    [`${prefix}/.codex-plugin/plugin.json`]: manifest,
    [`${prefix}/skills/pidex-demo/SKILL.md`]: await readFile(
      join(source, 'skills/pidex-demo/SKILL.md'),
      'utf8',
    ),
    [`Pidex-Plugins-${commit}/README.md`]: 'This repository file is not installed.',
  }
  const catalog = {
    schemaVersion: 1,
    plugins: [
      {
        id: 'pidex-demo',
        path: 'plugins/pidex-demo',
        version: '1.0.0',
        name: 'Pidex Demo',
        description: 'Demo',
        developerName: 'Pidex',
        category: 'Demo',
      },
    ],
  }
  let archive: Buffer = pluginZip(files)
  let offline = false
  let calls = 0
  const urls: string[] = []
  const fetcher = (async (url: string | URL | Request) => {
    calls++
    if (offline) throw new Error('offline with sensitive path')
    const path = String(url)
    urls.push(path)
    if (path.endsWith('/assets/logo.png')) return new Response(new Uint8Array(testPng))
    if (path.endsWith('/commits/main')) return Response.json({ sha: commit })
    if (path.endsWith('/marketplace.json')) return Response.json(catalog)
    if (path.endsWith(`/zip/${commit}`)) return new Response(new Uint8Array(archive))
    throw new Error(`Unexpected request ${path}`)
  }) as typeof fetch
  const roots = {
    builtinPluginsRoot: join(root, 'bundled'),
    dataRoot: root,
    userHome: root,
    fetcher,
  }
  const settings = new PluginSettingsRepository(settingsDatabase())
  const service = new PluginManagementService(settings, roots)
  return {
    root,
    roots,
    service,
    settings,
    catalog,
    files,
    prefix,
    offline: () => {
      offline = true
    },
    calls: () => calls,
    urls,
    archive: (bytes: Buffer) => {
      archive = bytes
    },
  }
}

describe('downloaded plugin lifecycle', () => {
  test('installs, loads Skill, survives restart, preserves disabled state and removes/reinstalls', async () => {
    const fixture = await downloadablePlugin()
    const { service, root } = fixture
    const events: number[] = []
    service.subscribe((_id, generation) => events.push(generation))
    expect((await service.list()).plugins[0]).toMatchObject({ installed: false, canInstall: true })
    const input = { pluginId: 'pidex-demo', operationId: 'install-1' }
    const installed = await service.install(input)
    expect(await service.install(input)).toEqual(installed)
    expect(events).toHaveLength(1)
    expect(await readdir(join(root, 'plugins/installed/pidex-demo'))).toEqual(
      expect.arrayContaining(['.codex-plugin', 'skills']),
    )
    expect(await Bun.file(join(root, 'plugins/installed/pidex-demo/README.md')).exists()).toBe(
      false,
    )
    const restarted = new PluginManagementService(fixture.settings, fixture.roots)
    expect((await restarted.listLocal()).plugins[0]).toMatchObject({
      installed: true,
      canUninstall: true,
    })
    const beforeScan = fixture.calls()
    const skills = new SkillService({ pluginSkillRoots: () => restarted.enabledSkillRoots() })
    await skills.scan({ workspaceRoot: root, dataRoot: root, userHome: root })
    expect((await skills.read('pidex-demo')).body).toContain('生成任务规划')
    expect(
      (
        await pluginReferenceData('[@Demo](plugin://pidex-demo)', restarted, root, skills.list())
      )[0],
    ).toContain('用户引用了插件')
    expect(fixture.calls()).toBe(beforeScan)
    await restarted.setEnabled({
      pluginId: input.pluginId,
      enabled: false,
      operationId: 'disable-1',
    })
    expect(await restarted.enabledSkillRoots()).toEqual([])
    const removal = { pluginId: input.pluginId, operationId: 'remove-1' }
    const removed = await restarted.uninstall(removal)
    expect(await restarted.uninstall(removal)).toEqual(removed)
    expect(
      await Bun.file(join(root, 'plugins/installed/pidex-demo/.codex-plugin/plugin.json')).exists(),
    ).toBe(false)
    await restarted.install({ pluginId: input.pluginId, operationId: 'install-2' })
    expect((await restarted.listLocal()).plugins[0]).toMatchObject({
      installed: true,
      enabled: false,
    })
    await restarted.setEnabled({ pluginId: input.pluginId, enabled: true, operationId: 'enable-1' })
    expect(await restarted.enabledSkillRoots()).toHaveLength(1)
    await expect(restarted.uninstall(input)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  test('keeps bundled identities authoritative and rejects their removal', async () => {
    const fixture = await downloadablePlugin()
    await writePlugin({ root: fixture.roots.builtinPluginsRoot, id: 'pidex-demo', extension: true })
    const listed = await fixture.service.list()
    expect(listed.plugins).toHaveLength(1)
    expect(listed.plugins[0]).toMatchObject({ source: 'bundled', inMarketplace: true })
    expect(listed.plugins[0]?.canUninstall).not.toBe(true)
    await expect(
      fixture.service.install({ pluginId: 'pidex-demo', operationId: 'install' }),
    ).rejects.toMatchObject({ code: 'PATH_DENIED' })
    await expect(
      fixture.service.uninstall({ pluginId: 'pidex-demo', operationId: 'remove' }),
    ).rejects.toMatchObject({ code: 'PATH_DENIED' })
  })

  test('offline refresh retains cached catalog and installed plugins without leaking errors', async () => {
    const fixture = await downloadablePlugin()
    await fixture.service.install({ pluginId: 'pidex-demo', operationId: 'install' })
    fixture.offline()
    const restarted = new PluginManagementService(fixture.settings, fixture.roots)
    const result = await restarted.list({ forceReload: true })
    expect(result.plugins[0]?.installed).toBe(true)
    expect(result.catalogError).toContain('刷新重试')
    expect(JSON.stringify(result)).not.toContain('sensitive path')
    await restarted.uninstall({ pluginId: 'pidex-demo', operationId: 'remove' })
    expect((await restarted.list()).plugins[0]).toMatchObject({
      installed: false,
      canInstall: true,
    })
    await expect(
      restarted.install({ pluginId: 'pidex-demo', operationId: 'failed-install' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
    expect(await readdir(join(fixture.root, 'plugins/installed'))).toEqual([])
  })

  test('rejects traversal, symlinks and mismatched versions before installing', async () => {
    expect(() => marketplacePath('../outside')).toThrow()
    for (const kind of ['traversal', 'symlink', 'version'] as const) {
      const fixture = await downloadablePlugin()
      let files = { ...fixture.files }
      let link: string | undefined
      if (kind === 'traversal') files[`${fixture.prefix}/../escape`] = 'escape'
      if (kind === 'symlink') {
        link = `${fixture.prefix}/linked`
        files[link] = '../outside'
      }
      if (kind === 'version') {
        const name = `${fixture.prefix}/.codex-plugin/plugin.json`
        files[name] = files[name]!.replace('1.0.0', '2.0.0')
      }
      fixture.archive(pluginZip(files, link))
      await expect(
        fixture.service.install({ pluginId: 'pidex-demo', operationId: kind }),
      ).rejects.toBeDefined()
      expect(await readdir(join(fixture.root, 'plugins/installed'))).toEqual([])
    }
  })

  test('vendor filter skips unrelated entries before creating directories', async () => {
    const root = await temporaryRoot()
    const archive = join(root, 'test.zip')
    await writeFile(archive, pluginZip({ 'selected/hello': 'hello', 'unselected/file': 'skip' }))
    const output = join(root, 'output')
    await extractZip(archive, {
      dir: output,
      filter: (entry) => entry.fileName.startsWith('selected/'),
    })
    expect(await readdir(output)).toEqual(['selected'])
  })
})

const testPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=',
  'base64',
)

test('catalog metadata and pinned assets survive offline restart; installed version owns its details', async () => {
  const fixture = await downloadablePlugin()
  const entry = fixture.catalog.plugins[0]!
  Object.assign(entry, {
    longDescription: '远程详细介绍',
    displayCapabilities: ['演示'],
    logo: './assets/logo.png',
    websiteURL: 'https://example.com/demo',
  })
  Object.assign(fixture.catalog, {
    sections: [{ id: 'featured', title: '推荐', pluginIds: ['pidex-demo'] }],
  })
  const listed = await fixture.service.list()
  expect(listed.sections).toEqual([{ id: 'featured', title: '推荐', pluginIds: ['pidex-demo'] }])
  expect(listed.plugins[0]).toMatchObject({ inMarketplace: true, assetKinds: ['logo'] })
  expect((await fixture.service.getDetails({ pluginId: 'pidex-demo' })).details).toMatchObject({
    longDescription: '远程详细介绍',
    websiteURL: 'https://example.com/demo',
    displayCapabilities: ['演示'],
  })
  const image = await fixture.service.readAsset({ pluginId: 'pidex-demo', kind: 'logo' })
  expect(image).toEqual({ mimeType: 'image/png', base64: testPng.toString('base64') })
  expect(fixture.urls.at(-1)).toContain(`/${'a'.repeat(40)}/plugins/pidex-demo/assets/logo.png`)
  fixture.offline()
  const restarted = new PluginManagementService(fixture.settings, fixture.roots)
  expect(await restarted.readAsset({ pluginId: 'pidex-demo', kind: 'logo' })).toEqual(image)
  expect((await restarted.list()).plugins[0]).toMatchObject({ inMarketplace: true })
})

test('installed metadata and assets take precedence and reject unsafe/missing images safely', async () => {
  const fixture = await downloadablePlugin()
  const manifestKey = `${fixture.prefix}/.codex-plugin/plugin.json`
  const manifest = JSON.parse(fixture.files[manifestKey]!)
  Object.assign(manifest.interface, {
    longDescription: '本地版本介绍',
    logo: './assets/logo.png',
    privacyPolicyURL: 'https://example.com/privacy',
  })
  fixture.archive(
    pluginZip({
      ...fixture.files,
      [manifestKey]: JSON.stringify(manifest),
      [`${fixture.prefix}/assets/logo.png`]: testPng,
    }),
  )
  await fixture.service.install({ pluginId: 'pidex-demo', operationId: 'install-assets' })
  Object.assign(fixture.catalog.plugins[0]!, { longDescription: '更新的远程介绍' })
  await fixture.service.list({ forceReload: true })
  expect((await fixture.service.getDetails({ pluginId: 'pidex-demo' })).details).toMatchObject({
    longDescription: '本地版本介绍',
    privacyPolicyURL: 'https://example.com/privacy',
  })
  const calls = fixture.calls()
  expect((await fixture.service.readAsset({ pluginId: 'pidex-demo', kind: 'logo' })).base64).toBe(
    testPng.toString('base64'),
  )
  expect(fixture.calls()).toBe(calls)
  await expect(
    fixture.service.readAsset({ pluginId: 'pidex-demo', kind: 'logoDark' }),
  ).rejects.toMatchObject({ code: 'PLUGIN_INVALID', message: '插件图片暂不可用' })
  await writeFile(
    join(fixture.root, 'plugins/installed/pidex-demo/assets/logo.png'),
    'invalid image',
  )
  await expect(
    fixture.service.readAsset({ pluginId: 'pidex-demo', kind: 'logo' }),
  ).rejects.toMatchObject({ code: 'PLUGIN_INVALID' })
  expect((await fixture.service.listLocal()).plugins[0]?.status).toBe('ready')
  for (const logo of [
    '../escape.png',
    'https://example.com/logo.png',
    'assets/../../escape.png',
    'assets/icon.svg',
  ]) {
    expect(() =>
      parseCatalog({ ...fixture.catalog, plugins: [{ ...fixture.catalog.plugins[0], logo }] }),
    ).toThrow()
  }
  expect(() =>
    parseCatalog({
      ...fixture.catalog,
      sections: [{ id: 'featured', title: '推荐', pluginIds: ['missing'] }],
    }),
  ).toThrow()
  expect(() =>
    parseCatalog({
      ...fixture.catalog,
      plugins: [fixture.catalog.plugins[0], fixture.catalog.plugins[0]],
    }),
  ).toThrow()
})
