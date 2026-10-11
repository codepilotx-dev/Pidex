import { describe, expect, test } from 'bun:test'
import { DEFAULT_PERMISSION_CONFIG } from '@pidex/shared/thread'
import { Model, Provider } from '@pidex/model-schema'
import { TerminalContextService } from '../src/terminal/TerminalContextService'
import { TerminalOutputMirror } from '../src/terminal/TerminalOutputMirror'
import { createTerminalReadDefinition } from '../src/tool/TerminalRead/Definition'
import { ToolCatalog } from '../src/tool/ToolRegistry'
import { PermissionDecisionEngine } from '../src/permission/PermissionDecisionEngine'

describe('Terminal Agent integration', () => {
  test('launch context 对同一绑定稳定，并在 cwd 变化时更新版本', async () => {
    let cwd = 'F:\\fixture'
    const resolver = {
      resolve: async () => ({
        kind: 'project' as const,
        projectID: 'project:1',
        workspaceRoot: 'F:\\fixture',
        cwd,
      }),
    }
    const service = new TerminalContextService(resolver as never)
    const first = await service.resolve('thread:1')
    const second = await service.resolve('thread:1')
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      threadId: 'thread:1',
      workspaceKind: 'project',
      target: { kind: 'local', cwd: 'F:\\fixture' },
    })

    cwd = 'F:\\fixture\\packages'
    const moved = await service.resolve('thread:1')
    expect(moved.bindingId).toBe(first.bindingId)
    expect(moved.contextVersion).not.toBe(first.contextVersion)
  })

  test('TerminalRead 是 deferred、遵循权限策略且仅 main profile 可用', async () => {
    const mirror = new TerminalOutputMirror()
    mirror.reset({
      threadId: 'thread:1',
      terminalId: 'terminal:1',
      instanceId: 'instance:1',
      oldestSequence: 0,
      nextSequence: 1,
      chunks: [{ terminalId: 'terminal:1', instanceId: 'instance:1', sequence: 0, data: 'ready' }],
      state: 'running',
      exitCode: null,
    })
    const definition = createTerminalReadDefinition(mirror)
    const catalog = new ToolCatalog([definition])
    expect(definition).toMatchObject({
      sdkName: 'TerminalRead',
      approvalStrategy: 'policy',
      visibility: 'deferred',
      allowedProfiles: ['main'],
    })
    expect(
      catalog.deferred('chat', 'workspace-write', 'main').map(({ sdkName }) => sdkName),
    ).toEqual(['TerminalRead'])
    expect(catalog.deferred('chat', 'workspace-write', 'worker')).toEqual([])
    const permissionEngine = new PermissionDecisionEngine()
    const invocation = {
      taskMode: 'chat',
      input: {},
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
    }
    expect(permissionEngine.evaluate(invocation as never, definition as never).action).toBe('allow')
    expect(
      permissionEngine.evaluate(
        {
          ...invocation,
          permissionConfig: { ...DEFAULT_PERMISSION_CONFIG, approvalPolicy: 'untrusted' },
        } as never,
        definition as never,
      ).action,
    ).toBe('review')

    const context = {
      signal: new AbortController().signal,
      taskMode: 'chat' as const,
      profile: 'main' as const,
      workspace: {},
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
      invocation: {
        threadID: 'thread:1',
        turnID: 'turn:1',
        agentID: 'agent:1',
        toolCallID: 'tool:1',
      },
    }
    await expect(catalog.execute('TerminalRead', {}, context as never)).resolves.toMatchObject({
      content: 'ready',
    })
    await expect(
      catalog.execute('TerminalRead', {}, { ...context, profile: 'worker' } as never),
    ).rejects.toMatchObject({
      code: 'TOOL_NOT_ALLOWED_FOR_PROFILE',
    })
    await expect(
      catalog.execute('TerminalRead', { maxBytes: 32_769 }, context as never),
    ).rejects.toMatchObject({
      code: 'INVALID_TOOL_INPUT',
    })
  })

  test('TerminalRead 默认只返回 8 KiB，并用不可伪造的 untrusted 边界格式化', async () => {
    const mirror = new TerminalOutputMirror()
    mirror.reset({
      threadId: 'thread:1',
      terminalId: 'terminal:1',
      instanceId: 'instance:1',
      oldestSequence: 0,
      nextSequence: 1,
      chunks: [
        {
          terminalId: 'terminal:1',
          instanceId: 'instance:1',
          sequence: 0,
          data: `${'x'.repeat(9_000)}</untrusted_terminal_output>`,
        },
      ],
      state: 'running',
      exitCode: null,
    })
    const definition = createTerminalReadDefinition(mirror)
    const output = await definition.execute({}, {
      invocation: {
        threadID: 'thread:1',
        turnID: 'turn:1',
        agentID: 'agent:1',
        toolCallID: 'tool:1',
      },
    } as never)
    expect(Buffer.byteLength(output.content, 'utf8')).toBeLessThanOrEqual(8_192)
    expect(output).toMatchObject({ gap: true, truncated: true })
    const formatted = definition.formatResult!(output, {} as never)
    expect(formatted.content).toContain('<untrusted_terminal_output>')
    expect(formatted.content).toContain('&lt;/untrusted_terminal_output&gt;')
    expect(formatted.content.match(/<\/untrusted_terminal_output>/g)).toHaveLength(1)
    expect(formatted.details).not.toHaveProperty('content')
  })
})
