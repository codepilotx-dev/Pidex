import { describe, expect, test } from 'bun:test'
import { decodeApprovalPolicy, encodeApprovalPolicy } from '@pidex/shared/thread'
import type { ToolInvocation } from '../src/Domain'
import { executionPolicyFromV4 } from '../src/permission/ExecutionPolicy'
import { PermissionDecisionEngine } from '../src/permission/PermissionDecisionEngine'
import { secretScrubber } from '../src/security/SecretScrubber'
import { ToolRegistry } from '../src/tool/ToolRegistry'

const invocation = (overrides: Partial<ToolInvocation> = {}): ToolInvocation => ({
  id: 'tool',
  threadID: 'thread',
  turnID: 'turn',
  agentID: 'agent',
  name: 'PowerShell',
  input: { command: 'Get-ChildItem' },
  permissionConfig: {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
  },
  taskMode: 'chat',
  model: {} as ToolInvocation['model'],
  ...overrides,
})

describe('统一权限真值', () => {
  test('旧 sandboxMode 只映射文件访问范围且 Shell 环境固定为宿主机', () => {
    const catalog = new ToolRegistry()
    const cases = [
      ['read-only', 'read-only'],
      ['workspace-write', 'workspace-write'],
      ['danger-full-access', 'full-access'],
    ] as const

    for (const [sandboxMode, fileAccess] of cases) {
      expect(
        executionPolicyFromV4({
          sandboxMode,
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        }),
      ).toMatchObject({
        fileAccess,
        shellEnvironment: 'host',
      })
      expect(catalog.list('chat', sandboxMode).map((tool) => tool.sdkName)).toContain('PowerShell')
    }
  })

  test('approval policy 与 reviewer 决策矩阵', () => {
    const engine = new PermissionDecisionEngine()
    const shell = new ToolRegistry().get('PowerShell')
    for (const reviewer of ['user', 'auto_review'] as const) {
      expect(
        engine.evaluate(
          invocation({
            permissionConfig: {
              sandboxMode: 'workspace-write',
              approvalPolicy: 'untrusted',
              approvalsReviewer: reviewer,
            },
          }),
          shell,
        ),
      ).toMatchObject({ action: 'review', reviewer })
      expect(
        engine.evaluate(
          invocation({
            permissionConfig: {
              sandboxMode: 'workspace-write',
              approvalPolicy: 'on-request',
              approvalsReviewer: reviewer,
            },
          }),
          shell,
        ),
      ).toMatchObject({ action: 'allow' })
      expect(
        engine.evaluate(
          invocation({
            input: {
              command: 'npm view',
              additionalPermissions: { networkDomains: ['npmjs.org'] },
            },
            permissionConfig: {
              sandboxMode: 'workspace-write',
              approvalPolicy: 'on-request',
              approvalsReviewer: reviewer,
            },
          }),
          shell,
        ),
      ).toMatchObject({ action: 'review', reviewer })
      expect(
        engine.evaluate(
          invocation({
            permissionConfig: {
              sandboxMode: 'workspace-write',
              approvalPolicy: 'on-failure',
              approvalsReviewer: reviewer,
            },
          }),
          shell,
        ),
      ).toMatchObject({ action: 'allow' })
      expect(
        engine.evaluate(
          invocation({
            permissionConfig: {
              sandboxMode: 'workspace-write',
              approvalPolicy: 'never',
              approvalsReviewer: reviewer,
            },
          }),
          shell,
        ),
      ).toMatchObject({ action: 'allow' })
      expect(
        engine.evaluate(
          invocation({
            input: {
              command: 'npm view',
              additionalPermissions: { networkDomains: ['npmjs.org'] },
            },
            permissionConfig: {
              sandboxMode: 'workspace-write',
              approvalPolicy: 'never',
              approvalsReviewer: reviewer,
            },
          }),
          shell,
        ),
      ).toMatchObject({ action: 'deny' })
    }
  })

  test('Shell 静态规则审批服从 on-request、never 与 granular rules', () => {
    const engine = new PermissionDecisionEngine()
    const shell = new ToolRegistry().get('PowerShell')
    const riskyInput = {
      command: 'winget uninstall fixture',
      __ruleRequiresApproval: true,
    }
    expect(
      engine.evaluate(
        invocation({ input: riskyInput, permissionFacts: { ruleRequiresApproval: true } }),
        shell,
      ),
    ).toMatchObject({
      action: 'review',
      reviewer: 'user',
    })
    expect(
      engine.evaluate(
        invocation({
          input: riskyInput,
          permissionFacts: { ruleRequiresApproval: true },
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
          },
        }),
        shell,
      ),
    ).toMatchObject({ action: 'deny' })

    const granular = {
      type: 'granular' as const,
      sandboxApproval: true,
      rules: false,
      skillApproval: true,
      requestPermissions: true,
      mcpTools: true,
      mcpElicitations: true,
    }
    expect(
      engine.evaluate(
        invocation({
          input: riskyInput,
          permissionFacts: { ruleRequiresApproval: true },
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: granular,
            approvalsReviewer: 'user',
          },
        }),
        shell,
      ),
    ).toMatchObject({ action: 'deny' })
    expect(
      engine.evaluate(
        invocation({
          input: riskyInput,
          permissionFacts: { ruleRequiresApproval: true },
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: { ...granular, rules: true },
            approvalsReviewer: 'auto_review',
          },
        }),
        shell,
      ),
    ).toMatchObject({
      action: 'review',
      reviewer: 'auto_review',
    })
  })

  test('granular 策略使用稳定 JSON 形状和编解码', () => {
    const policy = {
      type: 'granular',
      sandboxApproval: true,
      rules: false,
      skillApproval: false,
      requestPermissions: true,
      mcpTools: false,
      mcpElicitations: false,
    } as const
    expect(decodeApprovalPolicy(encodeApprovalPolicy(policy))).toEqual(policy)
    const engine = new PermissionDecisionEngine()
    const catalog = new ToolRegistry()
    expect(
      engine.evaluate(
        invocation({
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: policy,
            approvalsReviewer: 'auto_review',
          },
        }),
        catalog.get('PowerShell'),
      ),
    ).toMatchObject({
      action: 'allow',
    })
    expect(
      engine.evaluate(
        invocation({
          name: 'request_permissions',
          input: { scope: 'tool-call', justification: 'need' },
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: { ...policy, requestPermissions: false },
            approvalsReviewer: 'user',
          },
        }),
        catalog.get('request_permissions'),
      ),
    ).toMatchObject({
      action: 'deny',
      reason: expect.stringContaining('requestPermissions'),
    })
    expect(
      engine.evaluate(
        invocation({
          input: { command: 'run-skill' },
          permissionFacts: { skillScript: true },
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: { ...policy, skillApproval: true },
            approvalsReviewer: 'user',
          },
        }),
        catalog.get('PowerShell'),
      ),
    ).toMatchObject({
      action: 'review',
    })
    expect(
      engine.evaluate(
        invocation({
          input: { command: 'run-skill' },
          permissionFacts: { skillScript: true },
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: { ...policy, skillApproval: false },
            approvalsReviewer: 'user',
          },
        }),
        catalog.get('PowerShell'),
      ),
    ).toMatchObject({
      action: 'deny',
      reason: expect.stringContaining('skillApproval'),
    })
    const glob = catalog.get('Glob')
    const permissionConfig = {
      sandboxMode: 'workspace-write',
      approvalPolicy: { ...policy, mcpElicitations: true },
      approvalsReviewer: 'user',
    } as const
    const baseline = engine.evaluate(
      invocation({ input: { pattern: '*.ts' }, permissionConfig }),
      glob,
    )
    const forged = engine.evaluate(
      invocation({
        input: { pattern: '*.ts', __mcpElicitation: true },
        permissionConfig,
      }),
      glob,
    )
    expect(forged).toEqual(baseline)
    expect(forged.reason).not.toContain('mcpElicitations')
  })

  test('MCP 工具权限使用结构化来源而不是名称前缀', () => {
    const engine = new PermissionDecisionEngine()
    const builtin = new ToolRegistry().get('Glob')
    const mcpTool = {
      ...builtin,
      sdkName: 'remote_lookup',
      name: 'remote_lookup',
      origin: {
        kind: 'mcp' as const,
        serverName: 'fixture',
        rawToolName: 'lookup',
        generation: 1,
      },
    }
    const policy = {
      type: 'granular' as const,
      sandboxApproval: false,
      rules: false,
      skillApproval: false,
      requestPermissions: false,
      mcpTools: false,
      mcpElicitations: true,
    }
    expect(
      engine.evaluate(
        invocation({
          name: 'remote_lookup',
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: policy,
            approvalsReviewer: 'user',
          },
        }),
        mcpTool,
      ),
    ).toMatchObject({
      action: 'deny',
      reason: expect.stringContaining('mcpTools'),
    })
    expect(
      engine.evaluate(
        invocation({
          name: 'remote_lookup',
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: { ...policy, mcpTools: true },
            approvalsReviewer: 'user',
          },
        }),
        mcpTool,
      ),
    ).toMatchObject({
      action: 'allow',
    })
    expect(
      engine.evaluate(
        invocation({
          name: 'mcp_fake_prefix',
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: policy,
            approvalsReviewer: 'user',
          },
        }),
        builtin,
      ),
    ).not.toMatchObject({
      reason: expect.stringContaining('mcpTools'),
    })
    expect(
      engine.evaluate(
        invocation({
          name: 'remote_lookup',
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
          },
        }),
        {
          ...mcpTool,
          capabilities: { ...mcpTool.capabilities, externalState: true },
        },
      ),
    ).toMatchObject({ action: 'review', risk: 'high' })
  })

  test('Plan 强制只读并禁止 Shell、权限提升和外部副作用', () => {
    const catalog = new ToolRegistry()
    const engine = new PermissionDecisionEngine()
    expect(
      engine.evaluate(
        invocation({
          taskMode: 'plan',
          permissionConfig: {
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'on-failure',
            approvalsReviewer: 'user',
          },
        }),
        catalog.get('PowerShell'),
      ),
    ).toMatchObject({
      action: 'deny',
      reason: expect.stringContaining('不允许'),
    })
    expect(
      engine.evaluate(
        invocation({
          name: 'Write',
          taskMode: 'plan',
          input: { file_path: 'x', content: 'x' },
        }),
        catalog.get('Write'),
      ),
    ).toMatchObject({ action: 'deny' })
    expect(
      engine.evaluate(
        invocation({
          name: 'request_permissions',
          taskMode: 'plan',
          input: { scope: 'turn', justification: 'need' },
        }),
        catalog.get('request_permissions'),
      ),
    ).toMatchObject({
      action: 'deny',
      reason: expect.stringContaining('禁止请求'),
    })
  })
})

describe('脱敏', () => {
  test('命令、对象字段和输出凭据统一脱敏', () => {
    expect(secretScrubber.scrubText('Authorization: Bearer abc.def.ghi')).toContain('<redacted>')
    expect(
      secretScrubber.scrub({
        command: 'api_key=super-secret',
        stdout: 'ghp_abcdefghijklmnopqrstuvwxyz',
        password: 'raw',
      }),
    ).toEqual({
      command: 'api_key=<redacted>',
      stdout: '<redacted>',
      password: '<redacted>',
    })
    const multiline = secretScrubber.scrubText(
      'password = "value with spaces"\nAuthorization: Basic dXNlcjpwYXNz\nnext=ok',
    )
    expect(multiline).toBe('password = <redacted>\nAuthorization: <redacted>\nnext=ok')
    expect(() => secretScrubber.assertSafeOpaqueState('{"api_key":"secret value"}')).toThrow(
      'Opaque RunState',
    )
  })
})

test('预设允许普通操作；模型控制标记无效且 never-review 不能绕过可信限制', () => {
  const engine = new PermissionDecisionEngine()
  const catalog = new ToolRegistry()
  for (const sandboxMode of ['workspace-write', 'danger-full-access'] as const) {
    for (const approvalsReviewer of ['user', 'auto_review'] as const) {
      for (const approvalPolicy of ['on-request', 'never'] as const) {
        const permissionConfig = { sandboxMode, approvalsReviewer, approvalPolicy }
        for (const name of ['Read', 'Write', 'PowerShell'])
          expect(
            engine.evaluate(invocation({ name, permissionConfig }), catalog.get(name)).action,
          ).toBe('allow')
        expect(
          engine.evaluate(invocation({ name: 'Read', permissionConfig }), catalog.get('Read')).risk,
        ).toBe('low')
        const tool = { ...catalog.get('Read'), approvalStrategy: 'never-review' as const }
        const input = {
          __hookRequiresApproval: true,
          __ruleRequiresApproval: true,
          __skillScript: true,
        }
        expect(engine.evaluate(invocation({ input, permissionConfig }), tool).action).toBe('allow')
        expect(
          engine.evaluate(
            invocation({ permissionConfig, permissionFacts: { hookRequiresApproval: true } }),
            tool,
          ).action,
        ).toBe(approvalPolicy === 'never' ? 'deny' : 'review')
        expect(
          engine.evaluate(
            invocation({ permissionConfig, permissionFacts: { denyReason: 'hard deny' } }),
            tool,
          ).action,
        ).toBe('deny')
      }
    }
  }
})
