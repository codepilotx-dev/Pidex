import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const electronRoot = resolve(repositoryRoot, 'apps/desktop/electron')
const rendererDist = resolve(repositoryRoot, 'dist/renderer')
const isolatedRoot = requiredEnvironment('PIDEX_PLAN_SMOKE_ROOT')
const agentOrigin = requiredEnvironment('PIDEX_AGENT_URL')
const authToken = requiredEnvironment('PIDEX_AUTH_TOKEN')
const live = process.env.PIDEX_PLAN_SMOKE_LIVE === '1'

test.describe('Plan 桌面全流程', () => {
  let application: ElectronApplication | undefined
  let page: Page | undefined

  test.afterEach(async ({}, testInfo) => {
    if (application && page && testInfo.status !== testInfo.expectedStatus) {
      const screenshot = testInfo.outputPath('failure.png')
      await mkdir(dirname(screenshot), { recursive: true })
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined)
      await application
        .context()
        .tracing.stop({
          path: testInfo.outputPath('trace.zip'),
        })
        .catch(() => undefined)
    } else {
      await application
        ?.context()
        .tracing.stop()
        .catch(() => undefined)
    }
    await application?.close().catch(() => undefined)
  })

  test('Plan 正文、Chat 执行进度与刷新恢复', async () => {
    application = await launchDesktop()
    await application.context().tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    })
    page = await application.firstWindow()
    await waitForApplication(page)
    await page.evaluate(() => {
      location.hash = '#/new?surface=chat'
    })
    await expect.poll(() => page!.evaluate(() => location.hash)).toBe('#/new?surface=chat')

    const composer = page.getByRole('combobox', { name: '消息输入框' })
    await expect(composer).toBeVisible()
    await composer.fill('/plan')
    await composer.press('Enter')
    await expect(page.getByTitle('计划模式')).toBeVisible()

    await composer.fill(
      [
        '请制定一个只读测试方案。',
        '最终计划标题必须是“Plan 流程自动化方案”，',
        '包含“验证计划正文”和“验证持久化恢复”两项。',
        '不要修改文件，也不要请求确认。',
      ].join(''),
    )
    await composer.press('Enter')

    const planCard = page.locator('.workflow-plan-card').first()
    await expect(planCard).toBeVisible()
    await expect(planCard).toContainText(live ? '计划' : 'Plan 流程自动化方案')
    await expect(page.getByText('<proposed_plan>', { exact: false })).toHaveCount(0)
    await expect(page.getByText('</proposed_plan>', { exact: false })).toHaveCount(0)
    await expect(
      page.getByRole('button', {
        name: /确认计划|批准计划|开始实施/,
      }),
    ).toHaveCount(0)

    const threadURL = await waitForThreadURL(page)
    await page.getByTitle('计划模式').click()
    await expect(page.getByTitle('计划模式')).toHaveCount(0)

    await composer.fill(
      [
        '只验证执行计划状态，不要修改文件，也不要调用其他工具。',
        '先调用 update_plan 提交两个步骤：验证计划正文为 in_progress、',
        '验证持久化恢复为 pending；然后再次调用 update_plan，',
        '把两个步骤都设为 completed，最后简短回复完成。',
      ].join(''),
    )
    await composer.press('Enter')

    const executionPlanToggle = page.getByRole('button', {
      name: /执行计划(?:进行中|已完成)，已完成 2 \/ 2 步/,
    })
    await expect(executionPlanToggle).toBeVisible()
    await executionPlanToggle.focus()
    const executionPlan = page.getByRole('article', { name: '执行计划' })
    await expect(executionPlan).toBeVisible()
    await expect(executionPlan).toContainText('验证计划正文')
    await expect(executionPlan).toContainText('验证持久化恢复')
    await expect(
      executionPlan.getByRole('listitem', {
        name: '第 1 步，验证计划正文，已完成',
      }),
    ).toBeVisible()
    await expect(
      executionPlan.getByRole('listitem', {
        name: '第 2 步，验证持久化恢复，已完成',
      }),
    ).toBeVisible()
    if (!live) {
      await expect(page.getByText('两个步骤都已完成。')).toBeVisible()
    }

    await page.reload()
    await waitForApplication(page)
    await expect.poll(() => page!.url()).toBe(threadURL)
    await expect(page.locator('.workflow-plan-card').first()).toBeVisible()
    const restoredExecutionPlanToggle = page.getByRole('button', {
      name: /执行计划已完成，已完成 2 \/ 2 步/,
    })
    await expect(restoredExecutionPlanToggle).toBeVisible()
    await restoredExecutionPlanToggle.focus()
    const restoredPlan = page.getByRole('article', { name: '执行计划' })
    await expect(restoredPlan).toContainText('验证计划正文')
    await expect(
      restoredPlan.getByRole('listitem', {
        name: '第 1 步，验证计划正文，已完成',
      }),
    ).toBeVisible()
    await expect(
      restoredPlan.getByRole('listitem', {
        name: '第 2 步，验证持久化恢复，已完成',
      }),
    ).toBeVisible()
  })
})

async function launchDesktop(): Promise<ElectronApplication> {
  const userDataDirectory = join(isolatedRoot, 'electron-user-data')
  const logDirectory = join(isolatedRoot, 'desktop-logs')
  return electron.launch({
    args: [electronRoot],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PIDEX_AGENT_URL: agentOrigin,
      PIDEX_AUTH_TOKEN: authToken,
      PIDEX_BUN_PATH: resolveBunExecutable(),
      PIDEX_USER_DATA_DIR: userDataDirectory,
      PIDEX_DATA_DIR: join(isolatedRoot, 'agent'),
      PIDEX_LOG_DIR: logDirectory,
      PIDEX_STATIC_DIR: rendererDist,
      NO_PROXY: '127.0.0.1,localhost,::1',
      no_proxy: '127.0.0.1,localhost,::1',
    },
  })
}

async function waitForApplication(page: Page): Promise<void> {
  await page.waitForURL(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//, { timeout: 60_000 })
  await expect(page.locator('html')).toHaveAttribute('data-window-type', 'electron')
}

async function waitForThreadURL(page: Page): Promise<string> {
  await page.waitForURL(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/#\/threads\/[^/?#]+$/)
  return page.url()
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Plan smoke 缺少环境变量 ${name}`)
  return value
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
  if (!executable) throw new Error('Plan Electron smoke 未找到 bun.exe')
  return executable
}
