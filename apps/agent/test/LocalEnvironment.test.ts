import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { EnvironmentDeltaStore } from '../src/local-environment/EnvironmentDeltaStore'
import {
  LocalEnvironmentDiscovery,
  LOCAL_ENVIRONMENT_RELATIVE_PATH,
} from '../src/local-environment/LocalEnvironmentDiscovery'
import { LocalEnvironmentRunner } from '../src/local-environment/LocalEnvironmentRunner'
import { LocalEnvironmentService } from '../src/local-environment/LocalEnvironmentService'
import {
  FileProjectTrustStore,
  MemoryProjectTrustStore,
} from '../src/local-environment/ProjectTrustStore'
import { GitCommandRunner } from '../src/git/GitCommandRunner'
import { LocalEnvironmentWorktreeLifecycle } from '../src/local-environment/WorktreeEnvironmentLifecycle'
import { BindingHandoffWorkspace } from '../src/handoff/BindingHandoffWorkspace'
import { Database } from 'bun:sqlite'
import { LocalEnvironmentCatalog } from '../src/local-environment/LocalEnvironmentCatalog'
import {
  LOCAL_ENVIRONMENT_SELECTION_SCHEMA,
  LocalEnvironmentRepository,
} from '../src/local-environment/LocalEnvironmentRepository'

const roots: string[] = []

test('项目文件夹信任覆盖脚本版本，撤销后不允许旧摘要授权绕过', async () => {
  const { root, runner, trust } = await fixture()
  let trusted = true
  const service = new LocalEnvironmentService(
    new LocalEnvironmentDiscovery(
      new GitCommandRunner({ timeoutMs: 10_000, maxOutputBytes: 64 * 1024 }),
    ),
    trust,
    runner,
    undefined,
    async () => trusted,
  )
  const initial = await service.read(root)
  const saved = await service.update({
    cwd: root,
    expectedRevision: initial.revision,
    edits: [{ keyPath: ['setup'], value: { script: 'echo ok' } }],
  })
  expect(saved.executionTrusted).toBe(true)
  expect((await service.read(root)).executionTrusted).toBe(true)
  await service.confirmExecution(root, saved.configHash)
  trusted = false
  expect((await service.read(root)).executionTrusted).toBe(false)
  await expect(
    service.runLifecycle({ cwd: root, bindingId: 'test', kind: 'setup' }),
  ).rejects.toMatchObject({ code: 'LOCAL_ENVIRONMENT_UNTRUSTED' })
}, 30_000)

const git = async (cwd: string, args: string[]) => {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const code = await child.exited
  if (code !== 0) throw new Error('git fixture failed')
}

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-local-env-'))
  roots.push(root)
  await git(root, ['init'])
  await git(root, ['config', 'user.email', 'test@example.com'])
  await git(root, ['config', 'user.name', 'Test'])
  const data = join(root, '.agent-data')
  const trust = new MemoryProjectTrustStore()
  const deltas = new EnvironmentDeltaStore(data)
  const runner = new LocalEnvironmentRunner(deltas, 30_000)
  const discovery = new LocalEnvironmentDiscovery(
    new GitCommandRunner({ maxOutputBytes: 64 * 1024, timeoutMs: 10_000 }),
  )
  const service = new LocalEnvironmentService(discovery, trust, runner)
  return { root, data, trust, deltas, runner, discovery, service }
}

afterEach(async () => {
  await removeFixturePaths(roots.splice(0))
})

describe('LocalEnvironmentService', () => {
  test('唯一 ID 环境可作为默认环境发现，操作列表使用相同配置；legacy 与显式选择优先', async () => {
    const { root, service, discovery } = await fixture()
    const directory = join(root, '.pidex', 'environments')
    await mkdir(directory, { recursive: true })
    const named = join(directory, 'stable-id.jsonc')
    await writeFile(
      named,
      JSON.stringify({
        schema_version: 1,
        name: '启动',
        actions: [
          { name: '启动桌面', command: 'bun run dev:desktop' },
          { name: '启动agent', command: 'bun run dev:agent' },
        ],
      }),
      'utf8',
    )
    expect((await discovery.discover(root)).filePath).toBe(named)
    expect((await service.actionList(root)).actions.map((action) => action.name)).toEqual([
      '启动桌面',
      '启动agent',
    ])
    const legacy = join(root, LOCAL_ENVIRONMENT_RELATIVE_PATH)
    await writeFile(legacy, '{"schema_version":1,"name":"旧默认","actions":[]}', 'utf8')
    expect((await discovery.discover(root)).filePath).toBe(legacy)
    const selected = new LocalEnvironmentDiscovery(
      new GitCommandRunner({ maxOutputBytes: 65536, timeoutMs: 10000 }),
      () => ({ filePath: named }),
    )
    expect((await selected.discover(root)).filePath).toBe(named)
  }, 30_000)

  test('普通本地项目可读取并保存环境，但仍拒绝项目范围外的配置路径', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-local-folder-'))
    roots.push(root)
    const discovery = new LocalEnvironmentDiscovery(
      new GitCommandRunner({ maxOutputBytes: 65536, timeoutMs: 10000 }),
    )
    const service = new LocalEnvironmentService(
      discovery,
      new MemoryProjectTrustStore(),
      new LocalEnvironmentRunner(new EnvironmentDeltaStore(join(root, '.data')), 30000),
    )
    const initial = await service.read(root)
    expect(initial.exists).toBe(false)
    await service.update({
      cwd: root,
      expectedRevision: initial.revision,
      edits: [
        { keyPath: ['name'], value: '本地项目' },
        { keyPath: ['setup', 'script'], value: 'echo setup' },
      ],
    })
    expect((await service.read(root)).config.name).toBe('本地项目')
    expect((await service.read(root)).executionTrusted).toBe(false)
    await expect(service.read(root, join(dirname(root), 'outside.jsonc'))).rejects.toMatchObject({
      code: 'LOCAL_ENVIRONMENT_INVALID',
    })
  }, 30_000)

  test('多环境继承、选择、冲突、信任撤销与冻结配置使用同一解析', async () => {
    const { root, trust, runner } = await fixture()
    const projectRoot = join(root, 'app')
    const worktreeRoot = join(root, 'worktree')
    await Promise.all([
      mkdir(projectRoot),
      mkdir(worktreeRoot),
      mkdir(join(root, '.pidex', 'environments'), { recursive: true }),
    ])
    await writeFile(
      join(root, LOCAL_ENVIRONMENT_RELATIVE_PATH),
      '// 保留注释\n{"schema_version":1,"name":"继承环境","future":42,"actions":[]}',
      'utf8',
    )
    const sqlite = new Database(':memory:')
    sqlite.exec(
      'CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE managed_worktrees (id TEXT PRIMARY KEY,path TEXT,deleted_at INTEGER)',
    )
    sqlite.exec(LOCAL_ENVIRONMENT_SELECTION_SCHEMA.join(';'))
    sqlite.query('INSERT INTO projects VALUES (?)').run('project')
    sqlite.query('INSERT INTO managed_worktrees VALUES (?,?,NULL)').run('worktree', worktreeRoot)
    const repository = new LocalEnvironmentRepository(sqlite)
    const discovery = new LocalEnvironmentDiscovery(
      new GitCommandRunner({ maxOutputBytes: 64 * 1024, timeoutMs: 10_000 }),
      (cwd) => {
        const snapshot = repository.snapshotForCwd(cwd)
        if (snapshot)
          return {
            filePath: snapshot.snapshot_path,
            frozen: true,
            revision: snapshot.revision,
            trustIdentity: snapshot.trust_identity,
          }
        const selected = repository.selectedForCwd(cwd)
        return selected ? { filePath: selected.config_path } : null
      },
    )
    const service = new LocalEnvironmentService(discovery, trust, runner)
    const catalog = new LocalEnvironmentCatalog(
      service,
      discovery,
      repository,
      () => projectRoot,
      join(root, '.snapshots'),
    )
    const inherited = (await catalog.list('project')).environments[0]!
    expect(inherited.inherited).toBe(true)
    await expect(catalog.create('project', '名称不是路径/../环境')).rejects.toMatchObject({
      code: 'LOCAL_ENVIRONMENT_INVALID',
    })
    const named = await catalog.create('project', '测试环境')
    expect(repository.selection('project')?.config_path).toBe(
      join(root, LOCAL_ENVIRONMENT_RELATIVE_PATH),
    )
    await catalog.select('project', named.environmentId)
    const selected = await service.read(projectRoot)
    expect(selected.config.name).toBe('测试环境')
    expect(selected.filePath).toEndWith('测试环境.jsonc')
    await expect(catalog.create('project', '测试环境')).rejects.toMatchObject({
      code: 'LOCAL_ENVIRONMENT_CONFLICT',
    })
    await catalog.update({
      projectId: 'project',
      environmentId: named.environmentId,
      expectedRevision: selected.revision,
      trust: { configHash: selected.configHash, decision: 'allow' },
    })
    expect((await service.read(projectRoot)).executionTrusted).toBe(true)
    await catalog.freeze('project', 'worktree', projectRoot)
    await catalog.update({
      projectId: 'project',
      environmentId: named.environmentId,
      expectedRevision: selected.revision,
      edits: [{ keyPath: ['name'], value: '新配置' }],
    })
    const renamedId = (await catalog.list('project')).environments.find(
      (item) => item.name === '新配置',
    )!.id
    expect(repository.selection('project')?.config_path).toEndWith('新配置.jsonc')
    await expect(
      catalog.update({
        projectId: 'project',
        environmentId: renamedId,
        expectedRevision: selected.revision,
        edits: [{ keyPath: ['name'], value: '旧草稿' }],
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_ENVIRONMENT_CONFLICT' })
    expect((await service.read(projectRoot)).executionTrusted).toBe(false)
    await catalog.select('project', inherited.id)
    expect((await service.read(projectRoot)).config.name).toBe('继承环境')
    const frozen = await service.read(worktreeRoot)
    expect(frozen.config.name).toBe('测试环境')
    expect(frozen.executionTrusted).toBe(false)
    const current = await catalog.read('project', renamedId)
    await expect(catalog.delete('project', renamedId, current.revision)).rejects.toMatchObject({
      code: 'LOCAL_ENVIRONMENT_CONFLICT',
    })
    const inheritedSource = await service.read(projectRoot)
    expect(inheritedSource.filePath).toEndWith('继承环境.jsonc')
    expect(await readFile(inheritedSource.filePath, 'utf8')).toContain('// 保留注释')
    expect(inheritedSource.config.future).toBe(42)
    sqlite.close()
  }, 30_000)
  test('worktree setup 仅向创建期脚本注入权威源目录与目标目录变量', async () => {
    let lifecycleInput: Record<string, unknown> | null = null
    const lifecycle = new LocalEnvironmentWorktreeLifecycle({
      runLifecycle: async (input: Record<string, unknown>) => {
        lifecycleInput = input
        return { status: 'succeeded' }
      },
      operationOutput: () => null,
      hostEnvironmentForBinding: async () => ({ revision: 0, set: {}, unset: [] }),
    } as never)

    await lifecycle.setup({
      operationId: 'setup',
      projectId: 'project',
      worktreeId: 'worktree',
      sourceWorkspacePath: 'C:\\source',
      workspacePath: 'C:\\managed',
      onOutput: () => undefined,
    })

    expect(lifecycleInput).toMatchObject({
      cwd: 'C:\\managed',
      bindingId: 'worktree',
      kind: 'setup',
      environment: {
        PIDEX_SOURCE_TREE_PATH: 'C:\\source',
        PIDEX_WORKTREE_PATH: 'C:\\managed',
      },
    })
  })

  test('环境 delta copy 校验预期 revision，cleanup 失败不会被降级成可继续警告', async () => {
    const { deltas } = await fixture()
    await deltas.replace('source', { set: { SAFE_ENV: 'value' }, unset: [] })
    expect(await deltas.copy('source', 'target', 1)).toEqual({
      revision: 1,
      set: { SAFE_ENV: 'value' },
      unset: [],
    })
    await expect(deltas.copy('source', 'stale-target', 2)).rejects.toThrow(
      '环境增量版本与执行绑定不一致',
    )
    expect(await deltas.read('stale-target')).toEqual({ revision: 0, set: {}, unset: [] })

    const lifecycle = new LocalEnvironmentWorktreeLifecycle({
      runLifecycle: async () => ({ status: 'failed' }),
      operationOutput: () => null,
    } as never)
    await expect(
      lifecycle.cleanup({
        operationId: 'cleanup',
        projectId: 'project',
        worktreeId: 'worktree',
        workspacePath: 'workspace',
        onOutput: () => undefined,
      }),
    ).rejects.toThrow('WORKTREE_CLEANUP_FAILED')
  })

  test('Worktree→Local Handoff 不复制 cwd-specific environment delta', async () => {
    let copied = false
    let bound: Record<string, unknown> | null = null
    const recorded = { bindingId: null as string | null }
    const workspace = new BindingHandoffWorkspace(
      null as never,
      null as never,
      {
        allocateBindingId: () => 'local-target-binding',
        bindLocal: (input: Record<string, unknown>) => {
          bound = input
          return input
        },
      } as never,
      null as never,
      {
        recordTargetBinding: (_operationId: string, bindingId: string) => {
          recorded.bindingId = bindingId
        },
      } as never,
      {
        copy: async () => {
          copied = true
          return { revision: 9, set: { WORKTREE_ONLY: 'secret' }, unset: [] }
        },
        remove: async () => undefined,
      } as never,
    )

    await workspace.bindTarget({
      operationID: 'handoff-worktree-local',
      source: {
        threadID: 'source-thread',
        bindingID: 'source-worktree-binding',
        kind: 'worktree',
        cwd: 'C:\\managed-worktree',
        workspaceRootsJson: '[]',
        projectID: 'project',
        worktreeID: 'worktree',
      },
      destination: {
        threadID: 'source-thread',
        bindingID: 'destination-context',
        kind: 'local',
        cwd: 'C:\\repository',
        workspaceRootsJson: '[]',
        projectID: 'project',
      },
      targetThreadID: 'target-thread',
    })

    expect(copied).toBe(false)
    expect(bound).toMatchObject({
      threadId: 'target-thread',
      bindingId: 'local-target-binding',
      cwd: 'C:\\repository',
      environmentRevision: 0,
    })
    expect(recorded.bindingId).toBe('local-target-binding')
  })

  test('最近配置优先，key-path 更新保留注释、未知键和其他平台字段', async () => {
    const { root, service } = await fixture()
    const nested = join(root, 'packages', 'app')
    const filePath = join(root, 'packages', LOCAL_ENVIRONMENT_RELATIVE_PATH)
    await mkdir(dirname(filePath), { recursive: true })
    await mkdir(nested, { recursive: true })
    await writeFile(
      filePath,
      [
        '{',
        '  // keep this comment',
        '  "schema_version": 1,',
        '  "name": "before",',
        '  "unknown": { "future": true },',
        '  "setup": { "script": "base", "windows": "win", "macos": "mac", "linux": "linux" },',
        '  "actions": [{',
        '    // keep action comment',
        '    "name": "Dev", "icon": "play", "command": "base", "windows": "win-dev",',
        '    "future": { "keep": true }',
        '  }]',
        '}',
        '',
      ].join('\n'),
      'utf8',
    )

    const before = await service.read(nested)
    expect(before.filePath).toBe(filePath)
    expect(before.config.unknown).toEqual({ future: true })
    const updated = await service.update({
      cwd: nested,
      expectedRevision: before.revision,
      edits: [
        { keyPath: ['name'], value: 'after' },
        { keyPath: ['actions', 0, 'command'], value: 'bun dev' },
      ],
    })
    const text = await readFile(filePath, 'utf8')
    expect(text).toContain('// keep this comment')
    expect(text).toContain('"future": true')
    expect(text).toContain('// keep action comment')
    expect(text).toContain('"future": { "keep": true }')
    expect(text).toContain('"command": "bun dev"')
    expect(text).toContain('"macos": "mac"')
    expect(updated.executionTrusted).toBe(false)
    await expect(
      service.update({
        cwd: nested,
        expectedRevision: before.revision,
        edits: [{ keyPath: ['name'], value: 'stale' }],
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_ENVIRONMENT_CONFLICT' })
  }, 30_000)

  test('无配置时写入 Git root，Action 列表不暴露命令且 hash 变化撤销执行信任', async () => {
    const { root, service } = await fixture()
    const before = await service.read(root)
    expect(before.exists).toBe(false)
    const result = await service.update({
      cwd: root,
      expectedRevision: before.revision,
      edits: [
        {
          keyPath: ['actions'],
          value: [{ name: 'Test', icon: 'play', command: 'secret-command' }],
        },
      ],
    })
    expect(await stat(result.filePath).then((entry) => entry.isFile())).toBe(true)
    await service.update({
      cwd: root,
      expectedRevision: result.revision,
      trust: { configHash: result.configHash, decision: 'allow' },
    })
    expect((await service.read(root)).executionTrusted).toBe(true)
    const actions = await service.actionList(root)
    expect(actions.actions).toEqual([{ name: 'Test', icon: 'play', availability: 'available' }])
    expect(JSON.stringify(actions)).not.toContain('secret-command')
    await service.update({
      cwd: root,
      expectedRevision: result.revision,
      edits: [{ keyPath: ['name'], value: 'changed' }],
    })
    expect((await service.read(root)).executionTrusted).toBe(false)
  }, 30_000)

  test('setup 成功才原子替换环境增量，并将输出限制为 64 KiB 内存 tail', async () => {
    const { root, service, deltas, runner } = await fixture()
    const configPath = join(root, LOCAL_ENVIRONMENT_RELATIVE_PATH)
    await mkdir(dirname(configPath), { recursive: true })
    const successCommand =
      process.platform === 'win32'
        ? "$env:LOCAL_ENV_TEST_DELTA='updated'; $env:PIDEX_SECRET_CONTROL='blocked'; Write-Output ('x' * 70000)"
        : "export LOCAL_ENV_TEST_DELTA=updated; export PIDEX_SECRET_CONTROL=blocked; head -c 70000 /dev/zero | tr '\\0' x"
    await writeFile(
      configPath,
      JSON.stringify(
        {
          schema_version: 1,
          name: 'test',
          setup: { script: successCommand },
          actions: [],
        },
        null,
        2,
      ),
      'utf8',
    )
    const loaded = await service.read(root)
    await service.confirmExecution(root, loaded.configHash)
    const streamed: string[] = []
    const operation = await service.runLifecycle({
      cwd: root,
      bindingId: 'binding',
      kind: 'setup',
      operationId: 'setup-1',
      onOutput: (chunk) => streamed.push(chunk),
    })
    expect(operation).toMatchObject({ status: 'succeeded', errorCode: null })
    expect(streamed.join('')).not.toHaveLength(0)
    expect((await deltas.read('binding')).set.LOCAL_ENV_TEST_DELTA).toBe('updated')
    expect((await deltas.read('binding')).set.PIDEX_SECRET_CONTROL).toBeUndefined()
    const output = runner.output('setup-1')!
    expect(
      Buffer.byteLength(output.chunks.map((chunk) => chunk.data).join(''), 'utf8'),
    ).toBeLessThanOrEqual(64 * 1024)

    const firstDelta = await deltas.read('binding')
    await writeFile(
      configPath,
      JSON.stringify({
        schema_version: 1,
        name: 'test',
        setup: { script: process.platform === 'win32' ? "throw 'failed'" : 'exit 7' },
        actions: [],
      }),
      'utf8',
    )
    const changed = await service.read(root)
    await service.confirmExecution(root, changed.configHash)
    const failed = await service.runLifecycle({
      cwd: root,
      bindingId: 'binding',
      kind: 'setup',
      operationId: 'setup-2',
    })
    expect(failed).toMatchObject({
      status: 'failed',
      errorCode: 'LOCAL_ENVIRONMENT_COMMAND_FAILED',
    })
    expect(await deltas.read('binding')).toEqual(firstDelta)
  }, 30_000)

  test('执行信任只持久化项目与配置摘要，重启后可读取且 hash 改变失效', async () => {
    const { data } = await fixture()
    const first = new FileProjectTrustStore(data)
    const configHash = 'a'.repeat(64)
    await first.trustExecution('stable-project-id', configHash)
    expect(
      await new FileProjectTrustStore(data).isExecutionTrusted('stable-project-id', configHash),
    ).toBe(true)
    expect(
      await new FileProjectTrustStore(data).isExecutionTrusted('stable-project-id', 'b'.repeat(64)),
    ).toBe(false)
    const persisted = await readFile(
      join(data, 'local-environment', 'execution-trust.json'),
      'utf8',
    )
    expect(persisted).not.toContain('stable-project-id')
    expect(persisted).not.toContain('script')
  }, 30_000)

  test('拒绝通过配置目录 symlink 或 junction 越界读取和更新', async () => {
    const { root, service } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'pidex-local-env-outside-'))
    roots.push(outside)
    await mkdir(join(outside, 'environments'), { recursive: true })
    await writeFile(
      join(outside, 'environments', 'environment.jsonc'),
      JSON.stringify({
        schema_version: 1,
        name: 'outside',
        actions: [],
      }),
      'utf8',
    )
    try {
      await symlink(
        outside,
        join(root, '.pidex'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    } catch (cause) {
      if (
        process.platform === 'win32' &&
        ['EPERM', 'EACCES'].includes((cause as NodeJS.ErrnoException).code ?? '')
      )
        return
      throw cause
    }
    await expect(service.read(root)).rejects.toMatchObject({ code: 'LOCAL_ENVIRONMENT_INVALID' })
  }, 30_000)

  test('主工作区与其 Git worktree 共享稳定项目身份', async () => {
    const { root, discovery } = await fixture()
    await writeFile(join(root, 'tracked.txt'), 'fixture\n', 'utf8')
    await git(root, ['add', 'tracked.txt'])
    await git(root, ['commit', '-m', 'fixture'])
    const target = await mkdtemp(join(tmpdir(), 'pidex-local-env-worktree-'))
    await rm(target, { recursive: true, force: true })
    roots.push(target)
    await git(root, ['worktree', 'add', '--detach', target])
    expect((await discovery.discover(target)).projectIdentity).toBe(
      (await discovery.discover(root)).projectIdentity,
    )
  }, 30_000)

  test('信任写入期间配置 revision 改变会撤销信任并返回冲突', async () => {
    const { root, discovery, runner } = await fixture()
    const configPath = join(root, LOCAL_ENVIRONMENT_RELATIVE_PATH)
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      configPath,
      JSON.stringify({ schema_version: 1, name: 'before', actions: [] }),
      'utf8',
    )
    let revoked = false
    const service = new LocalEnvironmentService(
      discovery,
      {
        isExecutionTrusted: async () => false,
        trustExecution: async () => {
          await writeFile(
            configPath,
            JSON.stringify({ schema_version: 1, name: 'changed', actions: [] }),
            'utf8',
          )
        },
        revokeExecution: async () => {
          revoked = true
        },
      },
      runner,
    )
    const before = await service.read(root)
    await expect(
      service.update({
        cwd: root,
        expectedRevision: before.revision,
        trust: { configHash: before.configHash, decision: 'allow' },
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_ENVIRONMENT_CONFLICT' })
    expect(revoked).toBe(true)
  }, 30_000)
})
