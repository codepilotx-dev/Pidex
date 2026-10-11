import type { ComputerAction, ComputerResult } from '@pidex/agent-protocol'
import type { NodeReplChildMessage, NodeReplHostMessage, NodeReplImage } from './Protocol'

/** Transport used by the child runtime; injected so it is testable without spawning. */
export type NodeReplChildTransport = {
  send(message: NodeReplChildMessage): void
  next(): Promise<NodeReplHostMessage | null>
}

/** Transport failures surface to the script as typed errors, never silent successes. */
export class NodeReplCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'NodeReplCallError'
  }
}

const toImage = (data: unknown, mimeType: unknown): NodeReplImage => {
  if (data instanceof Uint8Array) {
    return { data: Buffer.from(data).toString('base64'), mimeType: defaultMime(mimeType) }
  }
  if (typeof data === 'string') return { data, mimeType: defaultMime(mimeType) }
  throw new NodeReplCallError(
    'NODE_REPL_INVALID_ARGUMENT',
    'emitImage 需要 Uint8Array 或 base64 字符串',
  )
}

const defaultMime = (mimeType: unknown) =>
  typeof mimeType === 'string' && mimeType.trim() ? mimeType : 'image/png'

const format = (value: unknown) => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Builds the restricted globals exposed to a cell: the `computer` bridge,
 * `nodeRepl` output helpers and nothing else. Modules, Shell, files and the
 * network are not provided; shadowing `Bun`/`process`/`require`/`fetch` keeps
 * the obvious escapes unreachable. This is a bounded surface, not a security
 * sandbox: process isolation exists for cleanup and fault isolation.
 */
export const nodeReplGlobals = (transport: NodeReplChildTransport) => {
  const pending = new Map<
    number,
    { resolve: (result: ComputerResult) => void; reject: (error: Error) => void }
  >()
  let sequence = 0

  const pump = async () => {
    for (;;) {
      const message = await transport.next().catch(() => null)
      if (!message) return
      if (message.type !== 'result') continue
      const entry = pending.get(message.id)
      if (!entry) continue
      pending.delete(message.id)
      if (message.ok) entry.resolve(message.result)
      else entry.reject(new NodeReplCallError(message.error.code, message.error.message))
    }
  }

  const call = (method: string, args: Record<string, unknown>) =>
    new Promise<ComputerResult>((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      transport.send({ type: 'call', id, method: method as never, args })
    })

  const computer = Object.freeze({
    apps: () => call('apps', {}),
    read: (windowRef: unknown) =>
      call('read', { windowRef: requireString(windowRef, 'windowRef') }),
    action: (windowRef: unknown, observationId: unknown, operation: unknown) =>
      call('action', {
        windowRef: requireString(windowRef, 'windowRef'),
        observationId: requireString(observationId, 'observationId'),
        operation: (operation ?? {}) as ComputerAction,
      }),
  })

  const nodeRepl = Object.freeze({
    write: (value: unknown) => transport.send({ type: 'write', text: format(value) }),
    emitImage: (data: unknown, mimeType?: unknown) =>
      transport.send({ type: 'image', ...toImage(data, mimeType) }),
  })

  return { pump, computer, nodeRepl }
}

const requireString = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value.trim())
    throw new NodeReplCallError('NODE_REPL_INVALID_ARGUMENT', `${name} 必须是非空字符串`)
  return value
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>

/**
 * Runs one cell. Returns after `done` is sent; the caller owns process exit.
 * Globals, imports and module cache never survive a cell because each call is a
 * fresh process.
 */
export async function runNodeReplScript(
  transport: NodeReplChildTransport,
  code: string,
): Promise<void> {
  const { pump, computer, nodeRepl } = nodeReplGlobals(transport)
  const pumping = pump()
  try {
    const cell = new AsyncFunction(
      'computer',
      'nodeRepl',
      'process',
      'Bun',
      'require',
      'fetch',
      code,
    )
    await cell(computer, nodeRepl, undefined, undefined, undefined, undefined)
    transport.send({ type: 'done' })
  } catch (cause) {
    transport.send({
      type: 'error',
      message: cause instanceof Error ? cause.message : String(cause),
    })
  } finally {
    void pumping
  }
}
