import { describe, expect, test } from 'bun:test'
import type { DesktopTerminalIpcBridge } from '@pidex/shared/desktop-terminal-ipc'
import { createDesktopTerminalClient } from '../src/services/desktop-client/TerminalClient.js'

describe('desktop terminal client', () => {
  test('delegates to the typed bridge and closes the cached task terminal', async () => {
    const closeInputs: unknown[] = []
    const terminal = {
      terminalId: 'terminal-1',
      instanceId: 'instance-1',
      threadId: 'thread-1',
      profileId: 'windows-pwsh',
      state: 'running' as const,
      oldestSequence: 0,
      nextSequence: 0,
      chunks: [],
      gap: false,
      truncated: false,
      contextChanged: false,
      exitCode: null,
      exitReason: null,
      displayPath: 'repo',
    }
    const bridge = {
      listTerminalProfiles: async () => [],
      ensureTerminal: async () => terminal,
      attachTerminal: async () => terminal,
      writeTerminal: () => {},
      resizeTerminal: () => {},
      closeTerminal: async (input) => {
        closeInputs.push(input)
        return { ...terminal, state: 'exited', exitReason: 'user-close' }
      },
      closeTerminalForThread: async (input) => {
        closeInputs.push(input)
        return { closed: true }
      },
      runTerminalAction: async () => ({ ...terminal, instanceId: 'instance-action' }),
      onTerminalEvent: () => () => {},
    } satisfies Partial<DesktopTerminalIpcBridge>
    const client = createDesktopTerminalClient(bridge)

    await client.ensureTerminal({
      threadId: 'thread-1',
      profileId: null,
      cols: 80,
      rows: 24,
    })
    expect('getThreadAgentSharing' in client).toBe(false)
    expect('setTerminalAgentSharing' in client).toBe(false)
    await client.closeThreadTerminal('thread-1')

    expect(client.available).toBe(true)
    expect(closeInputs).toEqual([
      {
        threadId: 'thread-1',
        reason: 'user-close',
      },
    ])
  })

  test('keeps browser mock profile listing safe and rejects PTY creation', async () => {
    const client = createDesktopTerminalClient()
    expect(await client.listTerminalProfiles()).toEqual([])
    expect(client.available).toBe(false)
    await expect(
      client.ensureTerminal({
        threadId: 'thread-1',
        profileId: null,
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow('仅在 Pidex 桌面应用中可用')
  })
})
