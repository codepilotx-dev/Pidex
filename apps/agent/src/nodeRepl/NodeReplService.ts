import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ComputerResult } from '@pidex/agent-protocol'
import { AgentError } from '../Domain'
import {
  clampNodeReplTimeout,
  type NodeReplChildMessage,
  type NodeReplHostMessage,
  type NodeReplImage,
  type NodeReplOperationRequest,
} from './Protocol'

/** Startup flag the installed agent binary uses to dispatch the child mode. */
export const NODE_REPL_CHILD_FLAG = '--pidex-node-repl'

export type NodeReplCommand = { executable: string; args: string[] }

export type NodeReplChildHandle = {
  write(line: string): Promise<void> | void
  lines(): AsyncIterable<string>
  stderr(): Promise<string>
  kill(): void
  exited: Promise<number>
}

export type NodeReplSpawner = (command: NodeReplCommand, signal: AbortSignal) => NodeReplChildHandle

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
  signal: AbortSignal
  runOperation: (
    request: NodeReplOperationRequest,
    child: NodeReplChildHandle,
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

const decodeLines = async function* (stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const index = buffer.indexOf('\n')
        if (index < 0) break
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (line.trim()) yield line
      }
    }
    if (buffer.trim()) yield buffer
  } finally {
    reader.releaseLock()
  }
}

const defaultSpawner: NodeReplSpawner = (command, signal) => {
  const child = Bun.spawn([command.executable, ...command.args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PIDEX_NODE_REPL_CHILD: '1' },
    ...(signal ? { signal } : {}),
  })
  return {
    write: async (line: string) => {
      child.stdin.write(`${line}\n`)
      await child.stdin.flush()
    },
    lines: () => decodeLines(child.stdout as ReadableStream<Uint8Array>),
    stderr: async () => new Response(child.stderr as ReadableStream<Uint8Array>).text(),
    kill: () => {
      try {
        child.kill()
      } catch {
        // Already exited; killing is best-effort cleanup.
      }
    },
    exited: child.exited,
  }
}

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

  constructor(
    private readonly spawn: NodeReplSpawner = defaultSpawner,
    private readonly command: () => NodeReplCommand = resolveNodeReplCommand,
  ) {}

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
    const timeoutMs = clampNodeReplTimeout(input.timeoutMs)
    const text: string[] = []
    const images: NodeReplImage[] = []
    const abort = new AbortController()
    const onOuterAbort = () => abort.abort()
    input.signal.addEventListener('abort', onOuterAbort, { once: true })
    const child = this.spawn(this.command(), abort.signal)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (input.signal.aborted) throw new AgentError('RUN_ABORTED', '任务已停止', 499)
      timer = setTimeout(() => abort.abort(), timeoutMs)
      await child.write(
        JSON.stringify({ type: 'init', code: input.code, timeoutMs } satisfies NodeReplHostMessage),
      )
      for await (const line of child.lines()) {
        let message: NodeReplChildMessage
        try {
          message = JSON.parse(line) as NodeReplChildMessage
        } catch {
          continue
        }
        if (message.type === 'write') {
          text.push(message.text)
        } else if (message.type === 'image') {
          images.push({ data: message.data, mimeType: message.mimeType })
        } else if (message.type === 'done') {
          return { text: text.join('\n'), images, paused: false }
        } else if (message.type === 'error') {
          throw new AgentError('NODE_REPL_SCRIPT_ERROR', message.message, 400)
        } else if (message.type === 'call') {
          const outcome = await input.runOperation(
            { method: message.method, args: message.args } as NodeReplOperationRequest,
            child,
          )
          if (outcome.kind === 'paused') throw new NodeReplPaused()
          const reply: NodeReplHostMessage =
            outcome.kind === 'result'
              ? { type: 'result', id: message.id, ok: true, result: outcome.result }
              : {
                  type: 'result',
                  id: message.id,
                  ok: false,
                  error: { code: outcome.code, message: outcome.message },
                }
          if (outcome.kind === 'result' && outcome.result.images)
            images.push(...outcome.result.images)
          await child.write(JSON.stringify(reply))
        }
      }
      throw new AgentError('NODE_REPL_CHILD_EXITED', 'JavaScript 执行进程提前退出', 500)
    } catch (cause) {
      if (cause instanceof NodeReplPaused) return { text: text.join('\n'), images, paused: true }
      if (abort.signal.aborted) {
        if (input.signal.aborted) throw new AgentError('RUN_ABORTED', '任务已停止', 499)
        throw new AgentError('NODE_REPL_TIMEOUT', `JavaScript 执行超时（${timeoutMs}ms）`, 408)
      }
      if (cause instanceof AgentError) throw cause
      const stderr = await child.stderr().catch(() => '')
      throw new AgentError(
        'NODE_REPL_FAILED',
        stderr.trim() || (cause instanceof Error ? cause.message : String(cause)),
        500,
      )
    } finally {
      if (timer) clearTimeout(timer)
      input.signal.removeEventListener('abort', onOuterAbort)
      child.kill()
      await child.exited.catch(() => undefined)
    }
  }
}
