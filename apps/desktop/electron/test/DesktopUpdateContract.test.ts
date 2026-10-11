import { describe, expect, test } from 'bun:test'
import { DESKTOP_UPDATE_IPC_CHANNELS } from '@pidex/shared/desktop-update-ipc'

describe('桌面更新 IPC 契约', () => {
  test('集中维护检查、下载、安装和状态通道', () => {
    expect(DESKTOP_UPDATE_IPC_CHANNELS).toEqual({
      check: 'desktop-update:check',
      download: 'desktop-update:download',
      quitAndInstall: 'desktop-update:quit-and-install',
      status: 'desktop-update:status',
    })
  })
})
