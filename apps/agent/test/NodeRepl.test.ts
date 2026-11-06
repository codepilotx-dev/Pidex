import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpClient, StdioTransport } from '@earendil-works/pi-mcp'
import type { NodeReplChildMessage, NodeReplHostMessage } from '../src/nodeRepl/Protocol'
import { computerOperationRecoveryFrom } from '../src/nodeRepl/Protocol'
import {
  NodeReplRuntime,
  runNodeReplScript,
  type NodeReplChildTransport,
} from '../src/nodeRepl/ChildRuntime'
import {
  NodeReplPaused,
  NodeReplService,
  NODE_REPL_CHILD_FLAG,
  resolveNodeReplCommand,
  defaultNodeReplServer,
} from '../src/nodeRepl/NodeReplService'
import {
  NODE_REPL_PLUGIN_ID,
  NODE_REPL_SERVER_NAME,
  NODE_REPL_TOOL_NAME,
  hostManagedMcpDeclarations,
  isTrustedHostMcpServer,
} from '../src/nodeRepl/Association'
import { createMcpGenerationBinding } from '../src/runtime-composition/Composer'
import { nodeReplResetToolDefinition, nodeReplToolDefinition } from '../src/nodeRepl/Definition'
import { connectMcpClient, mcpStdioEnvironment } from '../src/mcp/McpClientFactory'
import { PluginManagementService } from '../src/plugin/PluginManagementService'

const roots: string[] = []
const services: NodeReplService[] = []
const closureClients: McpClient[] = []

/** Registers a service so its child processes are always reaped after the test. */
const tracked = (service = new NodeReplService()) => {
  services.push(service)
  return service
}

afterEach(async () => {
  await Promise.all(closureClients.splice(0).map((client) => client.close().catch(() => undefined)))
  await Promise.all(services.splice(0).map((service) => service.closeAll()))
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

describe('node_repl runtime cell isolation', () => {
  /** Drives the runtime directly so cell ids and late frames can be observed. */
  const harness = () => {
    const sent: NodeReplChildMessage[] = []
    const queue: NodeReplHostMessage[] = []
    let resolveNext: ((message: NodeReplHostMessage | null) => void) | null = null
    let closed = false
    const transport: NodeReplChildTransport = {
      send: (message) => sent.push(message),
      next: () =>
        queue.length
          ? Promise.resolve(queue.shift()!)
          : new Promise<NodeReplHostMessage | null>((resolve) => {
              resolveNext = resolve
            }),
      close: () => {
        closed = true
        resolveNext?.(null)
        resolveNext = null
      },
    }
    const push = (message: NodeReplHostMessage) => {
      if (resolveNext) {
        const resolve = resolveNext
        resolveNext = null
        resolve(message)
      } else queue.push(message)
    }
    return { sent, transport, push, isClosed: () => closed }
  }

  test('drops a result frame addressed to a cell that is no longer active', async () => {
    const runtime = new NodeReplRuntime()
    const cellA = harness()
    const running = runtime.run(
      cellA.transport,
      `await computer.apps(); nodeRepl.write('late')`,
      'cell-a',
    )
    // 单元格 A 已经结束并切到单元格 B 之后，A 的结果才到达。
    const cellB = harness()
    cellA.push({ type: 'result', id: 1, cellId: 'cell-a', ok: true, result: { text: 'a' } })
    await running
    expect(runtime.cellId).toBeUndefined()
    expect(runtime.accepts('cell-a')).toBe(false)
    expect(runtime.accepts('cell-b')).toBe(false)

    const second = runtime.run(cellB.transport, `nodeRepl.write('b')`, 'cell-b')
    expect(runtime.accepts('cell-b')).toBe(true)
    await second
    // 迟到的 A 结果不能进入 B 的待处理表。
    cellB.push({ type: 'result', id: 1, cellId: 'cell-a', ok: true, result: { text: 'leak' } })
    expect(runtime.accepts('cell-a')).toBe(false)
  })

  test('a leftover bridge from a finished cell cannot reach the next cell', async () => {
    const runtime = new NodeReplRuntime()
    const first = harness()
    // 单元格一保存自己的 computer 引用；它属于那个单元格，不属于之后的单元格。
    await runtime.run(
      first.transport,
      `globalThis.stale = computer; nodeRepl.write('saved')`,
      'cell-x',
    )
    const next = harness()
    await runtime.run(
      next.transport,
      `try { await stale.apps() } catch (error) { nodeRepl.write(error.code) }`,
      'cell-y',
    )
    const writes = next.sent.flatMap((message) => (message.type === 'write' ? [message.text] : []))
    // 残留引用被拒绝：既没有借用当前单元格的桥，也没有产生新的 call 帧。
    expect(writes).toEqual(['NODE_REPL_CONTEXT_LOST'])
    expect(next.sent.some((message) => message.type === 'call')).toBe(false)
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
    const service = tracked()
    const result = await execute(service, `nodeRepl.write('hello'); nodeRepl.emitImage('AAAA')`)
    expect(result.paused).toBe(false)
    expect(result.text).toBe('hello')
    expect(result.images).toEqual([{ data: 'AAAA', mimeType: 'image/png' }])
  })

  test('uses a configured stdio command, arguments and environment', async () => {
    const root = await temporaryRoot()
    const entry = join(root, 'configured.ts')
    await writeFile(
      entry,
      `
      import { createInterface } from 'node:readline'
      for await (const line of createInterface({ input: process.stdin })) {
        const request = JSON.parse(line)
        if (request.id === undefined) continue
        const result = request.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
          : request.method === 'tools/list' ? { tools: [{ name: 'js', inputSchema: { type: 'object' } }] }
          : { content: [{ type: 'text', text: process.env.PIDEX_TEST_REPL + ':' + process.argv.at(-1) }] }
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n')
      }
    `,
      'utf8',
    )
    const result = await execute(tracked(), 'ignored by fixture', {
      server: {
        ...defaultNodeReplServer(),
        transport: {
          type: 'stdio',
          command: process.execPath,
          args: ['run', entry, 'custom-argument'],
          env: { PIDEX_TEST_REPL: 'custom-env' },
        },
      },
    })
    expect(result.text).toBe('custom-env:custom-argument')
  })

  test('keeps bindings, functions and mutated objects across cells of one chat', async () => {
    const service = tracked()
    const first = await execute(service, `let n = 0; n += 1; nodeRepl.write(String(n))`)
    expect(first.text).toBe('1')
    const second = await execute(service, `n += 1; nodeRepl.write(String(n))`)
    expect(second.text).toBe('2')
    // 对象身份保留：第二个单元格改的是同一个对象，读回时字段与身份都在。
    await execute(service, `globalThis.shared = { count: 0 }; nodeRepl.write('created')`)
    const mutated = await execute(
      service,
      `shared.count = 7; shared.self = shared === globalThis.shared; nodeRepl.write(JSON.stringify(shared))`,
    )
    expect(JSON.parse(mutated.text)).toEqual({ count: 7, self: true })
    const read = await execute(service, `nodeRepl.write(String(shared.self))`)
    expect(read.text).toBe('true')
  })

  test('carries a top-level-await binding into a later cell', async () => {
    const service = tracked()
    await execute(
      service,
      `const sum = (await Promise.resolve(41)) + 1; let tag = 'x'; class Box { v = 1 }; nodeRepl.write('tla')`,
    )
    const later = await execute(service, `nodeRepl.write(JSON.stringify([sum, tag, new Box().v]))`)
    expect(JSON.parse(later.text)).toEqual([42, 'x', 1])
  })

  test('isolates chats from each other', async () => {
    const service = tracked()
    await execute(service, `globalThis.__chatA = 'a'; let localA = 1; nodeRepl.write('set')`)
    const other = await execute(
      service,
      `nodeRepl.write([typeof __chatA, typeof localA].join(','))`,
      {
        threadID: 'thread-2',
      },
    )
    expect(other.text).toBe('undefined,undefined')
  })

  test('js_reset clears the chat context so earlier bindings are gone', async () => {
    const service = tracked()
    await execute(service, `globalThis.__stale = 1; let stale = 2; nodeRepl.write('set')`)
    await service.reset('thread-1')
    const after = await execute(service, `nodeRepl.write([typeof __stale, typeof stale].join(','))`)
    expect(after.text).toBe('undefined,undefined')
  })

  test('an ordinary script error keeps the context alive', async () => {
    const service = tracked()
    await expect(
      execute(service, `let survived = 5; throw new Error('boom')`),
    ).rejects.toMatchObject({
      code: 'NODE_REPL_SCRIPT_ERROR',
    })
    const after = await execute(service, `nodeRepl.write(String(survived))`)
    expect(after.text).toBe('5')
  })

  test('a cancelled cell discards the context instead of leaking it forward', async () => {
    const service = tracked()
    const controller = new AbortController()
    let started = false
    const pending = execute(service, `await computer.apps(); nodeRepl.write('late')`, {
      signal: controller.signal,
      runOperation: async () => {
        started = true
        await new Promise(() => {})
        return { kind: 'result', result: { text: 'never' } }
      },
    })
    while (!started) await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'RUN_ABORTED' })
    // 上下文随取消一起丢弃：下一个单元格必须是干净进程。
    const after = await execute(service, `nodeRepl.write('fresh')`)
    expect(after.text).toBe('fresh')
  })

  test('a timed-out cell does not leak its operation into the next cell', async () => {
    const service = tracked()
    const seen: string[] = []
    let releaseOperation: (() => void) | undefined
    const timedOut = execute(service, `await computer.read('w1'); nodeRepl.write('late')`, {
      timeoutMs: 1_000,
      runOperation: async (request) => {
        seen.push(request.method)
        // 宿主迟迟不返回：超时先终止这条连接。
        await new Promise<void>((resolve) => {
          releaseOperation = resolve
        })
        return { kind: 'result', result: { text: 'late-result' } }
      },
    })
    await expect(timedOut).rejects.toMatchObject({ code: 'NODE_REPL_TIMEOUT' })
    releaseOperation?.()
    // 新单元格跑在全新进程上，看不到上一单元格的操作或输出。
    const next = await execute(service, `nodeRepl.write('clean')`)
    expect(next.text).toBe('clean')
    expect(seen).toEqual(['read'])
  })

  test('a changed server declaration starts a new process', async () => {
    const service = tracked()
    const server = defaultNodeReplServer()
    await execute(service, `globalThis.__config = 1; nodeRepl.write('set')`, { server })
    const same = await execute(service, `nodeRepl.write(String(globalThis.__config))`, { server })
    expect(same.text).toBe('1')
    // 声明任意字段变化都要求新的求值上下文。
    const changed = await execute(service, `nodeRepl.write(String(globalThis.__config))`, {
      server: { ...server, toolTimeoutMs: 30_000 },
    })
    expect(changed.text).toBe('undefined')
  })

  test('bridges computer calls to the host operation runner', async () => {
    const service = tracked()
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

  test('waits for issued operations even when the script omits await', async () => {
    let completed = false
    await execute(tracked(), 'void computer.apps()', {
      runOperation: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        completed = true
        return { kind: 'result', result: { text: 'done' } }
      },
    })
    expect(completed).toBe(true)
  })

  test('stops the cell when the host arranges an approval pause', async () => {
    const service = tracked()
    const result = await execute(service, `await computer.read('w1'); nodeRepl.write('after')`, {
      runOperation: async () => ({ kind: 'paused' }),
    })
    expect(result.paused).toBe(true)
    // Nothing after the blocked read executed.
    expect(result.text).toBe('')
  })

  test('kills a cell that exceeds its timeout', async () => {
    const service = tracked()
    await expect(
      execute(service, `await new Promise(() => {}); nodeRepl.write('never')`, {
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'NODE_REPL_TIMEOUT' })
  })

  test('stops the MCP process when its plugin is disabled', async () => {
    let cleaned = false
    const service = tracked(
      new NodeReplService((stop) => {
        const timer = setTimeout(stop, 300)
        return () => {
          clearTimeout(timer)
          cleaned = true
        }
      }),
    )
    await expect(execute(service, 'await new Promise(() => {})')).rejects.toMatchObject({
      code: 'NODE_REPL_UNAVAILABLE',
    })
    expect(cleaned).toBe(true)
  })

  test('honours cancellation before starting any work', async () => {
    const service = tracked()
    const controller = new AbortController()
    controller.abort()
    await expect(
      execute(service, `nodeRepl.write('x')`, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'RUN_ABORTED' })
  })

  test('the spawned child answers a two-cell round trip in one context', async () => {
    const command = resolveNodeReplCommand()
    const client = new McpClient({ name: 'pidex-test', version: '1', requestTimeoutMs: 30_000 })
    const transport = new StdioTransport({
      command: command.executable,
      args: command.args,
      env: mcpStdioEnvironment({ type: 'stdio', command: command.executable }),
      inheritEnv: false,
      stderr: 'pipe',
      closeTimeoutMs: 200,
    })
    closureClients.push(client)
    try {
      await connectMcpClient(client, transport, 20_000)
      client.setRequestHandler('pidex/computer', async () => ({
        ok: true,
        result: { text: 'host-ok' },
      }))
      const tools = (await client.listTools()).map((tool) => tool.name).sort()
      // 子进程把 js 与 js_reset 一起对外声明。
      expect(tools).toEqual(['js', 'js_reset'])
      const call = (name: string, args: Record<string, unknown>) =>
        client.callTool(name, args, { timeoutMs: 20_000 })
      const first = await call('js', { code: `let n = 1; n += 1; nodeRepl.write(String(n))` })
      expect(first.content).toEqual([{ type: 'text', text: '2' }])
      const second = await call('js', { code: `n += 1; nodeRepl.write(String(n))` })
      expect(second.content).toEqual([{ type: 'text', text: '3' }])
      // 真实子进程上的 host 桥接仍走 pidex/computer。
      const bridged = await call('js', { code: `nodeRepl.write((await computer.apps()).text)` })
      expect(bridged.content).toEqual([{ type: 'text', text: 'host-ok' }])
      const reset = await call('js_reset', {})
      expect(reset.isError ?? false).toBe(false)
      const cleared = await call('js', { code: `nodeRepl.write(typeof n)` })
      expect(cleared.content).toEqual([{ type: 'text', text: 'undefined' }])
    } finally {
      await client.close().catch(() => undefined)
    }
  }, 60_000)

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

  test('configured executables use MCP process and external-state permissions', () => {
    const tool = nodeReplToolDefinition({
      plugins: { isEnabled: () => true } as never,
      computer: { available: () => true } as never,
      service: {} as never,
      executor: {} as never,
      server: { ...defaultNodeReplServer(), transport: { type: 'stdio', command: 'custom.exe' } },
    })
    expect(tool.approvalStrategy).toBe('policy')
    expect(tool.capabilities.process).toBe(true)
    expect(tool.capabilities.externalState).toBe(true)
  })

  test('saving the unchanged built-in command preserves its existing authorization behavior', () => {
    const tool = nodeReplToolDefinition({
      plugins: {} as never,
      computer: {} as never,
      service: {} as never,
      executor: {} as never,
      server: defaultNodeReplServer(),
    })
    expect(tool.approvalStrategy).toBe('never-review')
    expect(tool.capabilities.process).toBe(false)
  })

  test('configuration fingerprints prevent a changed executable from resuming an approved binding', () => {
    const binding = (command: string) => {
      const tool = nodeReplToolDefinition({
        plugins: {} as never,
        computer: {} as never,
        service: {} as never,
        executor: {} as never,
        server: { ...defaultNodeReplServer(), transport: { type: 'stdio', command } },
      })
      const origin = tool.origin!
      if (origin.kind !== 'mcp') throw new Error('expected MCP origin')
      return createMcpGenerationBinding('workspace', {
        serverInstructions: [],
        definitions: [{ sdkName: tool.sdkName, ...origin }],
      }).bindingHash
    }
    expect(binding('first.exe')).not.toBe(binding('second.exe'))
    expect(binding('first.exe')).toBe(binding('first.exe'))
  })

  test('rejects stale configuration before starting a process', async () => {
    const tool = nodeReplToolDefinition({
      plugins: { isEnabled: () => true } as never,
      computer: {} as never,
      service: {} as never,
      executor: {} as never,
      validateConfiguration: async () => {
        throw new Error('configuration changed')
      },
    })
    await expect(
      tool.execute({ code: 'x', title: 'x' }, {
        invocation: { toolCallID: 'call' },
        profile: 'main',
      } as never),
    ).rejects.toThrow('configuration changed')
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

describe('node_repl js_reset exposure', () => {
  const resetDeps = (overrides: Record<string, unknown> = {}) => ({
    plugins: { isEnabled: () => true } as never,
    computer: { available: () => true, inspect: () => undefined } as never,
    service: {} as never,
    executor: {} as never,
    ...overrides,
  })

  test('is a deferred, main-agent-only chat entry with no capability elevation', () => {
    const tool = nodeReplResetToolDefinition(resetDeps())
    expect(tool.sdkName).toBe('mcp__node_repl__js_reset')
    expect(tool.origin).toEqual({
      kind: 'mcp',
      serverName: NODE_REPL_SERVER_NAME,
      rawToolName: 'js_reset',
      generation: 0,
    })
    expect(tool.visibility).toBe('deferred')
    expect(tool.allowedModes).toEqual(['chat'])
    expect(tool.allowedProfiles).toEqual(['main'])
    // 内置服务无需审批；它也不声明进程或外部状态能力。
    expect(tool.approvalStrategy).toBe('never-review')
    expect(tool.capabilities.process).toBe(false)
    expect(tool.capabilities.externalState).toBe(false)
  })

  test('resets the invoking chat through the host service', async () => {
    const reset: string[] = []
    const tool = nodeReplResetToolDefinition(
      resetDeps({
        service: { reset: async (threadID: string) => void reset.push(threadID) } as never,
      }),
    )
    const result = await tool.execute({}, {
      invocation: { threadID: 'thread-9', toolCallID: 'call-reset' },
      profile: 'main',
    } as never)
    expect(reset).toEqual(['thread-9'])
    expect(result.terminated).toBe(false)
    // 不经过 service.execute，因此既不启动进程也不触发脚本。
    expect(result.images).toEqual([])
  })

  test('rejects a non-host identity like the js entry does', async () => {
    const tool = nodeReplResetToolDefinition(resetDeps())
    await expect(
      tool.execute({}, { profile: 'subagent', invocation: { toolCallID: 'x' } } as never),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  test('is unavailable while the computer-use plugin is disabled', () => {
    const tool = nodeReplResetToolDefinition(
      resetDeps({ plugins: { isEnabled: () => false } as never }),
    )
    expect(tool.available?.()).toBe(false)
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
