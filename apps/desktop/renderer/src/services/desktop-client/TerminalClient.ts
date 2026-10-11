import type {
  AckDesktopTerminalOutputInput,
  AttachDesktopTerminalInput,
  CloseDesktopTerminalInput,
  DesktopTerminalEvent,
  DesktopTerminalIpcBridge,
  DesktopTerminalProfile,
  DesktopTerminalSnapshot,
  EnsureDesktopTerminalInput,
  ResizeDesktopTerminalInput,
  RunDesktopTerminalActionInput,
  WriteDesktopTerminalInput,
} from '@pidex/shared/desktop-terminal-ipc'
import { defaultDesktopClientEnvironment } from './Environment.js'

export type DesktopTerminalClient = DesktopTerminalIpcBridge & {
  available: boolean
  closeThreadTerminal(threadId: string, reason?: CloseDesktopTerminalInput['reason']): Promise<void>
}

export function createDesktopTerminalClient(
  bridge?: Partial<DesktopTerminalIpcBridge>,
): DesktopTerminalClient {
  const sessionsByThread = new Map<string, DesktopTerminalSnapshot>()
  const unavailable = (): never => {
    throw new Error('集成终端仅在 Pidex 桌面应用中可用。')
  }

  const ensureTerminal = async (
    input: EnsureDesktopTerminalInput,
  ): Promise<DesktopTerminalSnapshot> => {
    const snapshot = await (bridge?.ensureTerminal?.(input) ?? unavailable())
    sessionsByThread.set(input.threadId, snapshot)
    return snapshot
  }

  const attachTerminal = async (
    input: AttachDesktopTerminalInput,
  ): Promise<DesktopTerminalSnapshot> => {
    const snapshot = await (bridge?.attachTerminal?.(input) ?? unavailable())
    sessionsByThread.set(snapshot.threadId, snapshot)
    return snapshot
  }

  const closeTerminal = async (
    input: CloseDesktopTerminalInput,
  ): Promise<DesktopTerminalSnapshot> => {
    const snapshot = await (bridge?.closeTerminal?.(input) ?? unavailable())
    sessionsByThread.delete(snapshot.threadId)
    return snapshot
  }

  const runTerminalAction = async (
    input: RunDesktopTerminalActionInput,
  ): Promise<DesktopTerminalSnapshot> => {
    const snapshot = await (bridge?.runTerminalAction?.(input) ?? unavailable())
    sessionsByThread.set(input.threadId, snapshot)
    return snapshot
  }

  return {
    available: Boolean(
      bridge?.ensureTerminal &&
      bridge.attachTerminal &&
      bridge.writeTerminal &&
      bridge.resizeTerminal &&
      bridge.closeTerminal &&
      bridge.closeTerminalForThread &&
      bridge.runTerminalAction &&
      bridge.onTerminalEvent,
    ),
    listTerminalProfiles: async (): Promise<readonly DesktopTerminalProfile[]> =>
      bridge?.listTerminalProfiles?.() ?? [],
    ensureTerminal,
    attachTerminal,
    writeTerminal: (input: WriteDesktopTerminalInput): void => {
      if (!bridge?.writeTerminal) unavailable()
      bridge.writeTerminal(input)
    },
    resizeTerminal: (input: ResizeDesktopTerminalInput): void => {
      if (!bridge?.resizeTerminal) unavailable()
      bridge.resizeTerminal(input)
    },
    // 可选能力：旧版 Electron 没有 ack 通道时退化为无流量控制（输出仍按有界缓冲截断）。
    ackTerminalOutput: (input: AckDesktopTerminalOutputInput): void => {
      bridge?.ackTerminalOutput?.(input)
    },
    closeTerminal,
    runTerminalAction,
    closeTerminalForThread: async (input) => {
      const result = await (bridge?.closeTerminalForThread?.(input) ?? unavailable())
      sessionsByThread.delete(input.threadId)
      return result
    },
    onTerminalEvent: (listener: (event: DesktopTerminalEvent) => void): (() => void) =>
      bridge?.onTerminalEvent?.(listener) ?? (() => {}),
    closeThreadTerminal: async (threadId, reason = 'user-close'): Promise<void> => {
      if (bridge?.closeTerminalForThread) {
        await bridge.closeTerminalForThread({ threadId, reason })
      } else {
        const snapshot = sessionsByThread.get(threadId)
        if (snapshot) {
          await closeTerminal({
            terminalId: snapshot.terminalId,
            instanceId: snapshot.instanceId,
            reason,
          })
        }
      }
      sessionsByThread.delete(threadId)
    },
  }
}

const environment = defaultDesktopClientEnvironment()

export const terminalClient = createDesktopTerminalClient(environment.window?.DesktopBridge)
