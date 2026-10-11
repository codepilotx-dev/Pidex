import { describe, expect, test } from 'bun:test'
import type { DesktopLogger } from '../src/logging/DesktopLogger'
import type { SidecarSupervisor } from '../src/sidecar/Supervisor'
import { TerminalHostRpcClient } from '../src/terminal/TerminalHostRpcClient'

describe('终端 Agent host RPC', () => {
  test('使用 desktop-host authority 初始化并解析权威 task cwd', async () => {
    const requests: Array<{ path: string; init: RequestInit }> = []
    const supervisor = {
      request: async (path: string, init: RequestInit): Promise<Response> => {
        requests.push({ path, init })
        const body = JSON.parse(String(init.body)) as {
          method: string
          params?: Record<string, unknown>
        }
        if (body.method === 'initialize') {
          return jsonResponse({ result: { connectionId: 'terminal-host-1' } })
        }
        if (body.method === 'initialized') return new Response(null, { status: 204 })
        return jsonResponse({
          result: {
            threadId: body.params?.threadId,
            bindingId: 'binding-1',
            contextVersion: '1',
            workspaceKind: 'project',
            target: { kind: 'worktree', cwd: 'C:\\worktree' },
          },
        })
      },
    } as unknown as SidecarSupervisor

    const client = new TerminalHostRpcClient(() => supervisor)
    await expect(client.resolve('thread-1')).resolves.toMatchObject({
      bindingId: 'binding-1',
      target: { kind: 'worktree', cwd: 'C:\\worktree' },
    })

    const initializeBody = JSON.parse(String(requests[0]?.init.body))
    expect(initializeBody.params.clientInfo.authority).toBe('desktop-host')
    expect(initializeBody.params.capabilities).toContain('terminal.host.v1')
    expect(requests[2]?.init.headers).toMatchObject({
      'X-Pidex-Connection-ID': 'terminal-host-1',
    })
  })

  test('Action 双读校验 context、command 和 environment revision', async () => {
    const methods: string[] = []
    const supervisor = {
      request: async (_path: string, init: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init.body)) as {
          method: string
          params?: Record<string, unknown>
        }
        methods.push(body.method)
        if (body.method === 'initialize')
          return jsonResponse({ result: { connectionId: 'terminal-host-action' } })
        if (body.method === 'initialized') return new Response(null, { status: 204 })
        if (body.method === 'terminal/host/context')
          return jsonResponse({ result: launchContext(body.params?.threadId) })
        if (body.method === 'terminal/host/action/resolve') {
          return jsonResponse({
            result: { contextVersion: 'context-1', environmentRevision: 3, command: 'bun run dev' },
          })
        }
        return jsonResponse({
          result: { revision: 3, set: { PATH: 'C:\\action' }, unset: ['OLD_PATH'] },
        })
      },
    } as unknown as SidecarSupervisor
    const client = new TerminalHostRpcClient(() => supervisor)

    await expect(client.prepareAction('thread-action', 'Dev')).resolves.toMatchObject({
      context: { bindingId: 'binding-1', contextVersion: 'context-1' },
      environment: { revision: 3 },
    })
    expect(methods).toEqual([
      'initialize',
      'initialized',
      'terminal/host/context',
      'terminal/host/action/resolve',
      'terminal/host/environment',
      'terminal/host/action/resolve',
      'terminal/host/context',
    ])
  })

  test('invalidate 后重新初始化 host 连接', async () => {
    const methods: string[] = []
    let initializeCount = 0
    const supervisor = {
      request: async (_path: string, init: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init.body)) as {
          method: string
          params?: Record<string, unknown>
        }
        methods.push(body.method)
        if (body.method === 'initialize') {
          initializeCount += 1
          return jsonResponse({ result: { connectionId: `terminal-host-${initializeCount}` } })
        }
        if (body.method === 'initialized') return new Response(null, { status: 204 })
        return jsonResponse({ result: launchContext(body.params?.threadId) })
      },
    } as unknown as SidecarSupervisor
    const client = new TerminalHostRpcClient(() => supervisor)

    await client.resolve('thread-reconnect')
    client.invalidate()
    await client.resolve('thread-reconnect')

    expect(methods).toEqual([
      'initialize',
      'initialized',
      'terminal/host/context',
      'initialize',
      'initialized',
      'terminal/host/context',
    ])
  })

  test('host 连接租约过期后重新初始化并重放一次请求', async () => {
    const requests: Array<{ method: string; connectionId?: string }> = []
    let initializeCount = 0
    let contextCount = 0
    const supervisor = {
      request: async (_path: string, init: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init.body)) as {
          method: string
          params?: Record<string, unknown>
        }
        const connectionId = (init.headers as Record<string, string> | undefined)?.[
          'X-Pidex-Connection-ID'
        ]
        requests.push({ method: body.method, connectionId })
        if (body.method === 'initialize') {
          initializeCount += 1
          return jsonResponse({ result: { connectionId: `terminal-host-${initializeCount}` } })
        }
        if (body.method === 'initialized') return new Response(null, { status: 204 })
        contextCount += 1
        if (contextCount === 1) {
          return jsonResponse({
            error: {
              code: -32001,
              message: 'expired Bearer secret-token C:\\private\\workspace',
              data: { code: 'UNAUTHORIZED' },
            },
          })
        }
        return jsonResponse({ result: launchContext(body.params?.threadId) })
      },
    } as unknown as SidecarSupervisor
    const client = new TerminalHostRpcClient(() => supervisor)

    await expect(client.resolve('thread-expired')).resolves.toMatchObject({
      threadId: 'thread-expired',
      target: { cwd: 'C:\\worktree' },
    })

    expect(requests).toEqual([
      { method: 'initialize', connectionId: undefined },
      { method: 'initialized', connectionId: 'terminal-host-1' },
      { method: 'terminal/host/context', connectionId: 'terminal-host-1' },
      { method: 'initialize', connectionId: undefined },
      { method: 'initialized', connectionId: 'terminal-host-2' },
      { method: 'terminal/host/context', connectionId: 'terminal-host-2' },
    ])
  })

  test('重新初始化后仍未授权时停止重放并返回通用错误', async () => {
    const methods: string[] = []
    let initializeCount = 0
    const supervisor = {
      request: async (_path: string, init: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init.body)) as { method: string }
        methods.push(body.method)
        if (body.method === 'initialize') {
          initializeCount += 1
          return jsonResponse({ result: { connectionId: `terminal-host-${initializeCount}` } })
        }
        if (body.method === 'initialized') return new Response(null, { status: 204 })
        return jsonResponse({
          error: {
            code: -32001,
            message: 'Bearer secret-token C:\\private\\workspace raw-response',
            data: { code: 'UNAUTHORIZED' },
          },
        })
      },
    } as unknown as SidecarSupervisor
    const client = new TerminalHostRpcClient(() => supervisor)

    const error = await client.resolve('thread-still-unauthorized').catch((cause) => cause as Error)

    expect(error.message).toContain('TERMINAL_UNAVAILABLE')
    expect(error.message).toContain('Agent 拒绝了终端请求')
    expect(error.message).not.toContain('secret-token')
    expect(error.message).not.toContain('private')
    expect(methods).toEqual([
      'initialize',
      'initialized',
      'terminal/host/context',
      'initialize',
      'initialized',
      'terminal/host/context',
    ])
  })

  test('Action 二次解析变化时安全拒绝，错误不包含 command', async () => {
    let actionRead = 0
    const supervisor = {
      request: async (_path: string, init: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init.body)) as {
          method: string
          params?: Record<string, unknown>
        }
        if (body.method === 'initialize')
          return jsonResponse({ result: { connectionId: 'terminal-host-stale' } })
        if (body.method === 'initialized') return new Response(null, { status: 204 })
        if (body.method === 'terminal/host/context')
          return jsonResponse({ result: launchContext(body.params?.threadId) })
        if (body.method === 'terminal/host/environment')
          return jsonResponse({ result: { revision: 3, set: {}, unset: [] } })
        actionRead += 1
        return jsonResponse({
          result: {
            contextVersion: 'context-1',
            environmentRevision: 3,
            command: actionRead === 1 ? 'first-sensitive-command' : 'second-sensitive-command',
          },
        })
      },
    } as unknown as SidecarSupervisor
    const client = new TerminalHostRpcClient(() => supervisor)
    const error = await client.prepareAction('thread-stale', 'Dev').catch((cause) => cause as Error)
    expect(error.message).toContain('TERMINAL_CONTEXT_STALE')
    expect(error.message).not.toContain('sensitive-command')
  })

  test('Agent 的信任错误映射为稳定安全错误', async () => {
    const supervisor = {
      request: async (_path: string, init: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init.body)) as {
          method: string
          params?: Record<string, unknown>
        }
        if (body.method === 'initialize')
          return jsonResponse({ result: { connectionId: 'terminal-host-denied' } })
        if (body.method === 'initialized') return new Response(null, { status: 204 })
        if (body.method === 'terminal/host/context')
          return jsonResponse({ result: launchContext(body.params?.threadId) })
        return jsonResponse({
          error: {
            code: -32000,
            message: 'raw-sensitive-error',
            data: { code: 'LOCAL_ENVIRONMENT_UNTRUSTED' },
          },
        })
      },
    } as unknown as SidecarSupervisor
    const client = new TerminalHostRpcClient(() => supervisor)
    const error = await client
      .prepareAction('thread-denied', 'Dev')
      .catch((cause) => cause as Error)
    expect(error.message).toContain('TERMINAL_ACTION_UNTRUSTED')
    expect(error.message).not.toContain('raw-sensitive-error')
  })

  test('初始化拒绝只记录允许公开的稳定错误码', async () => {
    const logs: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const sensitiveMessage = 'Bearer secret-token C:\\private\\workspace raw-response'
    const supervisor = initializeFailureSupervisor({
      code: -32000,
      message: sensitiveMessage,
      data: { code: 'PERMISSION_DENIED' },
    })
    const client = new TerminalHostRpcClient(() => supervisor, loggerCapturing(logs))

    const error = await client.resolve('thread-sensitive').catch((cause) => cause as Error)

    expect(error.message).toContain('TERMINAL_UNAVAILABLE')
    expect(error.message).toContain('无法初始化终端 Agent 连接')
    expect(logs).toEqual([
      {
        event: 'terminal.host-initialize-rejected',
        fields: { details: { code: 'PERMISSION_DENIED' } },
      },
    ])
    const serializedLogs = JSON.stringify(logs)
    expect(serializedLogs).not.toContain(sensitiveMessage)
    expect(serializedLogs).not.toContain('secret-token')
    expect(serializedLogs).not.toContain('C:\\private\\workspace')
    expect(serializedLogs).not.toContain('raw-response')
  })

  test('未知初始化错误码归一化为 UNKNOWN', async () => {
    const logs: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const supervisor = initializeFailureSupervisor({
      code: -32000,
      message: 'malicious-response-body',
      data: { code: 'EVIL_C:\\private\\token-secret' },
    })
    const client = new TerminalHostRpcClient(() => supervisor, loggerCapturing(logs))

    const error = await client.resolve('thread-unknown').catch((cause) => cause as Error)

    expect(error.message).toContain('TERMINAL_UNAVAILABLE')
    expect(logs).toEqual([
      {
        event: 'terminal.host-initialize-rejected',
        fields: { details: { code: 'UNKNOWN' } },
      },
    ])
    expect(JSON.stringify(logs)).not.toContain('malicious-response-body')
    expect(JSON.stringify(logs)).not.toContain('private')
  })

  test('无效初始化响应记录 INVALID_RESPONSE', async () => {
    const logs: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const supervisor = {
      request: async (): Promise<Response> =>
        jsonResponse({ result: { connectionId: 'invalid id' } }),
    } as unknown as SidecarSupervisor
    const client = new TerminalHostRpcClient(() => supervisor, loggerCapturing(logs))

    const error = await client.resolve('thread-invalid').catch((cause) => cause as Error)

    expect(error.message).toContain('TERMINAL_UNAVAILABLE')
    expect(logs).toEqual([
      {
        event: 'terminal.host-initialize-rejected',
        fields: { details: { code: 'INVALID_RESPONSE' } },
      },
    ])
  })
})

function launchContext(threadId: unknown) {
  return {
    threadId,
    bindingId: 'binding-1',
    contextVersion: 'context-1',
    workspaceKind: 'project',
    target: { kind: 'worktree', cwd: 'C:\\worktree' },
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function initializeFailureSupervisor(error: unknown): SidecarSupervisor {
  return {
    request: async (): Promise<Response> => jsonResponse({ error }),
  } as unknown as SidecarSupervisor
}

function loggerCapturing(
  logs: Array<{ event: string; fields?: Record<string, unknown> }>,
): DesktopLogger {
  return {
    directory: '',
    consoleEnabled: false,
    debug: () => {},
    info: () => {},
    warn: (event, fields) => logs.push({ event, fields }),
    error: () => {},
    forwardConsoleLine: () => {},
  }
}
