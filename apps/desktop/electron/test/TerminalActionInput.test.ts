import { describe, expect, test } from 'bun:test'
import { requireRunTerminalActionInput } from '../src/ipc/TerminalActionInput'

describe('终端 Action typed IPC 输入', () => {
  test('renderer 只能提交 thread/action/profile/尺寸，拒绝 command、cwd 和 env', () => {
    const safe = {
      threadId: 'thread-1',
      actionName: 'Dev',
      profileId: null,
      cols: 80,
      rows: 24,
    }
    expect(requireRunTerminalActionInput(safe)).toEqual(safe)
    for (const forbidden of [
      { command: 'secret' },
      { cwd: 'C:\\outside' },
      { env: { TOKEN: 'secret' } },
    ]) {
      expect(() => requireRunTerminalActionInput({ ...safe, ...forbidden })).toThrow(
        'TERMINAL_CONTEXT_STALE',
      )
    }
  })
})
