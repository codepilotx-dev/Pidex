import { describe, expect, test } from 'bun:test'
import type { DesktopUpdateStatus } from '@pidex/shared/desktop-update-ipc'
import type { DesktopLogger } from '../src/logging/DesktopLogger'
import {
  DesktopAutoUpdater,
  resolveDesktopUpdateChannel,
  type ElectronAutoUpdaterLike,
} from '../src/update/DesktopAutoUpdater'

describe('桌面自动更新通道', () => {
  test.each([
    ['1.2.3', 'latest', false],
    ['1.2.3-alpha.1', 'alpha', true],
    ['1.2.3-beta.4', 'beta', true],
    ['1.2.3-rc.2', 'rc', true],
  ] as const)('%s 使用 %s 通道', (version, channel, allowPrerelease) => {
    expect(resolveDesktopUpdateChannel(version)).toEqual({
      channel,
      allowPrerelease,
    })
  })
})

describe('桌面自动更新服务', () => {
  test('合并并发检查和下载，并只在下载完成后安装', async () => {
    const updater = new FakeUpdater()
    const statuses: DesktopUpdateStatus[] = []
    const check = deferred()
    const download = deferred()
    updater.checkResult = check.promise
    updater.downloadResult = download.promise
    const service = createService(updater, statuses)
    expect(updater.logger).toBeNull()
    expect(updater.autoDownload).toBeFalse()
    expect(updater.autoInstallOnAppQuit).toBeFalse()
    expect(updater.allowPrerelease).toBeTrue()
    expect(updater.channel).toBe('beta')

    const firstCheck = service.checkForUpdates()
    const secondCheck = service.checkForUpdates()
    expect(updater.checkCalls).toBe(1)
    expect(statuses.at(-1)).toEqual({ phase: 'checking' })
    updater.emit('update-available', { version: '0.2.0-beta.5' })
    check.resolve()
    await Promise.all([firstCheck, secondCheck])

    const firstDownload = service.downloadUpdate()
    const secondDownload = service.downloadUpdate()
    expect(updater.downloadCalls).toBe(1)
    updater.emit('download-progress', { percent: 42.5 })
    expect(statuses.at(-1)).toEqual({
      phase: 'downloading',
      percent: 42.5,
    })
    updater.emit('update-downloaded')
    download.resolve()
    await Promise.all([firstDownload, secondDownload])

    await service.quitAndInstall()
    expect(updater.installCalls).toBe(1)
  })

  test('拒绝错误阶段的下载和安装', async () => {
    const service = createService(new FakeUpdater(), [])
    await expect(service.downloadUpdate()).rejects.toThrow('当前没有可下载的更新')
    await expect(service.quitAndInstall()).rejects.toThrow('更新尚未下载完成')
  })

  test('错误状态不会暴露原始异常内容', async () => {
    const updater = new FakeUpdater()
    updater.checkResult = Promise.reject(new Error('C:\\Users\\secret token=super-secret'))
    const statuses: DesktopUpdateStatus[] = []
    const warnings: Array<Record<string, unknown> | undefined> = []
    const service = createService(updater, statuses, warnings)

    await service.checkForUpdates()

    expect(statuses.at(-1)).toEqual({
      phase: 'error',
      message: '检查更新失败，请稍后重试',
    })
    expect(JSON.stringify(warnings)).not.toContain('secret')
    expect(warnings.at(-1)).toEqual({
      operation: 'check',
      reason: 'updater-error',
    })
  })

  test('开发环境不访问更新源', async () => {
    const updater = new FakeUpdater()
    const statuses: DesktopUpdateStatus[] = []
    const service = new DesktopAutoUpdater({
      packaged: false,
      version: '0.2.0-beta.4',
      logger: loggerStub(),
      onStatusChange: (status) => statuses.push(status),
      updater,
    })

    await service.checkForUpdates()

    expect(updater.checkCalls).toBe(0)
    expect(statuses).toEqual([{ phase: 'no-update' }])
  })
})

function createService(
  updater: FakeUpdater,
  statuses: DesktopUpdateStatus[],
  warnings: Array<Record<string, unknown> | undefined> = [],
): DesktopAutoUpdater {
  return new DesktopAutoUpdater({
    packaged: true,
    version: '0.2.0-beta.4',
    logger: loggerStub(warnings),
    onStatusChange: (status) => statuses.push(status),
    updater,
  })
}

function loggerStub(warnings: Array<Record<string, unknown> | undefined> = []): DesktopLogger {
  return {
    directory: '',
    consoleEnabled: false,
    debug: () => {},
    info: () => {},
    warn: (_event, fields) => warnings.push(fields),
    error: () => {},
    forwardConsoleLine: () => {},
  }
}

function deferred(): {
  promise: Promise<unknown>
  resolve: () => void
} {
  let resolve = (): void => {}
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

class FakeUpdater implements ElectronAutoUpdaterLike {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = false
  channel: string | null = null
  logger: unknown = console
  checkCalls = 0
  downloadCalls = 0
  installCalls = 0
  checkResult: Promise<unknown> = Promise.resolve()
  downloadResult: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>()

  on(event: string, listener: (...args: any[]) => void): void {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
  }

  checkForUpdates(): Promise<unknown> {
    this.checkCalls += 1
    return this.checkResult
  }

  downloadUpdate(): Promise<unknown> {
    this.downloadCalls += 1
    return this.downloadResult
  }

  quitAndInstall(): void {
    this.installCalls += 1
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}
