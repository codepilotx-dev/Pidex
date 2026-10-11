import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { WorkspaceService } from '../src/workspace/WorkspaceService'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)))

describe('工作区工具', () => {
  test('Plan 暴露面固定为只读并与 Chat update_plan 分离', () => {
    const executor = new ToolExecutor(new ToolRegistry())
    const plan = executor.exposurePlan({
      taskMode: 'plan',
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'on-request',

      profile: 'main',
    })
    expect(plan.exposed).not.toContain('PowerShell')
    expect(plan.exposed).not.toContain('Bash')
    expect(plan.exposed).toContain('request_user_input')
    expect(plan.exposed).not.toContain('Write')
    expect(plan.exposed).not.toContain('request_permissions')
    expect(plan.exposed).not.toContain('update_plan')
    expect(plan.exposed).not.toContain('finalize_plan')

    const chat = executor.exposurePlan({
      taskMode: 'chat',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',

      profile: 'main',
    })
    expect(chat.exposed).toContain('update_plan')
    expect(chat.exposed).not.toContain('request_user_input')
    expect(
      executor.exposurePlan({
        taskMode: 'chat',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',

        profile: 'main',
        defaultModeRequestUserInput: true,
      }).exposed,
    ).toContain('request_user_input')
    expect(
      executor.exposurePlan({
        taskMode: 'chat',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',

        profile: 'worker',
      }).exposed,
    ).not.toContain('update_plan')
    expect(
      executor.exposurePlan({
        taskMode: 'chat',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',

        profile: 'worker',
        defaultModeRequestUserInput: true,
      }).exposed,
    ).not.toContain('request_user_input')
  })

  test('普通模式直接应用补丁，Plan 模式拒绝写入', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-workspace-'))
    paths.push(root)
    const file = join(root, 'source.txt')
    await writeFile(file, 'before', 'utf8')
    const workspace = await WorkspaceService.open(root)
    const tools = new ToolRegistry()
    const executor = new ToolExecutor(tools)
    const context = {
      threadID: 'thread',
      turnID: 'turn',
      taskMode: 'chat' as const,
      signal: new AbortController().signal,
      workspace,
    }

    await executor.execute('Read', { file_path: 'source.txt' }, context)
    const patch = await executor.execute(
      'Edit',
      {
        path: 'source.txt',
        edits: [{ oldText: 'before', newText: 'after' }],
      },
      context,
    )
    expect(patch).toMatchObject({ operation: 'edit', path: 'source.txt' })
    expect(await Bun.file(file).text()).toBe('after')
    await expect(
      executor.execute(
        'Edit',
        {
          path: 'source.txt',
          edits: [{ oldText: 'after', newText: 'blocked' }],
        },
        { ...context, taskMode: 'plan' },
      ),
    ).rejects.toMatchObject({ code: 'TOOL_PERMISSION_DENIED' })
    expect(await Bun.file(file).text()).toBe('after')
  })

  test('拒绝工作区外路径并以 UTF-8 读取文件', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'pidex-workspace-'))
    paths.push(parent)
    const root = join(parent, 'project')
    await mkdir(root)
    await Bun.write(join(parent, 'outside.txt'), 'outside')
    await Bun.write(join(root, 'utf8.txt'), '中文 UTF-8')
    const workspace = await WorkspaceService.open(root)

    await expect(workspace.read('../outside.txt')).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_DENIED',
    })
    expect(await workspace.read('utf8.txt')).toBe('中文 UTF-8')
  })

  test('ToolCatalog 传递 workspace.read offset/limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-workspace-'))
    paths.push(root)
    await Bun.write(join(root, 'lines.txt'), 'zero\none\ntwo\nthree')
    const workspace = await WorkspaceService.open(root)
    const executor = new ToolExecutor(new ToolRegistry())
    const result = await executor.execute<{ content: string }>(
      'workspace.read',
      { file_path: 'lines.txt', offset: 1, limit: 2 },
      {
        threadID: 'thread',
        turnID: 'turn',
        taskMode: 'chat',
        signal: new AbortController().signal,
        workspace,
      },
    )
    expect(result.content).toBe('one\ntwo')
  })

  test('Skill allowedTools 在执行器最终边界只能收紧工具', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-skill-tools-'))
    paths.push(root)
    await Bun.write(join(root, 'file.txt'), 'ok')
    const workspace = await WorkspaceService.open(root)
    const executor = new ToolExecutor(new ToolRegistry())
    const context = {
      threadID: 'thread',
      turnID: 'turn',
      taskMode: 'chat' as const,
      signal: new AbortController().signal,
      workspace,
      allowedTools: ['Read'],
    }
    await expect(
      executor
        .execute<{ content: string }>('workspace.read', { file_path: 'file.txt' }, context)
        .then((result) => result.content),
    ).resolves.toBe('ok')
    await expect(
      executor.execute('workspace.grep', { pattern: 'ok' }, context),
    ).rejects.toMatchObject({ code: 'SKILL_TOOL_NOT_ALLOWED' })
  })

  test('拒绝通过符号链接逃离工作区', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'pidex-workspace-'))
    paths.push(parent)
    const root = join(parent, 'project')
    const outside = join(parent, 'outside.txt')
    await mkdir(root)
    await writeFile(outside, 'secret', 'utf8')
    await symlink(outside, join(root, 'outside-link.txt'), 'file')
    const workspace = await WorkspaceService.open(root)

    await expect(workspace.read('outside-link.txt')).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_DENIED',
    })
  })

  test('统一执行器最低层拒绝 read-only apply_patch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-workspace-'))
    paths.push(root)
    const workspace = await WorkspaceService.open(root)
    const executor = new ToolExecutor(new ToolRegistry())

    await expect(
      executor.execute(
        'Write',
        { file_path: 'blocked.txt', content: 'blocked' },
        {
          threadID: 'thread',
          turnID: 'turn',
          taskMode: 'chat',
          signal: new AbortController().signal,
          workspace,
          permissionConfig: {
            sandboxMode: 'read-only',
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'TOOL_PERMISSION_DENIED' })
  })

  test('Explorer 不暴露 Shell 且直接调用也在执行器最低层拒绝', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-explorer-'))
    paths.push(root)
    const workspace = await WorkspaceService.open(root)
    const registry = new ToolRegistry()
    expect(
      registry.list('chat', 'workspace-write', 'explorer').map((tool) => tool.sdkName),
    ).not.toContain('PowerShell')
    const executor = new ToolExecutor(registry)
    await expect(
      executor.execute(
        'PowerShell',
        { command: 'Get-ChildItem' },
        {
          threadID: 'thread',
          turnID: 'turn',
          profile: 'explorer',
          taskMode: 'chat',
          signal: new AbortController().signal,
          workspace,
        },
      ),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_ALLOWED_FOR_PROFILE' })
  })
})
