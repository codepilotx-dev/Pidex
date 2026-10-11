import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import {
  PermissionGrantStore,
  intersectPermissionGrant,
} from '../src/permission/PermissionGrantStore'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { WorkspaceService } from '../src/workspace/WorkspaceService'

const temporary: string[] = []
afterEach(async () => removeFixturePaths(temporary.splice(0)))

describe('临时权限授权', () => {
  test('request_permissions schema 支持 session 且拒绝空权限请求', () => {
    const schema = new ToolRegistry().get('request_permissions').schema
    expect(
      schema.parse({
        scope: 'session',
        networkDomains: ['api.example.com'],
        justification: '允许 API',
      }),
    ).toMatchObject({ scope: 'session' })
    expect(() => schema.parse({ scope: 'turn', justification: '没有具体权限' })).toThrow()
  })

  test('用户授权只能缩小模型请求', () => {
    expect(
      intersectPermissionGrant(
        {
          readPaths: ['C:\\repo'],
          writePaths: ['C:\\repo\\output'],
          networkDomains: ['example.com'],
        },
        {
          readPaths: ['C:\\repo\\src', 'C:\\'],
          writePaths: ['C:\\repo\\output\\result.txt', 'C:\\repo'],
          networkDomains: ['api.example.com', 'other.example'],
        },
      ),
    ).toEqual({
      readPaths: ['C:\\repo\\src'],
      writePaths: ['C:\\repo\\output\\result.txt'],
      networkDomains: ['api.example.com'],
    })
  })

  test('tool-call 只消费一次，turn 不跨 turn，session 仅按 thread 生效', () => {
    const store = new PermissionGrantStore()
    const permissions = { readPaths: ['C:\\repo'], writePaths: [], networkDomains: [] }
    store.grant({
      threadID: 'thread',
      turnID: 'turn-1',
      agentID: 'agent',
      scope: 'tool-call',
      requested: permissions,
      granted: permissions,
    })
    expect(
      store.authorize({
        threadID: 'thread',
        turnID: 'turn-1',
        agentID: 'agent',
        requested: permissions,
        consumeToolCall: true,
      })?.scope,
    ).toBe('tool-call')
    expect(
      store.authorize({
        threadID: 'thread',
        turnID: 'turn-1',
        agentID: 'agent',
        requested: permissions,
        consumeToolCall: true,
      }),
    ).toBeNull()

    store.grant({
      threadID: 'thread',
      turnID: 'turn-1',
      agentID: 'agent',
      scope: 'turn',
      requested: permissions,
      granted: permissions,
    })
    expect(
      store.authorize({
        threadID: 'thread',
        turnID: 'turn-2',
        agentID: 'agent',
        requested: permissions,
      }),
    ).toBeNull()

    store.grant({
      threadID: 'thread',
      turnID: 'turn-1',
      agentID: 'agent',
      scope: 'session',
      requested: permissions,
      granted: permissions,
    })
    expect(
      store.authorize({
        threadID: 'thread',
        turnID: 'turn-2',
        agentID: 'other-agent',
        requested: permissions,
      })?.scope,
    ).toBe('session')
    expect(
      store.authorize({
        threadID: 'other-thread',
        turnID: 'turn-2',
        agentID: 'agent',
        requested: permissions,
      }),
    ).toBeNull()
  })

  test('获批的 tool-call 权限被下一次 Shell 消费且不会重复审批', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'pidex-permission-grant-'))
    temporary.push(parent)
    const workspaceRoot = join(parent, 'workspace')
    const outsideRoot = join(parent, 'outside')
    await Promise.all([mkdir(workspaceRoot), mkdir(outsideRoot)])
    await writeFile(join(outsideRoot, 'fixture.txt'), 'fixture', 'utf8')
    const hostCommands: string[] = []
    let approvals = 0
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(parent, 'agent-data'),
      runHost: async (command) => {
        hostCommands.push(command)
        return {
          exitCode: 0,
          signal: null,
          stdout: 'ok',
          stderr: '',
          timedOut: false,
          truncated: false,
        }
      },
      authorizeShell: async () => {
        approvals += 1
        return { decision: 'allow', risk: 'low', reason: 'test fallback' }
      },
    })
    const context = {
      threadID: 'thread',
      turnID: 'turn',
      agentID: 'agent',
      taskMode: 'chat' as const,
      signal: new AbortController().signal,
      workspace: await WorkspaceService.open(workspaceRoot),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      } as const,
    }

    await executor.execute(
      'request_permissions',
      {
        scope: 'tool-call',
        readPaths: [outsideRoot],
        justification: '读取测试 fixture',
      },
      { ...context, toolCallID: 'permission-call', approvedToolCallID: 'permission-call' },
    )

    const shellInput = {
      command: 'Write-Output ok',
      additionalPermissions: { readPaths: [outsideRoot] },
    }
    await executor.execute('PowerShell', shellInput, context)
    expect(approvals).toBe(0)
    expect(hostCommands).toHaveLength(1)

    await executor.execute('PowerShell', shellInput, context)
    expect(approvals).toBe(1)
    expect(hostCommands).toHaveLength(2)
  })
})

test('文件授权预览不消费，并发执行只消费一次且不扩散到其他调用', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'pidex-file-grant-'))
  temporary.push(parent)
  const root = join(parent, 'workspace')
  const outside = join(parent, 'outside')
  await Promise.all([mkdir(root), mkdir(outside)])
  const target = join(outside, 'fixture.txt')
  await writeFile(target, 'fixture', 'utf8')
  const store = new PermissionGrantStore()
  const executor = new ToolExecutor(new ToolRegistry(), {
    dataDir: join(parent, 'data'),
    permissionGrants: store,
    authorizeShell: async () => ({ decision: 'allow', risk: 'low', reason: 'test' }),
  })
  const workspace = await WorkspaceService.open(root)
  const context = {
    threadID: 'thread',
    turnID: 'turn',
    agentID: 'agent',
    taskMode: 'chat' as const,
    signal: new AbortController().signal,
    workspace,
  }
  store.grant({
    ...context,
    scope: 'tool-call',
    requested: { readPaths: [target] },
    granted: { readPaths: [target] },
  })
  await executor.execute('Read', { file_path: target }, { ...context, authorizationOnly: true })
  expect(store.list('thread')).toHaveLength(1)
  const results = await Promise.allSettled([
    executor.execute('Read', { file_path: target }, context),
    executor.execute('Read', { file_path: target }, context),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(store.list('thread')).toHaveLength(0)
  await expect(workspace.resolveExistingPath(target)).rejects.toThrow()
  await expect(executor.execute('Read', { file_path: target }, context)).rejects.toThrow()
})

test('读取授权不能写入；写入授权只覆盖全部获批补丁目标且不绕过 Plan 或只读根', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'pidex-write-grant-'))
  temporary.push(parent)
  const root = join(parent, 'workspace')
  const outside = join(parent, 'outside')
  await Promise.all([mkdir(root), mkdir(outside)])
  const target = join(outside, 'created.txt')
  const store = new PermissionGrantStore()
  const executor = new ToolExecutor(new ToolRegistry(), {
    dataDir: join(parent, 'data'),
    permissionGrants: store,
    authorizeShell: async () => ({ decision: 'allow', risk: 'low', reason: 'test' }),
  })
  const context = {
    threadID: 'thread',
    turnID: 'turn',
    agentID: 'agent',
    taskMode: 'chat' as const,
    signal: new AbortController().signal,
    workspace: await WorkspaceService.open(root),
  }
  store.grant({
    ...context,
    scope: 'turn',
    requested: { readPaths: [outside] },
    granted: { readPaths: [outside] },
  })
  await expect(
    executor.execute('Write', { file_path: target, content: 'deny' }, context),
  ).rejects.toThrow()
  store.grant({
    ...context,
    scope: 'session',
    requested: { writePaths: [target] },
    granted: { writePaths: [target] },
  })
  await expect(
    executor.execute(
      'Write',
      { file_path: target, content: 'deny' },
      { ...context, taskMode: 'plan' },
    ),
  ).rejects.toThrow()
  const patch = `*** Begin Patch\n*** Add File: ${target}\n+ok\n*** Add File: ${join(outside, 'ungranted.txt')}\n+deny\n*** End Patch`
  await expect(executor.execute('apply_patch', { patch }, context)).rejects.toThrow()
  await expect(
    context.workspace.withFileAccess('full-access').resolveExistingPath(target),
  ).rejects.toThrow()
  await executor.execute(
    'Write',
    { file_path: target, content: 'ok' },
    { ...context, turnID: 'later' },
  )
  const readonlyWorkspace = await WorkspaceService.openRoots({
    primaryRoot: root,
    roots: [
      { path: root, role: 'primary' },
      { path: outside, role: 'secondary', writable: false },
    ],
  })
  await expect(
    executor.execute(
      'Write',
      { file_path: target, content: 'deny' },
      { ...context, workspace: readonlyWorkspace },
    ),
  ).rejects.toThrow()
})

test('Hook 改写外部目标重新匹配授权，不消费原目标授权', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'pidex-hook-grant-'))
  temporary.push(parent)
  const root = join(parent, 'workspace')
  const outside = join(parent, 'outside')
  await Promise.all([mkdir(root), mkdir(outside)])
  const target = join(outside, 'allowed.txt')
  const denied = join(outside, 'denied.txt')
  await Promise.all([writeFile(target, 'allowed', 'utf8'), writeFile(denied, 'denied', 'utf8')])
  const store = new PermissionGrantStore()
  const context = {
    threadID: 'thread',
    turnID: 'turn',
    agentID: 'agent',
    taskMode: 'chat' as const,
    signal: new AbortController().signal,
    workspace: await WorkspaceService.open(root),
  }
  store.grant({
    ...context,
    scope: 'tool-call',
    requested: { readPaths: [target] },
    granted: { readPaths: [target] },
  })
  const executor = new ToolExecutor(new ToolRegistry(), {
    dataDir: join(parent, 'data'),
    permissionGrants: store,
    authorizeShell: async () => ({ decision: 'allow', risk: 'low', reason: 'test' }),
    hooks: {
      run: async (event) =>
        event === 'pre_tool_use'
          ? [{ result: { decision: 'continue', narrowedInput: { file_path: denied } } }]
          : [],
    },
  })
  await expect(executor.execute('Read', { file_path: target }, context)).rejects.toThrow()
  expect(store.list('thread')).toHaveLength(1)
})

test('路径授权用于外部目录搜索和多文件补丁，目录内链接不能扩大范围', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'pidex-search-grant-'))
  temporary.push(parent)
  const root = join(parent, 'workspace')
  const outside = join(parent, 'outside')
  await Promise.all([mkdir(root), mkdir(outside)])
  const store = new PermissionGrantStore()
  const context = {
    threadID: 'thread',
    turnID: 'turn',
    agentID: 'agent',
    taskMode: 'chat' as const,
    signal: new AbortController().signal,
    workspace: await WorkspaceService.open(root),
  }
  store.grant({
    ...context,
    scope: 'session',
    requested: { writePaths: [outside] },
    granted: { writePaths: [outside] },
  })
  const executor = new ToolExecutor(new ToolRegistry(), {
    dataDir: join(parent, 'data'),
    permissionGrants: store,
    authorizeShell: async () => ({ decision: 'allow', risk: 'low', reason: 'test' }),
    resolveTooling: async () => ({
      available: false,
      code: 'SYSTEM_TOOL_NOT_FOUND',
      reason: 'fixture',
    }),
  })
  const first = join(outside, 'first.txt')
  const second = join(outside, 'second.txt')
  await executor.execute(
    'apply_patch',
    {
      patch: `*** Begin Patch\n*** Add File: ${first}\n+needle\n*** Add File: ${second}\n+other\n*** End Patch`,
    },
    context,
  )
  const glob = await executor.execute<{ matches: string[] }>(
    'Glob',
    { path: outside, pattern: '*.txt' },
    context,
  )
  expect(glob.matches).toHaveLength(2)
  const grep = await executor.execute<{ matches: unknown[] }>(
    'Grep',
    { path: outside, pattern: 'needle' },
    context,
  )
  expect(grep.matches).toHaveLength(1)
  await expect(context.workspace.resolveExistingPath(first)).rejects.toThrow()
  await symlink(
    outside,
    join(root, 'approved-link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await expect(
    executor.execute('Read', { file_path: join(root, 'approved-link', 'first.txt') }, context),
  ).resolves.toBeDefined()
  const secret = join(parent, 'secret')
  await mkdir(secret)
  await writeFile(join(secret, 'secret.txt'), 'secret', 'utf8')
  await symlink(secret, join(outside, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(
    executor.execute('Read', { file_path: join(outside, 'escape', 'secret.txt') }, context),
  ).rejects.toThrow()
})
