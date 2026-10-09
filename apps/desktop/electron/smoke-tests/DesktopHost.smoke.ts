import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import type { DesktopThemeSettingsV7 } from '@pidex/shared/desktop-theme'
import type { DesktopPetPresentation } from '@pidex/shared/desktop-pet-overlay'
import type { DesktopSettingsPayload } from '@pidex/shared/desktop-settings-ipc'
import type { DesktopDataLocationState } from '@pidex/shared/desktop-data-location-ipc'
import type { DesktopEditIpcBridge } from '@pidex/shared/desktop-edit-ipc'

declare global {
  interface Window {
    __pidexStartupThemeSamples?: Array<{
      background: string
      label: string
      theme: string | null
    }>
    DesktopBridge: {
      getAppearanceSettings(): Promise<DesktopThemeSettingsV7>
      saveAppearanceSettings(settings: DesktopThemeSettingsV7): Promise<void>
      getDataLocation(): Promise<DesktopDataLocationState>
      openPetOverlay(): Promise<void>
      hidePetOverlay(): Promise<void>
      getPetOverlayWindowState(): Promise<{
        open: boolean
        bounds: { x: number; y: number; width: number; height: number }
      }>
      beginPetDrag(): void
      updatePetDrag(): void
      endPetDrag(): void
      setPetPointerPassthrough(passthrough: boolean): void
      previewPetPresentation(presentation: DesktopPetPresentation): Promise<DesktopPetPresentation>
      onPetPresentationPreview(listener: (presentation: DesktopPetPresentation) => void): () => void
      getPetGlobalPointerPosition(): Promise<{ x: number; y: number }>
      getDesktopSettings(): Promise<DesktopSettingsPayload>
      saveDesktopSettings(settings: DesktopSettingsPayload): Promise<DesktopSettingsPayload>
      onDesktopSettingsChange(listener: (settings: DesktopSettingsPayload) => void): () => void
    } & DesktopEditIpcBridge
  }
}

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const electronRoot = resolve(repositoryRoot, 'apps/desktop/electron')
const rendererDist = resolve(repositoryRoot, 'dist/renderer')

test.describe('真实 Electron 宿主', () => {
  let userDataDirectory = ''
  let logDirectory = ''
  let application: ElectronApplication | undefined

  test.beforeEach(async () => {
    userDataDirectory = await mkdtemp(join(tmpdir(), 'pidex-electron-smoke-'))
    logDirectory = join(userDataDirectory, 'logs')
  })

  test.afterEach(async () => {
    await application?.close().catch(() => undefined)
    await rm(userDataDirectory, { force: true, recursive: true })
  })

  test('使用 preload 应用并持久化 V7 主题，且新路由均可达', async () => {
    application = await launchDesktop(userDataDirectory, logDirectory)
    let page = await application.firstWindow()
    await waitForApplication(page)
    await expect
      .poll(() => existsSync(join(userDataDirectory, 'agent-home', 'history.sqlite')))
      .toBe(true)
    expect(existsSync(join(userDataDirectory, 'agent', 'history.sqlite'))).toBe(false)

    await expectHostContract(page)
    expect(
      await page.evaluate(async () => {
        const input = document.createElement('input')
        input.value = 'Pidex edit bridge'
        document.body.append(input)
        input.focus()
        input.setSelectionRange(0, 4)

        await window.DesktopBridge.performEditAction('selectAll')
        const selected = input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
        await window.DesktopBridge.performEditAction('delete')
        const valueAfterDelete = input.value
        input.remove()

        return { selected, valueAfterDelete }
      }),
    ).toEqual({
      selected: 'Pidex edit bridge',
      valueAfterDelete: '',
    })
    await expect(
      page.evaluate(() =>
        (window.DesktopBridge.performEditAction as (action: string) => Promise<void>)(
          'invalid',
        ),
      ),
    ).rejects.toThrow('编辑命令无效')
    const settings = await page.evaluate(async () =>
      window.DesktopBridge.getAppearanceSettings(),
    )
    expect(settings.version).toBe(7)
    expect(await page.evaluate(() => window.DesktopBridge.getDataLocation())).toMatchObject({
      currentDataDir: join(userDataDirectory, 'agent-home'),
      controlSource: 'env',
      isEnvControlled: true,
    })

    await page.evaluate(() =>
      Promise.all([
        window.DesktopBridge.openPetOverlay(),
        window.DesktopBridge.openPetOverlay(),
      ]),
    )
    await expect
      .poll(
        () =>
          application
            ?.windows()
            .find((candidate) => candidate.url().endsWith('/#/pet-overlay'))
            ?.url() ?? null,
      )
      .toMatch(/\/#\/pet-overlay$/)
    expect(
      application.windows().filter((candidate) => candidate.url().endsWith('/#/pet-overlay')),
    ).toHaveLength(1)
    const overlayPage = application
      .windows()
      .find((candidate) => candidate.url().endsWith('/#/pet-overlay'))
    if (!overlayPage) throw new Error('Electron smoke 未找到宠物悬浮窗')
    await expect(overlayPage.locator('.pet-overlay-page')).toBeAttached()
    await expect(
      overlayPage.evaluate(() => window.DesktopBridge.performEditAction('selectAll')),
    ).rejects.toThrow('IPC 调用来源无效')
    expect(
      await overlayPage.evaluate(() => ({
        hasDesktopBridge: typeof window.DesktopBridge === 'object',
        hasDragBridge: typeof window.DesktopBridge.beginPetDrag === 'function',
        hasPointerBridge: typeof window.DesktopBridge.setPetPointerPassthrough === 'function',
        hasPresentationBridge:
          typeof window.DesktopBridge.onPetPresentationPreview === 'function',
        hasGlobalPointerBridge:
          typeof window.DesktopBridge.getPetGlobalPointerPosition === 'function',
      })),
    ).toEqual({
      hasDesktopBridge: true,
      hasDragBridge: true,
      hasGlobalPointerBridge: true,
      hasPointerBridge: true,
      hasPresentationBridge: true,
    })
    const presentationPreview = overlayPage.evaluate(
      () =>
        new Promise<DesktopPetPresentation>((resolve) => {
          const unsubscribe = window.DesktopBridge.onPetPresentationPreview((value) => {
            unsubscribe()
            resolve(value)
          })
        }),
    )
    expect(
      await page.evaluate(() =>
        window.DesktopBridge.previewPetPresentation({
          selectedPetId: 'smoke-pet',
          size: 500,
        }),
      ),
    ).toEqual({ selectedPetId: 'smoke-pet', size: 224 })
    await expect(presentationPreview).resolves.toEqual({ selectedPetId: 'smoke-pet', size: 224 })
    expect(
      await overlayPage.evaluate(() => window.DesktopBridge.getPetGlobalPointerPosition()),
    ).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
    })
    await expect(
      page.evaluate(() => window.DesktopBridge.getPetGlobalPointerPosition()),
    ).rejects.toThrow('IPC 调用来源无效')
    const settingsChanged = page.evaluate(
      () =>
        new Promise<DesktopSettingsPayload>((resolve) => {
          const unsubscribe = window.DesktopBridge.onDesktopSettingsChange((value) => {
            unsubscribe()
            resolve(value)
          })
        }),
    )
    const overlaySettingsChanged = overlayPage.evaluate(
      () =>
        new Promise<DesktopSettingsPayload>((resolve) => {
          const unsubscribe = window.DesktopBridge.onDesktopSettingsChange((value) => {
            unsubscribe()
            resolve(value)
          })
        }),
    )
    const currentDesktopSettings = await page.evaluate(() =>
      window.DesktopBridge.getDesktopSettings(),
    )
    await expect(
      overlayPage.evaluate(
        (value) => window.DesktopBridge.saveDesktopSettings(value),
        currentDesktopSettings,
      ),
    ).rejects.toThrow('IPC 调用来源无效')
    await page.evaluate(
      (value) => window.DesktopBridge.saveDesktopSettings(value),
      currentDesktopSettings,
    )
    await expect(settingsChanged).resolves.toEqual(currentDesktopSettings)
    await expect(overlaySettingsChanged).resolves.toEqual(currentDesktopSettings)
    await overlayPage.evaluate(() => {
      window.DesktopBridge.setPetPointerPassthrough(false)
      window.DesktopBridge.beginPetDrag()
      window.DesktopBridge.updatePetDrag()
      window.DesktopBridge.endPetDrag()
      window.DesktopBridge.setPetPointerPassthrough(true)
    })
    await expect
      .poll(() => page.evaluate(() => window.DesktopBridge.getPetOverlayWindowState()))
      .toMatchObject({ open: true })
    await page.evaluate(() => window.DesktopBridge.hidePetOverlay())
    await page.evaluate(() =>
      window.DesktopBridge.previewPetPresentation({
        selectedPetId: null,
        size: 112,
      }),
    )
    await expect
      .poll(() => page.evaluate(() => window.DesktopBridge.getPetOverlayWindowState()))
      .toMatchObject({ open: false })
    await page.evaluate(() => window.DesktopBridge.openPetOverlay())
    await expect
      .poll(() => page.evaluate(() => window.DesktopBridge.getPetOverlayWindowState()))
      .toMatchObject({ open: true })

    await page.evaluate(async (current) => {
      await window.DesktopBridge.saveAppearanceSettings({
        ...current,
        mode: 'dark',
        pointerCursorEnabled: true,
        reduceMotion: 'on',
        fontSmoothingEnabled: false,
        fontSizes: { ui: 16, code: 24 },
        chromeThemes: {
          light: { ...current.chromeThemes.light },
          dark: {
            ...current.chromeThemes.dark,
            surface: '#121725',
            ink: '#f4f6ff',
            accent: '#8db8ff',
          },
        },
      })
    }, settings)

    await page.addInitScript(() => {
      const samples: NonNullable<Window['__pidexStartupThemeSamples']> = []
      window.__pidexStartupThemeSamples = samples
      let frames = 0
      const sample = (): void => {
        const splash = document.getElementById('startup-splash')
        if (splash) {
          samples.push({
            background: getComputedStyle(splash).backgroundColor,
            label: splash.querySelector('.full-screen-whale-loader__status')?.textContent ?? '',
            theme: document.documentElement.dataset.theme ?? null,
          })
        }
        frames += 1
        if (frames < 600 && (splash || document.readyState !== 'complete')) {
          requestAnimationFrame(sample)
        }
      }
      requestAnimationFrame(sample)
    })
    await page.reload()
    await waitForApplication(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const startupThemeSamples = await page.evaluate(
      () => window.__pidexStartupThemeSamples ?? [],
    )
    expect(startupThemeSamples.length).toBeGreaterThan(0)
    expect(
      startupThemeSamples.some(
        (sample) => sample.label === '正在加载桌面界面…' || sample.label === '正在读取模型配置…',
      ),
    ).toBe(true)
    expect(startupThemeSamples.every((sample) => sample.theme === 'dark')).toBe(true)
    expect(
      startupThemeSamples.every((sample) => {
        const channels =
          sample.background
            .match(/\d+(?:\.\d+)?/g)
            ?.slice(0, 3)
            .map(Number) ?? []
        return channels.length === 3 && Math.max(...channels) < 128
      }),
    ).toBe(true)
    await expect(page.locator('html')).toHaveAttribute('data-pointer-cursor', 'on')
    await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'on')
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--font-size-ui').trim(),
        ),
      )
      .toBe('16px')

    for (const route of ['/new', '/settings/general', '/labs']) {
      await page.evaluate((nextRoute) => {
        location.hash = `#${nextRoute}`
      }, route)
      await expect
        .poll(() => page.evaluate(() => location.hash.slice(1).split('?', 1)[0]))
        .toBe(route)
    }
    await expect(page.getByRole('heading', { name: '这个页面不存在' })).toBeVisible()

    const restoredBounds = await application.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.webContents.getURL().endsWith('/#/pet-overlay'),
      )
      if (!window) throw new Error('Electron smoke 未找到主窗口')
      const current = window.getBounds()
      const next = {
        x: current.x + 20,
        y: current.y + 20,
        width: 1180,
        height: 760,
      }
      window.unmaximize()
      window.setBounds(next)
      await new Promise((resolve) => setTimeout(resolve, 350))
      const normalBounds = window.getBounds()
      window.maximize()
      return normalBounds
    })
    await expect
      .poll(() =>
        application?.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((candidate) => !candidate.webContents.getURL().endsWith('/#/pet-overlay'))
              ?.isMaximized() ?? false,
        ),
      )
      .toBe(true)

    await application.close()
    application = undefined
    application = await launchDesktop(userDataDirectory, logDirectory)
    page = await application.firstWindow()
    await waitForApplication(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const persisted = await page.evaluate(async () =>
      window.DesktopBridge.getAppearanceSettings(),
    )
    expect(persisted).toMatchObject({
      version: 7,
      mode: 'dark',
      pointerCursorEnabled: true,
      reduceMotion: 'on',
      fontSmoothingEnabled: false,
      fontSizes: { ui: 16, code: 24 },
    })
    expect(persisted.chromeThemes.dark).toMatchObject({
      surface: '#121725',
      ink: '#f4f6ff',
      accent: '#8db8ff',
    })
    await expect
      .poll(() =>
        application?.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows().find(
            (candidate) => !candidate.webContents.getURL().endsWith('/#/pet-overlay'),
          )
          return window
            ? {
                backgroundColor: window.getBackgroundColor().toLowerCase(),
                maximized: window.isMaximized(),
                normalBounds: window.getNormalBounds(),
              }
            : null
        }),
      )
      .toMatchObject({
        backgroundColor: '#121725',
        maximized: true,
      })
    const restoredWindowState = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.webContents.getURL().endsWith('/#/pet-overlay'),
      )
      if (!window) throw new Error('Electron smoke 未找到重启后的主窗口')
      return window.getNormalBounds()
    })
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(
        Math.abs(restoredWindowState[key] - restoredBounds[key]),
        `重启后的 ${key} 应接近保存值`,
      ).toBeLessThanOrEqual(10)
    }

    await application.close()
    application = undefined
  })
})

async function launchDesktop(
  userDataDirectory: string,
  logDirectory: string,
): Promise<ElectronApplication> {
  const packagedExecutable = process.env.PIDEX_SMOKE_EXECUTABLE?.trim()
  return electron.launch({
    ...(packagedExecutable
      ? { executablePath: resolve(packagedExecutable), args: [] }
      : { args: [electronRoot] }),
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PIDEX_BUN_PATH: resolveBunExecutable(),
      PIDEX_USER_DATA_DIR: userDataDirectory,
      PIDEX_DATA_DIR: join(userDataDirectory, 'agent-home'),
      PIDEX_LOG_DIR: logDirectory,
      PIDEX_STATIC_DIR: rendererDist,
      NO_PROXY: '127.0.0.1,localhost,::1',
      no_proxy: '127.0.0.1,localhost,::1',
    },
  })
}

async function waitForApplication(page: Page): Promise<void> {
  await page.waitForURL(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//, {
    timeout: 60_000,
  })
  await expect(page.locator('html')).toHaveAttribute('data-window-type', 'electron')
}

async function expectHostContract(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-window-type', 'electron')
  await expect(page.locator('html')).toHaveAttribute('data-os', 'windows')
  expect(
    await page.evaluate(() => ({
      hasDesktopBridge: typeof window.DesktopBridge === 'object',
      hasEditBridge: typeof window.DesktopBridge.performEditAction === 'function',
      hasNodeRequire: typeof (window as unknown as { require?: unknown }).require,
      tokenCount: (() => {
        const names = new Set<string>()
        const visit = (rules: CSSRuleList): void => {
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule) {
              for (const name of Array.from(rule.style)) {
                if (name.startsWith('--color-token-')) names.add(name)
              }
            }
            if ('cssRules' in rule) {
              visit((rule as CSSGroupingRule).cssRules)
            }
          }
        }
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            visit(sheet.cssRules)
          } catch {
            // Same-origin application styles are readable; vendor sheets may not be.
          }
        }
        const computed = getComputedStyle(document.documentElement)
        return Array.from(names).filter((name) => computed.getPropertyValue(name).trim().length > 0)
          .length
      })(),
    })),
  ).toEqual({
    hasDesktopBridge: true,
    hasEditBridge: true,
    hasNodeRequire: 'undefined',
    tokenCount: 121,
  })
}

function resolveBunExecutable(): string {
  if (process.env.PIDEX_BUN_PATH) {
    return process.env.PIDEX_BUN_PATH
  }
  const output = execFileSync('where.exe', ['bun'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  const commandPaths = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const executable = [
    ...commandPaths.filter((path) => path.toLowerCase().endsWith('.exe')),
    ...commandPaths.map((path) => join(dirname(path), 'node_modules/bun/bin/bun.exe')),
  ].find((path) => existsSync(path))
  if (!executable) throw new Error('Electron smoke 测试未找到 bun.exe')
  return executable
}
