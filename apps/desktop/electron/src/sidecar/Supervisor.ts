import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { DesktopLogger } from '../logging/DesktopLogger.js'
import { HostProcessTreeKiller, type ProcessTreeKiller } from '../terminal/ProcessTree.js'
import { normalizeOrigin } from '../security/Navigation.js'
import {
  missingPackagedSidecarError,
  resolveSidecarCommand,
  SidecarInstallationError,
  type SidecarCommand,
} from './Command.js'
import {
  readSidecarFailureCode,
  SidecarTerminationError,
  type SidecarConnectStage,
} from './FailureDiagnostics.js'

import {
  formatError,
  probeReady,
  sleep,
  waitForReady,
  waitForReadyMessage,
  type ReadyMessage,
} from './Readiness.js'

type DocumentsPathName = 'documents' | 'home'

export function resolveDocumentsDirectory(getPath: (name: DocumentsPathName) => string): string {
  try {
    return getPath('documents')
  } catch {
    return join(getPath('home'), 'Documents')
  }
}

const SHUTDOWN_TIMEOUT_MS = 4_000
const SIGTERM_TIMEOUT_MS = 2_000
const PROCESS_TREE_TIMEOUT_MS = 2_000
const WATCHDOG_INTERVAL_MS = 2_000
const WATCHDOG_FAILURE_LIMIT = 3

export type AgentConnectionState = 'connected' | 'disconnected' | 'unknown'

export interface ConnectionStatus {
  state: AgentConnectionState
  phase: 'starting' | 'connecting' | 'authenticating' | 'loading' | 'reconnecting'
  attempt: number
  message?: string
}

export interface OwnedSidecarIdentity {
  readonly generation: number
  readonly instanceToken: string
}

export interface SidecarConnection {
  readonly origin: string
  readonly managed: boolean
  readonly port: number
  readonly generation: number
  /** 仅 Electron 内部校验 owned sidecar；不得记录或传给 renderer。 */
  readonly instanceToken?: string
}

export interface SidecarDataLocation {
  dataDir: string
  relocation: {
    operationId: string
    sourceDataDir: string
    targetDataDir: string
  } | null
}

export interface SidecarAppRuntime {
  readonly isPackaged: boolean
  readonly resourcesPath: string
  getPath(name: 'userData' | 'home' | 'documents'): string
}

interface OwnedSidecarProcess {
  readonly child: ChildProcessWithoutNullStreams
  readonly identity: OwnedSidecarIdentity
  origin?: string
  disposePromise?: Promise<void>
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface SidecarSupervisorDependencies {
  appRuntime: SidecarAppRuntime
  spawnProcess?: (
    executable: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio,
  ) => ChildProcessWithoutNullStreams
  fetcher?: FetchLike
  resolveCommand?: (input: {
    readonly packaged: boolean
    readonly resourcesPath: string
    readonly moduleDirectory: string
  }) => SidecarCommand
  waitForReadyMessage?: (
    child: ChildProcessWithoutNullStreams,
    logger: DesktopLogger,
    expectedInstanceToken?: string,
  ) => Promise<ReadyMessage>
  waitForReady?: (
    origin: string,
    token: string,
    logger: DesktopLogger,
    attempt: number,
    expectedInstanceToken?: string,
  ) => Promise<void>
  probeReady?: (
    origin: string,
    fetcher: FetchLike,
    token: string | undefined,
    timeoutMs: number,
    expectedInstanceToken?: string,
  ) => Promise<void>
  sleep?: (milliseconds: number) => Promise<void>
  processTreeKiller?: ProcessTreeKiller
  randomInstanceToken?: () => string
  shutdownTimeoutMs?: number
  sigtermTimeoutMs?: number
  processTreeTimeoutMs?: number
  watchdogIntervalMs?: number
  watchdogFailureLimit?: number
}

export class SidecarSupervisor {
  readonly #token: string
  readonly #logger: DesktopLogger
  readonly #moduleDirectory: string
  readonly #dataLocation: SidecarDataLocation
  readonly #app: SidecarAppRuntime
  readonly #spawnProcess: NonNullable<SidecarSupervisorDependencies['spawnProcess']>
  readonly #fetch: FetchLike
  readonly #resolveCommand: NonNullable<SidecarSupervisorDependencies['resolveCommand']>
  readonly #waitForReadyMessage: NonNullable<SidecarSupervisorDependencies['waitForReadyMessage']>
  readonly #waitForReady: NonNullable<SidecarSupervisorDependencies['waitForReady']>
  readonly #probeReady: NonNullable<SidecarSupervisorDependencies['probeReady']>
  readonly #sleep: NonNullable<SidecarSupervisorDependencies['sleep']>
  readonly #processTreeKiller: ProcessTreeKiller
  readonly #randomInstanceToken: () => string
  readonly #shutdownTimeoutMs: number
  readonly #sigtermTimeoutMs: number
  readonly #processTreeTimeoutMs: number
  readonly #watchdogIntervalMs: number
  readonly #watchdogFailureLimit: number
  #owned: OwnedSidecarProcess | undefined
  #connection: SidecarConnection | undefined
  #preferredPort: number | undefined
  #generation = 0
  #stopping = false
  #stopPromise: Promise<void> | undefined
  #terminationFailure: SidecarTerminationError | undefined
  #watchdog: NodeJS.Timeout | undefined
  #watchdogBusy = false
  #watchdogEpoch = 0
  #onStateChange: ((status: ConnectionStatus) => void) | undefined
  #onConnectionLost: (() => void) | undefined

  constructor(
    token: string,
    logger: DesktopLogger,
    moduleDirectory: string,
    dataLocation: SidecarDataLocation,
    dependencies: SidecarSupervisorDependencies,
  ) {
    this.#token = token
    this.#logger = logger
    this.#moduleDirectory = moduleDirectory
    this.#dataLocation = dataLocation
    this.#app = dependencies.appRuntime
    this.#spawnProcess =
      dependencies.spawnProcess ??
      ((executable, args, options) =>
        spawn(executable, [...args], {
          ...options,
          stdio: ['pipe', 'pipe', 'pipe'],
        }))
    this.#fetch = dependencies.fetcher ?? fetch
    this.#resolveCommand = dependencies.resolveCommand ?? resolveSidecarCommand
    this.#waitForReadyMessage = dependencies.waitForReadyMessage ?? waitForReadyMessage
    this.#waitForReady = dependencies.waitForReady ?? waitForReady
    this.#probeReady = dependencies.probeReady ?? probeReady
    this.#sleep = dependencies.sleep ?? sleep
    this.#processTreeKiller = dependencies.processTreeKiller ?? new HostProcessTreeKiller()
    this.#randomInstanceToken =
      dependencies.randomInstanceToken ?? (() => randomBytes(32).toString('base64url'))
    this.#shutdownTimeoutMs = dependencies.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS
    this.#sigtermTimeoutMs = dependencies.sigtermTimeoutMs ?? SIGTERM_TIMEOUT_MS
    this.#processTreeTimeoutMs = dependencies.processTreeTimeoutMs ?? PROCESS_TREE_TIMEOUT_MS
    this.#watchdogIntervalMs = dependencies.watchdogIntervalMs ?? WATCHDOG_INTERVAL_MS
    this.#watchdogFailureLimit = dependencies.watchdogFailureLimit ?? WATCHDOG_FAILURE_LIMIT
  }

  onStateChange(listener: (status: ConnectionStatus) => void): void {
    this.#onStateChange = listener
  }

  async connect(
    validate: (connection: SidecarConnection) => Promise<void>,
  ): Promise<SidecarConnection> {
    if (this.#terminationFailure) throw this.#terminationFailure
    let attempt = 0
    let delay = 0
    while (!this.#stopping) {
      attempt += 1
      let stage: SidecarConnectStage = 'select-connection'
      this.#onStateChange?.({
        state: 'disconnected',
        phase: attempt === 1 ? 'connecting' : 'reconnecting',
        attempt,
      })
      try {
        const connection = await this.#connectOnce(attempt, (nextStage) => {
          stage = nextStage
        })
        this.#assertConnectionCurrent(connection)
        this.#connection = connection
        this.#onStateChange?.({
          state: 'disconnected',
          phase: 'authenticating',
          attempt,
        })
        stage = 'validate-connection'
        await validate(connection)
        this.#assertConnectionCurrent(connection)
        this.#logger.info('sidecar.connected', {
          origin: connection.origin,
          managed: connection.managed,
          port: connection.port,
          attempt,
          generation: connection.generation,
        })
        return connection
      } catch (error) {
        this.#connection = undefined
        try {
          await this.#disposeCurrentOwned()
        } catch (disposeError) {
          throw this.#rememberTerminationFailure(disposeError)
        }
        if (error instanceof SidecarInstallationError || error instanceof SidecarTerminationError) {
          throw error
        }
        if (this.#dataLocation.relocation) throw error
        const message = formatError(error)
        const failureCode = readSidecarFailureCode(error)
        this.#logger.warn('sidecar.connect-failed', {
          attempt,
          stage,
          failureCode,
          message,
        })
        if (this.#stopping) break
        delay = delay === 0 ? 500 : Math.min(10_000, delay * 2)
        await this.#sleep(delay + Math.round(Math.random() * Math.min(500, delay * 0.2)))
      }
    }
    throw new Error('Agent 连接已停止')
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

  async invalidate(): Promise<void> {
    this.#clearWatchdog()
    this.#connection = undefined
    await this.#disposeCurrentOwned()
  }

  watch(connection: SidecarConnection, onLost: () => void): void {
    this.#clearWatchdog()
    const watchdogEpoch = this.#watchdogEpoch
    this.#onConnectionLost = onLost
    let failures = 0
    this.#watchdog = setInterval(() => {
      if (
        watchdogEpoch !== this.#watchdogEpoch ||
        this.#watchdogBusy ||
        this.#stopping ||
        !this.#isConnectionCurrent(connection)
      ) {
        return
      }
      this.#watchdogBusy = true
      void this.#probeReady(
        connection.origin,
        this.#fetch,
        this.#token,
        1_000,
        connection.instanceToken,
      )
        .then(() => {
          if (watchdogEpoch !== this.#watchdogEpoch) return
          if (!this.#isConnectionCurrent(connection)) return
          failures = 0
        })
        .catch((error) => {
          if (watchdogEpoch !== this.#watchdogEpoch) return
          if (!this.#isConnectionCurrent(connection)) return
          failures += 1
          this.#logger.warn('sidecar.watchdog-error', {
            origin: connection.origin,
            failures,
            message: formatError(error),
            generation: connection.generation,
          })
        })
        .finally(() => {
          if (watchdogEpoch !== this.#watchdogEpoch) return
          this.#watchdogBusy = false
          if (failures < this.#watchdogFailureLimit || !this.#isConnectionCurrent(connection)) {
            return
          }
          this.#clearWatchdog()
          this.#onConnectionLost?.()
        })
    }, this.#watchdogIntervalMs)
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const connection = this.#connection
    if (!connection) throw new Error('Agent 尚未连接')
    this.#assertConnectionCurrent(connection)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${this.#token}`)
    let response: Response
    try {
      response = await this.#fetch(`${connection.origin}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(10_000),
      })
    } catch (error) {
      if (!this.#isConnectionCurrent(connection)) {
        throw new Error('忽略过期的 Agent 请求响应')
      }
      throw error
    }
    this.#assertConnectionCurrent(connection)
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string }
      } | null
      this.#assertConnectionCurrent(connection)
      throw new Error(body?.error?.message ?? `Agent 请求失败（HTTP ${response.status}）`)
    }
    return response
  }

  async #stopOnce(): Promise<void> {
    this.#stopping = true
    this.#clearWatchdog()
    if (this.#terminationFailure && this.#owned) {
      // 用户可能已在任务管理器中结束残留进程；后续退出必须
      // 重新检查 exit/close 或 taskkill 返回，不能永久复用旧的 reject。
      this.#owned.disposePromise = undefined
      this.#terminationFailure = undefined
    }
    try {
      await this.#disposeCurrentOwned()
    } finally {
      this.#connection = undefined
    }
  }

  async #connectOnce(
    attempt: number,
    reportStage: (stage: SidecarConnectStage) => void,
  ): Promise<SidecarConnection> {
    const managedOrigin = process.env.PIDEX_AGENT_URL
    if (managedOrigin) {
      reportStage('managed-origin')
      const origin = normalizeOrigin(managedOrigin)
      const generation = ++this.#generation
      reportStage('managed-ready')
      await this.#waitForReady(origin, this.#token, this.#logger, attempt)
      return {
        origin,
        managed: true,
        port: Number(new URL(origin).port),
        generation,
      }
    }
    return this.#spawnOwnedSidecar(attempt, reportStage)
  }

  async #spawnOwnedSidecar(
    attempt: number,
    reportStage: (stage: SidecarConnectStage) => void,
  ): Promise<SidecarConnection> {
    if (this.#terminationFailure) throw this.#terminationFailure
    if (this.#owned) {
      throw new SidecarTerminationError()
    }
    reportStage('resolve-command')
    const command = this.#resolveCommand({
      packaged: this.#app.isPackaged,
      resourcesPath: this.#app.resourcesPath,
      moduleDirectory: this.#moduleDirectory,
    })
    const dataDirectory = resolve(this.#dataLocation.dataDir)
    const relocation = this.#dataLocation.relocation
    const identity: OwnedSidecarIdentity = {
      generation: ++this.#generation,
      instanceToken: this.#randomInstanceToken(),
    }
    reportStage('resolve-environment')
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      PIDEX_HOST: '127.0.0.1',
      PIDEX_PORT: String(this.#preferredPort ?? 0),
      PIDEX_AUTH_TOKEN: this.#token,
      PIDEX_DESKTOP_MANAGED: '1',
      PIDEX_SIDECAR_INSTANCE_TOKEN: identity.instanceToken,
      PIDEX_DATA_DIR: dataDirectory,
      PIDEX_PETS_DIR: join(dataDirectory, 'pets'),
      PIDEX_TOOLING_HOME: join(dataDirectory, 'tooling'),
      PIDEX_BUILTIN_SKILLS_DIR: this.#app.isPackaged
        ? join(this.#app.resourcesPath, 'agent', 'skills')
        : process.env.PIDEX_BUILTIN_SKILLS_DIR,
      PIDEX_BUILTIN_PLUGINS_DIR: this.#app.isPackaged
        ? join(this.#app.resourcesPath, 'agent', 'plugins')
        : process.env.PIDEX_BUILTIN_PLUGINS_DIR,
      PIDEX_BUILTIN_INTEGRATIONS_DIR: this.#app.isPackaged
        ? join(this.#app.resourcesPath, 'agent', 'integrations')
        : process.env.PIDEX_BUILTIN_INTEGRATIONS_DIR,
      PIDEX_LEGACY_DATA_DIR: join(this.#app.getPath('userData'), 'agent'),
      PIDEX_LEGACY_APPEARANCE_SETTINGS_PATH: join(
        this.#app.getPath('userData'),
        'appearance-settings.json',
      ),
      PIDEX_DOCUMENTS_DIR: resolveDocumentsDirectory((name) => this.#app.getPath(name)),
      PIDEX_LOG_DIR: join(dataDirectory, 'logs'),
      ...(relocation
        ? {
            PIDEX_RELOCATION_SOURCE_DIR: relocation.sourceDataDir,
            PIDEX_RELOCATION_OPERATION_ID: relocation.operationId,
          }
        : {
            PIDEX_RELOCATION_SOURCE_DIR: undefined,
            PIDEX_RELOCATION_OPERATION_ID: undefined,
          }),
      PIDEX_STATIC_DIR: this.#app.isPackaged
        ? join(this.#app.resourcesPath, 'renderer')
        : process.env.PIDEX_STATIC_DIR,
    }
    reportStage('spawn-process')
    const child = this.#spawnProcess(command.executable, command.args, {
      cwd: command.cwd,
      windowsHide: true,
      env: childEnvironment,
    })
    const owned: OwnedSidecarProcess = { child, identity }
    this.#owned = owned
    reportStage('close-stdin')
    child.stdin.end()

    this.#logger.info('sidecar.spawned', {
      pid: child.pid,
      attempt,
      preferredPort: this.#preferredPort ?? null,
      generation: identity.generation,
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (!this.#isOwnedCurrent(owned)) return
      this.#logger.error('sidecar.stderr', {
        pid: child.pid,
        text: chunk.toString('utf8'),
        generation: identity.generation,
      })
    })
    child.once('exit', (code, signal) => {
      this.#logger.warn('sidecar.exit', {
        pid: child.pid,
        code,
        signal,
        generation: identity.generation,
      })
      if (!this.#isOwnedCurrent(owned)) return
      const connection = this.#connection
      if (
        !this.#stopping &&
        connection &&
        !connection.managed &&
        connection.generation === identity.generation &&
        connection.instanceToken === identity.instanceToken
      ) {
        this.#onConnectionLost?.()
      }
    })

    try {
      reportStage('await-ready-message')
      const ready = await this.#waitForReadyMessage(child, this.#logger, identity.instanceToken)
      this.#assertOwnedCurrent(owned)
      const host = ready.host === 'localhost' ? 'localhost' : '127.0.0.1'
      owned.origin = `http://${host}:${ready.port}`
      this.#preferredPort = ready.port
      reportStage('probe-ready')
      await this.#waitForReady(
        owned.origin,
        this.#token,
        this.#logger,
        attempt,
        identity.instanceToken,
      )
      this.#assertOwnedCurrent(owned)
    } catch (error) {
      if (this.#isOwnedCurrent(owned)) {
        await this.#disposeOwned(owned)
      }
      const missingSidecar = this.#app.isPackaged
        ? missingPackagedSidecarError(error, command.executable)
        : undefined
      if (missingSidecar) throw missingSidecar
      throw error
    }

    return {
      origin: owned.origin,
      managed: false,
      port: Number(new URL(owned.origin).port),
      generation: identity.generation,
      instanceToken: identity.instanceToken,
    }
  }

  #isOwnedCurrent(owned: OwnedSidecarProcess): boolean {
    return (
      this.#owned === owned &&
      this.#owned.identity.generation === owned.identity.generation &&
      this.#owned.identity.instanceToken === owned.identity.instanceToken
    )
  }

  #assertOwnedCurrent(owned: OwnedSidecarProcess): void {
    if (!this.#isOwnedCurrent(owned)) {
      throw new Error('忽略过期的 Agent 生命周期回调')
    }
  }

  #isConnectionCurrent(connection: SidecarConnection): boolean {
    if (this.#connection !== connection) return false
    if (connection.managed) return true
    const owned = this.#owned
    return Boolean(
      owned &&
      owned.identity.generation === connection.generation &&
      owned.identity.instanceToken === connection.instanceToken,
    )
  }

  #assertConnectionCurrent(connection: SidecarConnection): void {
    if (connection.managed) return
    const owned = this.#owned
    if (
      !owned ||
      owned.identity.generation !== connection.generation ||
      owned.identity.instanceToken !== connection.instanceToken
    ) {
      throw new Error('忽略过期的 Agent 连接回调')
    }
  }

  #clearWatchdog(): void {
    if (this.#watchdog) clearInterval(this.#watchdog)
    this.#watchdog = undefined
    this.#watchdogBusy = false
    this.#watchdogEpoch += 1
  }

  async #disposeCurrentOwned(): Promise<void> {
    const owned = this.#owned
    if (!owned) return
    await this.#disposeOwned(owned)
  }

  #disposeOwned(owned: OwnedSidecarProcess): Promise<void> {
    if (owned.disposePromise) return owned.disposePromise
    owned.disposePromise = this.#disposeOwnedOnce(owned)
      .then(() => {
        if (this.#owned === owned) this.#owned = undefined
        this.#terminationFailure = undefined
      })
      .catch((error) => {
        throw this.#rememberTerminationFailure(error)
      })
    return owned.disposePromise
  }

  async #disposeOwnedOnce(owned: OwnedSidecarProcess): Promise<void> {
    const child = owned.child
    if (hasChildExited(child)) return

    if (owned.origin) {
      try {
        this.#logger.info('sidecar.shutdown-request', {
          origin: owned.origin,
          generation: owned.identity.generation,
        })
        await this.#fetch(`${owned.origin}/api/shutdown`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.#token}` },
          signal: AbortSignal.timeout(this.#shutdownTimeoutMs),
        })
      } catch {
        // SIGTERM 和进程树清理是关闭请求失败后的既有兜底。
      }
      if (await waitForChildExit(child, this.#shutdownTimeoutMs)) return
    }

    try {
      child.kill('SIGTERM')
    } catch {
      // 继续通过 exit/close 或严格进程树清理确认。
    }
    if (await waitForChildExit(child, this.#sigtermTimeoutMs)) return

    const pid = child.pid
    if (!Number.isSafeInteger(pid) || Number(pid) <= 0) {
      throw new SidecarTerminationError()
    }
    try {
      const confirmation = await withTimeout(
        this.#processTreeKiller.kill(Number(pid)),
        this.#processTreeTimeoutMs,
      )
      if (confirmation === 'process-not-found') return
      if (await waitForChildExit(child, this.#processTreeTimeoutMs)) return
      throw new SidecarTerminationError()
    } catch {
      if (await waitForChildExit(child, this.#processTreeTimeoutMs)) return
      throw new SidecarTerminationError()
    }
  }

  #rememberTerminationFailure(error: unknown): SidecarTerminationError {
    if (this.#terminationFailure) return this.#terminationFailure
    this.#terminationFailure =
      error instanceof SidecarTerminationError ? error : new SidecarTerminationError()
    this.#logger.error('sidecar.termination-unconfirmed', {
      code: this.#terminationFailure.code,
    })
    return this.#terminationFailure
  }
}

function hasChildExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (hasChildExited(child)) return Promise.resolve(true)
  return new Promise((resolveExit) => {
    let settled = false
    const finish = (exited: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      child.removeListener('close', onExit)
      child.removeListener('error', onError)
      resolveExit(exited)
    }
    const onExit = (): void => finish(true)
    const onError = (): void => finish(hasChildExited(child))
    const timer = setTimeout(() => finish(hasChildExited(child)), timeoutMs)
    child.once('exit', onExit)
    child.once('close', onExit)
    child.once('error', onError)
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolveValue, rejectValue) => {
    const timer = setTimeout(() => rejectValue(new Error('进程树清理超时')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolveValue(value)
      },
      (error) => {
        clearTimeout(timer)
        rejectValue(error)
      },
    )
  })
}
