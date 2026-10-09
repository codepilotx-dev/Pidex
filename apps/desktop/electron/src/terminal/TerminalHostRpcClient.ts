import type { DesktopLogger } from '../logging/DesktopLogger.js'
import type { SidecarSupervisor } from '../sidecar/Supervisor.js'
import { TerminalError } from './TerminalErrors.js'
import type { TerminalLaunchContextResolver } from './TerminalManager.js'
import type { TerminalActionLaunch, TerminalActionResolver } from './TerminalManager.js'
import type {
  TerminalLaunchContext,
  TerminalOutputMirrorSink,
  TerminalOutputMirrorSnapshot,
} from './TerminalSession.js'
import { isRecord } from '@pidex/shared/guards'

interface JsonRpcResponse {
  result?: unknown
  error?: { code?: unknown; message?: unknown; data?: { code?: unknown } }
}

const CLIENT_CAPABILITIES = ['rpc.typed.v1', 'terminal.host.v1'] as const
const MAX_MIRROR_RESET_BYTES = 240 * 1_024
const INITIALIZE_REJECTION_CODES = new Set([
  'PERMISSION_DENIED',
  'UNAUTHORIZED',
  'CAPABILITY_REQUIRED',
  'PROTOCOL_VERSION_UNSUPPORTED',
  'INVALID_REQUEST',
])

export class TerminalHostRpcClient
  implements TerminalLaunchContextResolver, TerminalOutputMirrorSink, TerminalActionResolver
{
  readonly #getSupervisor: () => SidecarSupervisor | undefined
  readonly #logger: DesktopLogger | undefined
  #connectionId: string | undefined
  #initializePromise: Promise<void> | undefined
  #requestSequence = 0

  constructor(getSupervisor: () => SidecarSupervisor | undefined, logger?: DesktopLogger) {
    this.#getSupervisor = getSupervisor
    this.#logger = logger
  }

  async resolve(threadId: string): Promise<TerminalLaunchContext> {
    const result = await this.#call('terminal/host/context', { threadId })
    if (!isLaunchContext(result, threadId)) {
      throw new TerminalError('TERMINAL_ENVIRONMENT_UNSUPPORTED', 'Agent 返回了无效的终端工作目录')
    }
    return result
  }

  async prepareAction(threadId: string, actionName: string): Promise<TerminalActionLaunch> {
    const contextBefore = await this.resolve(threadId)
    const actionBefore = await this.#resolveAction(threadId, actionName)
    const environment = await this.#resolveEnvironment(threadId)
    const actionAfter = await this.#resolveAction(threadId, actionName)
    const contextAfter = await this.resolve(threadId)
    if (
      !sameContext(contextBefore, contextAfter) ||
      actionBefore.contextVersion !== contextBefore.contextVersion ||
      actionAfter.contextVersion !== contextBefore.contextVersion ||
      actionBefore.contextVersion !== actionAfter.contextVersion ||
      actionBefore.environmentRevision !== environment.revision ||
      actionAfter.environmentRevision !== environment.revision ||
      actionBefore.command !== actionAfter.command
    ) {
      throw new TerminalError('TERMINAL_CONTEXT_STALE', '终端 Action 上下文已变化')
    }
    return { context: contextAfter, environment, command: actionAfter.command }
  }

  async reset(snapshot: TerminalOutputMirrorSnapshot): Promise<void> {
    await this.#call('terminal/host/output/reset', trimMirrorSnapshot(snapshot))
  }

  async append(input: Parameters<TerminalOutputMirrorSink['append']>[0]): Promise<void> {
    await this.#call('terminal/host/output/append', input)
  }

  async clear(input: Parameters<TerminalOutputMirrorSink['clear']>[0]): Promise<void> {
    await this.#call('terminal/host/output/clear', input)
  }

  invalidate(): void {
    this.#connectionId = undefined
  }

  async #resolveAction(threadId: string, actionName: string) {
    const result = await this.#call('terminal/host/action/resolve', { threadId, actionName })
    if (!isResolvedAction(result)) {
      throw new TerminalError('TERMINAL_ENVIRONMENT_UNSUPPORTED', 'Agent 返回了无效的终端 Action')
    }
    return result
  }

  async #resolveEnvironment(threadId: string) {
    const result = await this.#call('terminal/host/environment', { threadId })
    if (!isEnvironmentDelta(result)) {
      throw new TerminalError('TERMINAL_ENVIRONMENT_UNSUPPORTED', 'Agent 返回了无效的终端环境')
    }
    return result
  }

  async #call(method: string, params: unknown): Promise<unknown> {
    const supervisor = this.#getSupervisor()
    if (!supervisor) {
      throw new TerminalError('TERMINAL_UNAVAILABLE', 'Agent 尚未连接')
    }
    return this.#callWithReconnect(supervisor, method, params, true)
  }

  async #callWithReconnect(
    supervisor: SidecarSupervisor,
    method: string,
    params: unknown,
    retryUnauthorized: boolean,
  ): Promise<unknown> {
    await this.#ensureInitialized(supervisor)
    const connectionId = this.#connectionId
    if (!connectionId) {
      throw new TerminalError('TERMINAL_UNAVAILABLE', '无法初始化终端 Agent 连接')
    }
    const response = await supervisor.request('/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pidex-Connection-ID': connectionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `desktop-terminal:${++this.#requestSequence}`,
        method,
        params,
      }),
    })
    const payload = (await response.json()) as JsonRpcResponse
    if (payload.error) {
      if (retryUnauthorized && payload.error.data?.code === 'UNAUTHORIZED') {
        if (this.#connectionId === connectionId) this.#connectionId = undefined
        return this.#callWithReconnect(supervisor, method, params, false)
      }
      throw new TerminalError(mapRpcErrorCode(payload.error.data?.code), 'Agent 拒绝了终端请求')
    }
    return payload.result
  }

  async #ensureInitialized(supervisor: SidecarSupervisor): Promise<void> {
    if (this.#connectionId) return
    if (this.#initializePromise) {
      await this.#initializePromise
      return
    }
    const initializePromise = this.#initialize(supervisor)
    this.#initializePromise = initializePromise
    try {
      await initializePromise
    } finally {
      if (this.#initializePromise === initializePromise) {
        this.#initializePromise = undefined
      }
    }
  }

  async #initialize(supervisor: SidecarSupervisor): Promise<void> {
    const response = await supervisor.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `desktop-terminal:${++this.#requestSequence}`,
        method: 'initialize',
        params: {
          clientInfo: {
            name: 'pidex-desktop-terminal-host',
            version: '1.0.0',
            platform: process.platform,
            authority: 'desktop-host',
          },
          protocols: ['thread-rpc-v4'],
          capabilities: [...CLIENT_CAPABILITIES],
          interactionDelivery: 'observe',
        },
      }),
    })
    const payload = (await response.json()) as JsonRpcResponse
    if (payload.error) {
      this.#logInitializeRejection(safeInitializeRejectionCode(payload.error.data?.code))
      throw new TerminalError('TERMINAL_UNAVAILABLE', '无法初始化终端 Agent 连接')
    }
    if (!isRecord(payload.result)) {
      this.#logInitializeRejection('INVALID_RESPONSE')
      throw new TerminalError('TERMINAL_UNAVAILABLE', '无法初始化终端 Agent 连接')
    }
    const connectionId = payload.result.connectionId
    if (typeof connectionId !== 'string' || !isIdentifier(connectionId)) {
      this.#logInitializeRejection('INVALID_RESPONSE')
      throw new TerminalError('TERMINAL_UNAVAILABLE', '无法初始化终端 Agent 连接')
    }
    this.#connectionId = connectionId
    await supervisor.request('/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pidex-Connection-ID': connectionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialized',
        params: { protocol: 'thread-rpc-v4' },
      }),
    })
  }

  #logInitializeRejection(code: string): void {
    this.#logger?.warn('terminal.host-initialize-rejected', {
      details: { code },
    })
  }
}

function safeInitializeRejectionCode(code: unknown): string {
  return typeof code === 'string' && INITIALIZE_REJECTION_CODES.has(code) ? code : 'UNKNOWN'
}

function trimMirrorSnapshot(snapshot: TerminalOutputMirrorSnapshot): TerminalOutputMirrorSnapshot {
  const chunks = [...snapshot.chunks]
  let bytes = chunks.reduce((total, chunk) => total + Buffer.byteLength(chunk.data, 'utf8'), 0)
  while (bytes > MAX_MIRROR_RESET_BYTES && chunks.length > 0) {
    const removed = chunks.shift()
    if (removed) bytes -= Buffer.byteLength(removed.data, 'utf8')
  }
  return {
    ...snapshot,
    oldestSequence: chunks[0]?.sequence ?? snapshot.nextSequence,
    chunks,
  }
}

function isLaunchContext(value: unknown, expectedThreadId: string): value is TerminalLaunchContext {
  if (!isRecord(value) || !isRecord(value.target)) return false
  if (typeof value.threadId !== 'string') return false
  return (
    value.threadId === expectedThreadId &&
    isIdentifier(value.threadId) &&
    isIdentifier(value.bindingId) &&
    typeof value.contextVersion === 'string' &&
    value.contextVersion.length > 0 &&
    (value.workspaceKind === 'project' || value.workspaceKind === 'projectless') &&
    (value.target.kind === 'local' || value.target.kind === 'worktree') &&
    typeof value.target.cwd === 'string' &&
    value.target.cwd.length > 0
  )
}

function isResolvedAction(value: unknown): value is {
  contextVersion: string
  environmentRevision: number
  command: string
} {
  return (
    isRecord(value) &&
    typeof value.contextVersion === 'string' &&
    value.contextVersion.length > 0 &&
    value.contextVersion.length <= 512 &&
    Number.isSafeInteger(value.environmentRevision) &&
    Number(value.environmentRevision) >= 0 &&
    typeof value.command === 'string' &&
    value.command.trim().length > 0 &&
    Buffer.byteLength(value.command, 'utf8') <= 65_000
  )
}

function isEnvironmentDelta(value: unknown): value is TerminalActionLaunch['environment'] {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !isRecord(value.set) ||
    !Array.isArray(value.unset) ||
    value.unset.length > 4_096
  )
    return false
  let bytes = 0
  for (const [key, item] of Object.entries(value.set)) {
    if (!isEnvironmentKey(key) || isInternalEnvironmentKey(key) || typeof item !== 'string')
      return false
    bytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(item, 'utf8')
    if (bytes > 1_048_576) return false
  }
  for (const key of value.unset) {
    if (typeof key !== 'string' || !isEnvironmentKey(key) || isInternalEnvironmentKey(key))
      return false
    bytes += Buffer.byteLength(key, 'utf8')
    if (bytes > 1_048_576) return false
  }
  return true
}

function sameContext(left: TerminalLaunchContext, right: TerminalLaunchContext): boolean {
  return (
    left.threadId === right.threadId &&
    left.bindingId === right.bindingId &&
    left.contextVersion === right.contextVersion &&
    left.workspaceKind === right.workspaceKind &&
    left.target.kind === right.target.kind &&
    left.target.cwd === right.target.cwd
  )
}

function mapRpcErrorCode(
  code: unknown,
):
  | 'TERMINAL_UNAVAILABLE'
  | 'TERMINAL_CONTEXT_STALE'
  | 'TERMINAL_ACTION_UNTRUSTED'
  | 'TERMINAL_ACTION_UNAVAILABLE' {
  if (code === 'THREAD_NOT_FOUND' || code === 'LOCAL_ENVIRONMENT_CONFLICT')
    return 'TERMINAL_CONTEXT_STALE'
  if (code === 'LOCAL_ENVIRONMENT_UNTRUSTED' || code === 'PERMISSION_DENIED')
    return 'TERMINAL_ACTION_UNTRUSTED'
  if (
    code === 'LOCAL_ENVIRONMENT_ACTION_NOT_FOUND' ||
    code === 'LOCAL_ENVIRONMENT_PLATFORM_UNSUPPORTED'
  ) {
    return 'TERMINAL_ACTION_UNAVAILABLE'
  }
  return 'TERMINAL_UNAVAILABLE'
}

function isEnvironmentKey(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}

function isInternalEnvironmentKey(value: string): boolean {
  return value.toUpperCase().startsWith('PIDEX_')
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 200 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  )
}
