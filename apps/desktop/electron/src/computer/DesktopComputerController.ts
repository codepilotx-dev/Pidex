import { randomUUID } from 'node:crypto'
import type {
  ComputerAction,
  ComputerCommand,
  ComputerResult,
  ComputerWindow,
  ComputerIdentity,
} from '@pidex/agent-protocol'
import { CpxCuaRuntime, type CpxCuaToolResult } from './CpxCuaRuntime.js'
import { ComputerHostRpcClient } from './ComputerHostRpcClient.js'
import type { DesktopLogger } from '../logging/DesktopLogger.js'
import type { SidecarSupervisor } from '../sidecar/Supervisor.js'

export type DesktopComputerControllerOptions = {
  getSupervisor: () => SidecarSupervisor | undefined
  resolveExecutable: () => string | undefined
  logger: DesktopLogger
}

type Host = {
  instanceId: string
  registered: boolean
  stopped: boolean
  timer?: ReturnType<typeof setTimeout>
}

type NativeWindow = {
  appId: string
  processKey: string
  identity: ComputerIdentity
  pid: number
  windowId: string
  name: string
}
export type ComputerRuntime = Pick<CpxCuaRuntime, 'start' | 'stop' | 'callTool'>
export type ComputerHostClient = Pick<ComputerHostRpcClient, 'call' | 'invalidate'>

const IDLE_POLL_MS = 1_000

/**
 * Desktop-side computer host: bridges Agent computer commands to the CPX-CUA
 * native runtime and back.
 *
 * The host owns window reference minting. References are opaque IDs it issued
 * for a specific (application, process generation, HWND) triple, so a model can
 * never name a window the user did not authorize through discovery.
 */
export class DesktopComputerController {
  readonly #rpc: ComputerHostClient
  readonly #runtime: ComputerRuntime
  readonly #windows = new Map<string, NativeWindow>()
  #host?: Host
  #generation?: string
  #disposed = false
  #ready = false
  #activating?: Promise<void>
  #executing?: Promise<void>

  constructor(
    private readonly options: DesktopComputerControllerOptions,
    dependencies?: { rpc: ComputerHostClient; runtime: ComputerRuntime },
  ) {
    this.#rpc = dependencies?.rpc ?? new ComputerHostRpcClient(options.getSupervisor)
    this.#runtime =
      dependencies?.runtime ??
      new CpxCuaRuntime(options.resolveExecutable, options.logger, () => this.#runtimeLost())
  }

  /** Registers with the Agent and starts draining computer commands. */
  async ensure(): Promise<void> {
    if (this.#disposed) return
    const host = this.#host ?? this.#createHost()
    if (host.registered) return
    try {
      await this.#rpc.call('computer/host/registerIdentity', {
        instanceId: host.instanceId,
        available: this.#ready,
      })
      if (this.#disposed || this.#host !== host) return
      host.registered = true
      this.#poll()
    } catch {
      if (this.#disposed || this.#host !== host) return
      // The Agent may not be listening yet; retry until it accepts the host.
      host.timer = setTimeout(() => void this.ensure(), IDLE_POLL_MS)
    }
  }

  /** Agent transport was replaced or the Agent restarted: every reference is stale. */
  invalidate(): void {
    this.#rpc.invalidate()
    const host = this.#host
    if (host) {
      host.registered = false
      clearTimeout(host.timer)
    }
    this.#releaseNativeState()
  }

  dispose(): void {
    this.#disposed = true
    const host = this.#host
    this.#host = undefined
    if (host) {
      host.stopped = true
      clearTimeout(host.timer)
      void this.#rpc.call('computer/host/release', { instanceId: host.instanceId }).catch(() => {})
    }
    this.#releaseNativeState()
  }

  #createHost(): Host {
    const host: Host = { instanceId: randomUUID(), registered: false, stopped: false }
    this.#host = host
    return host
  }

  #runtimeLost(): void {
    const host = this.#host
    this.#releaseNativeState()
    if (!host || this.#disposed) return
    host.registered = false
    void this.#rpc
      .call('computer/host/release', { instanceId: host.instanceId })
      .catch(() => undefined)
  }

  /**
   * A new generation means the Agent dropped control (turn ended, stop pressed,
   * timeout, host release). Native snapshot tokens and captures belong to the
   * old generation, so the driver process is retired instead of reused.
   */
  #releaseNativeState(): void {
    this.#ready = false
    this.#generation = undefined
    this.#windows.clear()
    this.#runtime.stop()
  }

  #poll(): void {
    const host = this.#host
    if (this.#disposed || !host || host.stopped) return
    const instanceId = host.instanceId
    void this.#rpc
      .call('computer/host/next', {
        instanceId,
        ...(this.#generation ? { generation: this.#generation } : {}),
      })
      .then(async (result) => {
        if (this.#disposed || this.#host !== host || instanceId !== host.instanceId) return
        if (result.generation !== this.#generation) {
          this.#releaseNativeState()
          this.#generation = result.generation
        }
        if (!result.enabled) {
          this.#releaseNativeState()
          return
        }
        if (!this.#ready && !this.#activating && !this.#executing) {
          const generation = this.#generation
          this.#activating = this.#runtime
            .start()
            .then(async () => {
              if (this.#disposed || this.#host !== host || this.#generation !== generation) return
              this.#ready = true
              await this.#rpc.call('computer/host/registerIdentity', {
                instanceId,
                available: true,
              })
            })
            .catch(async () => {
              if (this.#host !== host || this.#generation !== generation) return
              this.#releaseNativeState()
              await this.#rpc
                .call('computer/host/registerIdentity', { instanceId, available: false })
                .catch(() => undefined)
            })
            .finally(() => {
              this.#activating = undefined
            })
        }
        // Keep polling while native work runs so stop can retire the process.
        if (result.command) {
          const command = result.command
          const previous = this.#executing
          const executing = (async () => {
            await previous
            if (!this.#disposed && command.generation === this.#generation)
              await this.#execute(instanceId, command)
          })().finally(() => {
            if (this.#executing === executing) this.#executing = undefined
          })
          this.#executing = executing
        }
      })
      .catch(() => {
        if (this.#host !== host) return
        host.registered = false
        this.#releaseNativeState()
      })
      .finally(() => {
        if (this.#disposed || this.#host !== host || host.stopped) return
        host.timer = setTimeout(
          () => {
            if (host.registered) this.#poll()
            else void this.ensure()
          },
          this.#ready && host.registered ? 0 : IDLE_POLL_MS,
        )
      })
  }

  async #execute(instanceId: string, command: ComputerCommand): Promise<void> {
    let failed = false
    const result = await this.#dispatch(command).catch((): ComputerResult => {
      failed = true
      return {
        text: '电脑运行时连接失效或超时；结果不确定，请重新发现应用。',
        isError: true,
        code: 'computer_runtime_lost',
      }
    })
    if (command.generation !== this.#generation || this.#disposed) return
    try {
      await this.#rpc.call('computer/host/complete', {
        instanceId,
        requestId: command.requestId,
        generation: command.generation,
        result,
      })
    } catch {
      // The Agent owns timeout and no-replay semantics; a lost completion is
      // never retried from the host.
    }
    if (failed && command.generation === this.#generation) {
      this.#releaseNativeState()
      await this.#rpc.call('computer/host/release', { instanceId }).catch(() => undefined)
      if (this.#host?.instanceId === instanceId) this.#host.registered = false
    }
  }

  async #dispatch(command: ComputerCommand): Promise<ComputerResult> {
    if (command.kind === 'list') return this.#list(command.generation)
    const window = this.#resolveWindow(command)
    if (command.kind === 'read') return this.#read(command, window)
    return this.#act(command, window)
  }

  #resolveWindow(command: ComputerCommand): NativeWindow {
    if (!command.window) throw new Error('电脑命令缺少窗口引用，请重新发现并读取应用')
    const issued = this.#windows.get(command.window.ref)
    if (!issued) throw new Error('窗口引用已失效，请重新发现应用')
    if (!matchesIssuedWindow(issued, command.window))
      throw new Error('窗口身份已变化，请重新发现应用')
    return issued
  }

  async #list(generation: string): Promise<ComputerResult> {
    const raw = await this.#runtime.callTool('cpx_apps', {})
    if (generation !== this.#generation) throw new Error('电脑发现已取消')
    if (raw.isError) return toResult(raw)
    const discovered = ((raw.structuredContent?.windows ?? []) as NativeWindow[]).flatMap(
      (entry) =>
        typeof entry.pid === 'number' && entry.appId && entry.windowId && entry.identity
          ? [{ ...entry, windowId: String(entry.windowId) }]
          : [],
    )
    this.#windows.clear()
    const windows: ComputerWindow[] = discovered.map((entry) => {
      const ref = randomUUID()
      this.#windows.set(ref, entry)
      return { ref, ...entry }
    })
    return { text: `发现 ${windows.length} 个可读取窗口。`, windows }
  }

  async #read(command: ComputerCommand, window: NativeWindow): Promise<ComputerResult> {
    const raw = await this.#runtime.callTool('get_window_state', {
      session: command.session,
      pid: window.pid,
      window_id: Number(window.windowId),
      cpx_app_id: window.appId,
      cpx_process_key: window.processKey,
      cpx_fingerprint: window.identity.fingerprint,
      cpx_window_id: window.windowId,
      include_accessibility_tree: true,
      include_screenshot: true,
    })
    const structured = raw.structuredContent ?? {}
    const elements = Array.isArray(structured.elements) ? structured.elements : []
    const tokens = elements.flatMap((element: { element_token?: unknown }) =>
      typeof element.element_token === 'string' ? [element.element_token] : [],
    )
    return {
      ...toResult(raw),
      ...(typeof structured.snapshot_id === 'string' ? { snapshotId: structured.snapshot_id } : {}),
      ...(typeof structured.capture_id === 'string' ? { captureId: structured.capture_id } : {}),
      ...(tokens.length ? { elementTokens: tokens } : {}),
    }
  }

  async #act(command: ComputerCommand, window: NativeWindow): Promise<ComputerResult> {
    const operation = command.operation
    if (!operation) throw new Error('电脑命令缺少操作内容')
    // Coordinates must be grounded in a screenshot. The Agent already enforces
    // this; the host re-checks so a forged command cannot address raw pixels.
    if (!operation.elementToken && !command.captureId)
      throw new Error('坐标操作缺少关联截图，请重新读取窗口')
    const [name, args] = nativeAction(operation, command, window)
    return toResult(await this.#runtime.callTool(name, args))
  }
}

/** The host only acts on a window whose identity still matches the one it issued. */
export const matchesIssuedWindow = (
  issued: NativeWindow,
  claimed: {
    appId: string
    pid: number
    windowId: string
    processKey: string
    identity?: ComputerIdentity
  },
): boolean =>
  issued.appId === claimed.appId &&
  issued.pid === claimed.pid &&
  issued.windowId === claimed.windowId &&
  issued.processKey === claimed.processKey &&
  JSON.stringify(issued.identity) === JSON.stringify(claimed.identity)

/**
 * Maps one agent operation onto the native tool that implements it.
 *
 * Native schemas are `additionalProperties: false` and differ per tool: only
 * `click` accepts `capture_id`, and `drag` has no element form at all. Each
 * branch therefore sends exactly the fields its tool declares.
 */
export const nativeAction = (
  operation: ComputerAction,
  command: ComputerCommand,
  window: NativeWindow,
): [string, Record<string, unknown>] => {
  const base: Record<string, unknown> = {
    session: command.session,
    pid: window.pid,
    cpx_app_id: window.appId,
    cpx_process_key: window.processKey,
    cpx_fingerprint: window.identity.fingerprint,
    cpx_window_id: window.windowId,
    delivery_mode: operation.delivery,
  }
  if (operation.action === 'drag')
    return [
      'drag',
      {
        ...base,
        from_x: operation.x,
        window_id: Number(window.windowId),
        from_y: operation.y,
        to_x: operation.endX,
        to_y: operation.endY,
      },
    ]
  const target = operation.elementToken
    ? { element_token: operation.elementToken }
    : {
        window_id: Number(window.windowId),
        ...(operation.x === undefined ? {} : { x: operation.x }),
        ...(operation.y === undefined ? {} : { y: operation.y }),
      }
  switch (operation.action) {
    case 'click':
      return [
        'click',
        {
          ...base,
          ...target,
          // Native capture admission needs coordinates, so it only applies to
          // the coordinate form of the click.
          ...(command.captureId && operation.x !== undefined && !operation.elementToken
            ? { capture_id: command.captureId }
            : {}),
        },
      ]
    case 'double_click':
      return ['double_click', { ...base, ...target }]
    case 'right_click':
      return ['right_click', { ...base, ...target }]
    case 'type_text':
      return ['type_text', { ...base, ...target, text: operation.text }]
    case 'press_key':
      return [
        'press_key',
        {
          ...base,
          ...target,
          key: operation.key,
          ...(operation.keys ? { modifiers: operation.keys } : {}),
        },
      ]
    case 'hotkey':
      return ['hotkey', { ...base, ...target, keys: operation.keys }]
    case 'scroll':
      return [
        'scroll',
        {
          ...base,
          ...target,
          direction: operation.direction,
          ...(operation.amount === undefined ? {} : { amount: operation.amount }),
        },
      ]
  }
}

export const toResult = (raw: CpxCuaToolResult): ComputerResult => {
  const structured = raw.structuredContent ?? {}
  const images = (raw.content ?? []).flatMap((part) =>
    part.type === 'image' && part.data
      ? [{ data: part.data, mimeType: part.mimeType ?? 'image/png' }]
      : [],
  )
  const text = (raw.content ?? [])
    .flatMap((part) => (typeof part.text === 'string' ? [part.text] : []))
    .join('\n')
  const elements = Array.isArray(structured.elements)
    ? structured.elements.flatMap((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return []
        const element = entry as Record<string, unknown>
        if (typeof element.element_token !== 'string') return []
        return [
          {
            element_token: element.element_token,
            role: element.role,
            label: element.label,
            value: element.value,
            enabled: element.enabled,
            actions: element.actions,
            frame: element.frame,
          },
        ]
      })
    : []
  return {
    text: [
      text || (raw.isError ? 'CPX-CUA 未能完成请求' : '操作已完成'),
      ...(elements.length ? [`界面元素：\n${JSON.stringify(elements)}`] : []),
    ].join('\n'),
    ...(raw.isError ? { isError: true } : {}),
    ...(typeof structured.code === 'string' ? { code: structured.code } : {}),
    ...(images.length ? { images } : {}),
  }
}
