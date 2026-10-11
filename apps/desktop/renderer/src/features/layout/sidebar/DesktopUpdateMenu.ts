import type { DesktopUpdateIpcBridge, DesktopUpdateStatus } from '@pidex/shared/desktop-update-ipc'

export type DesktopUpdateIndicatorAction = 'check' | 'download' | 'quit-and-install'

export type DesktopUpdateIndicatorModel = {
  action: DesktopUpdateIndicatorAction | null
  announcement: string
  ariaLabel: string
  disabled: boolean
  label: string
  phase: DesktopUpdateStatus['phase'] | null
  visible: boolean
}

export function startDesktopUpdateMonitoring(
  bridge: DesktopUpdateIpcBridge,
  listener: (status: DesktopUpdateStatus) => void,
): () => void {
  const unsubscribe = bridge.onUpdateStatusChange(listener)
  void bridge.checkForUpdates().catch(() => {
    listener({
      phase: 'error',
      message: '检查更新失败，请稍后重试',
    })
  })
  return unsubscribe
}

export function buildDesktopUpdateIndicatorModel(
  status: DesktopUpdateStatus | null,
): DesktopUpdateIndicatorModel {
  switch (status?.phase) {
    case 'available':
      return {
        action: 'download',
        announcement: `发现新版本 ${status.version}`,
        ariaLabel: `有新版本 ${status.version} 可用，下载更新`,
        disabled: false,
        label: '更新',
        phase: 'available',
        visible: true,
      }
    case 'downloading': {
      const percent = normalizeUpdatePercent(status.percent)
      return {
        action: null,
        announcement: `正在下载应用更新，${percent}%`,
        ariaLabel: `正在下载应用更新，${percent}%`,
        disabled: true,
        label: `${percent}%`,
        phase: 'downloading',
        visible: true,
      }
    }
    case 'downloaded':
      return {
        action: 'quit-and-install',
        announcement: '应用更新已下载，可以重启安装',
        ariaLabel: '更新已下载，重启并安装',
        disabled: false,
        label: '重启',
        phase: 'downloaded',
        visible: true,
      }
    case 'checking':
      return {
        action: null,
        announcement: '正在检查应用更新',
        ariaLabel: '正在检查应用更新',
        disabled: true,
        label: '检查中',
        phase: 'checking',
        visible: true,
      }
    case 'error':
      return {
        action: 'check',
        announcement: '检查更新失败，可以重试',
        ariaLabel: '检查更新失败，重试',
        disabled: false,
        label: '重试',
        phase: 'error',
        visible: true,
      }
    default:
      return {
        action: null,
        announcement: '',
        ariaLabel: '',
        disabled: false,
        label: '',
        phase: status?.phase ?? null,
        visible: false,
      }
  }
}

export async function runDesktopUpdateIndicatorAction(
  bridge: DesktopUpdateIpcBridge,
  action: DesktopUpdateIndicatorAction,
): Promise<void> {
  if (action === 'download') {
    await bridge.downloadUpdate()
    return
  }
  if (action === 'quit-and-install') {
    await bridge.quitAndInstall()
    return
  }
  await bridge.checkForUpdates()
}

function normalizeUpdatePercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0
  }
  return Math.round(Math.min(100, Math.max(0, percent)))
}
