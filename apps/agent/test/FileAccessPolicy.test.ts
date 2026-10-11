import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { DEFAULT_PERMISSION_CONFIG, FULL_ACCESS_PERMISSION_CONFIG } from '@pidex/shared/thread'
import type { ApprovalPolicy, GranularApprovalConfig, PermissionConfig } from '@pidex/shared/thread'
import { removeFixturePaths } from './FixtureCleanup'
import { createLifecycleTools } from '../src/orchestration/pi/PiToolAdapter'
import { createToolExposurePlan } from '../src/tool/ToolExposurePlan'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { ToolCatalog, ToolRegistry } from '../src/tool/ToolRegistry'
import { WorkspaceService } from '../src/workspace/WorkspaceService'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)))

type ExecutionContext = Parameters<ToolExecutor['execute']>[2]

const granular = (overrides: Partial<GranularApprovalConfig> = {}): ApprovalPolicy => ({
  type: 'granular',
  sandboxApproval: false,
  rules: false,
  skillApproval: false,
  requestPermissions: false,
  mcpTools: false,
  mcpElicitations: false,
  ...overrides,
})

/** Fixture whose external directory deliberately contains a space. */
const fixture = async () => {
  const parent = await mkdtemp(join(tmpdir(), 'pidex-file-access-'))
  paths.push(parent)
  const root = join(parent, 'project')
  const outside = join(parent, 'outside dir')
  await mkdir(root)
  await mkdir(outside)
  const workspace = await WorkspaceService.open(root)
  // The approval service is audited instead of trusted: every test asserts the
  // recorded list, so an unexpected approval request fails the call even though
  // this reviewer would have allowed it.
  const approvals: string[] = []
  const executor = new ToolExecutor(new ToolRegistry(), {
    dataDir: join(parent, 'agent-data'),
    // Force the bounded native search so Glob/Grep stay deterministic here.
    resolveTooling: async () => ({
      available: false,
      code: 'TOOLING_UNAVAILABLE',
      reason: '测试固定使用原生搜索',
    }),
    authorizeShell: async (invocation) => {
      approvals.push(invocation.name)
      return { decision: 'allow', risk: 'critical', reason: '测试审批通过' }
    },
  })
  const context = (
    permissionConfig: PermissionConfig,
    overrides: Partial<ExecutionContext> = {},
  ): ExecutionContext => ({
    threadID: 'thread',
    turnID: 'turn',
    taskMode: 'chat',
    signal: new AbortController().signal,
    workspace,
    permissionConfig,
    ...overrides,
  })
  return { parent, root, outside, workspace, executor, approvals, context }
}

describe('完全访问权限下的文件工具', () => {
  test('直接读取、创建并编辑工作区外文件，且不触发任何审批', async () => {
    const { outside, executor, approvals, context } = await fixture()
    const external = join(outside, 'plan.md')
    await writeFile(external, 'external plan\n', 'utf8')

    const read = await executor.execute<{ path: string; content: string }>(
      'Read',
      { file_path: external },
      context(FULL_ACCESS_PERMISSION_CONFIG),
    )
    expect(read.content).toBe('external plan\n')
    // 外部路径必须可识别为绝对路径，且不受工作区相对化影响。
    expect(isAbsolute(read.path)).toBe(true)
    expect(read.path.endsWith('plan.md')).toBe(true)

    const created = join(outside, 'nested dir', 'created by agent.txt')
    await mkdir(join(outside, 'nested dir'))
    await executor.execute(
      'Write',
      { file_path: created, content: 'created\n' },
      context(FULL_ACCESS_PERMISSION_CONFIG),
    )
    expect(await readFile(created, 'utf8')).toBe('created\n')

    await executor.execute('Read', { file_path: external }, context(FULL_ACCESS_PERMISSION_CONFIG))
    await executor.execute(
      'Edit',
      { path: external, edits: [{ oldText: 'external plan', newText: 'edited plan' }] },
      context(FULL_ACCESS_PERMISSION_CONFIG),
    )
    expect(await readFile(external, 'utf8')).toBe('edited plan\n')
    expect(approvals).toEqual([])
  })

  test('完全访问模式下 Glob 与 Grep 可搜索工作区外目录', async () => {
    const { outside, executor, approvals, context } = await fixture()
    const external = join(outside, 'plan.md')
    await writeFile(external, 'edited plan\n', 'utf8')

    const glob = await executor.execute<{ matches: string[] }>(
      'Glob',
      { pattern: '*.md', path: outside },
      context(FULL_ACCESS_PERMISSION_CONFIG),
    )
    expect(glob.matches.some((match) => match.endsWith('plan.md'))).toBe(true)

    const grep = await executor.execute<{ matches: Array<{ path: string }> }>(
      'Grep',
      { pattern: 'edited plan', path: outside },
      context(FULL_ACCESS_PERMISSION_CONFIG),
    )
    expect(grep.matches.map((match) => match.path).some((path) => path.endsWith('plan.md'))).toBe(
      true,
    )
    expect(approvals).toEqual([])

    await expect(
      executor.execute(
        'Glob',
        { pattern: '*.md', path: outside },
        context(DEFAULT_PERMISSION_CONFIG),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_DENIED' })
  })

  test('完全访问模式下 apply_patch 的写入预检与提交同样作用于工作区外文件', async () => {
    const { outside, executor, approvals, context } = await fixture()
    const external = join(outside, 'patched.md')
    const added = join(outside, 'added.md')
    await writeFile(external, 'before\n', 'utf8')
    await executor.execute('Read', { file_path: external }, context(FULL_ACCESS_PERMISSION_CONFIG))

    await executor.execute(
      'apply_patch',
      {
        patch: [
          '*** Begin Patch',
          `*** Update File: ${external}`,
          '@@',
          '-before',
          '+after',
          `*** Add File: ${added}`,
          '+added',
          '*** End Patch',
        ].join('\n'),
      },
      context(FULL_ACCESS_PERMISSION_CONFIG),
    )

    expect(await readFile(external, 'utf8')).toBe('after\n')
    expect(await readFile(added, 'utf8')).toBe('added\n')
    expect(approvals).toEqual([])
  })

  test('默认与只读文件访问范围继续阻止工作区外的读写', async () => {
    const { outside, executor, approvals, context } = await fixture()
    const external = join(outside, 'plan.md')
    await writeFile(external, 'external plan\n', 'utf8')
    const readOnly: PermissionConfig = {
      sandboxMode: 'read-only',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    }

    await expect(
      executor.execute('Read', { file_path: external }, context(DEFAULT_PERMISSION_CONFIG)),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_DENIED' })
    await expect(
      executor.execute('Read', { file_path: external }, context(readOnly)),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_DENIED' })
    await expect(
      executor.execute(
        'Write',
        { file_path: join(outside, 'blocked.txt'), content: 'blocked\n' },
        context(DEFAULT_PERMISSION_CONFIG),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_DENIED' })
    expect(await Bun.file(join(outside, 'blocked.txt')).exists()).toBe(false)
    expect(approvals).toEqual([])
  })

  test('默认模式可以读取只读本地上下文但不能写入', async () => {
    const { outside, workspace, executor, context } = await fixture()
    const reference = join(outside, 'reference.txt')
    await writeFile(reference, 'read only\n', 'utf8')
    workspace.grantReadOnlyPaths([{ path: reference, kind: 'file' }])

    const read = await executor.execute<{ content: string }>(
      'Read',
      { file_path: reference },
      context(DEFAULT_PERMISSION_CONFIG),
    )
    expect(read.content).toBe('read only\n')
    await expect(
      executor.execute(
        'Write',
        { file_path: reference, content: 'changed\n' },
        context(DEFAULT_PERMISSION_CONFIG),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FILE_READONLY' })
    expect(await readFile(reference, 'utf8')).toBe('read only\n')
  })

  test('Plan 模式在完全访问权限下仍然禁止写文件', async () => {
    const { root, executor, context } = await fixture()
    await writeFile(join(root, 'target.txt'), 'before\n', 'utf8')

    await expect(
      executor.execute(
        'Write',
        { file_path: 'target.txt', content: 'after\n' },
        context(FULL_ACCESS_PERMISSION_CONFIG, { taskMode: 'plan' }),
      ),
    ).rejects.toMatchObject({ code: 'TOOL_PERMISSION_DENIED' })
    expect(await readFile(join(root, 'target.txt'), 'utf8')).toBe('before\n')
  })

  test('完全访问权限仍保留显式只读目录约束', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'pidex-file-access-root-'))
    paths.push(parent)
    const primary = join(parent, 'primary')
    const locked = join(parent, 'locked')
    await mkdir(primary)
    await mkdir(locked)
    await writeFile(join(locked, 'locked.txt'), 'locked\n', 'utf8')
    const workspace = await WorkspaceService.openRoots({
      primaryRoot: primary,
      roots: [
        { path: primary, role: 'primary' },
        { path: locked, role: 'secondary', writable: false },
      ],
    })
    const executor = new ToolExecutor(new ToolRegistry())
    const context: ExecutionContext = {
      threadID: 'thread',
      turnID: 'turn',
      taskMode: 'chat',
      signal: new AbortController().signal,
      workspace,
      permissionConfig: FULL_ACCESS_PERMISSION_CONFIG,
    }

    expect(
      (
        await executor.execute<{ content: string }>(
          'Read',
          { file_path: join(locked, 'locked.txt') },
          context,
        )
      ).content,
    ).toBe('locked\n')
    await expect(
      executor.execute(
        'Write',
        { file_path: join(locked, 'locked.txt'), content: 'changed\n' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FILE_READONLY' })
    expect(await readFile(join(locked, 'locked.txt'), 'utf8')).toBe('locked\n')
  })

  test('并发调用与权限切换不会继承其他调用的完全访问权限', async () => {
    const { outside, workspace, executor, context } = await fixture()
    const external = join(outside, 'shared.md')
    await writeFile(external, 'shared\n', 'utf8')

    const [granted, restricted] = await Promise.allSettled([
      executor.execute<{ content: string }>(
        'Read',
        { file_path: external },
        context(FULL_ACCESS_PERMISSION_CONFIG),
      ),
      executor.execute('Read', { file_path: external }, context(DEFAULT_PERMISSION_CONFIG)),
    ])
    expect(granted.status).toBe('fulfilled')
    expect(restricted.status).toBe('rejected')
    if (restricted.status === 'rejected') {
      expect((restricted.reason as { code?: string }).code).toBe('WORKSPACE_PATH_DENIED')
    }

    // 共享实例本身从未被改写：完全访问结束后仍按工作区边界工作。
    expect(workspace.fileAccess).toBe('workspace-write')
    await expect(
      executor.execute('Read', { file_path: external }, context(DEFAULT_PERMISSION_CONFIG)),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_DENIED' })
    await expect(
      executor
        .execute<{ content: string }>(
          'Read',
          { file_path: external },
          context(FULL_ACCESS_PERMISSION_CONFIG),
        )
        .then((result) => result.content),
    ).resolves.toBe('shared\n')
  })

  test('默认模式仍阻止工作区内符号链接指向工作区外', async () => {
    const { root, outside, executor, context } = await fixture()
    const external = join(outside, 'secret.txt')
    await writeFile(external, 'secret\n', 'utf8')
    await symlink(external, join(root, 'linked.txt'), 'file')

    await expect(
      executor.execute('Read', { file_path: 'linked.txt' }, context(DEFAULT_PERMISSION_CONFIG)),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_DENIED' })
  })
})

describe('权限申请工具的暴露与审批', () => {
  const exposure = (approvalPolicy: ApprovalPolicy) =>
    createToolExposurePlan(new ToolCatalog(), {
      taskMode: 'chat',
      sandboxMode: 'danger-full-access',
      approvalPolicy,
      profile: 'main',
    })

  test('never 与细粒度禁止时不暴露权限申请工具', () => {
    expect(exposure('never').allows('request_permissions')).toBe(false)
    expect(exposure(granular()).allows('request_permissions')).toBe(false)
    expect(exposure('on-request').allows('request_permissions')).toBe(true)
    expect(exposure('untrusted').allows('request_permissions')).toBe(true)
    expect(exposure(granular({ requestPermissions: true })).allows('request_permissions')).toBe(
      true,
    )
    // 其他生命周期工具不受审批策略影响。
    expect(exposure('never').allows('update_plan')).toBe(true)
    expect(exposure('never').allows('finalize_result')).toBe(true)
  })

  test('Pi 生命周期工具按统一暴露结果注册，并复用注册表参数约束', () => {
    const callbacks = { requestPermissions: async () => ({ granted: true }) }
    expect(
      createLifecycleTools(callbacks, {
        exposedTools: [],
        taskMode: 'chat',
      } as never).map((tool) => tool.name),
    ).not.toContain('request_permissions')

    const [tool] = createLifecycleTools(callbacks, {
      exposedTools: ['request_permissions'],
      taskMode: 'chat',
    } as never)
    expect(tool?.name).toBe('request_permissions')
    expect(tool?.description).toContain('never 策略下本工具不可用')
    const parameters = JSON.stringify(tool?.parameters)
    expect(parameters).toContain('"enum":["tool-call","turn","session"]')
    expect(parameters).toContain('"required":["scope","justification"]')
    expect(parameters).toContain('"readPaths"')
    expect(parameters).toContain('"networkDomains"')
  })

  test('禁止审批的权限申请在执行端仍被拒绝，允许时进入既有审批流程', async () => {
    const { root, executor, approvals, context } = await fixture()
    const request = {
      scope: 'turn',
      readPaths: [root],
      justification: '需要读取工作区外的计划文件',
    }

    await expect(
      executor.execute('request_permissions', request, context(FULL_ACCESS_PERMISSION_CONFIG)),
    ).rejects.toMatchObject({ code: 'TOOL_PERMISSION_DENIED' })
    await expect(
      executor.execute(
        'request_permissions',
        request,
        context({
          sandboxMode: 'workspace-write',
          approvalPolicy: granular(),
          approvalsReviewer: 'user',
        }),
      ),
    ).rejects.toMatchObject({ code: 'TOOL_PERMISSION_DENIED' })
    expect(approvals).toEqual([])

    const decision = await executor.execute<{ decision: string }>(
      'request_permissions',
      request,
      context(DEFAULT_PERMISSION_CONFIG, { authorizationOnly: true }),
    )
    expect(decision.decision).toBe('allow')
    expect(approvals).toEqual(['request_permissions'])
  })
})

describe('真实路径的配置与敏感文件保护', () => {
  for (const tool of ['Write', 'Edit', 'apply_patch'] as const) {
    test(`${tool} 通过绝对路径写用户配置仍执行校验并保持原文件`, async () => {
      const { parent, outside, context } = await fixture()
      const target = join(outside, 'config.json')
      await writeFile(target, 'before\n', 'utf8')
      const scopes: string[] = []
      const executor = new ToolExecutor(new ToolRegistry(), {
        dataDir: join(parent, 'validation-data'),
        userConfigPath: target,
        authorizeShell: async () => {
          throw new Error('不应到达审批')
        },
        validateConfigDocument: (_text, scope) => {
          scopes.push(scope)
          throw new Error('配置校验拒绝')
        },
      })
      const ctx = context(FULL_ACCESS_PERMISSION_CONFIG)
      await executor.execute('Read', { file_path: target }, ctx)
      const input =
        tool === 'Write'
          ? { file_path: target, content: 'after\n' }
          : tool === 'Edit'
            ? { path: target, edits: [{ oldText: 'before', newText: 'after' }] }
            : {
                patch: `*** Begin Patch
*** Update File: ${target}
@@
-before
+after
*** End Patch`,
              }
      await expect(executor.execute(tool, input, ctx)).rejects.toThrow('配置校验拒绝')
      expect(scopes).toEqual(['user'])
      expect(await readFile(target, 'utf8')).toBe('before\n')
    })
  }

  test('外部新建项目配置和 Git hooks 通过目录链接仍要求审批', async () => {
    const { root, outside, executor, approvals, context } = await fixture()
    const configDir = join(outside, '.pidex')
    const hooksDir = join(outside, '.git', 'hooks')
    await mkdir(configDir)
    await mkdir(hooksDir, { recursive: true })
    await symlink(configDir, join(root, 'config-link'), 'junction')
    await symlink(hooksDir, join(root, 'hooks-link'), 'junction')
    for (const target of [
      join(root, 'config-link', 'config.json'),
      join(root, 'hooks-link', 'pre-commit'),
    ]) {
      await expect(
        executor.execute(
          'Write',
          { file_path: target, content: 'blocked' },
          context(FULL_ACCESS_PERMISSION_CONFIG),
        ),
      ).rejects.toMatchObject({ code: 'TOOL_PERMISSION_DENIED' })
      expect(await Bun.file(target).exists()).toBe(false)
    }
    expect(approvals).toEqual([])
  })

  test('外部环境文件的补丁保留审批规则，示例文件仍可编辑', async () => {
    const { outside, executor, context } = await fixture()
    for (const name of ['.env', '.env.example']) {
      const target = join(outside, name)
      const operation = executor.execute(
        'apply_patch',
        {
          patch: `*** Begin Patch
*** Add File: ${target}
+example
*** End Patch`,
        },
        context(FULL_ACCESS_PERMISSION_CONFIG),
      )
      if (name === '.env') {
        await expect(operation).rejects.toMatchObject({ code: 'TOOL_PERMISSION_DENIED' })
        expect(await Bun.file(target).exists()).toBe(false)
      } else {
        await operation
        expect(await readFile(target, 'utf8')).toBe('example\n')
      }
    }
  })
})
