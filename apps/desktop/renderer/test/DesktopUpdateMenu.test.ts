import { describe, expect, test } from 'bun:test'
import type { DesktopUpdateIpcBridge, DesktopUpdateStatus } from '@pidex/shared/desktop-update-ipc'
import {
  buildDesktopUpdateIndicatorModel,
  runDesktopUpdateIndicatorAction,
  startDesktopUpdateMonitoring,
} from '../src/features/layout/sidebar/DesktopUpdateMenu'

describe('桌面更新状态胶囊', () => {
  test('先订阅状态，再发起首次检查', () => {
    const calls: string[] = []
    const bridge = createBridge(calls)

    const unsubscribe = startDesktopUpdateMonitoring(bridge, () => {})

    expect(calls).toEqual(['subscribe', 'check'])
    unsubscribe()
    expect(calls).toEqual(['subscribe', 'check', 'unsubscribe'])
  })

  test('所有状态映射为对应的可见性、文字和动作', () => {
    expect(buildDesktopUpdateIndicatorModel(null)).toMatchObject({
      action: null,
      ariaLabel: '',
      disabled: false,
      label: '',
      visible: false,
    })
    expect(buildDesktopUpdateIndicatorModel({ phase: 'no-update' })).toMatchObject({
      action: null,
      ariaLabel: '',
      disabled: false,
      label: '',
      visible: false,
    })
    expect(buildDesktopUpdateIndicatorModel({ phase: 'checking' })).toMatchObject({
      action: null,
      ariaLabel: '正在检查应用更新',
      disabled: true,
      label: '检查中',
      visible: true,
    })
    expect(
      buildDesktopUpdateIndicatorModel({
        phase: 'available',
        version: '0.2.0-beta.5',
      }),
    ).toMatchObject({
      action: 'download',
      ariaLabel: '有新版本 0.2.0-beta.5 可用，下载更新',
      disabled: false,
      label: '更新',
      visible: true,
    })
    expect(
      buildDesktopUpdateIndicatorModel({
        phase: 'downloading',
        percent: 42.5,
      }),
    ).toMatchObject({
      action: null,
      ariaLabel: '正在下载应用更新，43%',
      disabled: true,
      label: '43%',
      visible: true,
    })
    expect(buildDesktopUpdateIndicatorModel({ phase: 'downloaded' })).toMatchObject({
      action: 'quit-and-install',
      ariaLabel: '更新已下载，重启并安装',
      disabled: false,
      label: '重启',
      visible: true,
    })
    expect(
      buildDesktopUpdateIndicatorModel({
        phase: 'error',
        message: 'safe error',
      }),
    ).toMatchObject({
      action: 'check',
      ariaLabel: '检查更新失败，重试',
      disabled: false,
      label: '重试',
      visible: true,
    })
  })

  test('更新、重启和重试路由到对应 bridge 方法', async () => {
    const calls: string[] = []
    const bridge = createBridge(calls)
    await runDesktopUpdateIndicatorAction(bridge, 'check')
    await runDesktopUpdateIndicatorAction(bridge, 'download')
    await runDesktopUpdateIndicatorAction(bridge, 'quit-and-install')
    expect(calls).toEqual(['check', 'download', 'install'])
  })
})

function createBridge(calls: string[]): DesktopUpdateIpcBridge {
  return {
    checkForUpdates: async () => {
      calls.push('check')
    },
    downloadUpdate: async () => {
      calls.push('download')
    },
    quitAndInstall: async () => {
      calls.push('install')
    },
    onUpdateStatusChange: (_listener: (status: DesktopUpdateStatus) => void) => {
      calls.push('subscribe')
      return () => {
        calls.push('unsubscribe')
      }
    },
  }
}
