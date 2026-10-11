import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const root = resolve('.')
const dir = await mkdtemp(join(tmpdir(), 'pidex-menu-smoke-'))
const bun = 'C:/nvm4w/nodejs/node_modules/bun/bin/bun.exe'
let app
try {
  app = await electron.launch({
    args: [join(root, 'apps/desktop/electron')],
    cwd: root,
    env: {
      ...process.env,
      PIDEX_BUN_PATH: bun,
      PIDEX_USER_DATA_DIR: dir,
      PIDEX_DATA_DIR: join(dir, 'agent-home'),
      PIDEX_LOG_DIR: join(dir, 'logs'),
      PIDEX_STATIC_DIR: join(root, 'dist/renderer'),
      NO_PROXY: '127.0.0.1,localhost,::1',
      no_proxy: '127.0.0.1,localhost,::1',
    },
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  async function ready(p) {
    await p.waitForURL(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//, { timeout: 60000 })
    await p.locator('.app-menubar').waitFor()
    await p.getByRole('button', { name: '稍后', exact: true }).click()
    await expect(p.getByRole('dialog')).toHaveCount(0)
  }
  await ready(page)
  const select = async (menu, label) => {
    const trigger = page.locator('.menubar-trigger').filter({ hasText: menu })
    await trigger.focus()
    await trigger.press('ArrowDown')
    await page
      .locator('.menubar-content[data-state="open"]')
      .getByText(label, { exact: true })
      .click()
  }
  await select('文件', '新建窗口')
  await expect.poll(() => app.windows().length).toBe(2)
  const child = app.windows().find((p) => p !== page)
  await ready(child)
  await child.keyboard.press('Control+w').catch((error) => {
    if (!child.isClosed()) throw error
  })
  await expect.poll(() => app.windows().length).toBe(1)
  await select('窗口', '最小化')
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()))
    .toBe(true)
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.restore()
    w.focus()
  })
  await select('窗口', '缩放')
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()))
    .toBe(true)
  await select('窗口', '缩放')
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()))
    .toBe(false)
  await select('查看', '放大')
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
      ),
    )
    .toBeGreaterThan(1)
  await page.keyboard.press('Control+0')
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
      ),
    )
    .toBe(1)
  const exited = new Promise((resolve) => app.process().once('exit', resolve))
  await select('文件', '退出应用').catch((error) => {
    if (!page.isClosed()) throw error
  })
  await Promise.race([
    exited,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error('exit timed out')), 20000)
      t.unref()
    }),
  ])
  console.log('PASS: native menu window create/close/minimize/maximize/restore/zoom/quit')
} finally {
  if (app && app.process().exitCode === null) await app.close()
  console.log('Isolated test data retained:', dir)
}
