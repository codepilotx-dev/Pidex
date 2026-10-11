import { describe, expect, test } from 'bun:test'
import type { DesktopLogger } from '../src/logging/DesktopLogger'
import {
  DesktopAgentConnectionCoordinator,
  type SidecarLifecycle,
} from '../src/sidecar/ConnectionCoordinator'
import { SidecarTerminationError } from '../src/sidecar/FailureDiagnostics'
import type { ConnectionStatus, SidecarConnection } from '../src/sidecar/Supervisor'

describe('DesktopAgentConnectionCoordinator', () => {
  test('统一拥有连接、丢失、清理和重连状态', async () => {
    const sidecar = new FakeSidecar()
    const reconnecting: number[] = []
    const connected: number[] = []
    const coordinator = new DesktopAgentConnectionCoordinator({
      supervisor: sidecar,
      logger,
      loadConnection: async () => undefined,
      onConnected: (connection) => {
        connected.push(connection.generation)
      },
      onReconnecting: (connection) => {
        reconnecting.push(connection.generation)
      },
      onTerminalFailure: (error) => {
        throw error
      },
      isRelocating: () => false,
    })

    await coordinator.start()
    expect(coordinator.status.lifecycle).toBe('connected')
    expect(connected).toEqual([1])

    sidecar.lose(0)
    await eventually(() => sidecar.connectCount === 2)
    await eventually(() => coordinator.status.lifecycle === 'connected')
    expect(reconnecting).toEqual([1])
    expect(connected).toEqual([1, 2])
    expect(sidecar.invalidateCount).toBe(1)

    // 旧 generation 的延迟回调不能再次触发清理或重连。
    sidecar.lose(0)
    await Promise.resolve()
    expect(sidecar.connectCount).toBe(2)
    expect(sidecar.invalidateCount).toBe(1)
  })

  test('并发 stop 复用同一 Promise 并只关闭一次 sidecar', async () => {
    const sidecar = new FakeSidecar()
    const coordinator = createCoordinator(sidecar)
    await coordinator.start()
    sidecar.deferStop = deferred<void>()

    const first = coordinator.stop()
    const second = coordinator.stop()
    expect(first).toBe(second)
    expect(sidecar.stopCount).toBe(1)
    sidecar.deferStop.resolve()
    await first
    expect(coordinator.status.lifecycle).toBe('idle')
  })

  test('loadConnection 等待期间 stop 后不得继续 UI 副作用', async () => {
    const sidecar = new FakeSidecar()
    const loadStarted = deferred<void>()
    const releaseLoad = deferred<void>()
    const effects: string[] = []
    const coordinator = new DesktopAgentConnectionCoordinator({
      supervisor: sidecar,
      logger,
      loadConnection: async (_connection, guard) => {
        loadStarted.resolve()
        await releaseLoad.promise
        guard.assertCurrent()
        effects.push('load-completed')
      },
      onConnected: () => {
        effects.push('connected')
      },
      onReconnecting: () => undefined,
      onTerminalFailure: (error) => {
        throw error
      },
      isRelocating: () => false,
    })

    const start = coordinator.start()
    await loadStarted.promise
    await coordinator.stop()
    releaseLoad.resolve()
    await start

    expect(effects).toEqual([])
    expect(coordinator.status.lifecycle).toBe('idle')
  })

  test('onConnected 等待期间 stop 后不得继续 UI 副作用', async () => {
    const sidecar = new FakeSidecar()
    const connectedStarted = deferred<void>()
    const releaseConnected = deferred<void>()
    const effects: string[] = []
    const coordinator = new DesktopAgentConnectionCoordinator({
      supervisor: sidecar,
      logger,
      loadConnection: async () => undefined,
      onConnected: async (_connection, guard) => {
        connectedStarted.resolve()
        await releaseConnected.promise
        guard.assertCurrent()
        effects.push('connected-completed')
      },
      onReconnecting: () => undefined,
      onTerminalFailure: (error) => {
        throw error
      },
      isRelocating: () => false,
    })

    const start = coordinator.start()
    await connectedStarted.promise
    await coordinator.stop()
    releaseConnected.resolve()
    await start

    expect(effects).toEqual([])
    expect(coordinator.status.lifecycle).toBe('idle')
  })

  test('无法确认旧进程退出时进入 failed 且不再 spawn', async () => {
    const sidecar = new FakeSidecar()
    const failures: string[] = []
    const coordinator = new DesktopAgentConnectionCoordinator({
      supervisor: sidecar,
      logger,
      loadConnection: async () => undefined,
      onConnected: () => undefined,
      onReconnecting: () => undefined,
      onTerminalFailure: (_error, kind) => {
        failures.push(kind)
      },
      isRelocating: () => false,
    })
    await coordinator.start()
    sidecar.invalidateError = new SidecarTerminationError()

    sidecar.lose(0)
    await eventually(() => coordinator.status.lifecycle === 'failed')
    expect(failures).toEqual(['termination'])
    expect(sidecar.connectCount).toBe(1)
  })
})

class FakeSidecar implements SidecarLifecycle {
  statusListener: ((status: ConnectionStatus) => void) | undefined
  readonly watches: Array<() => void> = []
  connectCount = 0
  invalidateCount = 0
  stopCount = 0
  invalidateError: unknown
  deferStop: ReturnType<typeof deferred<void>> | undefined

  onStateChange(listener: (status: ConnectionStatus) => void): void {
    this.statusListener = listener
  }

  async connect(
    validate: (connection: SidecarConnection) => Promise<void>,
  ): Promise<SidecarConnection> {
    this.connectCount += 1
    const connection = connectionFor(this.connectCount)
    this.statusListener?.({
      state: 'disconnected',
      phase: 'connecting',
      attempt: 1,
    })
    await validate(connection)
    return connection
  }

  watch(_connection: SidecarConnection, onLost: () => void): void {
    this.watches.push(onLost)
  }

  async invalidate(): Promise<void> {
    this.invalidateCount += 1
    if (this.invalidateError) throw this.invalidateError
  }

  async stop(): Promise<void> {
    this.stopCount += 1
    await this.deferStop?.promise
  }

  lose(index: number): void {
    this.watches[index]?.()
  }
}

function createCoordinator(sidecar: FakeSidecar) {
  return new DesktopAgentConnectionCoordinator({
    supervisor: sidecar,
    logger,
    loadConnection: async () => undefined,
    onConnected: () => undefined,
    onReconnecting: () => undefined,
    onTerminalFailure: (error) => {
      throw error
    },
    isRelocating: () => false,
  })
}

function connectionFor(generation: number): SidecarConnection {
  return {
    origin: 'http://127.0.0.1:4312',
    managed: false,
    port: 4312,
    generation,
    instanceToken: `instance-${generation}`,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('状态未在预期时间内收敛')
}

const logger: DesktopLogger = {
  directory: '',
  consoleEnabled: false,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  forwardConsoleLine: () => undefined,
}
