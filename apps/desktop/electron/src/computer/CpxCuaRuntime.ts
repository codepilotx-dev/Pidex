import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { DesktopLogger } from '../logging/DesktopLogger.js'

/** MCP revision the native runtime negotiates; kept in lockstep with its protocol session. */
const MCP_PROTOCOL_VERSION = '2025-06-18'

/** Native MCP result payload, narrowed to the fields CPX-CUA consumes. */
export type CpxCuaToolResult = {
  content?: ReadonlyArray<{ type?: string; text?: string; data?: string; mimeType?: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export type CpxCuaExecutableResolver = (
  signal: AbortSignal,
  onDownloading: (progress?: number) => Promise<void>,
) => string | undefined | Promise<string | undefined>

type Pending = {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const START_TIMEOUT_MS = 20_000
/**
 * Bounded below the Agent's 30s command deadline so a wedged native call is
 * reported as a failure instead of outliving the control turn.
 */
const TOOL_TIMEOUT_MS = 25_000
const REQUIRED_TOOLS = [
  'cpx_apps',
  'get_window_state',
  'click',
  'double_click',
  'right_click',
  'type_text',
  'press_key',
  'hotkey',
  'scroll',
  'drag',
]

/**
 * Line-delimited JSON-RPC client for the CPX-CUA native stdio runtime.
 *
 * The runtime is a child process CPX owns and ships; this is internal native
 * transport, not a user-configurable MCP server, so it deliberately speaks the
 * MCP subset the runtime implements (initialize + tools/call) without pulling an
 * SDK into the Electron workspace.
 */
export class CpxCuaRuntime {
  #child?: ChildProcess
  #starting?: Promise<void>
  #preparing?: AbortController
  #pending = new Map<number, Pending>()
  #sequence = 0
  #buffer = ''
  #ready = false

  constructor(
    private readonly resolveExecutable: CpxCuaExecutableResolver,
    private readonly logger: DesktopLogger,
    private readonly onUnexpectedExit?: () => void,
    private readonly onPreparing?: (
      status: 'downloading' | 'starting',
      progress?: number,
    ) => Promise<void>,
  ) {}

  async start(): Promise<void> {
    if (this.#starting) return this.#starting
    if (this.#ready) return
    const preparing = new AbortController()
    this.#preparing = preparing
    this.#starting = this.#spawn(preparing.signal).finally(() => {
      this.#starting = undefined
    })
    return this.#starting
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CpxCuaToolResult> {
    await this.start()
    const result = await this.#request('tools/call', { name, arguments: args }, TOOL_TIMEOUT_MS)
    return result as CpxCuaToolResult
  }

  stop(): void {
    this.#preparing?.abort()
    this.#preparing = undefined
    const child = this.#child
    this.#child = undefined
    this.#ready = false
    this.#buffer = ''
    this.#reject(new Error('CPX-CUA 原生运行时已停止'))
    if (!child) return
    child.stdin?.end()
    child.kill()
  }

  async #spawn(signal: AbortSignal): Promise<void> {
    const executable = await this.resolveExecutable(signal, async (progress) => {
      signal.throwIfAborted()
      await this.onPreparing?.('downloading', progress)
    })
    signal.throwIfAborted()
    if (!executable || !existsSync(executable))
      throw new Error('未找到 CPX-CUA 原生运行时，请重新启用电脑控制插件')
    await this.onPreparing?.('starting')
    signal.throwIfAborted()
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.#child = child
    this.#buffer = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (this.#child === child) this.#consume(chunk)
    })
    // Native tracing output is diagnostics only; it never reaches the renderer.
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      if (chunk.trim()) this.logger.debug('computer.runtime-output', { bytes: chunk.length })
    })
    const failed = (reason: string) => {
      if (this.#child !== child) return
      const wasReady = this.#ready
      this.#child = undefined
      this.#ready = false
      this.#reject(new Error(reason))
      this.logger.warn('computer.runtime-exited', { reason })
      if (wasReady) this.onUnexpectedExit?.()
    }
    child.on('error', () => failed('CPX-CUA 启动失败'))
    child.on('exit', (code) => failed(`CPX-CUA 原生运行时已退出（${code ?? '未知'}）`))
    try {
      await this.#request(
        'initialize',
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'CPX-CUA Host', version: '1.0.0' },
        },
        START_TIMEOUT_MS,
      )
      this.#notify('notifications/initialized', {})
      const tools = await this.#request('tools/list', {}, START_TIMEOUT_MS)
      const names = new Set(
        Array.isArray(tools.tools)
          ? tools.tools.flatMap((tool: unknown) =>
              tool && typeof tool === 'object' && 'name' in tool && typeof tool.name === 'string'
                ? [tool.name]
                : [],
            )
          : [],
      )
      if (
        !Array.isArray(tools.tools) ||
        !tools.tools.some(
          (tool: any) => tool?.name === 'cpx_apps' && tool['x-cpx-identity-v1'] === true,
        )
      )
        throw new Error('CPX-CUA 缺少可信身份核验能力，请更新电脑控制运行时')
      if (REQUIRED_TOOLS.some((name) => !names.has(name)))
        throw new Error('CPX-CUA 缺少必需的原生能力')
      if (this.#child !== child) throw new Error('CPX-CUA 启动已取消')
      this.#ready = true
    } catch (error) {
      if (this.#child === child) this.stop()
      throw error
    }
    this.logger.info('computer.runtime-started', {})
  }

  #consume(chunk: string): void {
    this.#buffer += chunk
    let index = this.#buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.#buffer.slice(0, index).trim()
      this.#buffer = this.#buffer.slice(index + 1)
      if (line) this.#handle(line)
      index = this.#buffer.indexOf('\n')
    }
  }

  #handle(line: string): void {
    let message: { id?: number; result?: Record<string, unknown>; error?: { message?: string } }
    try {
      message = JSON.parse(line) as typeof message
    } catch {
      this.logger.warn('computer.runtime-unparsable-message', { bytes: line.length })
      return
    }
    if (typeof message.id !== 'number') return
    const pending = this.#pending.get(message.id)
    if (!pending) return
    this.#pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(message.error.message ?? 'CPX-CUA 调用失败'))
    else pending.resolve(message.result ?? {})
  }

  #reject(error: Error): void {
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id)
      clearTimeout(pending.timer)
      pending.reject(error)
    }
  }

  #notify(method: string, params: Record<string, unknown>): void {
    this.#child?.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  #request(
    method: string,
    params: Record<string, unknown>,
    timeout: number,
  ): Promise<Record<string, unknown>> {
    const id = ++this.#sequence
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        this.stop()
        reject(new Error('CPX-CUA 调用超时'))
      }, timeout)
      timer.unref?.()
      this.#pending.set(id, { resolve, reject, timer })
      this.#child?.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }
}
