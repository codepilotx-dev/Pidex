import type {
  DesktopTerminalChunk,
  DesktopTerminalEvent,
  DesktopTerminalExitReason,
  DesktopTerminalSnapshot,
  DesktopTerminalState,
} from '@pidex/shared/desktop-terminal-ipc'
import type { IDisposable, IPty } from 'node-pty'
import type { ProcessTreeKiller } from './ProcessTree.js'
import { TerminalError } from './TerminalErrors.js'
import { TerminalOutputBuffer } from './TerminalOutputBuffer.js'

export interface TerminalLaunchContext {
  threadId: string
  bindingId: string
  contextVersion: string
  workspaceKind: 'project' | 'projectless'
  target: {
    kind: 'local' | 'worktree'
    cwd: string
  }
}

export interface TerminalOutputMirrorSnapshot {
  threadId: string
  terminalId: string
  instanceId: string
  oldestSequence: number
  nextSequence: number
  chunks: readonly DesktopTerminalChunk[]
  state: DesktopTerminalState
  exitCode: number | null
}

export interface TerminalOutputMirrorSink {
  reset(snapshot: TerminalOutputMirrorSnapshot): Promise<void>
  append(input: { threadId: string; chunk: DesktopTerminalChunk }): Promise<void>
  clear(input: { threadId: string; terminalId: string; instanceId: string }): Promise<void>
}

export interface TerminalSessionOptions {
  terminalId: string
  instanceId: string
  profileId: string
  context: TerminalLaunchContext
  pty: IPty
  processTreeKiller: ProcessTreeKiller
  mirrorSink?: TerminalOutputMirrorSink
  onEvent: (event: DesktopTerminalEvent) => void
  outputBufferBytes?: number
}

const OUTPUT_FLUSH_INTERVAL_MS = 16
const OUTPUT_FLUSH_BYTES = 65_536
/**
 * 渲染端输出 credit 窗口（单位与 chunk.data.length 一致）。窗口打满时暂停 PTY
 * 读取，而不是把积压留在 IPC 队列或主进程内存里。
 */
const OUTPUT_CREDIT_HIGH_CHARACTERS = 262_144
const OUTPUT_CREDIT_LOW_CHARACTERS = 65_536
/**
 * 消费者活跃判定：面板隐藏/卸载后不再有 ack，此时不应因窗口打满而暂停 PTY，
 * 否则后台构建会被静默卡住；改为只保留有界缓冲与截断提示。
 */
const CONSUMER_ACTIVITY_MS = 2_000
const GRACEFUL_CLOSE_TIMEOUT_MS = 1_500
const MIRROR_DRAIN_TIMEOUT_MS = 250
const MIRROR_CLEAR_TIMEOUT_MS = 500

export class TerminalSession {
  readonly terminalId: string
  readonly instanceId: string
  readonly profileId: string
  readonly context: TerminalLaunchContext
  readonly #pty: IPty
  readonly #processTreeKiller: ProcessTreeKiller
  readonly #mirrorSink: TerminalOutputMirrorSink | undefined
  readonly #onEvent: (event: DesktopTerminalEvent) => void
  readonly #buffer: TerminalOutputBuffer
  readonly #subscriptions: IDisposable[] = []
  #state: DesktopTerminalState = 'starting'
  #exitCode: number | null = null
  #exitReason: DesktopTerminalExitReason | null = null
  #contextChanged = false
  #mirrorInFlight: Promise<void> | undefined
  #mirrorPendingChunk: DesktopTerminalChunk | undefined
  #mirrorPendingReset = false
  #mirrorStale = false
  #mirrorNextSequence = 0
  #mirrorClosing = false
  #pendingOutput = ''
  #pendingOutputBytes = 0
  #flushTimer: NodeJS.Timeout | undefined
  #nextOutputSequence = 0
  #ackedSequence = -1
  #sentCharacters = 0
  #lastConsumerActivityAt = 0
  #paused = false
  #flowControlTimer: NodeJS.Timeout | undefined
  #closePromise: Promise<void> | undefined
  #resolveExit: (() => void) | undefined

  constructor(options: TerminalSessionOptions) {
    this.terminalId = options.terminalId
    this.instanceId = options.instanceId
    this.profileId = options.profileId
    this.context = options.context
    this.#pty = options.pty
    this.#processTreeKiller = options.processTreeKiller
    this.#mirrorSink = options.mirrorSink
    this.#onEvent = options.onEvent
    this.#buffer = new TerminalOutputBuffer(
      options.terminalId,
      options.instanceId,
      options.outputBufferBytes,
    )
    this.#subscriptions.push(
      this.#pty.onData((data) => this.#queueOutput(data)),
      this.#pty.onExit(({ exitCode }) => this.#handleExit(exitCode)),
    )
    this.#setState('running')
    if (this.#mirrorSink) {
      this.#mirrorStale = true
      this.#requestMirrorReset()
    }
  }

  get state(): DesktopTerminalState {
    return this.#state
  }

  matchesInstance(instanceId: string): boolean {
    return this.instanceId === instanceId
  }

  hasContext(context: TerminalLaunchContext): boolean {
    return (
      this.context.bindingId === context.bindingId &&
      this.context.contextVersion === context.contextVersion &&
      this.context.target.cwd === context.target.cwd
    )
  }

  markContextChanged(changed: boolean): void {
    this.#contextChanged = changed
  }

  write(data: string): void {
    if (this.#state !== 'running') {
      throw new TerminalError('TERMINAL_NOT_RUNNING', '集成终端未在运行')
    }
    this.#pty.write(data)
  }

  resize(cols: number, rows: number): void {
    if (this.#state !== 'running') {
      throw new TerminalError('TERMINAL_NOT_RUNNING', '集成终端未在运行')
    }
    this.#pty.resize(cols, rows)
  }

  snapshot(afterSequence = -1): DesktopTerminalSnapshot {
    this.#flushOutput()
    if (this.#mirrorStale && !this.#mirrorInFlight && !this.#mirrorPendingReset)
      this.#requestMirrorReset()
    const replay = this.#buffer.replay(afterSequence)
    return {
      terminalId: this.terminalId,
      instanceId: this.instanceId,
      threadId: this.context.threadId,
      displayPath: this.context.target.cwd,
      profileId: this.profileId,
      state: this.#state,
      oldestSequence: replay.oldestSequence,
      nextSequence: replay.nextSequence,
      chunks: replay.chunks,
      gap: replay.gap,
      truncated: replay.truncated,
      contextChanged: this.#contextChanged,
      exitCode: this.#exitCode,
      exitReason: this.#exitReason,
    }
  }

  close(
    reason: Exclude<DesktopTerminalExitReason, 'process-exit' | 'launch-failed'>,
  ): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    if (this.#state === 'exited' || this.#state === 'failed') {
      this.#exitReason ??= reason
      this.#closePromise = this.#clearMirrorAndDispose()
      return this.#closePromise
    }
    this.#exitReason = reason
    this.#setState('closing')
    this.#closePromise = this.#stopProcess().finally(() => this.#clearMirrorAndDispose())
    return this.#closePromise
  }

  async #stopProcess(): Promise<void> {
    const exitPromise = new Promise<void>((resolveExit) => {
      this.#resolveExit = resolveExit
    })
    // Kill the tree while the PTY root PID still identifies its descendants.
    // Killing only the shell first can orphan child processes on Windows.
    await Promise.race([
      this.#processTreeKiller.kill(this.#pty.pid).catch(() => undefined),
      delay(GRACEFUL_CLOSE_TIMEOUT_MS),
    ])
    try {
      this.#pty.kill()
    } catch {
      // The tree killer above remains authoritative.
    }
    const exitedGracefully = await Promise.race([
      exitPromise.then(() => true),
      delay(GRACEFUL_CLOSE_TIMEOUT_MS).then(() => false),
    ])
    if (!exitedGracefully) {
      await Promise.race([
        this.#processTreeKiller.kill(this.#pty.pid).catch(() => undefined),
        delay(500),
      ])
      await Promise.race([exitPromise, delay(500)])
    }
  }

  #queueOutput(data: string): void {
    if (!data) return
    this.#pendingOutput += data
    this.#pendingOutputBytes += Buffer.byteLength(data, 'utf8')
    if (this.#pendingOutputBytes >= OUTPUT_FLUSH_BYTES) {
      this.#flushOutput()
      return
    }
    if (!this.#flushTimer) {
      this.#flushTimer = setTimeout(() => this.#flushOutput(), OUTPUT_FLUSH_INTERVAL_MS)
      this.#flushTimer.unref()
    }
  }

  #flushOutput(): void {
    if (this.#flushTimer) clearTimeout(this.#flushTimer)
    this.#flushTimer = undefined
    if (!this.#pendingOutput) return
    const pending = this.#pendingOutput
    this.#pendingOutput = ''
    this.#pendingOutputBytes = 0
    for (const data of splitUtf8Chunks(pending, OUTPUT_FLUSH_BYTES)) {
      // 有界缓冲始终是唯一队列：即使窗口打满也先入队（必要时淘汰最旧），
      // 因此主进程内存不随积压增长。
      const chunk = this.#buffer.append(data)
      this.#requestMirrorChunk(chunk)
    }
    this.#pumpOutput()
  }

  /**
   * 按 credit 窗口向渲染端发送尚未确认的 chunk；窗口打满时暂停 PTY，而不是把
   * 积压留在 IPC 队列。恢复由 ack 驱动，不额外增加定时唤醒。
   */
  #pumpOutput(): void {
    const oldest = this.#buffer.oldestSequence()
    // 缓冲淘汰过快时前移到仍可发送的最早序号；跳过的部分由渲染端按截断处理。
    if (this.#nextOutputSequence < oldest) this.#nextOutputSequence = oldest
    while (this.#sentCharacters < OUTPUT_CREDIT_HIGH_CHARACTERS) {
      const record = this.#buffer.at(this.#nextOutputSequence)
      if (!record) break
      this.#nextOutputSequence = record.sequence + 1
      this.#sentCharacters += record.data.length
      const { bytes: _bytes, ...chunk } = record
      this.#onEvent({ type: 'output', chunk })
    }
    this.#updateFlowControl()
  }

  /**
   * @param sequence 渲染端已解析完成的最大连续序号
   * @param characters 该区间已消费的字符数增量
   */
  ack(sequence: number, characters: number): void {
    if (this.#state !== 'running') return
    if (!Number.isSafeInteger(sequence) || sequence < 0) return
    if (!Number.isSafeInteger(characters) || characters < 0) return
    // ack 只能单调推进：重复或乱序的 ack 不得二次释放窗口额度。
    if (sequence < this.#ackedSequence) return
    this.#ackedSequence = sequence
    this.#lastConsumerActivityAt = Date.now()
    this.#sentCharacters = Math.max(0, this.#sentCharacters - characters)
    this.#pumpOutput()
  }

  /** 渲染端显式 attach：即使还没有 ack 也算活跃消费者。 */
  markConsumerAttached(): void {
    this.#lastConsumerActivityAt = Date.now()
  }

  #updateFlowControl(): void {
    if (this.#sentCharacters >= OUTPUT_CREDIT_HIGH_CHARACTERS) {
      this.#pauseForBackpressure()
      return
    }
    if (this.#paused) this.#resumeFromBackpressure()
  }

  #pauseForBackpressure(): void {
    if (this.#paused || this.#state !== 'running') return
    // 没有活跃消费者（面板隐藏/卸载）时不暂停：后台进程必须继续运行，积压由
    // 有界缓冲与截断提示承担，恢复显示时再按缺口对账。
    if (Date.now() - this.#lastConsumerActivityAt > CONSUMER_ACTIVITY_MS) return
    this.#paused = true
    try {
      this.#pty.pause()
    } catch {
      // PTY 可能已退出；暂停失败不影响有界缓冲的正确性。
    }
    this.#armFlowControlWatchdog()
  }

  #resumeFromBackpressure(): void {
    this.#paused = false
    if (this.#flowControlTimer) clearTimeout(this.#flowControlTimer)
    this.#flowControlTimer = undefined
    try {
      this.#pty.resume()
    } catch {
      // 恢复失败只影响吞吐，不影响顺序与内存上界。
    }
  }

  /** 消费者在暂停期间消失时超时恢复 PTY，避免后台进程被静默卡住。 */
  #armFlowControlWatchdog(): void {
    if (this.#flowControlTimer) clearTimeout(this.#flowControlTimer)
    this.#flowControlTimer = setTimeout(() => {
      this.#flowControlTimer = undefined
      if (!this.#paused) return
      if (Date.now() - this.#lastConsumerActivityAt > CONSUMER_ACTIVITY_MS) {
        this.#resumeFromBackpressure()
        return
      }
      this.#armFlowControlWatchdog()
    }, CONSUMER_ACTIVITY_MS)
    this.#flowControlTimer.unref()
  }

  #clearFlowControl(): void {
    this.#paused = false
    if (this.#flowControlTimer) clearTimeout(this.#flowControlTimer)
    this.#flowControlTimer = undefined
  }

  #handleExit(exitCode: number): void {
    this.#flushOutput()
    this.#clearFlowControl()
    this.#exitCode = exitCode
    if (!this.#exitReason) this.#exitReason = 'process-exit'
    this.#setState('exited')
    this.#requestMirrorReset()
    this.#resolveExit?.()
    this.#resolveExit = undefined
  }

  #setState(state: DesktopTerminalState): void {
    this.#state = state
    this.#onEvent({
      type: 'state',
      terminalId: this.terminalId,
      instanceId: this.instanceId,
      state,
      exitCode: this.#exitCode,
      exitReason: this.#exitReason,
    })
  }

  #mirrorIdentity(): {
    threadId: string
    terminalId: string
    instanceId: string
  } {
    return {
      threadId: this.context.threadId,
      terminalId: this.terminalId,
      instanceId: this.instanceId,
    }
  }

  async #resetMirrorNow(): Promise<void> {
    if (!this.#mirrorSink) return
    const replay = this.#buffer.replay(-1)
    await this.#mirrorSink.reset({
      ...this.#mirrorIdentity(),
      oldestSequence: replay.oldestSequence,
      nextSequence: replay.nextSequence,
      chunks: replay.chunks,
      state: this.#state,
      exitCode: this.#exitCode,
    })
    this.#mirrorNextSequence = replay.nextSequence
    this.#mirrorStale = false
  }

  #requestMirrorReset(): void {
    if (!this.#mirrorSink || this.#mirrorClosing) return
    this.#mirrorPendingReset = true
    this.#mirrorPendingChunk = undefined
    this.#pumpMirror()
  }

  #requestMirrorChunk(chunk: DesktopTerminalChunk): void {
    if (!this.#mirrorSink || this.#mirrorClosing) return
    if (
      this.#mirrorInFlight ||
      this.#mirrorPendingReset ||
      this.#mirrorPendingChunk ||
      this.#mirrorStale ||
      chunk.sequence !== this.#mirrorNextSequence
    ) {
      // The bounded local buffer is authoritative. Once the mirror falls
      // behind, one latest reset replaces any number of pending appends.
      this.#mirrorPendingReset = true
      this.#mirrorPendingChunk = undefined
    } else {
      this.#mirrorPendingChunk = chunk
    }
    this.#pumpMirror()
  }

  #pumpMirror(): void {
    if (!this.#mirrorSink || this.#mirrorClosing || this.#mirrorInFlight) return
    let operation: (() => Promise<void>) | undefined
    if (this.#mirrorPendingReset || this.#mirrorStale) {
      this.#mirrorPendingReset = false
      this.#mirrorPendingChunk = undefined
      operation = () => this.#resetMirrorNow()
    } else if (this.#mirrorPendingChunk) {
      const chunk = this.#mirrorPendingChunk
      this.#mirrorPendingChunk = undefined
      if (chunk.sequence < this.#mirrorNextSequence) {
        this.#pumpMirror()
        return
      }
      if (chunk.sequence > this.#mirrorNextSequence) {
        operation = () => this.#resetMirrorNow()
      } else {
        operation = async () => {
          await this.#mirrorSink!.append({
            threadId: this.context.threadId,
            chunk,
          })
          this.#mirrorNextSequence = chunk.sequence + 1
        }
      }
    }
    if (!operation) return
    const inFlight = operation()
      .catch(() => {
        if (!this.#mirrorClosing) this.#mirrorStale = true
      })
      .finally(() => {
        if (this.#mirrorInFlight === inFlight) this.#mirrorInFlight = undefined
        if (!this.#mirrorClosing && (this.#mirrorPendingReset || this.#mirrorPendingChunk)) {
          this.#pumpMirror()
        }
      })
    this.#mirrorInFlight = inFlight
  }

  async #clearMirrorAndDispose(): Promise<void> {
    if (this.#flushTimer) clearTimeout(this.#flushTimer)
    this.#flushTimer = undefined
    this.#clearFlowControl()
    this.#flushOutput()
    // clear is authoritative for a closing instance. Pending work is bounded to
    // a single in-flight call; everything else is superseded by this tombstone.
    this.#mirrorClosing = true
    this.#mirrorPendingChunk = undefined
    this.#mirrorPendingReset = false
    for (const subscription of this.#subscriptions.splice(0)) subscription.dispose()
    const inFlight = this.#mirrorInFlight
    const drained = inFlight ? await waitBounded(inFlight, MIRROR_DRAIN_TIMEOUT_MS) : true
    if (this.#mirrorSink) {
      const identity = this.#mirrorIdentity()
      const mirrorSink = this.#mirrorSink
      await waitBounded(
        mirrorSink.clear(identity).catch(() => undefined),
        MIRROR_CLEAR_TIMEOUT_MS,
      )
      if (!drained && inFlight) {
        // A late reset/append must not resurrect a closed terminal. This
        // compensation retains IDs only; no output, command, cwd or env.
        void inFlight.finally(() => mirrorSink.clear(identity)).catch(() => undefined)
      }
    }
    this.#buffer.clear()
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function waitBounded(promise: Promise<unknown>, milliseconds: number): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    delay(milliseconds).then(() => false),
  ])
}

function splitUtf8Chunks(value: string, maximumBytes: number): string[] {
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0
  for (const character of value) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (currentBytes + bytes > maximumBytes && current) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }
    current += character
    currentBytes += bytes
  }
  if (current) chunks.push(current)
  return chunks
}
