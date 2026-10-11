import { describe, expect, test } from 'bun:test'

import {
  hasNonTerminalSessionStatus,
  withSessionStatusOverride,
} from '../src/services/desktop-client/SessionStatusOverrides.js'

describe('session status overrides', () => {
  test('keeps the row identity when there is nothing to change', () => {
    const running = {
      id: 'thread-1',
      status: 'running' as const,
      latestTurnStatus: 'running' as const,
    }

    expect(withSessionStatusOverride(running, undefined)).toBe(running)
    expect(
      withSessionStatusOverride(running, {
        status: 'running',
        latestTurnStatus: 'running',
      }),
    ).toBe(running)
  })

  test('replaces status and latest turn status for a covered thread', () => {
    const running = {
      id: 'thread-1',
      status: 'running' as const,
      latestTurnStatus: 'running' as const,
    }

    expect(
      withSessionStatusOverride(running, {
        status: 'done',
        latestTurnStatus: 'completed',
      }),
    ).toEqual({
      id: 'thread-1',
      status: 'done',
      latestTurnStatus: 'completed',
    })

    // A row without `latestTurnStatus` still compares against null.
    const bare = { id: 'thread-2', status: 'running' as const }
    expect(
      withSessionStatusOverride(bare, {
        status: 'done',
        latestTurnStatus: null,
      }),
    ).toEqual({ id: 'thread-2', status: 'done', latestTurnStatus: null })
  })

  test('only in-flight statuses keep the reconcile running', () => {
    const row = (status: 'queued' | 'waiting' | 'running' | 'done' | 'idle' | 'error') => ({
      id: `thread-${status}`,
      status,
    })

    expect(hasNonTerminalSessionStatus([])).toBe(false)
    expect(hasNonTerminalSessionStatus([row('done'), row('idle'), row('error')])).toBe(false)
    expect(hasNonTerminalSessionStatus([row('done'), row('running')])).toBe(true)
    expect(hasNonTerminalSessionStatus([row('waiting')])).toBe(true)
    expect(hasNonTerminalSessionStatus([row('queued')])).toBe(true)
  })
})
