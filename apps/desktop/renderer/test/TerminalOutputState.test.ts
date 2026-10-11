import { describe, expect, test } from 'bun:test'
import type {
  DesktopTerminalChunk,
  DesktopTerminalSnapshot,
} from '@pidex/shared/desktop-terminal-ipc'
import {
  consumeTerminalEvent,
  consumeTerminalSnapshot,
  createTerminalOutputState,
} from '../src/features/terminal/TerminalOutputState.js'

const chunk = (sequence: number, data = String(sequence)): DesktopTerminalChunk => ({
  terminalId: 'terminal-1',
  instanceId: 'instance-1',
  sequence,
  data,
})

function snapshot(
  chunks: readonly DesktopTerminalChunk[],
  overrides: Partial<DesktopTerminalSnapshot> = {},
): DesktopTerminalSnapshot {
  return {
    terminalId: 'terminal-1',
    instanceId: 'instance-1',
    threadId: 'thread-1',
    profileId: 'windows-pwsh',
    state: 'running',
    oldestSequence: chunks.length ? Math.min(...chunks.map((item) => item.sequence)) : 0,
    nextSequence: chunks.length ? Math.max(...chunks.map((item) => item.sequence)) + 1 : 0,
    chunks,
    gap: false,
    truncated: false,
    contextChanged: false,
    exitCode: null,
    exitReason: null,
    ...overrides,
  }
}

describe('terminal output projection', () => {
  test('orders snapshot chunks and ignores duplicate live output', () => {
    const initial = consumeTerminalSnapshot(
      createTerminalOutputState(),
      snapshot([chunk(1), chunk(0)]),
    )
    expect(initial.reset).toBe(true)
    expect(initial.chunks.map((item) => item.sequence)).toEqual([0, 1])
    expect(initial.state.nextSequence).toBe(2)

    const duplicate = consumeTerminalEvent(initial.state, {
      type: 'output',
      chunk: chunk(1),
    })
    expect(duplicate.chunks).toEqual([])
    expect(duplicate.replayRequired).toBe(false)
  })

  test('requests replay when a live chunk skips a sequence', () => {
    const initial = consumeTerminalSnapshot(createTerminalOutputState(), snapshot([chunk(0)]))
    const update = consumeTerminalEvent(initial.state, {
      type: 'output',
      chunk: chunk(2),
    })

    expect(update.chunks).toEqual([])
    expect(update.replayRequired).toBe(true)
    expect(update.state.nextSequence).toBe(1)
  })

  test('resets output for a new instance and records exit state', () => {
    const initial = consumeTerminalSnapshot(createTerminalOutputState(), snapshot([chunk(0)]))
    const restarted = consumeTerminalSnapshot(
      initial.state,
      snapshot([], {
        instanceId: 'instance-2',
        oldestSequence: 0,
        nextSequence: 0,
      }),
    )
    expect(restarted.reset).toBe(true)

    const exited = consumeTerminalEvent(restarted.state, {
      type: 'state',
      terminalId: 'terminal-1',
      instanceId: 'instance-2',
      state: 'exited',
      exitCode: 7,
      exitReason: 'process-exit',
    })
    expect(exited.state.state).toBe('exited')
    expect(exited.state.exitCode).toBe(7)
  })

  test('adopts a truncated snapshot from its oldest sequence and surfaces truncation', () => {
    const initial = consumeTerminalSnapshot(createTerminalOutputState(), snapshot([chunk(0)]))
    // 有界缓冲淘汰了最旧的输出：从仍可用的最早序号继续，并明确告知已截断。
    const truncated = consumeTerminalSnapshot(
      initial.state,
      snapshot([chunk(8), chunk(9)], {
        gap: true,
        truncated: true,
        oldestSequence: 8,
        nextSequence: 10,
      }),
    )

    expect(truncated.reset).toBe(true)
    expect(truncated.replayRequired).toBe(false)
    expect(truncated.chunks.map((item) => item.sequence)).toEqual([8, 9])
    expect(truncated.state.truncated).toBe(true)
    expect(truncated.state.nextSequence).toBe(10)
  })
})
