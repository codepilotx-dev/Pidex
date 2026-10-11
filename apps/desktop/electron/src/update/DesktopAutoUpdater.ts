import type { DesktopUpdateStatus } from '@pidex/shared/desktop-update-ipc'
import type { DesktopLogger } from '../logging/DesktopLogger.js'

type UpdateEvent =
  | 'checking-for-update'
  | 'update-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'update-not-available'
  | 'error'

export interface ElectronAutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  channel: string | null
  logger: unknown
  on(event: UpdateEvent, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

interface DesktopAutoUpdaterOptions {
  packaged: boolean
  version: string
  logger: DesktopLogger
  onStatusChange: (status: DesktopUpdateStatus) => void
  updater: ElectronAutoUpdaterLike
}

type UpdateOperation = 'check' | 'download' | 'install' | null

export function resolveDesktopUpdateChannel(version: string): {
  channel: 'latest' | 'alpha' | 'beta' | 'rc'
  allowPrerelease: boolean
} {
  const match = version.match(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(alpha|beta|rc)\.(?:0|[1-9]\d*))?$/,
  )
  const prerelease = match?.[1] as 'alpha' | 'beta' | 'rc' | undefined
  return prerelease
    ? { channel: prerelease, allowPrerelease: true }
    : { channel: 'latest', allowPrerelease: false }
}

export class DesktopAutoUpdater {
  private readonly updater: ElectronAutoUpdaterLike
  private readonly active: boolean
  private status: DesktopUpdateStatus | null = null
  private operation: UpdateOperation = null
  private checkTask: Promise<void> | null = null
  private downloadTask: Promise<void> | null = null

  constructor(private readonly options: DesktopAutoUpdaterOptions) {
    this.updater = options.updater
    this.active = options.packaged
    if (!this.active) return

    const updateChannel = resolveDesktopUpdateChannel(options.version)
    this.updater.logger = null
    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = false
    this.updater.allowPrerelease = updateChannel.allowPrerelease
    this.updater.channel = updateChannel.channel
    this.bindEvents()
    options.logger.info('desktop.update.enabled', {
      channel: updateChannel.channel,
      version: options.version,
    })
  }

  async checkForUpdates(): Promise<void> {
    if (!this.active) {
      this.publish({ phase: 'no-update' })
      return
    }
    if (this.downloadTask) {
      throw new Error('更新正在下载，请稍后再试')
    }
    if (this.checkTask) return this.checkTask

    this.operation = 'check'
    this.publish({ phase: 'checking' })
    this.checkTask = this.updater
      .checkForUpdates()
      .then(() => undefined)
      .catch(() => {
        this.publishFailure('check')
      })
      .finally(() => {
        this.checkTask = null
        if (this.operation === 'check') this.operation = null
      })
    return this.checkTask
  }

  async downloadUpdate(): Promise<void> {
    if (!this.active) throw new Error('开发环境不支持应用更新')
    if (this.downloadTask) return this.downloadTask
    if (this.status?.phase !== 'available') {
      throw new Error('当前没有可下载的更新')
    }

    this.operation = 'download'
    this.publish({ phase: 'downloading', percent: 0 })
    this.downloadTask = this.updater
      .downloadUpdate()
      .then(() => undefined)
      .catch(() => {
        this.publishFailure('download')
      })
      .finally(() => {
        this.downloadTask = null
        if (this.operation === 'download') this.operation = null
      })
    return this.downloadTask
  }

  async quitAndInstall(): Promise<void> {
    if (!this.active) throw new Error('开发环境不支持应用更新')
    if (this.status?.phase !== 'downloaded') {
      throw new Error('更新尚未下载完成')
    }
    this.operation = 'install'
    try {
      this.updater.quitAndInstall()
    } catch {
      this.publishFailure('install')
    }
  }

  private bindEvents(): void {
    this.updater.on('checking-for-update', () => {
      this.operation = 'check'
      this.publish({ phase: 'checking' })
    })
    this.updater.on('update-available', (info: { version?: unknown }) => {
      const version = normalizeVersion(info?.version)
      if (!version) {
        this.publishFailure('check')
        return
      }
      this.operation = null
      this.publish({ phase: 'available', version })
    })
    this.updater.on('download-progress', (progress: { percent?: unknown }) => {
      const percent =
        typeof progress?.percent === 'number' && Number.isFinite(progress.percent)
          ? Math.min(100, Math.max(0, progress.percent))
          : 0
      this.publish({ phase: 'downloading', percent })
    })
    this.updater.on('update-downloaded', () => {
      this.operation = null
      this.publish({ phase: 'downloaded' })
    })
    this.updater.on('update-not-available', () => {
      this.operation = null
      this.publish({ phase: 'no-update' })
    })
    this.updater.on('error', () => {
      this.publishFailure(this.operation ?? 'check')
    })
  }

  private publishFailure(operation: Exclude<UpdateOperation, null>): void {
    const message =
      operation === 'download'
        ? '更新下载失败，请稍后重试'
        : operation === 'install'
          ? '无法启动更新安装，请稍后重试'
          : '检查更新失败，请稍后重试'
    this.operation = null
    this.options.logger.warn('desktop.update.failed', {
      operation,
      reason: 'updater-error',
    })
    this.publish({ phase: 'error', message })
  }

  private publish(status: DesktopUpdateStatus): void {
    this.status = status
    this.options.onStatusChange(status)
  }
}

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (
    normalized.length < 1 ||
    normalized.length > 64 ||
    !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(normalized)
  ) {
    return null
  }
  return normalized
}
