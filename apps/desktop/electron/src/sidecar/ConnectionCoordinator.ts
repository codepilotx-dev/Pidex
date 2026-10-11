import type { DesktopLogger } from '../logging/DesktopLogger.js'
import { SidecarInstallationError } from './Command.js'
import { SidecarTerminationError } from './FailureDiagnostics.js'
import {
  type AgentConnectionState,
  type ConnectionStatus,
  type SidecarConnection,
} from './Supervisor.js'

export type DesktopAgentLifecycleState =
  'idle' | 'spawning' | 'probing' | 'loading' | 'connected' | 'disposing' | 'failed'

export interface DesktopAgentConnectionStatus {
  readonly lifecycle: DesktopAgentLifecycleState
  readonly connectionState: AgentConnectionState
  readonly phase: ConnectionStatus['phase']
  readonly attempt: number
  readonly message?: string
}

export interface DesktopAgentConnectionGuard {
  isCurrent(): boolean
  assertCurrent(): void
}

export interface SidecarLifecycle {
  onStateChange(listener: (status: ConnectionStatus) => void): void
  connect(validate: (connection: SidecarConnection) => Promise<void>): Promise<SidecarConnection>
  watch(connection: SidecarConnection, onLost: () => void): void
  invalidate(): Promise<void>
  stop(): Promise<void>
}

export interface DesktopAgentConnectionCoordinatorOptions {
  readonly supervisor: SidecarLifecycle
  readonly logger: DesktopLogger
  readonly loadConnection: (
    connection: SidecarConnection,
    guard: DesktopAgentConnectionGuard,
  ) => Promise<void>
  readonly onConnected: (
    connection: SidecarConnection,
    guard: DesktopAgentConnectionGuard,
  ) => Promise<void> | void
  readonly onReconnecting: (connection: SidecarConnection) => void
  readonly onBeforeReconnect?: () => void
  readonly onTerminalFailure: (
    error: unknown,
    kind: 'installation' | 'relocation' | 'termination' | 'unexpected',
  ) => void
  readonly isRelocating: () => boolean
}

/**
 * Electron 主进程中 Agent 连接状态的唯一所有者。Supervisor 只负责单个
 * sidecar 生命周期；窗口、认证和重连编排通过回调注入，main.ts 只装配。
 */
export class DesktopAgentConnectionCoordinator {
  readonly #options: DesktopAgentConnectionCoordinatorOptions
  #status: DesktopAgentConnectionStatus = {
    lifecycle: 'idle',
    connectionState: 'unknown',
    phase: 'starting',
    attempt: 0,
  }
  #listener: ((status: DesktopAgentConnectionStatus) => void) | undefined
  #cycle = 0
  #runPromise: Promise<void> | undefined
  #stopPromise: Promise<void> | undefined
  #stopping = false

  constructor(options: DesktopAgentConnectionCoordinatorOptions) {
    this.#options = options
    options.supervisor.onStateChange((status) => {
      if (this.#stopping) return
      this.#publish({
        lifecycle: status.phase === 'authenticating' ? 'probing' : 'spawning',
        connectionState: status.state,
        phase: status.phase,
        attempt: status.attempt,
        message: status.message,
      })
    })
  }

  get status(): DesktopAgentConnectionStatus {
    return this.#status
  }

  onStateChange(listener: (status: DesktopAgentConnectionStatus) => void): void {
    this.#listener = listener
    listener(this.#status)
  }

  start(): Promise<void> {
    if (this.#runPromise) return this.#runPromise
    if (this.#stopping) return Promise.reject(new Error('Agent 连接已停止'))
    const cycle = ++this.#cycle
    this.#runPromise = this.#runCycle(cycle).finally(() => {
      if (cycle === this.#cycle) this.#runPromise = undefined
    })
    return this.#runPromise
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise
    const attempt = this.#stopOnce()
    this.#stopPromise = attempt
    void attempt.catch(() => {
      if (this.#stopPromise === attempt) this.#stopPromise = undefined
    })
    return attempt
  }

  async #runCycle(cycle: number): Promise<void> {
    let connected: SidecarConnection | undefined
    const guard: DesktopAgentConnectionGuard = {
      isCurrent: () => this.#isCurrent(cycle),
      assertCurrent: () => this.#assertCurrent(cycle),
    }
    try {
      const connection = await this.#options.supervisor.connect(async (candidate) => {
        if (!this.#isCurrent(cycle)) return
        this.#publish({
          lifecycle: 'loading',
          connectionState: 'disconnected',
          phase: 'loading',
          attempt: this.#status.attempt,
        })
        await this.#options.loadConnection(candidate, guard)
        guard.assertCurrent()
      })
      guard.assertCurrent()
      connected = connection
      this.#publish({
        lifecycle: 'connected',
        connectionState: 'connected',
        phase: 'loading',
        attempt: this.#status.attempt,
      })
      await this.#options.onConnected(connection, guard)
      guard.assertCurrent()
      this.#options.supervisor.watch(connection, () => {
        if (!this.#isCurrent(cycle) || this.#status.lifecycle !== 'connected') {
          return
        }
        this.#options.logger.warn('desktop.connection-lost', {
          origin: connection.origin,
          generation: connection.generation,
        })
        this.#publish({
          lifecycle: 'disposing',
          connectionState: 'disconnected',
          phase: 'reconnecting',
          attempt: 0,
        })
        this.#options.onReconnecting(connection)
        void this.#restartAfterLoss(cycle)
      })
    } catch (error) {
      if (!this.#isCurrent(cycle)) return
      if (!connected) {
        this.#fail(error)
        return
      }
      try {
        await this.#options.supervisor.invalidate()
        if (this.#isCurrent(cycle)) this.#fail(error)
      } catch (disposeError) {
        if (this.#isCurrent(cycle)) this.#fail(disposeError)
      }
    }
  }

  async #restartAfterLoss(cycle: number): Promise<void> {
    try {
      await this.#options.supervisor.invalidate()
      if (!this.#isCurrent(cycle)) return
      this.#options.onBeforeReconnect?.()
      const nextCycle = ++this.#cycle
      this.#runPromise = this.#runCycle(nextCycle).finally(() => {
        if (nextCycle === this.#cycle) this.#runPromise = undefined
      })
      await this.#runPromise
    } catch (error) {
      if (this.#isCurrent(cycle)) this.#fail(error)
    }
  }

  async #stopOnce(): Promise<void> {
    this.#stopping = true
    this.#cycle += 1
    this.#publish({
      lifecycle: 'disposing',
      connectionState: 'disconnected',
      phase: 'reconnecting',
      attempt: this.#status.attempt,
    })
    try {
      await this.#options.supervisor.stop()
      this.#publish({
        lifecycle: 'idle',
        connectionState: 'disconnected',
        phase: 'starting',
        attempt: 0,
      })
    } catch (error) {
      this.#publish({
        lifecycle: 'failed',
        connectionState: 'disconnected',
        phase: 'reconnecting',
        attempt: this.#status.attempt,
        message: '无法确认旧 Agent 进程已经退出',
      })
      throw error
    }
  }

  #fail(error: unknown): void {
    const kind =
      error instanceof SidecarInstallationError
        ? 'installation'
        : error instanceof SidecarTerminationError
          ? 'termination'
          : this.#options.isRelocating()
            ? 'relocation'
            : 'unexpected'
    this.#publish({
      lifecycle: 'failed',
      connectionState: 'disconnected',
      phase: 'reconnecting',
      attempt: this.#status.attempt,
      message: kind === 'termination' ? '无法确认旧 Agent 进程已经退出' : undefined,
    })
    this.#options.onTerminalFailure(error, kind)
  }

  #isCurrent(cycle: number): boolean {
    return !this.#stopping && cycle === this.#cycle
  }

  #assertCurrent(cycle: number): void {
    if (!this.#isCurrent(cycle)) throw new Error('忽略过期的 Agent 连接周期')
  }

  #publish(status: DesktopAgentConnectionStatus): void {
    this.#status = status
    this.#listener?.(status)
  }
}
