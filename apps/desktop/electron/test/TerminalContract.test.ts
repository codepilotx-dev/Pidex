import { describe, expect, test } from 'bun:test'
import { DESKTOP_TERMINAL_IPC_CHANNELS } from '@pidex/shared/desktop-terminal-ipc'

describe('集成终端 IPC 契约', () => {
  test('集中维护全部 typed preload 通道', () => {
    expect(DESKTOP_TERMINAL_IPC_CHANNELS).toEqual({
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
    })
  })
})
