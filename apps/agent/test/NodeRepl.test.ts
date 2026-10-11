import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NodeReplChildMessage, NodeReplHostMessage } from '../src/nodeRepl/Protocol'
import { computerOperationRecoveryFrom } from '../src/nodeRepl/Protocol'
import { runNodeReplScript, type NodeReplChildTransport } from '../src/nodeRepl/ChildRuntime'
import {
  NodeReplPaused,
  NodeReplService,
  NODE_REPL_CHILD_FLAG,
  resolveNodeReplCommand,
} from '../src/nodeRepl/NodeReplService'
import {
  NODE_REPL_PLUGIN_ID,
  NODE_REPL_SERVER_NAME,
  NODE_REPL_TOOL_NAME,
  hostManagedMcpDeclarations,
  isTrustedHostMcpServer,
} from '../src/nodeRepl/Association'
import { nodeReplToolDefinition } from '../src/nodeRepl/Definition'
import { PluginManagementService } from '../src/plugin/PluginManagementService'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-node-repl-'))
  roots.push(root)
  return root
}

/** In-memory child transport with a polling driver so calls resolve like a real cell. */
const benchScript = async (
  code: string,
  respond: (method: string, args: Record<string, unknown>) => { text: string },
) => {
  const sent: NodeReplChildMessage[] = []
  const queue: NodeReplHostMessage[] = []
  let resolveNext: ((message: NodeReplHostMessage | null) => void) | null = null
  const transport: NodeReplChildTransport = {
    send: (message) => sent.push(message),
    next: () =>
      queue.length
        ? Promise.resolve(queue.shift()!)
        : new Promise<NodeReplHostMessage | null>((resolve) => {
            resolveNext = resolve
          }),
  }
  const push = (message: NodeReplHostMessage) => {
    if (resolveNext) {
      const resolve = resolveNext
      resolveNext = null
      resolve(message)
    } else queue.push(message)
  }
  const handled = new Set<number>()
  const timer = setInterval(() => {
    for (const message of sent) {
      if (message.type !== 'call' || handled.has(message.id)) continue
      handled.add(message.id)
      push({
        type: 'result',
        id: message.id,
        ok: true,
        result: respond(message.method, message.args),
      })
    }
  }, 2)
  try {
    await runNodeReplScript(transport, code)
  } finally {
    clearInterval(timer)
  }
  return sent
}

describe('node_repl cell runtime', () => {
  test('exposes only computer and nodeRepl, and supports top-level await', async () => {
    const sent = await benchScript(
      `nodeRepl.write((await computer.apps()).text); nodeRepl.write(typeof require); nodeRepl.write(typeof process); nodeRepl.write(typeof Bun)`,
      () => ({ text: 'apps-ok' }),
    )
    const writes = sent.flatMap((message) => (message.type === 'write' ? [message.text] : []))
    expect(writes).toEqual(['apps-ok', 'undefined', 'undefined', 'undefined'])
    expect(sent.some((message) => message.type === 'call' && message.method === 'apps')).toBe(true)
  })

  test('routes read and action arguments unchanged and surfaces typed call errors', async () => {
    const calls: Array<Record<string, unknown>> = []
    const sent = await benchScript(
      `try { await computer.read('w1') } catch (error) { nodeRepl.write(error.code) }`,
      (method, args) => {
        calls.push({ method, ...args })
        return { text: 'state' }
      },
    )
    expect(calls).toEqual([{ method: 'read', windowRef: 'w1' }])
    expect(sent.some((message) => message.type === 'done')).toBe(true)
    // Invalid arguments fail closed instead of reaching the host bridge.
    const rejected = await benchScript(
      `try { await computer.action('', 'o', {}) } catch (e) { nodeRepl.write(e.code) }`,
      () => ({
        text: 'never',
      }),
    )
    const codes = rejected.flatMap((message) => (message.type === 'write' ? [message.text] : []))
    expect(codes).toEqual(['NODE_REPL_INVALID_ARGUMENT'])
  })

  test('reports script failures as an error frame without a done frame', async () => {
    const sent = await benchScript(`throw new Error('boom')`, () => ({ text: 'x' }))
    expect(sent.some((message) => message.type === 'error' && message.message === 'boom')).toBe(
      true,
    )
    expect(sent.some((message) => message.type === 'done')).toBe(false)
  })
})

describe('node_repl host service', () => {
  const execute = (
    service: NodeReplService,
    code: string,
    overrides: Partial<Parameters<NodeReplService['execute']>[0]> = {},
  ) =>
    service.execute({
      threadID: 'thread-1',
      code,
      signal: new AbortController().signal,
      runOperation: async () => ({ kind: 'result', result: { text: 'ok' } }),
      ...overrides,
    })

  test('runs a real isolated cell and collects text and images', async () => {
    const service = new NodeReplService()
    const result = await execute(service, `nodeRepl.write('hello'); nodeRepl.emitImage('AAAA')`)
    expect(result.paused).toBe(false)
    expect(result.text).toBe('hello')
    expect(result.images).toEqual([{ data: 'AAAA', mimeType: 'image/png' }])
  })

  test('each call is a fresh process: no globals, bindings or module cache survive', async () => {
    const service = new NodeReplService()
    await execute(service, `globalThis.__pidexLeak = 1; nodeRepl.write('set')`)
    const second = await execute(service, `nodeRepl.write(typeof globalThis.__pidexLeak)`)
    expect(second.text).toBe('undefined')
  })

  test('bridges computer calls to the host operation runner', async () => {
    const service = new NodeReplService()
    const seen: string[] = []
    const result = await execute(service, `nodeRepl.write((await computer.apps()).text)`, {
      runOperation: async (request) => {
        seen.push(request.method)
        return { kind: 'result', result: { text: 'windows' } }
      },
    })
    expect(seen).toEqual(['apps'])
    expect(result.text).toBe('windows')
  })

  test('stops the cell when the host arranges an approval pause', async () => {
    const service = new NodeReplService()
    const result = await execute(service, `await computer.read('w1'); nodeRepl.write('after')`, {
      runOperation: async () => ({ kind: 'paused' }),
    })
    expect(result.paused).toBe(true)
    // Nothing after the blocked read executed.
    expect(result.text).toBe('')
  })

  test('kills a cell that exceeds its timeout', async () => {
    const service = new NodeReplService()
    await expect(
      execute(service, `await new Promise(() => {}); nodeRepl.write('never')`, {
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'NODE_REPL_TIMEOUT' })
  })

  test('honours cancellation before starting any work', async () => {
    const service = new NodeReplService()
    const controller = new AbortController()
    controller.abort()
    await expect(
      execute(service, `nodeRepl.write('x')`, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'RUN_ABORTED' })
  })

  test('the installed binary re-enters itself in child mode', () => {
    expect(resolveNodeReplCommand('C:/Pidex/pidex-agent.exe')).toEqual({
      executable: 'C:/Pidex/pidex-agent.exe',
      args: [NODE_REPL_CHILD_FLAG],
    })
    expect(resolveNodeReplCommand('C:/bun/bun.exe').args[0]).toBe('run')
  })

  test('NodeReplPaused is a distinct sentinel', () => {
    expect(new NodeReplPaused().name).toBe('NodeReplPaused')
  })
})

describe('host-managed MCP trust boundary', () => {
  test('only the official bundled plugin owns node_repl', () => {
    expect(isTrustedHostMcpServer(NODE_REPL_PLUGIN_ID, 'bundled', NODE_REPL_SERVER_NAME)).toBe(true)
    expect(isTrustedHostMcpServer(NODE_REPL_PLUGIN_ID, 'personal', NODE_REPL_SERVER_NAME)).toBe(
      false,
    )
    expect(isTrustedHostMcpServer(NODE_REPL_PLUGIN_ID, 'workspace', NODE_REPL_SERVER_NAME)).toBe(
      false,
    )
    expect(isTrustedHostMcpServer('third-party', 'bundled', NODE_REPL_SERVER_NAME)).toBe(false)
    expect(hostManagedMcpDeclarations('computer-use', 'personal')).toEqual([])
  })

  test('plugin details attribute the host MCP server only to the bundled plugin', async () => {
    const bundled = await temporaryRoot()
    const personal = await temporaryRoot()
    await writePluginWithHostMcp(bundled, 'computer-use')
    await writePluginWithHostMcp(personal, 'computer-use')
    const service = new PluginManagementService(pluginSettingsStub(), {
      builtinPluginsRoot: bundled,
      userHome: personal,
    })
    const listed = await service.list()
    expect(listed.plugins.map((plugin) => [plugin.id, plugin.source])).toContainEqual([
      'computer-use',
      'bundled',
    ])
    const details = await service.getDetails({ pluginId: 'computer-use' })
    const mcp = details.details.components?.find((component) => component.kind === 'mcp')
    expect(mcp).toMatchObject({
      id: NODE_REPL_SERVER_NAME,
      managedBy: 'host',
    })
    // The personal copy is not installed, so the bundled manifest wins; a
    // personal-only plugin never surfaces a host component at all.
    expect(hostManagedMcpDeclarations('computer-use', 'personal')).toEqual([])
  })
})

const pluginSettingsStub = () =>
  ({
    state: () => ({ version: 1, disabledPluginIds: [], generation: 1, updatedAt: 0 }),
  }) as never

const writePluginWithHostMcp = async (root: string, id: string) => {
  const pluginRoot = join(root, id)
  await mkdir(join(pluginRoot, '.codex-plugin'), { recursive: true })
  await mkdir(join(pluginRoot, '.cpx-plugin'), { recursive: true })
  await mkdir(join(pluginRoot, 'docs'), { recursive: true })
  await writeFile(
    join(pluginRoot, '.codex-plugin', 'plugin.json'),
    JSON.stringify({
      name: id,
      version: '1.0.0',
      description: '读取并操作本机 Windows 应用界面。',
      author: { name: 'Pidex' },
      docs: './docs/',
      mcpServers: { [NODE_REPL_SERVER_NAME]: { managed: true } },
      interface: {
        displayName: 'Computer Use',
        shortDescription: '通过 Pidex 控制 Windows 应用',
        developerName: 'Pidex',
        category: 'Productivity',
      },
    }),
  )
  await writeFile(
    join(pluginRoot, '.cpx-plugin', 'plugin.json'),
    JSON.stringify({
      schemaVersion: 1,
      installation: 'INSTALLED_BY_DEFAULT',
      capabilities: ['computer-use'],
      hostMcpServers: [NODE_REPL_SERVER_NAME],
    }),
  )
  await writeFile(join(pluginRoot, 'docs', 'computer-use.md'), '# Computer Use\n')
}

describe('node_repl tool exposure', () => {
  const definition = () =>
    nodeReplToolDefinition({
      plugins: { isEnabled: () => true } as never,
      computer: { available: () => true, inspect: () => undefined } as never,
      service: {} as never,
      executor: {} as never,
    })

  test('is a deferred MCP entry restricted to the main agent in chat mode', () => {
    const tool = definition()
    expect(tool.sdkName).toBe(NODE_REPL_TOOL_NAME)
    expect(tool.origin).toEqual({
      kind: 'mcp',
      serverName: NODE_REPL_SERVER_NAME,
      rawToolName: 'js',
      generation: 0,
    })
    expect(tool.visibility).toBe('deferred')
    expect(tool.allowedModes).toEqual(['chat'])
    expect(tool.allowedProfiles).toEqual(['main'])
    // No elevation of its own: every internal operation is judged separately.
    expect(tool.approvalStrategy).toBe('never-review')
    expect(tool.capabilities.externalState).toBe(false)
    expect(tool.capabilities.process).toBe(false)
  })

  test('is unavailable while the computer-use plugin is disabled', () => {
    const tool = nodeReplToolDefinition({
      plugins: { isEnabled: () => false } as never,
      computer: { available: () => true, inspect: () => undefined } as never,
      service: {} as never,
      executor: {} as never,
    })
    expect(tool.available?.()).toBe(false)
  })

  test('only inspects a recovered read, never a fresh script', () => {
    const tool = definition()
    const context = { invocation: { toolCallID: 't1' }, profile: 'main' } as never
    expect(tool.inspectInput?.({ code: 'x', title: 'y' }, context)).toBeUndefined()
  })
})

describe('approval recovery payload', () => {
  test('parses only well-formed internal operations', () => {
    expect(
      computerOperationRecoveryFrom({
        computerOperation: { method: 'read', args: { windowRef: 'w' } },
      }),
    ).toEqual({ method: 'read', args: { windowRef: 'w' } })
    expect(
      computerOperationRecoveryFrom({ computerOperation: { method: 'exec', args: {} } }),
    ).toBeUndefined()
    expect(
      computerOperationRecoveryFrom({ computerOperation: { method: 'read', args: [] } }),
    ).toBeUndefined()
    expect(computerOperationRecoveryFrom({ toolCallID: 'x' })).toBeUndefined()
    expect(computerOperationRecoveryFrom(null)).toBeUndefined()
  })
})
