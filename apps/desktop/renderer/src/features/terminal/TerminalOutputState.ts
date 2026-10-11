import type {
  DesktopTerminalChunk,
  DesktopTerminalEvent,
  DesktopTerminalSnapshot,
  DesktopTerminalState,
} from '@pidex/shared/desktop-terminal-ipc'

export type TerminalOutputState = {
  terminalId: string | null
  instanceId: string | null
  nextSequence: number
  state: DesktopTerminalState
  exitCode: number | null
  /**
   * 主进程缓冲因有界容量丢弃过最旧输出。渲染端据此给出明确的"已截断"提示，
   * 而不是让用户以为丢了数据或终端坏了。
   */
  truncated: boolean
}

export type TerminalOutputUpdate = {
  state: TerminalOutputState
  chunks: readonly DesktopTerminalChunk[]
  reset: boolean
  replayRequired: boolean
}

export function createTerminalOutputState(): TerminalOutputState {
  return {
    terminalId: null,
    instanceId: null,
    nextSequence: 0,
    state: 'starting',
    exitCode: null,
    truncated: false,
  }
}

export function consumeTerminalSnapshot(
  current: TerminalOutputState,
  snapshot: DesktopTerminalSnapshot,
): TerminalOutputUpdate {
  const instanceChanged =
    current.terminalId !== snapshot.terminalId || current.instanceId !== snapshot.instanceId
  const reset = instanceChanged || snapshot.gap
  let expected = reset ? snapshot.oldestSequence : current.nextSequence
  const chunks: DesktopTerminalChunk[] = []

  for (const chunk of [...snapshot.chunks].sort((left, right) => left.sequence - right.sequence)) {
    if (chunk.sequence < expected) continue
    if (chunk.sequence > expected) {
      return {
        state: {
          terminalId: snapshot.terminalId,
          instanceId: snapshot.instanceId,
          nextSequence: expected,
          state: snapshot.state,
          exitCode: snapshot.exitCode,
          truncated: snapshot.truncated,
        },
        chunks,
        reset,
        replayRequired: true,
      }
    }
    chunks.push(chunk)
    expected = chunk.sequence + 1
  }

  return {
    state: {
      terminalId: snapshot.terminalId,
      instanceId: snapshot.instanceId,
      nextSequence: Math.max(expected, snapshot.nextSequence),
      state: snapshot.state,
      exitCode: snapshot.exitCode,
      truncated: snapshot.truncated,
    },
    chunks,
    reset,
    replayRequired: false,
  }
}

export function consumeTerminalEvent(
  current: TerminalOutputState,
  event: DesktopTerminalEvent,
): TerminalOutputUpdate {
  const terminalId = event.type === 'output' ? event.chunk.terminalId : event.terminalId
  const instanceId = event.type === 'output' ? event.chunk.instanceId : event.instanceId
  if (terminalId !== current.terminalId || instanceId !== current.instanceId) {
    return { state: current, chunks: [], reset: false, replayRequired: false }
  }
  if (event.type === 'state') {
    return {
      state: {
        ...current,
        state: event.state,
        exitCode: event.exitCode,
      },
      chunks: [],
      reset: false,
      replayRequired: false,
    }
  }
  if (event.chunk.sequence < current.nextSequence) {
    return { state: current, chunks: [], reset: false, replayRequired: false }
  }
  if (event.chunk.sequence > current.nextSequence) {
    return { state: current, chunks: [], reset: false, replayRequired: true }
  }
  return {
    state: { ...current, nextSequence: current.nextSequence + 1 },
    chunks: [event.chunk],
    reset: false,
    replayRequired: false,
  }
}
