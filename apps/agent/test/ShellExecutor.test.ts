import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FULL_ACCESS_PERMISSION_CONFIG, type PermissionConfig } from '@pidex/shared/thread'
import { removeFixturePaths } from './FixtureCleanup'
import {
  shellRuntimeDependencies,
  ToolExecutor,
  type ToolExecutionContext,
} from '../src/tool/ToolExecutor'
import type { ProcessResult } from '../src/tool/Shell/HostProcess'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { AgentLogger } from '../src/observability/AgentLogger'
import type { ShellSecurityLevel } from '../src/security/ShellRiskClassifier'

const tempPaths: string[] = []
afterEach(async () => removeFixturePaths(tempPaths.splice(0)))

const workspaceWrite: PermissionConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
}

const readOnly: PermissionConfig = {
  sandboxMode: 'read-only',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
}

async function executionContext(
  root: string,
  permissionConfig: PermissionConfig = workspaceWrite,
  overrides: Partial<ToolExecutionContext> = {},
) {
  return {
    threadID: 'thread',
    turnID: 'turn',
    taskMode: 'chat' as const,
    signal: new AbortController().signal,
    workspace: await WorkspaceService.open(root),
    permissionConfig,
    ...overrides,
  }
}

const success = (stdout = 'ok'): ProcessResult => ({
  exitCode: 0,
  signal: null,
  stdout,
  stderr: '',
  timedOut: false,
  truncated: false,
})

describe('统一 Shell 宿主执行门', () => {
  test('只识别命令起始位置的 Node.js 与 Python 运行时', () => {
    expect(
      shellRuntimeDependencies(
        'node app.js && npm test; npx tsc | python script.py\npip install x & python3 -V',
      ),
    ).toEqual(['nodejs', 'python'])
    expect(shellRuntimeDependencies('corepack enable; python3 -V; pip3 -V')).toEqual([
      'nodejs',
      'python',
    ])
    expect(shellRuntimeDependencies("Write-Output 'npm python'; echo node; bun run test")).toEqual(
      [],
    )
    expect(shellRuntimeDependencies('C:\\custom\\node.exe app.js; ./python script.py')).toEqual([])
  })

  test('三种权限配置都在统一门禁后直接调用宿主 runner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-host-shell-'))
    tempPaths.push(root)
    const executed: string[] = []
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, '.agent-data'),
      authorizeShell: async () => ({ decision: 'allow', risk: 'critical', reason: '允许' }),
      runHost: async (command) => {
        executed.push(command)
        return success()
      },
    })

    for (const [index, permissionConfig] of [
      readOnly,
      workspaceWrite,
      FULL_ACCESS_PERMISSION_CONFIG,
    ].entries()) {
      await executor.execute(
        'PowerShell',
        { command: `Write-Output ${index}` },
        await executionContext(root, permissionConfig),
      )
    }

    expect(executed).toHaveLength(3)
  })

  test('Shell 只解析实际需要的运行时并注入受控 PATH', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-host-shell-'))
    tempPaths.push(root)
    const requested: string[][] = []
    let receivedEnv: NodeJS.ProcessEnv | undefined
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, '.agent-data'),
      authorizeShell: async () => ({ decision: 'allow', risk: 'low', reason: '允许' }),
      resolveToolingEnvironment: async (required) => {
        requested.push([...required])
        return {
          pathEntries: required.map((id) => `C:\\managed\\${id}`),
          resolutions: new Map(
            required.map((id) => [
              id,
              {
                available: true as const,
                path: `C:\\managed\\${id}\\runtime.exe`,
                source: 'managed' as const,
                version: 'test',
              },
            ]),
          ),
        }
      },
      runHost: async (_command, _cwd, _timeout, _signal, env) => {
        receivedEnv = env
        return success()
      },
    })

    await executor.execute('PowerShell', { command: 'npm test' }, await executionContext(root))
    expect(requested).toEqual([['nodejs']])
    expect(Object.values(receivedEnv ?? {}).join(';')).toContain('C:\\managed\\nodejs')
  })

  test('Windows Bash 在审批后动态解析 Managed Git Bash', async () => {
    if (process.platform !== 'win32') return
    const root = await mkdtemp(join(tmpdir(), 'pidex-host-shell-'))
    tempPaths.push(root)
    let resolutions = 0
    let command = ''
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, '.agent-data'),
      authorizeShell: async () => ({ decision: 'allow', risk: 'low', reason: '允许' }),
      resolveTooling: async () => {
        resolutions += 1
        return {
          available: true,
          path: 'C:\\managed\\Git\\bin\\bash.exe',
          source: 'managed',
          version: 'test',
        }
      },
      runHost: async (value) => {
        command = value
        return success()
      },
    })

    await executor.execute('Bash', { command: 'pwd' }, await executionContext(root))
    expect(resolutions).toBe(1)
    expect(command).toContain('C:\\managed\\Git\\bin\\bash.exe')
  })

  test('审批或项目 Hook 拒绝时宿主进程绝不启动', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-host-shell-'))
    tempPaths.push(root)
    let runs = 0
    const deniedByApproval = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, '.agent-data'),
      authorizeShell: async () => ({ decision: 'deny', risk: 'critical', reason: '拒绝' }),
      runHost: async () => {
        runs += 1
        return success()
      },
    })
    await expect(
      deniedByApproval.execute(
        'PowerShell',
        {
          command: 'Write-Output blocked',
          additionalPermissions: { networkDomains: ['example.com'] },
        },
        await executionContext(root),
      ),
    ).rejects.toMatchObject({ code: 'SHELL_PERMISSION_DENIED' })

    const deniedByHook = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, '.agent-data'),
      authorizeShell: async () => ({ decision: 'allow', risk: 'low', reason: '允许' }),
      hooks: {
        run: async (event) =>
          event === 'pre_tool_use' ? [{ result: { decision: 'deny', reason: 'blocked' } }] : [],
      },
      runHost: async () => {
        runs += 1
        return success()
      },
    })
    await expect(
      deniedByHook.execute(
        'PowerShell',
        { command: 'Write-Output blocked' },
        await executionContext(root),
      ),
    ).rejects.toMatchObject({ code: 'HOOK_DENIED' })
    expect(runs).toBe(0)
  })

  test('Shell 风险审批标记和安全级别热切换作用于同一执行器', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-host-shell-'))
    tempPaths.push(root)
    let securityLevel: ShellSecurityLevel = 'balanced'
    let receivedRuleApproval = false
    let runs = 0
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, '.agent-data'),
      resolveShellSecurityLevel: () => securityLevel,
      authorizeShell: async (invocation) => {
        receivedRuleApproval = invocation.permissionFacts?.ruleRequiresApproval === true
        return { decision: 'allow', risk: 'high', reason: '允许' }
      },
      runHost: async () => {
        runs += 1
        return success()
      },
    })

    await executor.execute(
      'PowerShell',
      { command: 'winget uninstall fixture' },
      await executionContext(root),
    )
    expect(receivedRuleApproval).toBe(true)
    expect(runs).toBe(1)

    securityLevel = 'strict'
    await expect(
      executor.execute(
        'PowerShell',
        { command: 'winget uninstall fixture' },
        await executionContext(root),
      ),
    ).rejects.toMatchObject({ code: 'SHELL_HARD_DENY' })
    expect(runs).toBe(1)
  })

  test('Pi 预审批恢复后不重复执行项目 Hook', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-host-shell-'))
    tempPaths.push(root)
    let preHooks = 0
    let runs = 0
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, '.agent-data'),
      authorizeShell: async () => ({ decision: 'allow', risk: 'critical', reason: '允许' }),
      hooks: {
        run: async (event) => {
          if (event === 'pre_tool_use') preHooks += 1
          return []
        },
      },
      runHost: async () => {
        runs += 1
        return success()
      },
    })
    const context = await executionContext(root)
    const toolCallID = 'tool-call'
    await executor.previewApproval(
      'PowerShell',
      { command: 'Write-Output once' },
      context,
      toolCallID,
    )
    await executor.execute(
      'PowerShell',
      { command: 'Write-Output once' },
      { ...context, toolCallID, approvedToolCallID: toolCallID },
    )
    expect(preHooks).toBe(1)
    expect(runs).toBe(1)
  })

  test('计划模式不暴露也不能直接执行 Shell', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-host-shell-'))
    tempPaths.push(root)
    let runs = 0
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, '.agent-data'),
      authorizeShell: async () => ({ decision: 'allow', risk: 'critical', reason: '允许' }),
      runHost: async () => {
        runs += 1
        return success()
      },
    })
    const plan = executor.exposurePlan({
      taskMode: 'plan',
      sandboxMode: 'read-only',
      approvalPolicy: 'on-request',

      profile: 'main',
    })
    expect(plan.exposed).not.toContain('Bash')
    expect(plan.exposed).not.toContain('PowerShell')
    await expect(
      executor.execute(
        'PowerShell',
        { command: 'Write-Output blocked' },
        { ...(await executionContext(root)), taskMode: 'plan' },
      ),
    ).rejects.toMatchObject({ code: 'PLAN_SHELL_DISABLED' })
    expect(runs).toBe(0)
  })

  test('旧 sandbox escalation token 明确返回不支持且无副作用', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-host-shell-'))
    tempPaths.push(root)
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, '.agent-data'),
      authorizeShell: async () => ({ decision: 'allow', risk: 'high', reason: '允许' }),
      runHost: async () => success(),
    })

    await expect(
      executor.execute(
        'request_permissions',
        {
          scope: 'tool-call',
          escalationToken: '11111111-1111-4111-8111-111111111111',
          justification: 'legacy',
        },
        await executionContext(root),
      ),
    ).rejects.toMatchObject({ code: 'SANDBOX_ESCALATION_UNAVAILABLE' })
  })

  test('分阶段日志包含诊断元数据但不记录命令和输出正文', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-host-shell-log-'))
    tempPaths.push(root)
    const logger = new AgentLogger(join(root, 'logs'), {
      detailMode: 'development',
    })
    const executor = new ToolExecutor(new ToolRegistry(), {
      dataDir: join(root, '.agent-data'),
      logger,
      authorizeShell: async () => ({ decision: 'allow', risk: 'critical', reason: '允许' }),
      runHost: async () => success('sensitive-output'),
    })

    await executor.execute(
      'PowerShell',
      { command: 'Write-Output sensitive-command' },
      await executionContext(root),
    )
    const log = await readFile(join(root, 'logs', 'agent.jsonl'), 'utf8')
    expect(log).toContain('shell.preflight.completed')
    expect(log).toContain('shell.execution.started')
    expect(log).toContain('shell.execution.completed')
    expect(log).toContain('"backend":"host-hook"')
    expect(log).toContain('"commandBytes":')
    expect(log).toContain('"stdoutBytes":')
    expect(log).not.toContain('sensitive-command')
    expect(log).not.toContain('sensitive-output')
  })
})

test('Shell 恢复审批核对精确指纹；Hook 改写后重新验证 schema 和硬拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-shell-recheck-'))
  tempPaths.push(root)
  const context = await executionContext(root)
  let runs = 0
  let rewrite: Record<string, unknown> | undefined
  const executor = new ToolExecutor(new ToolRegistry(), {
    dataDir: join(root, '.agent-data'),
    authorizeShell: async () => ({ decision: 'allow', risk: 'low', reason: 'test' }),
    hooks: {
      run: async (event) =>
        event === 'pre_tool_use' && rewrite
          ? [{ result: { decision: 'continue', narrowedInput: rewrite } }]
          : [],
    },
    runHost: async () => {
      runs += 1
      return success()
    },
  })
  const preview = await executor.previewApproval(
    'PowerShell',
    { command: 'Write-Output original' },
    context,
    'exact-call',
  )
  await expect(
    executor.execute(
      'PowerShell',
      { command: 'Write-Output changed' },
      {
        ...context,
        toolCallID: 'exact-call',
        approvedToolCallID: 'exact-call',
        approvedAuthorizationFingerprint: preview.authorizationFingerprint!,
      },
    ),
  ).rejects.toThrow('作用范围已变化')
  rewrite = { __ruleRequiresApproval: false }
  await expect(
    executor.execute('PowerShell', { command: 'Write-Output ok' }, context),
  ).rejects.toThrow()
  rewrite = { command: 'Remove-Item -Recurse -Force C:\\Windows' }
  await expect(
    executor.execute('PowerShell', { command: 'Write-Output ok' }, context),
  ).rejects.toThrow()
  expect(runs).toBe(0)
})
