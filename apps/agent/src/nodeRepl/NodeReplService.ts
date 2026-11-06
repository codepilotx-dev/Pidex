import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpClient, StdioTransport } from '@earendil-works/pi-mcp'
import { z } from 'zod'
import { connectMcpClient, mcpStdioEnvironment } from '../mcp/McpClientFactory'
import type { ComputerResult, McpServerDeclaration } from '@pidex/agent-protocol'
import { AgentError } from '../Domain'
import { clampNodeReplTimeout, type NodeReplImage, type NodeReplOperationRequest } from './Protocol'

/** Startup flag the installed agent binary uses to dispatch the child mode. */
export const NODE_REPL_CHILD_FLAG = '--pidex-node-repl'

export type NodeReplCommand = { executable: string; args: string[] }

/** Operational outcome of one internal computer operation. */
export type NodeReplOperationOutcome =
  | { kind: 'result'; result: ComputerResult }
  | { kind: 'denied'; code: string; message: string }
  /** The host already arranged an approval pause; stop the cell without replaying. */
  | { kind: 'paused' }

export type NodeReplExecuteInput = {
  threadID: string
  code: string
  timeoutMs?: number | undefined
  server?: McpServerDeclaration
  title?: string
  signal: AbortSignal
  runOperation: (
    request: NodeReplOperationRequest,
    signal: AbortSignal,
  ) => Promise<NodeReplOperationOutcome>
}

export type NodeReplExecuteResult = {
  text: string
  images: NodeReplImage[]
  paused: boolean
}

const childEntry = () => fileURLToPath(new URL('./Child.ts', import.meta.url))

/**
 * Dev runs the TypeScript entry through Bun; the installed binary re-enters its
 * own executable in child mode. Users never install Node or Bun separately.
 */
export const resolveNodeReplCommand = (execPath = process.execPath): NodeReplCommand =>
  /^bun(\.exe)?$/i.test(basename(execPath))
    ? { executable: execPath, args: ['run', childEntry()] }
    : { executable: execPath, args: [NODE_REPL_CHILD_FLAG] }

export const defaultNodeReplServer = (): McpServerDeclaration => {
  const command = resolveNodeReplCommand()
  return {
    name: 'node_repl',
    scope: 'user',
    enabled: true,
    transport: { type: 'stdio', command: command.executable, args: command.args },
  }
}

export const isBuiltinNodeReplServer = (server: McpServerDeclaration) => {
  const transport = server.transport
  const command = resolveNodeReplCommand()
  return (
    transport.type === 'stdio' &&
    transport.command === command.executable &&
    JSON.stringify(transport.args ?? []) === JSON.stringify(command.args) &&
    !transport.cwd &&
    Object.keys(transport.env ?? {}).length === 0 &&
    Object.keys(transport.envFromHost ?? {}).length === 0
  )
}

const operationSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('apps'), args: z.object({}).strict() }),
  z.object({
    method: z.literal('read'),
    args: z.object({ windowRef: z.string().min(1) }).strict(),
  }),
  z.object({
    method: z.literal('action'),
    args: z
      .object({
        windowRef: z.string().min(1),
        observationId: z.string().min(1),
        operation: z.record(z.string(), z.unknown()),
      })
      .strict(),
  }),
])

/** Raised internally when the cell stopped because an operation needs approval. */
export class NodeReplPaused extends Error {
  constructor() {
    super('node_repl paused for approval')
    this.name = 'NodeReplPaused'
  }
}

/**
 * Host side of the node_repl MCP entry. Every cell runs in a fresh process;
 * cells are serialized per chat, and timeout, cancel or plugin disable kills the
 * process so late results never apply.
 */
export class NodeReplService {
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(private readonly subscribeStop?: (stop: () => void) => () => void) {}

  /** Serializes cells of one chat; separate chats keep their own process. */
  private serialize<T>(threadID: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(threadID) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.locks.set(
      threadID,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  execute(input: NodeReplExecuteInput): Promise<NodeReplExecuteResult> {
    return this.serialize(input.threadID, () => this.runCell(input))
  }

  private async runCell(input: NodeReplExecuteInput): Promise<NodeReplExecuteResult> {
    if (input.signal.aborted) throw new AgentError('RUN_ABORTED', '任务已停止', 499)
    const server = input.server ?? defaultNodeReplServer()
    const timeoutMs = clampNodeReplTimeout(input.timeoutMs ?? server.toolTimeoutMs)
    if (!server.enabled || server.transport.type !== 'stdio')
      throw new AgentError('NODE_REPL_UNAVAILABLE', 'node_repl 需要启用的 stdio MCP 配置', 503)
    const transport = server.transport
    const client = new McpClient({
      name: 'pidex-agent',
      version: '0.2.0',
      requestTimeoutMs: timeoutMs,
    })
    const abort = new AbortController()
    const text: string[] = []
    const images: NodeReplImage[] = []
    const operations = new Set<Promise<NodeReplOperationOutcome>>()
    let paused = false
    let unavailable = false
    const stop = () => {
      abort.abort()
      void client.close().catch(() => undefined)
    }
    input.signal.addEventListener('abort', stop, { once: true })
    const unsubscribe = this.subscribeStop?.(() => {
      unavailable = true
      stop()
    })
    const timer = setTimeout(stop, timeoutMs)
    client.setRequestHandler('pidex/computer', async (params, requestContext) => {
      const request = operationSchema.parse(params) as NodeReplOperationRequest
      if (abort.signal.aborted) throw new Error('Execution stopped')
      const operation = input.runOperation(
        request,
        AbortSignal.any([abort.signal, requestContext.signal]),
      )
      operations.add(operation)
      let outcome: NodeReplOperationOutcome
      try {
        outcome = await operation
      } finally {
        operations.delete(operation)
      }
      if (outcome.kind === 'paused') {
        paused = true
        stop()
        throw new NodeReplPaused()
      }
      if (outcome.kind === 'denied')
        return { ok: false, error: { code: outcome.code, message: outcome.message } }
      if (outcome.result.images) images.push(...outcome.result.images)
      return { ok: true, result: outcome.result }
    })
    try {
      if (abort.signal.aborted) throw new Error('Execution stopped')
      await connectMcpClient(
        client,
        new StdioTransport({
          command: transport.command,
          ...(transport.args ? { args: transport.args } : {}),
          ...(transport.cwd ? { cwd: transport.cwd } : {}),
          env: mcpStdioEnvironment(transport),
          inheritEnv: false,
          stderr: 'pipe',
          closeTimeoutMs: 200,
        }),
        Math.min(server.startupTimeoutMs ?? 10_000, timeoutMs),
      )
      if (abort.signal.aborted) throw new Error('Execution stopped')
      const tools = await client.listTools({ signal: abort.signal })
      if (!tools.some((tool) => tool.name === 'js'))
        throw new AgentError('NODE_REPL_INCOMPATIBLE', 'node_repl MCP 未提供 js 工具', 400)
      const result = await client.callTool(
        'js',
        {
          code: input.code,
          title: input.title ?? 'JavaScript',
          timeout_ms: timeoutMs,
        },
        { signal: abort.signal },
      )
      // A cell can omit await; its already-issued operations still finish or cancel with the cell.
      await Promise.all(operations)
      if (paused) return { text: text.join('\n'), images, paused: true }
      if (abort.signal.aborted) throw new Error('Execution stopped')
      for (const item of result.content) {
        if (item.type === 'text') text.push(item.text)
        if (item.type === 'image') images.push({ data: item.data, mimeType: item.mimeType })
      }
      if (result.isError) throw new AgentError('NODE_REPL_SCRIPT_ERROR', text.join('\n'), 400)
      return { text: text.join('\n'), images, paused: false }
    } catch (cause) {
      if (paused) return { text: text.join('\n'), images, paused: true }
      if (input.signal.aborted) throw new AgentError('RUN_ABORTED', '任务已停止', 499)
      if (unavailable) throw new AgentError('NODE_REPL_UNAVAILABLE', 'Computer Use 插件已禁用', 403)
      if (abort.signal.aborted)
        throw new AgentError('NODE_REPL_TIMEOUT', `JavaScript 执行超时（${timeoutMs}ms）`, 408)
      if (cause instanceof AgentError) throw cause
      throw new AgentError('NODE_REPL_FAILED', 'node_repl MCP 启动或调用失败，请检查配置', 500)
    } finally {
      unsubscribe?.()
      clearTimeout(timer)
      input.signal.removeEventListener('abort', stop)
      await client.close().catch(() => undefined)
    }
  }
}
