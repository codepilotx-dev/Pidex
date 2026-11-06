import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpClient, StdioTransport } from '@earendil-works/pi-mcp'
import { z } from 'zod'
import { connectMcpClient, mcpStdioEnvironment } from '../mcp/McpClientFactory'
import type { ComputerResult, McpServerDeclaration } from '@pidex/agent-protocol'
import { AgentError } from '../Domain'
import {
  clampNodeReplTimeout,
  MAX_NODE_REPL_TIMEOUT_MS,
  type NodeReplImage,
  type NodeReplOperationRequest,
} from './Protocol'

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

/**
 * Wire envelope of one pidex/computer request. `cellId` is host-echoed metadata;
 * the operation itself is still validated by `operationSchema` below, so adding
 * the cell id never loosens argument checking.
 */
const computerRequestSchema = z.object({
  cellId: z.string().min(1).optional(),
  method: z.enum(['apps', 'read', 'action']),
  args: z.unknown(),
})

/** Raised internally when the cell stopped because an operation needs approval. */
export class NodeReplPaused extends Error {
  constructor() {
    super('node_repl paused for approval')
    this.name = 'NodeReplPaused'
  }
}

/** One long-lived child process bound to a chat. */
type NodeReplConnection = {
  /** Transport fingerprint; a changed configuration replaces the connection. */
  fingerprint: string
  client: McpClient
  close(): Promise<void>
}

/**
 * Host side of the node_repl MCP entry. A chat owns one long-lived child process,
 * so its cells share one evaluation context while cells of different chats never
 * do. Cells run one at a time per chat. Timeout, cancel, approval pause, a crash
 * or a configuration change discards the context, so a late result can never
 * apply to a later cell.
 */
export class NodeReplService {
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly connections = new Map<string, NodeReplConnection>()
  /**
   * One permanent stop subscription closes idle connections when the plugin is
   * disabled; each cell still subscribes for its own 403 mapping.
   */
  private readonly unsubscribeStop: (() => void) | undefined

  constructor(private readonly subscribeStop?: (stop: () => void) => () => void) {
    this.unsubscribeStop = subscribeStop?.(() => void this.closeAll())
  }

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

  /** Drops the chat's evaluation context; the next cell starts in a fresh process. */
  reset(threadID: string): Promise<void> {
    return this.serialize(threadID, () => this.evict(threadID))
  }

  /**
   * Closes one chat's child process after any in-flight cell settles. Call from
   * thread delete/archive so the process never outlives its chat.
   */
  closeThread(threadID: string): Promise<void> {
    return this.serialize(threadID, () => this.evict(threadID))
  }

  /** Closes every child process. Wire to agent shutdown. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((threadID) => this.evict(threadID)))
  }

  /** Idempotent teardown: no child process survives the owning service. */
  async dispose(): Promise<void> {
    this.unsubscribeStop?.()
    await this.closeAll()
  }

  private evict(threadID: string): Promise<void> {
    const connection = this.connections.get(threadID)
    if (!connection) return Promise.resolve()
    this.connections.delete(threadID)
    return connection.close()
  }

  /** Evicts only if the entry is still this cell's connection. */
  private evictConnection(threadID: string, connection: NodeReplConnection): Promise<void> {
    if (this.connections.get(threadID) !== connection) return Promise.resolve()
    this.connections.delete(threadID)
    return connection.close()
  }

  private async runCell(input: NodeReplExecuteInput): Promise<NodeReplExecuteResult> {
    if (input.signal.aborted) throw new AgentError('RUN_ABORTED', '任务已停止', 499)
    const server = input.server ?? defaultNodeReplServer()
    const timeoutMs = clampNodeReplTimeout(input.timeoutMs ?? server.toolTimeoutMs)
    if (!server.enabled || server.transport.type !== 'stdio')
      throw new AgentError('NODE_REPL_UNAVAILABLE', 'node_repl 需要启用的 stdio MCP 配置', 503)
    const text: string[] = []
    const images: NodeReplImage[] = []
    const operations = new Set<Promise<NodeReplOperationOutcome>>()
    const abort = new AbortController()
    let paused = false
    let unavailable = false
    let connection: NodeReplConnection | undefined
    // Any termination discards the context; an ordinary script exception keeps it.
    const stop = () => {
      abort.abort()
      void (connection
        ? this.evictConnection(input.threadID, connection)
        : this.evict(input.threadID))
    }
    input.signal.addEventListener('abort', stop, { once: true })
    const unsubscribe = this.subscribeStop?.(() => {
      unavailable = true
      stop()
    })
    const timer = setTimeout(stop, timeoutMs)
    let releaseHandler: (() => void) | undefined
    try {
      if (abort.signal.aborted) throw new Error('Execution stopped')
      connection = await this.connect(input.threadID, server, timeoutMs)
      // Every cell registers its own handler, so operations of an earlier cell
      // can never be judged by the authorization runner of the current one.
      releaseHandler = connection.client.setRequestHandler(
        'pidex/computer',
        async (params, requestContext) => {
          const envelope = computerRequestSchema.parse(params)
          const request = operationSchema.parse({
            method: envelope.method,
            args: envelope.args,
          }) as NodeReplOperationRequest
          const cellId = envelope.cellId
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
            return {
              ...(cellId ? { cellId } : {}),
              ok: false,
              error: { code: outcome.code, message: outcome.message },
            }
          if (outcome.result.images) images.push(...outcome.result.images)
          return { ...(cellId ? { cellId } : {}), ok: true, result: outcome.result }
        },
      )
      const result = await connection.client.callTool(
        'js',
        {
          code: input.code,
          title: input.title ?? 'JavaScript',
          timeout_ms: timeoutMs,
        },
        { signal: abort.signal, timeoutMs },
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
      // A crashed or unusable child cannot be trusted with the next cell.
      await this.evict(input.threadID)
      throw new AgentError('NODE_REPL_FAILED', 'node_repl MCP 启动或调用失败，请检查配置', 500)
    } finally {
      unsubscribe?.()
      clearTimeout(timer)
      releaseHandler?.()
      input.signal.removeEventListener('abort', stop)
      // The connection may already be gone; a stale operation must not surface
      // as an unhandled rejection in a later, unrelated cell.
      for (const operation of operations) void operation.catch(() => undefined)
      operations.clear()
    }
  }

  /** Reuses this chat's process when the configuration still matches. */
  private async connect(
    threadID: string,
    server: McpServerDeclaration,
    timeoutMs: number,
  ): Promise<NodeReplConnection> {
    // Same identity as the tool's configurationHash: any declaration change
    // starts a new process so a stale context can never serve a new config.
    const fingerprint = JSON.stringify(server)
    const existing = this.connections.get(threadID)
    if (
      existing &&
      existing.fingerprint === fingerprint &&
      existing.client.connectionState === 'connected'
    )
      return existing
    await this.evict(threadID)
    const transport = server.transport
    if (transport.type !== 'stdio')
      throw new AgentError('NODE_REPL_UNAVAILABLE', 'node_repl 需要启用的 stdio MCP 配置', 503)
    const client = new McpClient({
      name: 'pidex-agent',
      version: '0.2.0',
      // Per-cell deadlines travel with each request; the client default only guards setup.
      requestTimeoutMs: MAX_NODE_REPL_TIMEOUT_MS,
    })
    let closed: Promise<void> | undefined
    const connection: NodeReplConnection = {
      fingerprint,
      client,
      close: () => {
        closed ??= client.close().catch(() => undefined)
        return closed
      },
    }
    // A crash evicts the entry so the next cell starts a clean process.
    client.onClose(() => {
      if (this.connections.get(threadID) === connection) this.connections.delete(threadID)
    })
    this.connections.set(threadID, connection)
    try {
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
      const tools = await client.listTools({ timeoutMs })
      if (!tools.some((tool) => tool.name === 'js'))
        throw new AgentError('NODE_REPL_INCOMPATIBLE', 'node_repl MCP 未提供 js 工具', 400)
      return connection
    } catch (cause) {
      await this.evict(threadID)
      throw cause
    }
  }
}
