export const DESKTOP_TERMINAL_IPC_CHANNELS = {
  listProfiles: 'desktop-terminal:list-profiles',
  ensure: 'desktop-terminal:ensure',
  attach: 'desktop-terminal:attach',
  write: 'desktop-terminal:write',
  resize: 'desktop-terminal:resize',
  close: 'desktop-terminal:close',
  closeThread: 'desktop-terminal:close-thread',
  runAction: 'desktop-terminal:run-action',
  event: 'desktop-terminal:event',
  ack: 'desktop-terminal:ack',
} as const

export type DesktopTerminalState = 'starting' | 'running' | 'closing' | 'exited' | 'failed'

export type DesktopTerminalExitReason =
  'process-exit' | 'user-close' | 'task-close' | 'workspace-delete' | 'app-quit' | 'launch-failed'

export interface DesktopTerminalProfile {
  id: string
  label: string
  available: boolean
  isDefault: boolean
  unavailableReason?: string
}

export interface DesktopTerminalChunk {
  terminalId: string
  instanceId: string
  sequence: number
  data: string
}

export interface DesktopTerminalSnapshot {
  terminalId: string
  instanceId: string
  threadId: string
  displayPath: string
  profileId: string
  state: DesktopTerminalState
  oldestSequence: number
  nextSequence: number
  chunks: readonly DesktopTerminalChunk[]
  gap: boolean
  truncated: boolean
  contextChanged: boolean
  exitCode: number | null
  exitReason: DesktopTerminalExitReason | null
}

export type DesktopTerminalEvent =
  | { type: 'output'; chunk: DesktopTerminalChunk }
  | {
      type: 'state'
      terminalId: string
      instanceId: string
      state: DesktopTerminalState
      exitCode: number | null
      exitReason: DesktopTerminalExitReason | null
    }

export interface EnsureDesktopTerminalInput {
  threadId: string
  terminalId?: string
  cwd?: string
  profileId: string | null
  cols: number
  rows: number
}

export interface AttachDesktopTerminalInput {
  terminalId: string
  instanceId: string
  afterSequence: number
}

export interface WriteDesktopTerminalInput {
  terminalId: string
  instanceId: string
  data: string
}

export interface ResizeDesktopTerminalInput {
  terminalId: string
  instanceId: string
  cols: number
  rows: number
}

export interface CloseDesktopTerminalInput {
  terminalId: string
  instanceId?: string
  reason: 'user-close' | 'task-close' | 'workspace-delete'
}

export interface CloseDesktopTerminalForThreadInput {
  threadId: string
  reason: 'user-close' | 'task-close' | 'workspace-delete'
}

export interface RunDesktopTerminalActionInput {
  threadId: string
  actionName: string
  profileId: string | null
  cols: number
  rows: number
}

/**
 * 渲染端已消费到的输出位置。`characters` 是该位置的字符数增量（与主进程的
 * `chunk.data.length` 同单位），用于主进程按窗口暂停/恢复 PTY；它只影响流量
 * 控制，不参与数据完整性判断。
 */
export interface AckDesktopTerminalOutputInput {
  terminalId: string
  instanceId: string
  sequence: number
  characters: number
}

export interface DesktopTerminalIpcBridge {
  listTerminalProfiles(): Promise<readonly DesktopTerminalProfile[]>
  ensureTerminal(input: EnsureDesktopTerminalInput): Promise<DesktopTerminalSnapshot>
  attachTerminal(input: AttachDesktopTerminalInput): Promise<DesktopTerminalSnapshot>
  writeTerminal(input: WriteDesktopTerminalInput): void
  resizeTerminal(input: ResizeDesktopTerminalInput): void
  /** 旧版 Electron 可能没有该方法，渲染端按可选能力使用。 */
  ackTerminalOutput?(input: AckDesktopTerminalOutputInput): void
  closeTerminal(input: CloseDesktopTerminalInput): Promise<DesktopTerminalSnapshot>
  closeTerminalForThread(input: CloseDesktopTerminalForThreadInput): Promise<{ closed: boolean }>
  runTerminalAction(input: RunDesktopTerminalActionInput): Promise<DesktopTerminalSnapshot>
  onTerminalEvent(listener: (event: DesktopTerminalEvent) => void): () => void
}
