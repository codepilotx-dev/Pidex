import { describe, expect, test } from 'bun:test'
import type { IDisposable, IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty'
import type { DesktopTerminalEvent } from '@pidex/shared/desktop-terminal-ipc'
import { ShellProfileService } from '../src/terminal/ShellProfileService'
import { TerminalManager, type TerminalPtyFactory } from '../src/terminal/TerminalManager'
import type {
  TerminalLaunchContext,
  TerminalOutputMirrorSink,
} from '../src/terminal/TerminalSession'

describe('终端管理器', () => {
  test('每个 task 复用一个 PTY，并剥离内部认证环境', async () => {
    const factory = new FakePtyFactory()
    const manager = new TerminalManager({
      contextResolver: {
        resolve: async (threadId) => context(threadId),
      },
      profiles: windowsPowerShellProfile(),
      ptyFactory: factory,
      processTreeKiller: { kill: async () => undefined },
      environment: {
        PIDEX_AUTH_TOKEN: 'secret',
        PIDEX_PORT: '1234',
        USER_VISIBLE: 'yes',
      },
      onEvent: () => undefined,
    })

    const first = await manager.ensure({
      threadId: 'thread-1',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    const second = await manager.ensure({
      threadId: 'thread-1',
      profileId: null,
      cols: 120,
      rows: 40,
    })

    expect(second.terminalId).toBe(first.terminalId)
    expect(factory.spawns).toHaveLength(1)
    expect(factory.spawns[0]?.options.env).toMatchObject({ USER_VISIBLE: 'yes' })
    expect(factory.spawns[0]?.options.env).not.toHaveProperty('PIDEX_AUTH_TOKEN')
    expect(factory.spawns[0]?.options.env).not.toHaveProperty('PIDEX_PORT')
  })

  test('支持同一 threadId 打开多个独立终端并按 terminalId 隔离', async () => {
    const factory = new FakePtyFactory()
    const manager = new TerminalManager({
      contextResolver: { resolve: async (threadId) => context(threadId) },
      profiles: windowsPowerShellProfile(),
      ptyFactory: factory,
      processTreeKiller: { kill: async () => undefined },
      onEvent: () => undefined,
    })

    const term1 = await manager.ensure({
      threadId: 'thread-1',
      terminalId: 'term-1',
      cwd: 'C:\\custom-cwd-1',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    const term2 = await manager.ensure({
      threadId: 'thread-1',
      terminalId: 'term-2',
      cwd: 'C:\\custom-cwd-2',
      profileId: null,
      cols: 80,
      rows: 24,
    })

    expect(term1.terminalId).toBe('term-1')
    expect(term2.terminalId).toBe('term-2')
    expect(term1.terminalId).not.toBe(term2.terminalId)
    expect(factory.spawns).toHaveLength(2)
    expect(factory.spawns[0]?.options.cwd).toBe('C:\\custom-cwd-1')
    expect(factory.spawns[1]?.options.cwd).toBe('C:\\custom-cwd-2')

    // closeThread closes both
    const closeResult = await manager.closeThread('thread-1', 'user-close')
    expect(closeResult.closed).toBe(true)
  })

  test('按实例隔离输入、resize 和关闭，关闭时停止进程', async () => {
    const factory = new FakePtyFactory()
    const killed: number[] = []
    const manager = new TerminalManager({
      contextResolver: { resolve: async (threadId) => context(threadId) },
      profiles: windowsPowerShellProfile(),
      ptyFactory: factory,
      processTreeKiller: {
        kill: async (pid) => {
          killed.push(pid)
        },
      },
      onEvent: () => undefined,
    })
    const snapshot = await manager.ensure({
      threadId: 'thread-2',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    manager.write(snapshot.terminalId, snapshot.instanceId, 'dir\r')
    manager.resize(snapshot.terminalId, snapshot.instanceId, 100, 30)
    const pty = factory.ptys[0]!
    expect(pty.writes).toEqual(['dir\r'])
    expect(pty.resizes).toEqual([[100, 30]])

    await manager.close(snapshot.terminalId, snapshot.instanceId, 'user-close')
    expect(pty.killed).toBe(true)
    expect(killed).toEqual([4242])
    expect(() => manager.attach(snapshot.terminalId, snapshot.instanceId, -1)).toThrow()
  })

  test('task 工作目录绑定变化时停止旧 PTY 并创建新实例', async () => {
    const factory = new FakePtyFactory()
    let contextVersion = '1'
    const manager = new TerminalManager({
      contextResolver: {
        resolve: async (threadId) => ({
          ...context(threadId),
          contextVersion,
          target: { kind: 'worktree', cwd: `C:\\workspace-${contextVersion}` },
        }),
      },
      profiles: windowsPowerShellProfile(),
      ptyFactory: factory,
      processTreeKiller: { kill: async () => undefined },
      onEvent: () => undefined,
    })
    const first = await manager.ensure({
      threadId: 'thread-worktree',
      profileId: null,
      cols: 80,
      rows: 24,
    })

    contextVersion = '2'
    const second = await manager.ensure({
      threadId: 'thread-worktree',
      profileId: null,
      cols: 80,
      rows: 24,
    })

    expect(second.terminalId).not.toBe(first.terminalId)
    expect(factory.ptys[0]?.killed).toBe(true)
    expect(factory.spawns[1]?.options.cwd).toBe('C:\\workspace-2')
  })

  test('Action 关闭并重建 task 唯一 PTY，应用 Windows env delta 后写入命令和 Enter', async () => {
    const factory = new FakePtyFactory()
    const manager = new TerminalManager({
      contextResolver: { resolve: async (threadId) => context(threadId) },
      actionResolver: {
        prepareAction: async (threadId, actionName) => {
          expect(actionName).toBe('Dev')
          return {
            context: { ...context(threadId), contextVersion: 'action-2' },
            environment: {
              revision: 2,
              set: {
                PATH: 'C:\\action-bin',
                ACTION_VISIBLE: 'yes',
                PIDEX_AUTH_TOKEN: 'must-not-leak',
              },
              unset: ['REMOVE_ME', 'pidex_port'],
            },
            command: 'bun run dev',
          }
        },
      },
      profiles: windowsPowerShellProfile(),
      ptyFactory: factory,
      processTreeKiller: { kill: async () => undefined },
      environment: {
        Path: 'C:\\base-bin',
        REMOVE_ME: 'remove',
        PIDEX_PORT: '1234',
      },
      onEvent: () => undefined,
    })
    const old = await manager.ensure({
      threadId: 'thread-action',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    const next = await manager.runAction({
      threadId: 'thread-action',
      actionName: 'Dev',
      profileId: null,
      cols: 100,
      rows: 30,
    })

    expect(next.terminalId).not.toBe(old.terminalId)
    expect(factory.spawns).toHaveLength(2)
    expect(factory.ptys[0]?.killed).toBe(true)
    expect(factory.ptys[1]?.writes).toEqual(['bun run dev\r'])
    const actionEnvironment = factory.spawns[1]?.options.env
    expect(actionEnvironment).toMatchObject({ PATH: 'C:\\action-bin', ACTION_VISIBLE: 'yes' })
    expect(actionEnvironment).not.toHaveProperty('Path')
    expect(actionEnvironment).not.toHaveProperty('REMOVE_ME')
    expect(actionEnvironment).not.toHaveProperty('PIDEX_AUTH_TOKEN')
    expect(actionEnvironment).not.toHaveProperty('PIDEX_PORT')
    expect(() => manager.attach(old.terminalId, old.instanceId, -1)).toThrow()
  })

  test('默认镜像按 reset→append 串行，snapshot 显示权威 cwd，关闭时 clear', async () => {
    const factory = new FakePtyFactory()
    const calls: string[] = []
    const mirror: TerminalOutputMirrorSink = {
      reset: async () => {
        calls.push('reset')
      },
      append: async () => {
        calls.push('append')
      },
      clear: async () => {
        calls.push('clear')
      },
    }
    const manager = new TerminalManager({
      contextResolver: { resolve: async (threadId) => context(threadId) },
      mirrorSink: mirror,
      profiles: windowsPowerShellProfile(),
      ptyFactory: factory,
      processTreeKiller: { kill: async () => undefined },
      onEvent: () => undefined,
    })
    const snapshot = await manager.ensure({
      threadId: 'thread-mirror',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    expect(snapshot.displayPath).toBe('C:\\workspace')
    await waitFor(() => calls.length >= 1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    factory.ptys[0]!.emitData('ready')
    manager.attach(snapshot.terminalId, snapshot.instanceId, -1)
    await waitFor(() => calls.includes('append'))
    expect(calls.slice(0, 2)).toEqual(['reset', 'append'])

    await manager.close(snapshot.terminalId, snapshot.instanceId, 'user-close')
    expect(calls.at(-1)).toBe('clear')
  })

  test('镜像 append 失败不停止 PTY，后续输出通过 reset 恢复', async () => {
    const factory = new FakePtyFactory()
    const calls: string[] = []
    const resetChunkCounts: number[] = []
    let appendAttempts = 0
    const manager = new TerminalManager({
      contextResolver: { resolve: async (threadId) => context(threadId) },
      mirrorSink: {
        reset: async (snapshot) => {
          calls.push('reset')
          resetChunkCounts.push(snapshot.chunks.length)
        },
        append: async () => {
          calls.push('append')
          appendAttempts += 1
          if (appendAttempts === 1) throw new Error('mirror unavailable')
        },
        clear: async () => {
          calls.push('clear')
        },
      },
      profiles: windowsPowerShellProfile(),
      ptyFactory: factory,
      processTreeKiller: { kill: async () => undefined },
      onEvent: () => undefined,
    })
    const snapshot = await manager.ensure({
      threadId: 'thread-recover',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    await waitFor(() => calls.length >= 1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const pty = factory.ptys[0]!
    pty.emitData('first')
    manager.attach(snapshot.terminalId, snapshot.instanceId, -1)
    await waitFor(() => appendAttempts === 1)
    pty.emitData('second')
    manager.attach(snapshot.terminalId, snapshot.instanceId, -1)
    await waitFor(() => calls.filter((call) => call === 'reset').length >= 2)

    expect(pty.killed).toBe(false)
    expect(calls.slice(0, 3)).toEqual(['reset', 'append', 'reset'])
    expect(resetChunkCounts.at(-1)).toBe(2)
  })

  test('初始 reset 失败后，即使没有新输出也会在 snapshot/attach 时重试', async () => {
    const factory = new FakePtyFactory()
    let resetAttempts = 0
    const manager = new TerminalManager({
      contextResolver: { resolve: async (threadId) => context(threadId) },
      mirrorSink: {
        reset: async () => {
          resetAttempts += 1
          if (resetAttempts === 1) throw new Error('mirror unavailable')
        },
        append: async () => undefined,
        clear: async () => undefined,
      },
      profiles: windowsPowerShellProfile(),
      ptyFactory: factory,
      processTreeKiller: { kill: async () => undefined },
      onEvent: () => undefined,
    })
    const snapshot = await manager.ensure({
      threadId: 'thread-reset-retry',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    await waitFor(() => resetAttempts === 1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    manager.attach(snapshot.terminalId, snapshot.instanceId, -1)
    await waitFor(() => resetAttempts === 2)

    expect(factory.ptys[0]?.killed).toBe(false)
  })

  test('同一 task 的 ensure、Action 与 closeThread 严格串行且不遗留 PTY', async () => {
    const factory = new FakePtyFactory()
    const resolverEntered = deferred<void>()
    const releaseResolver = deferred<void>()
    let actionPrepared = false
    const manager = new TerminalManager({
      contextResolver: {
        resolve: async (threadId) => {
          resolverEntered.resolve()
          await releaseResolver.promise
          return context(threadId)
        },
      },
      actionResolver: {
        prepareAction: async (threadId) => {
          actionPrepared = true
          return {
            context: { ...context(threadId), contextVersion: 'action' },
            environment: { revision: 0, set: {}, unset: [] },
            command: 'echo serialized',
          }
        },
      },
      profiles: windowsPowerShellProfile(),
      ptyFactory: factory,
      processTreeKiller: { kill: async () => undefined },
      onEvent: () => undefined,
    })

    const ensured = manager.ensure({
      threadId: 'thread-serial',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    await resolverEntered.promise
    const action = manager.runAction({
      threadId: 'thread-serial',
      actionName: 'Build',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    const closed = manager.closeThread('thread-serial', 'task-close')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(actionPrepared).toBe(false)

    releaseResolver.resolve()
    const [first, second, closeResult] = await Promise.all([ensured, action, closed])
    expect(actionPrepared).toBe(true)
    expect(second.terminalId).not.toBe(first.terminalId)
    expect(closeResult).toEqual({ closed: true })
    expect(factory.spawns).toHaveLength(2)
    expect(factory.ptys.every((pty) => pty.killed)).toBe(true)
    expect(() => manager.attach(second.terminalId, second.instanceId, -1)).toThrow()
  })

  test('并发 ensure 在锁内重新解析和读取 task session，只创建一个 PTY', async () => {
    const factory = new FakePtyFactory()
    const firstResolverEntered = deferred<void>()
    const releaseFirstResolver = deferred<void>()
    let resolveCalls = 0
    const manager = new TerminalManager({
      contextResolver: {
        resolve: async (threadId) => {
          resolveCalls += 1
          if (resolveCalls === 1) {
            firstResolverEntered.resolve()
            await releaseFirstResolver.promise
          }
          return context(threadId)
        },
      },
      profiles: windowsPowerShellProfile(),
      ptyFactory: factory,
      processTreeKiller: { kill: async () => undefined },
      onEvent: () => undefined,
    })

    const first = manager.ensure({
      threadId: 'thread-concurrent',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    await firstResolverEntered.promise
    const second = manager.ensure({
      threadId: 'thread-concurrent',
      profileId: null,
      cols: 120,
      rows: 40,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resolveCalls).toBe(1)
    releaseFirstResolver.resolve()
    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second])

    expect(resolveCalls).toBe(2)
    expect(secondSnapshot.terminalId).toBe(firstSnapshot.terminalId)
    expect(factory.spawns).toHaveLength(1)
  })

  test('stopAll 使延迟 context 结果过期，退出后不会发布新 PTY', async () => {
    const factory = new FakePtyFactory()
    const resolverEntered = deferred<void>()
    const releaseResolver = deferred<void>()
    const manager = new TerminalManager({
      contextResolver: {
        resolve: async (threadId) => {
          resolverEntered.resolve()
          await releaseResolver.promise
          return context(threadId)
        },
      },
      profiles: windowsPowerShellProfile(),
      ptyFactory: factory,
      processTreeKiller: { kill: async () => undefined },
      onEvent: () => undefined,
    })

    const pending = manager.ensure({
      threadId: 'thread-stopping',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    await resolverEntered.promise
    await manager.stopAll('app-quit')
    releaseResolver.resolve()

    await expect(pending).rejects.toThrow('应用正在关闭')
    expect(factory.spawns).toHaveLength(0)
  })

  test('镜像落后时把任意数量 pending append 合并为一个最新 reset', async () => {
    const factory = new FakePtyFactory()
    const firstAppend = deferred<void>()
    const resetChunkCounts: number[] = []
    let appendCalls = 0
    const manager = new TerminalManager({
      contextResolver: { resolve: async (threadId) => context(threadId) },
      mirrorSink: {
        reset: async (snapshot) => {
          resetChunkCounts.push(snapshot.chunks.length)
        },
        append: async () => {
          appendCalls += 1
          await firstAppend.promise
        },
        clear: async () => undefined,
      },
      profiles: windowsPowerShellProfile(),
      ptyFactory: factory,
      processTreeKiller: { kill: async () => undefined },
      onEvent: () => undefined,
    })
    const snapshot = await manager.ensure({
      threadId: 'thread-bounded-mirror',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    await waitFor(() => resetChunkCounts.length === 1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const pty = factory.ptys[0]!
    pty.emitData('first')
    manager.attach(snapshot.terminalId, snapshot.instanceId, -1)
    await waitFor(() => appendCalls === 1)

    for (let index = 0; index < 100; index += 1) {
      pty.emitData(`pending-${index}`)
      manager.attach(snapshot.terminalId, snapshot.instanceId, -1)
    }
    expect(appendCalls).toBe(1)
    expect(resetChunkCounts).toEqual([0])

    firstAppend.resolve()
    await waitFor(() => resetChunkCounts.length === 2)
    expect(appendCalls).toBe(1)
    expect(resetChunkCounts[1]).toBe(101)
  })

  test('关闭不随卡住的历史镜像请求无限等待，并发送 ID clear', async () => {
    const factory = new FakePtyFactory()
    const never = deferred<void>()
    const clears: Array<{ threadId: string; terminalId: string; instanceId: string }> = []
    let appendCalls = 0
    const manager = new TerminalManager({
      contextResolver: { resolve: async (threadId) => context(threadId) },
      mirrorSink: {
        reset: async () => undefined,
        append: async () => {
          appendCalls += 1
          await never.promise
        },
        clear: async (identity) => {
          clears.push(identity)
        },
      },
      profiles: windowsPowerShellProfile(),
      ptyFactory: factory,
      processTreeKiller: { kill: async () => undefined },
      onEvent: () => undefined,
    })
    const snapshot = await manager.ensure({
      threadId: 'thread-close-bounded',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    factory.ptys[0]!.emitData('blocked')
    manager.attach(snapshot.terminalId, snapshot.instanceId, -1)
    await waitFor(() => appendCalls === 1)

    const startedAt = Date.now()
    await manager.closeThread('thread-close-bounded', 'task-close')
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(clears[0]).toEqual({
      threadId: 'thread-close-bounded',
      terminalId: snapshot.terminalId,
      instanceId: snapshot.instanceId,
    })
  })
})

describe('终端输出 credit 窗口', () => {
  const CHUNK = 'x'.repeat(65_536)

  function setup() {
    const events: DesktopTerminalEvent[] = []
    const factory = new FakePtyFactory()
    const manager = new TerminalManager({
      contextResolver: { resolve: async (threadId) => context(threadId) },
      ptyFactory: factory,
      processTreeKiller: { kill: async () => undefined },
      onEvent: (event) => events.push(event),
    })
    return { events, factory, manager }
  }

  async function ensureTerminal(manager: TerminalManager) {
    return manager.ensure({
      threadId: 'task-flow',
      profileId: null,
      cols: 80,
      rows: 24,
    })
  }

  test('初始窗口内直接发送输出，不需要 ack', async () => {
    const { events, factory, manager } = setup()
    await ensureTerminal(manager)
    factory.ptys[0]!.emitData('hello')

    await waitFor(() => outputSequences(events).length === 1)
    expect(outputSequences(events)).toEqual([0])
    expect(factory.ptys[0]!.pauseCount).toBe(0)
    await manager.stopAll()
  })

  test('窗口打满时暂停 PTY，ack 降到低水位后恢复并补发积压', async () => {
    const { events, factory, manager } = setup()
    const snapshot = await ensureTerminal(manager)
    const pty = factory.ptys[0]!
    // attach 代表渲染端已挂载，是允许暂停 PTY 的前提。
    manager.attach(snapshot.terminalId, snapshot.instanceId, -1)
    for (let index = 0; index < 5; index += 1) pty.emitData(CHUNK)

    await waitFor(() => outputSequences(events).length === 4)
    expect(pty.pauseCount).toBe(1)

    // 确认前 4 个 chunk（4 × 65536 = 262144 字符）后窗口重新打开并补发第 5 个。
    manager.ack(snapshot.terminalId, snapshot.instanceId, 3, 4 * 65_536)
    await waitFor(() => outputSequences(events).length === 5)
    expect(pty.resumeCount).toBe(1)
    expect(outputSequences(events)).toEqual([0, 1, 2, 3, 4])
    await manager.stopAll()
  })

  test('没有活跃消费者时不暂停 PTY，积压由有界缓冲明确截断', async () => {
    const { events, factory, manager } = setup()
    const snapshot = await ensureTerminal(manager)
    const pty = factory.ptys[0]!
    // 24 × 64KiB 超过 1MiB 缓冲：淘汰最旧并标记截断，但绝不暂停后台进程。
    for (let index = 0; index < 24; index += 1) pty.emitData(CHUNK)

    await waitFor(() => outputSequences(events).length >= 4)
    expect(pty.pauseCount).toBe(0)
    // 发送顺序严格连续、无重复无跳跃：有界内存不等于丢序。
    expect(outputSequences(events)).toEqual([0, 1, 2, 3])
    const replay = manager.attach(snapshot.terminalId, snapshot.instanceId, -1)
    expect(replay.truncated).toBe(true)
    expect(replay.chunks.length).toBeLessThanOrEqual(16)
    expect(replay.chunks.length).toBeGreaterThan(0)
    // 回放序号同样严格连续。
    expect(replay.chunks.map((chunk) => chunk.sequence)).toEqual(
      replay.chunks.map((_, index) => replay.oldestSequence + index),
    )
    await manager.stopAll()
  })

  test('重复或非法 ack 不释放窗口额度', async () => {
    const { events, factory, manager } = setup()
    const snapshot = await ensureTerminal(manager)
    const pty = factory.ptys[0]!
    manager.attach(snapshot.terminalId, snapshot.instanceId, -1)
    for (let index = 0; index < 5; index += 1) pty.emitData(CHUNK)
    await waitFor(() => outputSequences(events).length === 4)
    expect(pty.pauseCount).toBe(1)

    manager.ack(snapshot.terminalId, snapshot.instanceId, 3, -1)
    manager.ack(snapshot.terminalId, snapshot.instanceId, 3.5, 1_000)
    manager.ack(snapshot.terminalId, snapshot.instanceId, 4, 4 * 65_536)
    await waitFor(() => pty.resumeCount === 1)

    // 同一序号的重复 ack 不能二次释放额度，也不再触发一次恢复。
    manager.ack(snapshot.terminalId, snapshot.instanceId, 4, 4 * 65_536)
    await Promise.resolve()
    expect(pty.resumeCount).toBe(1)
    expect(pty.pauseCount).toBe(1)
    await manager.stopAll()
  })
})

function outputSequences(events: readonly DesktopTerminalEvent[]): number[] {
  return events
    .filter(
      (event): event is Extract<DesktopTerminalEvent, { type: 'output' }> =>
        event.type === 'output',
    )
    .map((event) => event.chunk.sequence)
}

class FakePtyFactory implements TerminalPtyFactory {
  readonly ptys: FakePty[] = []
  readonly spawns: Array<{
    file: string
    args: string[]
    options: IPtyForkOptions | IWindowsPtyForkOptions
  }> = []

  spawn(file: string, args: string[], options: IPtyForkOptions | IWindowsPtyForkOptions): IPty {
    this.spawns.push({ file, args, options })
    const pty = new FakePty()
    this.ptys.push(pty)
    return pty
  }
}

class FakePty implements IPty {
  readonly pid = 4242
  readonly process = 'fake'
  readonly writes: string[] = []
  readonly resizes: Array<[number, number]> = []
  killed = false
  pauseCount = 0
  resumeCount = 0
  paused = false
  #dataListeners = new Set<(data: string) => void>()
  #exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()

  onData(listener: (data: string) => void): IDisposable {
    this.#dataListeners.add(listener)
    return { dispose: () => this.#dataListeners.delete(listener) }
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): IDisposable {
    this.#exitListeners.add(listener)
    return { dispose: () => this.#exitListeners.delete(listener) }
  }

  write(data: string): void {
    this.writes.push(data)
  }

  emitData(data: string): void {
    for (const listener of this.#dataListeners) listener(data)
  }

  resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows])
  }

  clear(): void {}

  pause(): void {
    this.pauseCount += 1
    this.paused = true
  }

  resume(): void {
    this.resumeCount += 1
    this.paused = false
  }

  kill(): void {
    this.killed = true
    for (const listener of this.#exitListeners) listener({ exitCode: 0 })
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('timed out waiting for terminal mirror')
}

function context(threadId: string): TerminalLaunchContext {
  return {
    threadId,
    bindingId: `binding:${threadId}`,
    contextVersion: '1',
    workspaceKind: 'project',
    target: { kind: 'local', cwd: 'C:\\workspace' },
  }
}

function windowsPowerShellProfile(): ShellProfileService {
  return new ShellProfileService({
    platform: 'win32',
    environment: { SystemRoot: 'C:\\Windows' },
    fileExists: (path) => path.endsWith('powershell.exe'),
  })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
