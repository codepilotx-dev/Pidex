import { afterEach, describe, expect, test } from 'bun:test'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { DesktopLogger } from '../src/logging/DesktopLogger'
import { SidecarSupervisor, type SidecarSupervisorDependencies } from '../src/sidecar/Supervisor'
import { SidecarTerminationError } from '../src/sidecar/FailureDiagnostics'

const originalManagedOrigin = process.env.PIDEX_AGENT_URL

afterEach(() => {
  if (originalManagedOrigin === undefined) {
    delete process.env.PIDEX_AGENT_URL
  } else {
    process.env.PIDEX_AGENT_URL = originalManagedOrigin
  }
})

describe('SidecarSupervisor owned 生命周期', () => {
  test('打包 sidecar 使用安装资源中的内置 Skills 与 Plugins', async () => {
    delete process.env.PIDEX_AGENT_URL
    const harness = createHarness({
      appRuntime: {
        isPackaged: true,
        resourcesPath: 'C:\\resources',
        getPath: (name) => `C:\\${name}`,
      },
    })
    const supervisor = harness.supervisor()
    await supervisor.connect(async () => undefined)

    expect(harness.environments[0]?.PIDEX_BUILTIN_SKILLS_DIR).toBe('C:\\resources\\agent\\skills')
    expect(harness.environments[0]?.PIDEX_BUILTIN_PLUGINS_DIR).toBe('C:\\resources\\agent\\plugins')
    harness.children[0]?.exitOnSignal()
    await supervisor.stop()
  })

  test('每次 spawn 注入新 identity，并同时校验 stdout 与 /api/ready', async () => {
    delete process.env.PIDEX_AGENT_URL
    const harness = createHarness()
    const supervisor = harness.supervisor()
    const first = await supervisor.connect(async () => undefined)

    expect(first.generation).toBe(1)
    expect(first.instanceToken).toBe('instance-1')
    expect(harness.environments[0]).toMatchObject({
      PIDEX_DESKTOP_MANAGED: '1',
      PIDEX_SIDECAR_INSTANCE_TOKEN: 'instance-1',
    })
    expect(harness.stdoutExpectations).toEqual(['instance-1'])
    expect(harness.healthExpectations).toEqual(['instance-1'])

    harness.children[0]?.exitOnSignal()
    const firstStop = supervisor.stop()
    const secondStop = supervisor.stop()
    expect(firstStop).toBe(secondStop)
    await firstStop
    expect(harness.children[0]?.signals).toEqual(['SIGTERM'])
  })

  test('旧 child 延迟 exit 不能污染使用相同端口的新 generation', async () => {
    delete process.env.PIDEX_AGENT_URL
    const harness = createHarness({
      processTreeKiller: {
        kill: async () => 'process-not-found' as const,
      },
    })
    const supervisor = harness.supervisor()
    const first = await supervisor.connect(async () => undefined)
    let lost = 0
    supervisor.watch(first, () => {
      lost += 1
    })
    await supervisor.invalidate()

    const second = await supervisor.connect(async () => undefined)
    supervisor.watch(second, () => {
      lost += 1
    })
    expect(second.port).toBe(first.port)
    expect(second.generation).toBe(2)

    harness.children[0]?.markExited()
    await Promise.resolve()
    expect(lost).toBe(0)
    harness.children[1]?.exitOnSignal()
    await supervisor.stop()
  })

  test('旧 generation 的延迟 fetch 响应不能作为当前连接结果返回', async () => {
    delete process.env.PIDEX_AGENT_URL
    const staleResponse = deferred<Response>()
    let staleRequestStarted = false
    const harness = createHarness({
      fetcher: async (input) => {
        if (input.endsWith('/api/stale')) {
          staleRequestStarted = true
          return staleResponse.promise
        }
        return new Response(JSON.stringify({ ok: true }))
      },
    })
    const supervisor = harness.supervisor()
    await supervisor.connect(async () => undefined)
    const pending = supervisor.request('/api/stale')
    await eventually(() => staleRequestStarted)

    await supervisor.invalidate()
    await supervisor.connect(async () => undefined)
    staleResponse.resolve(new Response(JSON.stringify({ ok: true })))

    await expect(pending).rejects.toThrow('忽略过期的 Agent 连接回调')
    const current = await supervisor.request('/api/current')
    expect(current.ok).toBe(true)
    harness.children[1]?.exitOnSignal()
    await supervisor.stop()
  })

  test('旧 generation 的 ready 与 watchdog 延迟回调不能改变新连接', async () => {
    delete process.env.PIDEX_AGENT_URL
    const staleReady = deferred<{
      type: 'ready'
      host: string
      port: number
      instanceToken: string
    }>()
    let readyCalls = 0
    const readyHarness = createHarness({
      waitForReadyMessage: async (_child, _logger, expected) => {
        readyCalls += 1
        if (readyCalls === 1) return staleReady.promise
        return {
          type: 'ready',
          host: '127.0.0.1',
          port: 4312,
          instanceToken: expected,
        }
      },
    })
    const readySupervisor = readyHarness.supervisor()
    const pendingConnect = readySupervisor.connect(async () => undefined)
    await eventually(() => readyHarness.children.length === 1)
    readyHarness.children[0]?.exitOnSignal()
    await readySupervisor.stop()
    staleReady.resolve({
      type: 'ready',
      host: '127.0.0.1',
      port: 4312,
      instanceToken: 'instance-1',
    })
    await expect(pendingConnect).rejects.toThrow('连接已停止')
    expect(readyHarness.children).toHaveLength(1)

    const staleProbe = deferred<void>()
    let probeCalls = 0
    const watchdogHarness = createHarness({
      probeReady: async () => {
        probeCalls += 1
        if (probeCalls === 1) return staleProbe.promise
      },
      watchdogIntervalMs: 1,
      watchdogFailureLimit: 1,
      processTreeKiller: {
        kill: async () => 'process-not-found' as const,
      },
    })
    const watchdogSupervisor = watchdogHarness.supervisor()
    const first = await watchdogSupervisor.connect(async () => undefined)
    let lost = 0
    watchdogSupervisor.watch(first, () => {
      lost += 1
    })
    await eventually(() => probeCalls === 1)
    await watchdogSupervisor.invalidate()
    const second = await watchdogSupervisor.connect(async () => undefined)
    watchdogSupervisor.watch(second, () => {
      lost += 1
    })
    staleProbe.reject(new Error('stale watchdog failure'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(lost).toBe(0)
    watchdogHarness.children[1]?.exitOnSignal()
    await watchdogSupervisor.stop()
  })

  test('优雅退出和 SIGTERM hang 后升级进程树清理并等待 exit', async () => {
    delete process.env.PIDEX_AGENT_URL
    let killedPid: number | undefined
    const harness = createHarness({
      processTreeKiller: {
        kill: async (pid) => {
          killedPid = pid
          harness.children[0]?.markExited()
          return 'terminated' as const
        },
      },
    })
    const supervisor = harness.supervisor()
    await supervisor.connect(async () => undefined)

    await supervisor.stop()
    expect(harness.children[0]?.signals).toEqual(['SIGTERM'])
    expect(killedPid).toBe(harness.children[0]?.pid)
    expect(harness.fetchPaths).toContain('http://127.0.0.1:4312/api/shutdown')
  })

  test('无法确认退出时进入 terminal failure 并阻止再次 spawn', async () => {
    delete process.env.PIDEX_AGENT_URL
    const harness = createHarness({
      processTreeKiller: {
        kill: async () => {
          throw new Error('taskkill failed')
        },
      },
    })
    const supervisor = harness.supervisor()
    await supervisor.connect(async () => undefined)

    await expect(supervisor.invalidate()).rejects.toBeInstanceOf(SidecarTerminationError)
    await expect(supervisor.connect(async () => undefined)).rejects.toBeInstanceOf(
      SidecarTerminationError,
    )
    expect(harness.children).toHaveLength(1)
  })

  test('退出确认失败后再次 stop 会重新检查残留进程', async () => {
    delete process.env.PIDEX_AGENT_URL
    let killCalls = 0
    const harness = createHarness({
      processTreeKiller: {
        kill: async () => {
          killCalls += 1
          if (killCalls === 1) throw new Error('taskkill failed')
          return 'process-not-found' as const
        },
      },
    })
    const supervisor = harness.supervisor()
    await supervisor.connect(async () => undefined)

    await expect(supervisor.stop()).rejects.toBeInstanceOf(SidecarTerminationError)
    await supervisor.stop()

    expect(killCalls).toBe(2)
  })

  test('managed origin 不设置实例标识、不 spawn 且 stop 不关闭外部 Agent', async () => {
    process.env.PIDEX_AGENT_URL = 'http://127.0.0.1:4800'
    const harness = createHarness()
    const supervisor = harness.supervisor()
    const connection = await supervisor.connect(async () => undefined)

    expect(connection.managed).toBe(true)
    expect(connection.instanceToken).toBeUndefined()
    expect(harness.children).toHaveLength(0)
    await supervisor.stop()
    expect(harness.fetchPaths).toHaveLength(0)
  })
})

function createHarness(overrides: Partial<SidecarSupervisorDependencies> = {}) {
  const children: FakeChild[] = []
  const environments: NodeJS.ProcessEnv[] = []
  const stdoutExpectations: Array<string | undefined> = []
  const healthExpectations: Array<string | undefined> = []
  const fetchPaths: string[] = []
  let tokenSequence = 0

  const dependencies: SidecarSupervisorDependencies = {
    appRuntime: {
      isPackaged: false,
      resourcesPath: 'C:\\resources',
      getPath: (name) => `C:\\${name}`,
    },
    resolveCommand: () => ({
      executable: 'agent.exe',
      args: [],
      cwd: 'C:\\workspace',
    }),
    spawnProcess: (_executable, _args, options) => {
      const child = new FakeChild(5_000 + children.length)
      children.push(child)
      environments.push({ ...(options.env as NodeJS.ProcessEnv) })
      return child as unknown as ChildProcessWithoutNullStreams
    },
    waitForReadyMessage: async (_child, _logger, expected) => {
      stdoutExpectations.push(expected)
      return {
        type: 'ready',
        host: '127.0.0.1',
        port: 4312,
        instanceToken: expected,
      }
    },
    waitForReady: async (_origin, _token, _logger, _attempt, expected) => {
      healthExpectations.push(expected)
    },
    probeReady: async () => undefined,
    fetcher: async (input) => {
      fetchPaths.push(input)
      return new Response(JSON.stringify({ ok: true }))
    },
    sleep: async () => undefined,
    processTreeKiller: {
      kill: async () => 'process-not-found' as const,
    },
    randomInstanceToken: () => `instance-${++tokenSequence}`,
    shutdownTimeoutMs: 0,
    sigtermTimeoutMs: 0,
    processTreeTimeoutMs: 1,
    ...overrides,
  }

  return {
    children,
    environments,
    stdoutExpectations,
    healthExpectations,
    fetchPaths,
    supervisor: () =>
      new SidecarSupervisor(
        'desktop-auth-token',
        logger,
        'C:\\module',
        { dataDir: 'C:\\data', relocation: null },
        dependencies,
      ),
  }
}

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly signals: NodeJS.Signals[] = []
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  #exitOnSignal = false

  constructor(readonly pid: number) {
    super()
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal)
    if (this.#exitOnSignal) this.markExited(signal)
    return true
  }

  exitOnSignal(): void {
    this.#exitOnSignal = true
  }

  markExited(signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    this.exitCode = signal ? null : 0
    this.signalCode = signal
    this.emit('exit', this.exitCode, signal)
    this.emit('close', this.exitCode, signal)
  }
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
