import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { ConfigService, ConfigServiceError } from '../src/config/ConfigService'

const roots: string[] = []
const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-config-test-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await removeFixturePaths(roots.splice(0))
})

describe('ConfigService', () => {
  test('首次保存外观时跳过不存在的 nullable 字体项并仍可删除已有项', async () => {
    const root = await temporaryRoot()
    const service = new ConfigService(join(root, 'config.json'))
    await service.initialize()
    try {
      await service.batchWrite({ edits: [
        { keyPath: ['desktop', 'appearance', 'chromeThemes', 'light', 'fonts', 'code'], value: null },
        { keyPath: ['desktop', 'appearance', 'mode'], value: 'dark' },
        { keyPath: ['desktop', 'appearance', 'chromeThemes', 'light', 'fonts', 'ui'], value: null },
      ] })
      expect(service.snapshot().desktop).toEqual({ appearance: { mode: 'dark' } })
      await service.writeValue({ keyPath: ['desktop', 'appearance', 'mode'], value: null })
      expect(service.snapshot().desktop).toEqual({ appearance: {} })
    } finally {
      await service.dispose()
    }
  })

  test('三层配置幂等迁移任务模型且保留旧键与未知内容', async () => {
    const root = await temporaryRoot()
    const userConfig = join(root, 'config.json')
    const profileDirectory = join(root, 'profiles')
    const profileConfig = join(profileDirectory, 'focused.json')
    const workspace = join(root, 'workspace')
    const projectConfig = join(workspace, '.pidex', 'config.json')
    await mkdir(profileDirectory, { recursive: true })
    await mkdir(join(workspace, '.pidex'), { recursive: true })
    await writeFile(
      userConfig,
      [
        '{',
        '  // user comment',
        '  "profile": "focused",',
        '  "task_models": { "small_fast": "user-small", "fast": "user-fast", "plan": "user-plan", "reviewer": "user-reviewer" },',
        '  "specialized_models": { "generation": "custom/already-set" },',
        '  "future_user_key": { "keep": true },',
        '}',
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      profileConfig,
      JSON.stringify(
        {
          task_models: { fast: 'profile-fast', deep: 'profile-deep' },
        },
        null,
        2,
      ),
      'utf8',
    )
    await writeFile(
      projectConfig,
      [
        '{',
        '  // project comment',
        '  "task_models": { "default": "project-default", "reviewer": "project-reviewer" },',
        '  "future_project_key": true,',
        '}',
        '',
      ].join('\n'),
      'utf8',
    )

    const service = new ConfigService(userConfig)
    await service.initialize()
    await service.trustUpdate(workspace, 'trusted')
    await service.read({ cwd: workspace })

    const user = await readFile(userConfig, 'utf8')
    const profileText = await readFile(profileConfig, 'utf8')
    const project = await readFile(projectConfig, 'utf8')
    const layers = new Map(
      service.snapshotLayers(workspace).map((layer) => [layer.kind, layer.config]),
    )
    expect(user).toContain('// user comment')
    expect(user).toContain('"future_user_key"')
    expect(layers.get('user')).toMatchObject({
      task_models: { small_fast: 'user-small', reviewer: 'user-reviewer' },
      specialized_models: {
        generation: 'custom/already-set',
        organization: 'user-small',
        coding: 'user-plan',
        security: 'user-reviewer',
      },
    })
    expect(layers.get('profile')).toMatchObject({
      task_models: { fast: 'profile-fast', deep: 'profile-deep' },
      specialized_models: {
        generation: 'profile-fast',
        organization: 'profile-fast',
        coding: 'profile-deep',
      },
    })
    expect(layers.get('profile')?.specialized_models).not.toHaveProperty('security')
    expect(project).toContain('// project comment')
    expect(project).toContain('"future_project_key"')
    expect(layers.get('project')).toMatchObject({
      task_models: { default: 'project-default', reviewer: 'project-reviewer' },
      specialized_models: {
        coding: 'project-default',
        security: 'project-reviewer',
      },
    })

    const beforeSecondRead = { user, profile: profileText, project }
    await service.read({ cwd: workspace })
    expect(await readFile(userConfig, 'utf8')).toBe(beforeSecondRead.user)
    expect(await readFile(profileConfig, 'utf8')).toBe(beforeSecondRead.profile)
    expect(await readFile(projectConfig, 'utf8')).toBe(beforeSecondRead.project)
    await service.dispose()
  })

  test('活动 Profile 作为独立 JSONC 层覆盖用户配置且项目配置优先', async () => {
    const root = await temporaryRoot()
    const userConfig = join(root, 'config.json')
    const profileDirectory = join(root, 'profiles')
    const workspace = join(root, 'workspace')
    const projectConfig = join(workspace, '.pidex', 'config.json')
    await mkdir(profileDirectory, { recursive: true })
    await mkdir(join(workspace, '.pidex'), { recursive: true })
    await writeFile(
      userConfig,
      JSON.stringify(
        {
          profile: 'deep-review',
          model: 'user-model',
          approval_policy: 'on-request',
        },
        null,
        2,
      ),
      'utf8',
    )
    await writeFile(
      join(profileDirectory, 'deep-review.json'),
      [
        '{',
        '  // JSONC profile',
        '  "display_name": "深度审查",',
        '  "model": "profile-model",',
        '  "approval_policy": "never",',
        '}',
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(projectConfig, '{"model":"project-model"}\n', 'utf8')
    const service = new ConfigService(userConfig)
    await service.initialize()
    await service.trustUpdate(workspace, 'trusted')

    const read = await service.read({ cwd: workspace, includeLayers: true })
    expect(read.config).toMatchObject({
      model: 'project-model',
      approval_policy: 'never',
    })
    expect(read.origins.model).toBe('project')
    expect(read.origins.approval_policy).toBe('profile')
    expect(read.layers?.map((layer) => layer.kind)).toEqual([
      'defaults',
      'user',
      'profile',
      'project',
    ])
    expect(read.profileState).toEqual({
      activeProfile: 'deep-review',
      selectedProfile: 'deep-review',
      restartRequired: false,
    })
    await service.dispose()
  })

  test('切换或编辑 Profile 只标记待重启并保持启动快照', async () => {
    const root = await temporaryRoot()
    const userConfig = join(root, 'config.json')
    const profileDirectory = join(root, 'profiles')
    await mkdir(profileDirectory, { recursive: true })
    await writeFile(userConfig, '{"profile":"balanced"}\n', 'utf8')
    await writeFile(join(profileDirectory, 'balanced.json'), '{"model":"balanced"}\n', 'utf8')
    await writeFile(join(profileDirectory, 'deep.json'), '{"model":"deep"}\n', 'utf8')
    const service = new ConfigService(userConfig)
    await service.initialize()

    await service.writeValue({
      keyPath: ['model'],
      value: 'balanced-updated',
      target: { kind: 'profile', profileId: 'balanced' },
    })
    expect(service.snapshot().model).toBe('balanced')
    expect(service.profileState().restartRequired).toBe(true)

    const selected = await service.profileSelect('deep')
    expect(selected.profileState).toEqual({
      activeProfile: 'balanced',
      selectedProfile: 'deep',
      restartRequired: true,
    })
    expect(service.snapshot().model).toBe('balanced')
    await service.dispose()

    const restarted = new ConfigService(userConfig)
    await restarted.initialize()
    expect(restarted.snapshot().model).toBe('deep')
    expect(restarted.profileState().restartRequired).toBe(false)
    await restarted.dispose()
  })

  test('已选择的 Profile 缺失或包含全局设施时阻止启动', async () => {
    const root = await temporaryRoot()
    const userConfig = join(root, 'config.json')
    const profileDirectory = join(root, 'profiles')
    await mkdir(profileDirectory, { recursive: true })
    await writeFile(userConfig, '{"profile":"missing"}\n', 'utf8')
    await expect(new ConfigService(userConfig).initialize()).rejects.toMatchObject({
      code: 'CONFIG_PROFILE_NOT_FOUND',
    })

    await writeFile(
      join(profileDirectory, 'missing.json'),
      JSON.stringify({
        mcp_servers: { unsafe: { enabled: true } },
      }),
      'utf8',
    )
    await expect(new ConfigService(userConfig).initialize()).rejects.toMatchObject({
      code: 'CONFIG_PROFILE_INVALID',
    })
  })

  test('旧项目可信状态迁入机器本地仓库并从可迁移配置删除', async () => {
    const root = await temporaryRoot()
    const userConfig = join(root, 'config.json')
    const workspace = join(root, 'workspace')
    const trust = new Map<string, 'trusted' | 'untrusted'>()
    await mkdir(join(workspace, '.pidex'), { recursive: true })
    await writeFile(join(workspace, '.pidex', 'config.json'), '{}\n', 'utf8')
    await writeFile(
      userConfig,
      JSON.stringify(
        {
          projects: {
            [workspace]: { trust_level: 'trusted' },
          },
          future_setting: { keep: true },
        },
        null,
        2,
      ),
      'utf8',
    )
    const service = new ConfigService(
      userConfig,
      {},
      {
        read: (projectRoot) => trust.get(resolve(projectRoot)) ?? null,
        write: (projectRoot, trustLevel) => trust.set(resolve(projectRoot), trustLevel),
        import: (entries) => {
          for (const [projectRoot, trustLevel] of Object.entries(entries)) {
            trust.set(resolve(projectRoot), trustLevel)
          }
        },
      },
    )

    await service.initialize()

    expect((await service.trustRead(workspace)).trustLevel).toBe('trusted')
    const persisted = JSON.parse(await readFile(userConfig, 'utf8'))
    expect(persisted.projects).toBeUndefined()
    expect(persisted.future_setting).toEqual({ keep: true })
    await service.dispose()
  })

  test('项目向上查找不会把用户 config.json 当成项目配置', async () => {
    const root = await temporaryRoot()
    const home = join(root, 'home')
    const userConfig = join(home, '.pidex', 'config.json')
    const workspace = join(home, 'workspace')
    await mkdir(join(home, '.pidex'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFile(userConfig, '{}\n', 'utf8')
    const service = new ConfigService(userConfig)

    await service.initialize()

    expect(await service.trustRead(workspace)).toEqual({
      projectRoot: resolve(workspace),
      trustLevel: 'untrusted',
      hasProjectConfig: false,
    })
    await service.dispose()
  })

  test('启动时遇到无效用户 JSONC 不执行迁移写入或覆盖原文件', async () => {
    const root = await temporaryRoot()
    const userConfig = join(root, 'config.json')
    const invalid = '{\n  // 等待用户修复\n  "model":\n}\n'
    await writeFile(userConfig, invalid, 'utf8')
    const service = new ConfigService(userConfig)

    await service.initialize()

    expect((await service.read()).diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        scope: 'user',
      }),
    )
    expect(await readFile(userConfig, 'utf8')).toBe(invalid)
    await service.dispose()
  })

  test('局部写入 JSONC 时保留注释、尾逗号、顺序和未知字段', async () => {
    const root = await temporaryRoot()
    const filePath = join(root, 'config.json')
    await writeFile(
      filePath,
      [
        '{',
        '  // keep this comment',
        '  "model": "old",',
        '  "unknown_future_key": "keep",',
        '  "desktop": {',
        '    "showContextUsage": true, // keep inline',
        '  },',
        '}',
        '',
      ].join('\n'),
      'utf8',
    )
    const service = new ConfigService(filePath)
    await service.initialize()
    const before = await service.read({ includeLayers: true })
    const version = before.layers?.find((layer) => layer.kind === 'user')?.version
    const result = await service.batchWrite({
      edits: [
        { keyPath: ['model'], value: 'gpt-5.6' },
        { keyPath: ['desktop', 'reviewView'], value: 'inline' },
      ],
      expectedVersion: version,
    })

    const source = await readFile(filePath, 'utf8')
    expect(source).toContain('// keep this comment')
    expect(source).toContain('"unknown_future_key": "keep"')
    expect(source).toContain('"showContextUsage": true')
    expect(source).toContain('// keep inline')
    expect(source).toContain('"model": "gpt-5.6"')
    expect(source).toContain('"reviewView": "inline"')
    expect(source).toContain('},')
    await expect(
      service.writeValue({
        keyPath: ['model'],
        value: 'stale',
        expectedVersion: version,
      }),
    ).rejects.toMatchObject({
      code: 'CONFIG_VERSION_CONFLICT',
    } satisfies Partial<ConfigServiceError>)
    expect(result.version).not.toBe(version)
    await service.dispose()
  })

  test('replace 与 upsert 语义分别替换和递归合并对象', async () => {
    const root = await temporaryRoot()
    const filePath = join(root, 'config.json')
    await writeFile(
      filePath,
      JSON.stringify(
        {
          desktop: { tooling: { nodejs: 'system', python: 'system' } },
        },
        null,
        2,
      ),
      'utf8',
    )
    const service = new ConfigService(filePath)
    await service.initialize()

    await service.writeValue({
      keyPath: ['desktop', 'tooling'],
      value: { nodejs: 'managed' },
      mergeStrategy: 'upsert',
    })
    expect((await service.read()).config).toMatchObject({
      desktop: { tooling: { nodejs: 'managed', python: 'system' } },
    })
    await service.writeValue({
      keyPath: ['desktop', 'tooling'],
      value: { python: 'managed' },
      mergeStrategy: 'replace',
    })
    expect((await service.read()).config).toMatchObject({
      desktop: { tooling: { python: 'managed' } },
    })
    expect(JSON.stringify((await service.read()).config)).not.toContain('nodejs')
    await service.dispose()
  })

  test('同一 config.json 的并发写入会串行合并且不残留临时文件', async () => {
    const root = await temporaryRoot()
    const filePath = join(root, 'config.json')
    await writeFile(filePath, '{\n  // keep\n}\n', 'utf8')
    const service = new ConfigService(filePath)
    await service.initialize()

    await Promise.all([
      service.writeValue({
        keyPath: ['desktop', 'tooling', 'nodejs'],
        value: 'managed',
      }),
      service.writeValue({
        keyPath: ['desktop', 'tooling', 'python'],
        value: 'system',
      }),
    ])

    const source = await readFile(filePath, 'utf8')
    expect(source).toContain('// keep')
    expect(source).toContain('"nodejs": "managed"')
    expect(source).toContain('"python": "system"')
    expect((await readdir(root)).filter((name) => name.endsWith('.config.tmp'))).toEqual([])
    await service.dispose()
  })

  test('排队的项目写入会在落盘前重新检查最新信任状态', async () => {
    const root = await temporaryRoot()
    const workspace = join(root, 'workspace')
    const userConfig = join(root, 'data', 'config.json')
    const projectConfig = join(workspace, '.pidex', 'config.json')
    await mkdir(join(workspace, '.pidex'), { recursive: true })
    await writeFile(projectConfig, '{\n  // keep\n}\n', 'utf8')
    const service = new ConfigService(userConfig)
    await service.initialize()
    await service.trustUpdate(workspace, 'trusted')

    let releaseWrite!: () => void
    const blocker = new Promise<void>((resolveBlocker) => {
      releaseWrite = resolveBlocker
    })
    const queueKey =
      process.platform === 'win32' ? resolve(projectConfig).toLowerCase() : resolve(projectConfig)
    const writeQueues = (service as unknown as { writeQueues: Map<string, Promise<void>> })
      .writeQueues
    writeQueues.set(queueKey, blocker)

    const pending = service.writeValue({
      keyPath: ['mcp_servers', 'fixture', 'enabled'],
      value: true,
      filePath: projectConfig,
      cwd: workspace,
    })
    const settled = pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    )
    for (let attempt = 0; attempt < 100 && writeQueues.get(queueKey) === blocker; attempt += 1) {
      await Bun.sleep(5)
    }
    if (writeQueues.get(queueKey) === blocker) releaseWrite()
    expect(writeQueues.get(queueKey)).not.toBe(blocker)

    try {
      await service.trustUpdate(workspace, 'untrusted')
    } finally {
      releaseWrite()
    }

    expect(await settled).toMatchObject({
      error: { code: 'CONFIG_PROJECT_UNTRUSTED' },
    })
    expect(await readFile(projectConfig, 'utf8')).toBe('{\n  // keep\n}\n')
    await service.dispose()
  })

  test('只在信任项目后迁移其 TOML，并保留旧文件', async () => {
    const root = await temporaryRoot()
    const userConfig = join(root, 'data', 'config.json')
    const workspace = join(root, 'workspace')
    const legacyProjectConfig = join(workspace, '.pidex', 'config.toml')
    const projectConfig = join(workspace, '.pidex', 'config.json')
    await mkdir(join(workspace, '.pidex'), { recursive: true })
    await writeFile(legacyProjectConfig, 'model = "project-model"\n', 'utf8')
    const service = new ConfigService(userConfig)
    await service.initialize()

    const untrusted = await service.read({ cwd: workspace })
    expect(untrusted.config.model).toBeUndefined()
    await expect(readFile(projectConfig, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })

    await service.trustUpdate(workspace, 'trusted')
    expect((await service.read({ cwd: workspace })).config.model).toBe('project-model')
    expect(JSON.parse(await readFile(projectConfig, 'utf8'))).toMatchObject({
      model: 'project-model',
    })
    expect(await readFile(legacyProjectConfig, 'utf8')).toBe('model = "project-model"\n')
    await service.dispose()
  })

  test('用户 TOML 一次迁移并保留旧文件，已有 JSON 优先', async () => {
    const root = await temporaryRoot()
    const configPath = join(root, 'config.json')
    const legacyPath = join(root, 'config.toml')
    await writeFile(legacyPath, 'model = "legacy"\n', 'utf8')
    const first = new ConfigService(configPath)
    await first.initialize()
    expect(first.snapshot().model).toBe('legacy')
    expect(await readFile(legacyPath, 'utf8')).toBe('model = "legacy"\n')
    await first.dispose()

    await writeFile(configPath, '{"model":"json-wins"}\n', 'utf8')
    await writeFile(legacyPath, 'model = "changed-legacy"\n', 'utf8')
    const second = new ConfigService(configPath)
    await second.initialize()
    expect(second.snapshot().model).toBe('json-wins')
    await second.dispose()
  })

  test('无效外部 JSONC 保留 last-known-good 并产生诊断', async () => {
    const root = await temporaryRoot()
    const filePath = join(root, 'config.json')
    await writeFile(filePath, '{"model":"valid"}\n', 'utf8')
    const service = new ConfigService(filePath)
    await service.initialize()
    expect(service.snapshot().model).toBe('valid')
    await writeFile(filePath, '{"model": [', 'utf8')
    const read = await service.read()
    expect(read.config.model).toBe('valid')
    expect(read.diagnostics).toEqual([expect.objectContaining({ code: 'CONFIG_VALIDATION_ERROR' })])
    await service.dispose()
  })

  test('项目层拒绝敏感根，MCP 环境变量引用通过且静态凭据仍被拒绝', async () => {
    const root = await temporaryRoot()
    const service = new ConfigService(join(root, 'config.json'))
    await service.initialize()
    await service.writeValue({
      keyPath: ['provider_credentials', 'store'],
      value: 'auth-json',
    })
    expect(service.snapshot()).toMatchObject({
      provider_credentials: { store: 'auth-json' },
    })
    expect(() =>
      service.validateDocument('{"provider_credentials":{"store":"portable"}}', 'user'),
    ).toThrow(ConfigServiceError)
    expect(() =>
      service.validateDocument('{"desktop":{"reviewView":"inline"}}', 'project'),
    ).toThrow(ConfigServiceError)
    expect(() =>
      service.validateDocument('{"provider_credentials":{"store":"auth-json"}}', 'project'),
    ).toThrow(ConfigServiceError)
    expect(() =>
      service.validateDocument('{"model_providers":{"openai":{"api_key":"secret"}}}', 'user'),
    ).toThrow(ConfigServiceError)
    expect(() =>
      service.validateDocument(
        JSON.stringify({
          mcp_servers: {
            context7: {
              transport: {
                type: 'http',
                url: 'https://mcp.context7.com/mcp',
                bearerTokenEnvVar: 'CONTEXT7_API_KEY',
                headerFromEnv: { CONTEXT7_API_KEY: 'CONTEXT7_API_KEY' },
              },
            },
            worker: {
              transport: {
                type: 'stdio',
                command: 'worker',
                envFromHost: { API_KEY: 'WORKER_API_KEY' },
              },
            },
          },
        }),
        'user',
      ),
    ).not.toThrow()
    expect(() =>
      service.validateDocument(
        JSON.stringify({
          mcp_servers: {
            context7: {
              transport: {
                type: 'http',
                headers: { Authorization: 'secret' },
              },
            },
          },
        }),
        'user',
      ),
    ).toThrow(ConfigServiceError)
    await service.dispose()
  })

  test('工作区出现后搬移未解析 MCP，并删除对应迁移节点', async () => {
    const root = await temporaryRoot()
    const workspace = join(root, 'workspace')
    const userConfig = join(root, 'data', 'config.json')
    const projectConfig = join(workspace, '.pidex', 'config.json')
    const hash = createHash('sha256').update(workspace.toLowerCase()).digest('hex')
    await mkdir(join(root, 'data'), { recursive: true })
    await mkdir(join(workspace, '.pidex'), { recursive: true })
    await writeFile(
      userConfig,
      JSON.stringify(
        {
          projects: {
            [resolve(workspace)]: { trust_level: 'trusted' },
          },
          migration: {
            unresolved_mcp: {
              [hash]: {
                legacy: {
                  enabled: true,
                  transport: { type: 'http', url: 'https://example.com/mcp' },
                },
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    await writeFile(projectConfig, '{"model":"keep"}\n', 'utf8')
    const service = new ConfigService(userConfig)
    await service.initialize()

    await expect(service.resolveUnresolvedMcp(workspace)).resolves.toBe(true)
    const project = JSON.parse(await readFile(projectConfig, 'utf8'))
    expect(project).toMatchObject({
      model: 'keep',
      mcp_servers: {
        legacy: {
          enabled: true,
          transport: { url: 'https://example.com/mcp' },
        },
      },
    })
    expect(await readFile(userConfig, 'utf8')).not.toContain(hash)
    await expect(service.resolveUnresolvedMcp(workspace)).resolves.toBe(false)
    await service.dispose()
  })
})
