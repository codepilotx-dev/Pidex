import { AgentError } from '../Domain'

export type TurnTerminalStatus = 'completed' | 'failed' | 'interrupted'

export type ActiveTurnHandle = {
  threadID: string
  turnID: string
  controller: AbortController
  runtimeReady: boolean
  acceptingSteer: boolean
  dispatchedSteerIDs: Set<string>
  terminal: Promise<TurnTerminalStatus>
}

type InternalTurnHandle = ActiveTurnHandle & {
  resolveTerminal: (status: TurnTerminalStatus) => void
}

/**
 * Serializes short admission/terminal transitions per thread without holding a
 * lock for the lifetime of a model run. SQLite remains the durable source of
 * truth; this registry only owns live-process runtime state.
 */
export class TurnCoordinator {
  private readonly handles = new Map<string, InternalTurnHandle>()
  private readonly gates = new Map<string, Promise<void>>()

  async exclusive<T>(threadID: string, operation: () => Promise<T> | T): Promise<T> {
    const previous = this.gates.get(threadID) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.catch(() => undefined).then(() => current)
    this.gates.set(threadID, queued)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.gates.get(threadID) === queued) this.gates.delete(threadID)
    }
  }

  active(threadID: string): ActiveTurnHandle | null {
    return this.handles.get(threadID) ?? null
  }

  reserve(threadID: string, turnID: string): ActiveTurnHandle {
    const existing = this.handles.get(threadID)
    if (existing) {
      if (existing.turnID !== turnID)
        throw new AgentError('TURN_ACTIVE', '当前 Thread 已有运行中的 Turn', 409)
      return existing
    }
    let resolveTerminal!: (status: TurnTerminalStatus) => void
    const terminal = new Promise<TurnTerminalStatus>((resolve) => {
      resolveTerminal = resolve
    })
    const handle: InternalTurnHandle = {
      threadID,
      turnID,
      controller: new AbortController(),
      runtimeReady: false,
      acceptingSteer: true,
      dispatchedSteerIDs: new Set<string>(),
      terminal,
      resolveTerminal,
    }
    this.handles.set(threadID, handle)
    return handle
  }

  markRuntimeReady(threadID: string, turnID: string): ActiveTurnHandle {
    const handle = this.require(threadID, turnID)
    handle.runtimeReady = true
    return handle
  }

  closeAdmission(threadID: string, turnID: string): ActiveTurnHandle {
    const handle = this.require(threadID, turnID)
    handle.acceptingSteer = false
    return handle
  }

  release(threadID: string, turnID: string): void {
    const handle = this.handles.get(threadID)
    if (handle?.turnID === turnID) this.handles.delete(threadID)
  }

  finish(threadID: string, turnID: string, status: TurnTerminalStatus): void {
    const handle = this.handles.get(threadID)
    if (!handle || handle.turnID !== turnID) return
    this.handles.delete(threadID)
    handle.acceptingSteer = false
    handle.resolveTerminal(status)
  }

  private require(threadID: string, turnID: string): InternalTurnHandle {
    const handle = this.handles.get(threadID)
    if (!handle || handle.turnID !== turnID) {
      throw new AgentError('TURN_ID_MISMATCH', '活动 Turn 已变化，请刷新后重试', 409)
    }
    return handle
  }
}
