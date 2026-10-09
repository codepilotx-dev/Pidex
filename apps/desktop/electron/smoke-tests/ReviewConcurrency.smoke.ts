import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'
import {
  createReviewConcurrencyFileContent,
  REVIEW_CONCURRENCY_CHANGED_LINE_COUNT,
  REVIEW_CONCURRENCY_LINE_COUNT,
} from '../../../agent/scripts/ReviewConcurrencyContent'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const electronRoot = resolve(repositoryRoot, 'apps/desktop/electron')
const rendererDist = resolve(repositoryRoot, 'dist/renderer')
const isolatedRoot = requiredEnvironment('PIDEX_REVIEW_CONCURRENCY_ROOT')
const agentOrigin = requiredEnvironment('PIDEX_AGENT_URL')
const authToken = requiredEnvironment('PIDEX_AUTH_TOKEN')
const releaseFileName = '.review-concurrency-release'
const totalThreadCount = 30
const historicalTurnCount = 500
const bulkFileCount = 1_197
const bulkFileLineCount = 10
const trackedFiles = ['src/session-1.ts', 'src/session-2.ts', 'src/session-3.ts'] as const

type ThreadSnapshotResult = {
  snapshot: {
    thread: { id: string }
    turns: Array<{ status: string }>
    items: Array<{
      type: string
      tool?: string
      state?: string
    }>
  }
}

type ReviewSummaryRpcResult = {
  snapshot: {
    generation: string
    largeDiffMode: boolean
    files: Array<{
      path: string
      revision: string
    }>
  }
}

type ReviewConcurrencyEvent =
  | { type: 'git'; args: string[] }
  | {
      type: 'rpc'
      method: string
      generation?: string
      path?: string
    }

test.describe('真实 Agent/Electron 并发 Review', () => {
  let application: ElectronApplication | undefined
  let page: Page | undefined

  test.afterEach(async ({}, testInfo) => {
    if (application && page && testInfo.status !== testInfo.expectedStatus) {
      await mkdir(dirname(testInfo.outputPath('failure.png')), {
        recursive: true,
      })
      await page
        .screenshot({
          path: testInfo.outputPath('failure.png'),
          fullPage: true,
        })
        .catch(() => undefined)
      await application
        .context()
        .tracing.stop({ path: testInfo.outputPath('trace.zip') })
        .catch(() => undefined)
    } else {
      await application
        ?.context()
        .tracing.stop()
        .catch(() => undefined)
    }
    await application?.close().catch(() => undefined)
    await setBatchCapability(true).catch(() => undefined)
  })

  test('52 文件的小仓库通过一次批量 RPC 退出 loading', async () => {
    await setBatchCapability(true)
    await clearReviewConcurrencyEvents()
    const workspaceRoot = join(isolatedRoot, 'small-batch-repository')
    await createSmallRepository(workspaceRoot, 52)
    const rpc = await createRpcClient(agentOrigin, authToken)
    const { threadId } = await createReviewProjectAndThread(
      rpc,
      workspaceRoot,
      'Review 小仓库批量加载',
    )

    application = await launchDesktop('electron-small-batch')
    page = await application.firstWindow()
    await setWindowSize(application)
    await waitForApplication(page)
    await openThread(page, threadId)
    const rightPanel = await openReview(page, false)
    await expect(rightPanel.getByText('正在加载文件差异…')).toHaveCount(0, { timeout: 30_000 })

    const { events } = await readReviewConcurrencyState()
    expect(
      events.filter((event) => event.type === 'rpc' && event.method === 'review/file-diffs'),
    ).toHaveLength(1)
    expect(
      events.filter((event) => event.type === 'rpc' && event.method === 'review/fileDiff'),
    ).toHaveLength(0)
  })

  test('旧 Agent 缺少批量能力时单文件队列并发不超过 2', async () => {
    await setBatchCapability(false)
    await clearReviewConcurrencyEvents()
    const workspaceRoot = join(isolatedRoot, 'legacy-agent-repository')
    await createSmallRepository(workspaceRoot, 52)
    const rpc = await createRpcClient(agentOrigin, authToken)
    const { threadId } = await createReviewProjectAndThread(
      rpc,
      workspaceRoot,
      'Review 旧 Agent 降级',
    )

    application = await launchDesktop('electron-legacy-agent')
    page = await application.firstWindow()
    await setWindowSize(application)
    await waitForApplication(page)
    await openThread(page, threadId)
    await openReview(page, false)
    await expect
      .poll(
        async () => {
          const { events } = await readReviewConcurrencyState()
          return events.filter(
            (event) => event.type === 'rpc' && event.method === 'review/fileDiff',
          ).length
        },
        { timeout: 60_000 },
      )
      .toBe(52)

    const state = await readReviewConcurrencyState()
    expect(
      state.events.filter((event) => event.type === 'rpc' && event.method === 'review/file-diffs'),
    ).toHaveLength(0)
    expect(state.maxActiveFileDiffRequests).toBeGreaterThan(0)
    expect(state.maxActiveFileDiffRequests).toBeLessThanOrEqual(2)
  })

  test('大 Diff 与长会话并发更新期间所有 Review 面板真实重排', async ({}, testInfo) => {
    await setBatchCapability(true)
    await clearReviewConcurrencyEvents()
    const workspaceRoot = join(isolatedRoot, 'repository')
    await createRepository(workspaceRoot)
    const rpc = await createRpcClient(agentOrigin, authToken)
    const project = await rpc.call<{ project: { id: string } }>('project/create', {
      primaryPath: workspaceRoot,
      operationId: crypto.randomUUID(),
    })
    const threadIds: string[] = []
    for (let index = 1; index <= totalThreadCount; index += 1) {
      const created = await rpc.call<ThreadSnapshotResult>('thread/create', {
        title: `Review 并发会话 ${index}`,
        workspace: {
          kind: 'project',
          projectId: project.project.id,
        },
        operationId: crypto.randomUUID(),
      })
      threadIds.push(created.snapshot.thread.id)
    }
    await seedHistoricalTurns(threadIds[0]!, historicalTurnCount)

    application = await launchDesktop('electron-large-workspace')
    await application.context().tracing.start({
      screenshots: false,
      snapshots: false,
      sources: false,
    })
    page = await application.firstWindow()
    await setWindowSize(application)
    await waitForApplication(page)
    await openThread(page, threadIds[0]!)
    const rightPanel = await openReview(page)
    await page.getByRole('menuitem', { name: '查看', exact: true }).click()
    await page
      .getByRole('menuitem', {
        name: '切换底部面板',
        exact: true,
      })
      .click()
    const bottomPanel = page.getByRole('complementary', {
      name: '底部面板',
    })
    const bottomSeparator = page.getByRole('separator', {
      name: '调整底部面板高度',
    })
    await expect(bottomPanel).toBeVisible()
    await expect(bottomSeparator).toBeVisible()
    const bottomPanelBox = await bottomPanel.boundingBox()
    if (!bottomPanelBox) {
      throw new Error('Review concurrency 无法读取底部面板尺寸')
    }

    await Promise.all(
      threadIds.slice(0, 3).map((threadId, index) =>
        rpc.call('turn/start', {
          threadId,
          inputId: crypto.randomUUID(),
          content: `[review-concurrency:${index + 1}] 修改对应 tracked 文件。`,
          model: {
            providerID: 'openai',
            id: 'faux-1',
          },
          permissionConfig: {
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
          },
          taskMode: 'chat',
        }),
      ),
    )
    const writingThreadIds = threadIds.slice(0, 3)
    await waitForPowerShellBarrier(rpc, writingThreadIds)

    const fileTree = rightPanel.getByRole('region', {
      name: '审查文件导航',
    })
    const diffPreview = rightPanel.locator('.review-diff-preview')
    const reviewMain = rightPanel.locator('.review-sidebar-main')
    const fileTreeSeparator = rightPanel.getByRole('separator', {
      name: '调整审查文件导航宽度',
    })
    const rightSeparator = page.getByRole('separator', {
      name: '调整右侧面板宽度',
    })
    await expect(fileTreeSeparator).toBeVisible()
    await expect(rightSeparator).toBeVisible()
    await expect(fileTree).toBeVisible()
    await expect(diffPreview).toBeVisible()
    const fileTreeBox = await fileTree.boundingBox()
    const diffPreviewBox = await diffPreview.boundingBox()
    const rightPanelBox = await rightPanel.boundingBox()
    if (!fileTreeBox || !diffPreviewBox || !rightPanelBox) {
      throw new Error('Review concurrency 测试无法读取文件树或 Diff 尺寸')
    }

    await startLayoutStorageProbe(page)
    await startInteractionProbe(page)
    await markInteractionPhase(page, 'probe-started')
    await writeFile(join(workspaceRoot, releaseFileName), 'release\n', 'utf8')
    await markInteractionPhase(page, 'writes-released')

    await markInteractionPhase(page, 'right-drag-start')
    const rightResize = await dragLivePanel({
      page,
      separator: rightSeparator,
      panel: rightPanel,
      deltaX: 96,
      deltaY: 0,
      storageKey: 'pidex.desktop.rightDockWidthRatio.v2',
    })
    await markInteractionPhase(page, 'right-drag-end')
    expect(rightResize.liveSize.width).toBeLessThan(rightPanelBox.width - 64)

    const treeSeparatorBox = await fileTreeSeparator.boundingBox()
    if (!treeSeparatorBox) {
      throw new Error('Review concurrency 无法读取文件树分隔线')
    }
    const writesBeforeTreeDrag = await readLayoutStorageWrites(page)
    await page.mouse.move(
      treeSeparatorBox.x + treeSeparatorBox.width / 2,
      treeSeparatorBox.y + treeSeparatorBox.height / 2,
    )
    await page.mouse.down()
    await markInteractionPhase(page, 'file-tree-pointer-down')
    await movePointerInSteps(page, {
      fromX: treeSeparatorBox.x + treeSeparatorBox.width / 2,
      fromY: treeSeparatorBox.y + treeSeparatorBox.height / 2,
      deltaX: -72,
      deltaY: 0,
    })
    const liveFileTreeWidth = (await fileTree.boundingBox())?.width ?? 0
    const liveDiffPreviewWidth = (await diffPreview.boundingBox())?.width ?? 0
    const liveTreeSeparatorBox = await fileTreeSeparator.boundingBox()
    if (!liveTreeSeparatorBox) {
      throw new Error('Review concurrency 拖动中无法读取文件树分隔线')
    }
    const treeBoundaryErrorPx = Math.abs(
      liveTreeSeparatorBox.x +
        liveTreeSeparatorBox.width / 2 -
        (treeSeparatorBox.x + treeSeparatorBox.width / 2 - 72),
    )
    const committedWidthDuringDrag = await readReviewFileTreeCommittedWidth(reviewMain)
    expect(liveFileTreeWidth).toBeGreaterThan(fileTreeBox.width + 48)
    expect(liveDiffPreviewWidth).toBeLessThan(diffPreviewBox.width - 48)
    expect(committedWidthDuringDrag).toBeCloseTo(fileTreeBox.width, 0)
    expect(treeBoundaryErrorPx).toBeLessThanOrEqual(2)
    expect(await fileTree.evaluate((element) => getComputedStyle(element).transform)).toBe('none')
    expect(await readLayoutStorageWrites(page)).toEqual(writesBeforeTreeDrag)
    await page.mouse.up()
    await markInteractionPhase(page, 'file-tree-drag-end')
    await expect
      .poll(() => readReviewFileTreeCommittedWidth(reviewMain))
      .toBeGreaterThan(fileTreeBox.width + 48)
    const committedWidthAfterDrop = await readReviewFileTreeCommittedWidth(reviewMain)
    expect(committedWidthAfterDrop).toBeGreaterThan(fileTreeBox.width + 48)

    await markInteractionPhase(page, 'bottom-drag-start')
    const bottomResize = await dragLivePanel({
      page,
      separator: bottomSeparator,
      panel: bottomPanel,
      deltaX: 0,
      deltaY: -88,
      storageKey: 'pidex.desktop.bottomPanelHeightRatio.v3',
    })
    await markInteractionPhase(page, 'bottom-drag-end')
    expect(bottomResize.liveSize.height).toBeGreaterThan(bottomPanelBox.height + 56)
    await markInteractionPhase(page, 'wait-for-turns-start')
    await waitForCompletedTurns(rpc, writingThreadIds)
    await markInteractionPhase(page, 'turns-completed')
    await rm(join(workspaceRoot, releaseFileName))
    const interaction = await stopInteractionProbe(page)
    const layoutStorageWrites = await stopLayoutStorageProbe(page)
    expect(layoutStorageWrites['pidex.desktop.rightDockWidthRatio.v2']).toBe(1)
    expect(layoutStorageWrites['pidex.desktop.bottomPanelHeightRatio.v3']).toBe(1)

    await refreshReviewAfterDrag(rpc, project.project.id)
    await page.reload()
    await waitForApplication(page)
    await openThread(page, threadIds[0]!)
    const refreshedRightPanel = await openReview(page)
    const firstFileButton = refreshedRightPanel
      .getByRole('region', { name: '审查文件导航' })
      .getByRole('treeitem', { name: /session-1\.ts/ })
    await firstFileButton.click()
    await expect(
      refreshedRightPanel
        .getByLabel('src/session-1.ts diff')
        .locator('.review-codex-diff--virtual'),
    ).toBeVisible()
    await expect(refreshedRightPanel.locator('[data-review-diff-path]')).toHaveCount(1)
    expect(
      await refreshedRightPanel
        .getByRole('region', { name: '审查文件导航' })
        .locator('[role="treeitem"]')
        .count(),
    ).toBeLessThan(100)
    const reviewEvents = await readReviewConcurrencyEvents()
    const fileDiffEvents = reviewEvents.filter(
      (event): event is Extract<ReviewConcurrencyEvent, { type: 'rpc' }> =>
        event.type === 'rpc' && event.method === 'review/fileDiff',
    )
    expect(
      reviewEvents.filter((event) => event.type === 'rpc' && event.method === 'review/file-diffs'),
    ).toHaveLength(0)
    expect(fileDiffEvents.length).toBeGreaterThan(0)
    expect(
      new Set(fileDiffEvents.map((event) => `${event.generation ?? ''}\0${event.path ?? ''}`)).size,
    ).toBe(fileDiffEvents.length)
    expect(fileDiffEvents.every((event) => event.path === 'src/session-1.ts')).toBe(true)
    assertSummaryNeverReadsWholePatch(reviewEvents)

    for (let index = 1; index <= 3; index += 1) {
      expect(await readFile(join(workspaceRoot, `src/session-${index}.ts`), 'utf8')).toContain(
        `updated-by-thread-${index}`,
      )
    }

    const metrics = {
      ...interaction,
      changedLines:
        REVIEW_CONCURRENCY_CHANGED_LINE_COUNT * 2 * trackedFiles.length +
        bulkFileCount * bulkFileLineCount * 2,
      sourceLines:
        REVIEW_CONCURRENCY_LINE_COUNT * trackedFiles.length + bulkFileCount * bulkFileLineCount,
      threadCount: threadIds.length,
      historicalTurnCount,
      changedFileCount: trackedFiles.length + bulkFileCount,
      diffWidthShiftDuringDrag: liveDiffPreviewWidth - diffPreviewBox.width,
      liveTreeWidthChanged: Number(liveFileTreeWidth > fileTreeBox.width + 48),
      committedWidthChangedDuringDrag: Number(
        Math.abs(committedWidthDuringDrag - fileTreeBox.width) > 1,
      ),
      committedWidthChangedAfterDrop: Number(committedWidthAfterDrop > fileTreeBox.width + 48),
      layoutStorageWrites,
      rightBoundaryErrorPx: rightResize.boundaryErrorPx,
      bottomBoundaryErrorPx: bottomResize.boundaryErrorPx,
      treeBoundaryErrorPx,
      fileDiffRequestCount: fileDiffEvents.length,
    }
    await testInfo.attach('review-concurrency-metrics.json', {
      body: Buffer.from(`${JSON.stringify(metrics, null, 2)}\n`, 'utf8'),
      contentType: 'application/json',
    })
    console.log(`[review-concurrency-metrics] ${JSON.stringify(metrics)}`)
    for (const drag of Object.values(interaction.dragMetrics)) {
      expect(drag.frameP95Ms).toBeLessThanOrEqual(20)
      expect(drag.maxLongTaskMs).toBeLessThanOrEqual(50)
    }
    expect(interaction.maxLongTaskMs).toBeLessThanOrEqual(50)
  })
})

async function createRepository(workspaceRoot: string): Promise<void> {
  await mkdir(join(workspaceRoot, 'src'), { recursive: true })
  await mkdir(join(workspaceRoot, 'zz-bulk'), { recursive: true })
  for (let index = 1; index <= 3; index += 1) {
    await writeFile(
      join(workspaceRoot, `src/session-${index}.ts`),
      createReviewConcurrencyFileContent(index, 'initial'),
      'utf8',
    )
  }
  await writeBulkFiles(workspaceRoot, 'initial')
  git(workspaceRoot, 'init', '-b', 'main')
  git(workspaceRoot, 'config', 'user.name', 'Pidex Test')
  git(workspaceRoot, 'config', 'user.email', 'test@pidex.local')
  git(workspaceRoot, 'config', 'core.autocrlf', 'false')
  git(workspaceRoot, 'add', '.')
  git(workspaceRoot, 'commit', '-m', 'initial')
  await Promise.all(
    trackedFiles.map((filePath, index) =>
      writeFile(
        join(workspaceRoot, filePath),
        createReviewConcurrencyFileContent(index + 1, 'preview'),
        'utf8',
      ),
    ),
  )
  await writeBulkFiles(workspaceRoot, 'changed')
}

async function createSmallRepository(workspaceRoot: string, fileCount: number): Promise<void> {
  await mkdir(join(workspaceRoot, 'src'), { recursive: true })
  await Promise.all(
    Array.from({ length: fileCount }, (_, index) =>
      writeFile(
        join(workspaceRoot, 'src', `session-${index + 1}.ts`),
        `export const value${index + 1} = "initial"\n`,
        'utf8',
      ),
    ),
  )
  git(workspaceRoot, 'init', '-b', 'main')
  git(workspaceRoot, 'config', 'user.name', 'Pidex Test')
  git(workspaceRoot, 'config', 'user.email', 'test@pidex.local')
  git(workspaceRoot, 'config', 'core.autocrlf', 'false')
  git(workspaceRoot, 'add', '.')
  git(workspaceRoot, 'commit', '-m', 'initial')
  await Promise.all(
    Array.from({ length: fileCount }, (_, index) =>
      writeFile(
        join(workspaceRoot, 'src', `session-${index + 1}.ts`),
        `export const value${index + 1} = "changed"\n`,
        'utf8',
      ),
    ),
  )
}

async function createReviewProjectAndThread(
  rpc: RpcClient,
  workspaceRoot: string,
  title: string,
): Promise<{ projectId: string; threadId: string }> {
  const project = await rpc.call<{ project: { id: string } }>('project/create', {
    primaryPath: workspaceRoot,
    operationId: crypto.randomUUID(),
  })
  const thread = await rpc.call<ThreadSnapshotResult>('thread/create', {
    title,
    workspace: {
      kind: 'project',
      projectId: project.project.id,
    },
    operationId: crypto.randomUUID(),
  })
  return {
    projectId: project.project.id,
    threadId: thread.snapshot.thread.id,
  }
}

async function writeBulkFiles(workspaceRoot: string, state: 'initial' | 'changed'): Promise<void> {
  const batchSize = 64
  for (let offset = 0; offset < bulkFileCount; offset += batchSize) {
    await Promise.all(
      Array.from({ length: Math.min(batchSize, bulkFileCount - offset) }, async (_, batchIndex) => {
        const fileIndex = offset + batchIndex
        const content = Array.from(
          { length: bulkFileLineCount },
          (_, lineIndex) =>
            `export const value${lineIndex} = "${state}-${fileIndex}-${lineIndex}"\n`,
        ).join('')
        await writeFile(
          join(workspaceRoot, 'zz-bulk', `file-${String(fileIndex).padStart(4, '0')}.ts`),
          content,
          'utf8',
        )
      }),
    )
  }
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
}

async function launchDesktop(
  userDataDirectory = 'electron-user-data',
): Promise<ElectronApplication> {
  return electron.launch({
    args: [electronRoot],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PIDEX_AGENT_URL: agentOrigin,
      PIDEX_AUTH_TOKEN: authToken,
      PIDEX_BUN_PATH: resolveBunExecutable(),
      PIDEX_USER_DATA_DIR: join(isolatedRoot, userDataDirectory),
      PIDEX_DATA_DIR: join(isolatedRoot, 'agent'),
      PIDEX_LOG_DIR: join(isolatedRoot, 'desktop-logs'),
      PIDEX_STATIC_DIR: rendererDist,
      NO_PROXY: '127.0.0.1,localhost,::1',
      no_proxy: '127.0.0.1,localhost,::1',
    },
  })
}

async function setWindowSize(currentApplication: ElectronApplication): Promise<void> {
  await currentApplication.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1_600, 1_000)
  })
}

async function waitForApplication(currentPage: Page): Promise<void> {
  await currentPage.waitForURL(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//, { timeout: 60_000 })
  await expect(currentPage.locator('html')).toHaveAttribute('data-window-type', 'electron')
  await currentPage.locator('.composer-editor-content').waitFor()
}

async function openThread(currentPage: Page, threadId: string): Promise<void> {
  await currentPage.evaluate((id) => {
    location.hash = `#/threads/${encodeURIComponent(id)}`
  }, threadId)
  await currentPage.locator(`[data-canonical-thread-id="${threadId}"]`).waitFor()
}

async function openReview(currentPage: Page, expectVirtual = true) {
  await currentPage.getByRole('button', { name: /用 .+ 打开/ }).waitFor()
  await currentPage.waitForTimeout(1_000)
  const hideRightPanel = currentPage.getByRole('button', {
    name: '关闭右侧面板',
  })
  if (await hideRightPanel.isVisible()) await hideRightPanel.click()
  await expect(
    currentPage.getByRole('button', {
      name: '显示右侧面板',
    }),
  ).toBeVisible()
  await currentPage.keyboard.press('Control+Shift+G')
  const rightPanel = currentPage.locator('aside[aria-label="右侧面板"]')
  await expect(rightPanel).toBeVisible({ timeout: 60_000 })
  const reviewTab = rightPanel.getByRole('tab', {
    name: '审阅',
    exact: true,
  })
  if (await reviewTab.isVisible()) {
    await reviewTab.click()
  } else {
    await rightPanel.getByRole('button', { name: /^审阅/ }).click()
  }
  const fileTreeRegion = rightPanel.getByRole('region', {
    name: '审查文件导航',
  })
  await currentPage.waitForTimeout(350)
  if (!(await fileTreeRegion.isVisible().catch(() => false))) {
    const separator = currentPage.getByRole('separator', {
      name: '调整右侧面板宽度',
    })
    const separatorBox = await separator.boundingBox()
    if (!separatorBox) throw new Error('无法为 Review 文件树扩展右侧面板')
    const x = separatorBox.x + separatorBox.width / 2
    const y = separatorBox.y + separatorBox.height / 2
    await currentPage.mouse.move(x, y)
    await currentPage.mouse.down()
    await currentPage.mouse.move(x - 180, y, { steps: 20 })
    await currentPage.mouse.up()
  }
  await expect(fileTreeRegion.getByRole('treeitem', { name: /session-1\.ts/ })).toBeVisible({
    timeout: 15_000,
  })
  await fileTreeRegion.getByRole('treeitem', { name: /session-1\.ts/ }).click()
  const firstDiff = rightPanel.getByLabel('src/session-1.ts diff')
  await expect(firstDiff).toBeVisible({ timeout: 15_000 })
  if (expectVirtual) {
    const virtualDiff = firstDiff.locator('.review-codex-diff--virtual')
    await expect(virtualDiff).toHaveAttribute('data-review-syntax-state', 'ready', {
      timeout: 15_000,
    })
    await expect(virtualDiff).toBeVisible({ timeout: 15_000 })
  } else {
    await expect(firstDiff.getByText('正在加载文件差异…')).toHaveCount(0, { timeout: 30_000 })
  }
  return rightPanel
}

async function refreshReviewAfterDrag(rpc: RpcClient, projectId: string): Promise<void> {
  const source = { kind: 'unstaged' } as const
  let refreshed: ReviewSummaryRpcResult | null = null
  let lastError: unknown
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      refreshed = await rpc.call<ReviewSummaryRpcResult>('review/refresh', { projectId, source })
      break
    } catch (error) {
      lastError = error
      if (!String(error).includes('REVIEW_REPOSITORY_BUSY')) throw error
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
  }
  if (!refreshed) throw lastError
  const file = refreshed.snapshot.files.find((candidate) => candidate.path === 'src/session-1.ts')
  if (
    !file ||
    refreshed.snapshot.files.length !== trackedFiles.length + bulkFileCount ||
    !refreshed.snapshot.largeDiffMode
  ) {
    throw new Error('Review concurrency 未进入 1200 文件的大 Diff 模式')
  }
}

async function seedHistoricalTurns(threadId: string, count: number): Promise<void> {
  const response = await fetch(`${agentOrigin}/__review-concurrency/seed-history`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ threadId, count }),
  })
  if (!response.ok) {
    throw new Error(`历史压力回合写入失败：${response.status}`)
  }
}

async function waitForPowerShellBarrier(
  rpc: RpcClient,
  threadIds: readonly string[],
): Promise<void> {
  await waitFor(async () => {
    const snapshots = await Promise.all(
      threadIds.map((threadId) => rpc.call<ThreadSnapshotResult>('thread/read', { threadId })),
    )
    return snapshots.every(({ snapshot }) =>
      snapshot.items.some(
        (item) => item.type === 'tool' && item.tool === 'PowerShell' && item.state === 'running',
      ),
    )
  }, '三个会话未同时到达 PowerShell barrier')
}

async function waitForCompletedTurns(rpc: RpcClient, threadIds: readonly string[]): Promise<void> {
  await waitFor(
    async () => {
      const snapshots = await Promise.all(
        threadIds.map((threadId) => rpc.call<ThreadSnapshotResult>('thread/read', { threadId })),
      )
      return snapshots.every(({ snapshot }) => snapshot.turns.at(-1)?.status === 'completed')
    },
    '三个并发会话未全部完成',
    60_000,
  )
}

async function waitFor(
  predicate: () => Promise<boolean>,
  message: string,
  timeoutMs = 30_000,
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error(message)
}

type LayoutStorageWrites = Record<string, number>

async function startLayoutStorageProbe(currentPage: Page): Promise<void> {
  await currentPage.evaluate(() => {
    const target = window as typeof window & {
      __reviewLayoutStorageProbe?: {
        original: typeof Storage.prototype.setItem
        writes: Record<string, number>
      }
    }
    if (target.__reviewLayoutStorageProbe) return
    const original = Storage.prototype.setItem
    const writes: Record<string, number> = {}
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      if (
        this === window.localStorage &&
        (key === 'pidex.desktop.rightDockWidthRatio.v2' ||
          key === 'pidex.desktop.bottomPanelHeightRatio.v3')
      ) {
        writes[key] = (writes[key] ?? 0) + 1
      }
      original.call(this, key, value)
    }
    target.__reviewLayoutStorageProbe = { original, writes }
  })
}

async function readLayoutStorageWrites(currentPage: Page): Promise<LayoutStorageWrites> {
  return currentPage.evaluate(() => {
    const target = window as typeof window & {
      __reviewLayoutStorageProbe?: {
        writes: Record<string, number>
      }
    }
    return { ...(target.__reviewLayoutStorageProbe?.writes ?? {}) }
  })
}

async function stopLayoutStorageProbe(currentPage: Page): Promise<LayoutStorageWrites> {
  return currentPage.evaluate(() => {
    const target = window as typeof window & {
      __reviewLayoutStorageProbe?: {
        original: typeof Storage.prototype.setItem
        writes: Record<string, number>
      }
    }
    const probe = target.__reviewLayoutStorageProbe
    if (!probe) return {}
    Storage.prototype.setItem = probe.original
    delete target.__reviewLayoutStorageProbe
    return { ...probe.writes }
  })
}

async function movePointerInSteps(
  currentPage: Page,
  input: {
    fromX: number
    fromY: number
    deltaX: number
    deltaY: number
  },
): Promise<void> {
  for (let step = 1; step <= 60; step += 1) {
    await currentPage.mouse.move(
      input.fromX + (input.deltaX * step) / 60,
      input.fromY + (input.deltaY * step) / 60,
    )
    if (step % 10 === 0) await currentPage.waitForTimeout(8)
  }
}

async function dragLivePanel({
  page: currentPage,
  separator,
  panel,
  deltaX,
  deltaY,
  storageKey,
}: {
  page: Page
  separator: Locator
  panel: Locator
  deltaX: number
  deltaY: number
  storageKey: string
}): Promise<{
  boundaryErrorPx: number
  liveSize: { width: number; height: number }
}> {
  const separatorBox = await separator.boundingBox()
  if (!separatorBox) throw new Error(`无法读取 ${storageKey} 分隔线`)
  const startX = separatorBox.x + separatorBox.width / 2
  const startY = separatorBox.y + separatorBox.height / 2
  const writesBefore = await readLayoutStorageWrites(currentPage)
  const writeCountBefore = writesBefore[storageKey] ?? 0
  await currentPage.mouse.move(startX, startY)
  await currentPage.mouse.down()
  await movePointerInSteps(currentPage, {
    fromX: startX,
    fromY: startY,
    deltaX,
    deltaY,
  })
  const livePanelBox = await panel.boundingBox()
  const liveSeparatorBox = await separator.boundingBox()
  if (!livePanelBox || !liveSeparatorBox) {
    throw new Error(`拖动 ${storageKey} 时无法读取实时尺寸`)
  }
  const writesDuring = await readLayoutStorageWrites(currentPage)
  expect(writesDuring[storageKey] ?? 0).toBe(writeCountBefore)
  const transform = await panel.evaluate((element) => {
    const shell = element.closest('.desktop-workspace-panel')
    const surface = shell?.querySelector<HTMLElement>('.desktop-workspace-panel__surface')
    return surface ? getComputedStyle(surface).transform : 'none'
  })
  expect(transform).toBe('none')
  const boundaryErrorPx =
    Math.abs(deltaX) >= Math.abs(deltaY)
      ? Math.abs(liveSeparatorBox.x + liveSeparatorBox.width / 2 - (startX + deltaX))
      : Math.abs(liveSeparatorBox.y + liveSeparatorBox.height / 2 - (startY + deltaY))
  expect(boundaryErrorPx).toBeLessThanOrEqual(2)
  await currentPage.mouse.up()
  await currentPage.evaluate(
    () =>
      new Promise<void>((resolveWait) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolveWait()))
      }),
  )
  await expect
    .poll(async () => {
      const writesAfter = await readLayoutStorageWrites(currentPage)
      return writesAfter[storageKey] ?? 0
    })
    .toBe(writeCountBefore + 1)
  return {
    boundaryErrorPx,
    liveSize: {
      width: livePanelBox.width,
      height: livePanelBox.height,
    },
  }
}

type InteractionMetrics = {
  dragMetrics: Record<string, { frameP95Ms: number; maxLongTaskMs: number }>
  durationMs: number
  frameP95Ms: number
  maxFrameMs: number
  maxLongTaskMs: number
  longTasks: Array<{
    startMs: number
    durationMs: number
    scripts?: Array<{
      durationMs: number
      forcedStyleAndLayoutDurationMs: number
      functionName: string
      invoker: string
      sourceUrl: string
    }>
  }>
  phases: Array<{ name: string; atMs: number }>
}

async function startInteractionProbe(currentPage: Page): Promise<void> {
  await currentPage.evaluate(() => {
    const target = window as typeof window & {
      __reviewConcurrencyProbe?: {
        animationFrame: number
        frameSamples: Array<{ atMs: number; durationMs: number }>
        lastFrame: number
        longTasks: InteractionMetrics['longTasks']
        observer: PerformanceObserver | null
        phases: Array<{ name: string; atMs: number }>
        startedAt: number
      }
    }
    const probe = {
      animationFrame: 0,
      frameSamples: [] as Array<{ atMs: number; durationMs: number }>,
      lastFrame: performance.now(),
      longTasks: [] as InteractionMetrics['longTasks'],
      observer: null as PerformanceObserver | null,
      phases: [] as Array<{ name: string; atMs: number }>,
      startedAt: performance.now(),
    }
    const frame = (now: number): void => {
      probe.frameSamples.push({
        atMs: now - probe.startedAt,
        durationMs: now - probe.lastFrame,
      })
      probe.lastFrame = now
      probe.animationFrame = requestAnimationFrame(frame)
    }
    probe.animationFrame = requestAnimationFrame(frame)
    const entryType = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')
      ? 'long-animation-frame'
      : PerformanceObserver.supportedEntryTypes.includes('longtask')
        ? 'longtask'
        : null
    if (entryType) {
      probe.observer = new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          const scripts = (
            entry as PerformanceEntry & {
              scripts?: Array<{
                duration: number
                forcedStyleAndLayoutDuration: number
                sourceURL: string
                sourceFunctionName: string
                invoker: string
              }>
            }
          ).scripts
          probe.longTasks.push({
            startMs: entry.startTime - probe.startedAt,
            durationMs: entry.duration,
            ...(scripts
              ? {
                  scripts: scripts.map((script) => ({
                    durationMs: script.duration,
                    forcedStyleAndLayoutDurationMs: script.forcedStyleAndLayoutDuration,
                    functionName: script.sourceFunctionName,
                    invoker: script.invoker,
                    sourceUrl: script.sourceURL,
                  })),
                }
              : {}),
          })
        }
      })
      probe.observer.observe({ entryTypes: [entryType] })
    }
    target.__reviewConcurrencyProbe = probe
  })
}

async function markInteractionPhase(currentPage: Page, name: string): Promise<void> {
  await currentPage.evaluate((phaseName) => {
    const target = window as typeof window & {
      __reviewConcurrencyProbe?: {
        phases: Array<{ name: string; atMs: number }>
        startedAt: number
      }
    }
    const probe = target.__reviewConcurrencyProbe
    if (!probe) return
    probe.phases.push({
      name: phaseName,
      atMs: performance.now() - probe.startedAt,
    })
  }, name)
}

async function stopInteractionProbe(currentPage: Page): Promise<InteractionMetrics> {
  await currentPage.evaluate(
    () =>
      new Promise<void>((resolveWait) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolveWait()))
      }),
  )
  return currentPage.evaluate(() => {
    const target = window as typeof window & {
      __reviewConcurrencyProbe?: {
        animationFrame: number
        frameSamples: Array<{ atMs: number; durationMs: number }>
        longTasks: InteractionMetrics['longTasks']
        observer: PerformanceObserver | null
        phases: Array<{ name: string; atMs: number }>
        startedAt: number
      }
    }
    const probe = target.__reviewConcurrencyProbe
    if (!probe) throw new Error('Review concurrency probe 未启动')
    cancelAnimationFrame(probe.animationFrame)
    probe.observer?.disconnect()
    const sorted = probe.frameSamples
      .map((sample) => sample.durationMs)
      .sort((left, right) => left - right)
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
    const phases = new Map(probe.phases.map((phase) => [phase.name, phase.atMs]))
    const dragWindows = [
      ['right', 'right-drag-start', 'right-drag-end'],
      ['fileTree', 'file-tree-pointer-down', 'file-tree-drag-end'],
      ['bottom', 'bottom-drag-start', 'bottom-drag-end'],
    ] as const
    const dragMetrics = Object.fromEntries(
      dragWindows.map(([name, startName, endName]) => {
        const start = phases.get(startName) ?? 0
        const end = phases.get(endName) ?? start
        const dragFrames = probe.frameSamples
          .filter((sample) => sample.atMs >= start && sample.atMs <= end)
          .map((sample) => sample.durationMs)
          .sort((left, right) => left - right)
        const dragP95Index = Math.max(0, Math.ceil(dragFrames.length * 0.95) - 1)
        const overlappingLongTasks = probe.longTasks.filter(
          (entry) => entry.startMs < end && entry.startMs + entry.durationMs > start,
        )
        return [
          name,
          {
            frameP95Ms: dragFrames[dragP95Index] ?? 0,
            maxLongTaskMs: Math.max(0, ...overlappingLongTasks.map((entry) => entry.durationMs)),
          },
        ]
      }),
    )
    delete target.__reviewConcurrencyProbe
    return {
      dragMetrics,
      durationMs: performance.now() - probe.startedAt,
      frameP95Ms: sorted[p95Index] ?? 0,
      maxFrameMs: sorted.at(-1) ?? 0,
      maxLongTaskMs: Math.max(0, ...probe.longTasks.map((entry) => entry.durationMs)),
      longTasks: probe.longTasks,
      phases: probe.phases,
    }
  })
}

async function readReviewFileTreeCommittedWidth(
  reviewMain: ReturnType<Page['locator']>,
): Promise<number> {
  return reviewMain.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).getPropertyValue('--review-file-tree-panel-w')),
  )
}

type RpcClient = {
  call: <T = unknown>(method: string, params: Record<string, unknown>) => Promise<T>
}

async function createRpcClient(origin: string, token: string): Promise<RpcClient> {
  let sequence = 0
  let connectionId = ''
  const request = async <T>(
    method: string,
    params: Record<string, unknown>,
    notification = false,
  ): Promise<T> => {
    const response = await fetch(`${origin}/rpc`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(connectionId ? { 'x-pidex-connection-id': connectionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        ...(notification ? {} : { id: `review:${++sequence}` }),
        method,
        params,
      }),
    })
    if (notification) return undefined as T
    const payload = (await response.json()) as {
      result?: T
      error?: unknown
    }
    if (payload.error) {
      throw new Error(`${method}: ${JSON.stringify(payload.error)}`)
    }
    return payload.result as T
  }

  const initialized = await request<{ connectionId: string }>('initialize', {
    clientInfo: {
      name: 'review-concurrency-control',
      version: '1.0.0',
      platform: 'win32',
    },
    protocols: ['thread-rpc-v4'],
    capabilities: [
      'rpc.typed.v1',
      'events.live.v1',
      'events.replay.v1',
      'turn.admission.v1',
      'git.review.v1',
    ],
    interactionDelivery: 'observe',
  })
  connectionId = initialized.connectionId
  await request('initialized', { protocol: 'thread-rpc-v4' }, true)
  return { call: request }
}

async function readReviewConcurrencyEvents(): Promise<ReviewConcurrencyEvent[]> {
  return (await readReviewConcurrencyState()).events
}

async function readReviewConcurrencyState(): Promise<{
  events: ReviewConcurrencyEvent[]
  maxActiveFileDiffRequests: number
}> {
  const response = await fetch(`${agentOrigin}/__review-concurrency/events`)
  if (!response.ok) {
    throw new Error('无法读取 Review concurrency Agent 事件')
  }
  const payload = (await response.json()) as {
    events?: ReviewConcurrencyEvent[]
    maxActiveFileDiffRequests?: number
  }
  return {
    events: payload.events ?? [],
    maxActiveFileDiffRequests: payload.maxActiveFileDiffRequests ?? 0,
  }
}

async function clearReviewConcurrencyEvents(): Promise<void> {
  const response = await fetch(`${agentOrigin}/__review-concurrency/events`, { method: 'DELETE' })
  if (!response.ok) throw new Error('无法清理 Review concurrency Agent 事件')
}

async function setBatchCapability(enabled: boolean): Promise<void> {
  const response = await fetch(`${agentOrigin}/__review-concurrency/batch-capability`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  if (!response.ok) throw new Error('无法设置 Review concurrency 批量能力')
}

function assertSummaryNeverReadsWholePatch(events: readonly ReviewConcurrencyEvent[]): void {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (
      event?.type !== 'rpc' ||
      (event.method !== 'review/summary' && event.method !== 'review/refresh')
    ) {
      continue
    }
    const nextFileRequest = events.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        candidate.type === 'rpc' &&
        (candidate.method === 'review/fileDiff' || candidate.method === 'review/file-diffs'),
    )
    const summaryEvents = events.slice(
      index + 1,
      nextFileRequest < 0 ? events.length : nextFileRequest,
    )
    expect(
      summaryEvents.some(
        (candidate) =>
          candidate.type === 'git' &&
          candidate.args[0] === 'diff' &&
          candidate.args.includes('--binary'),
      ),
    ).toBe(false)
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Review concurrency 缺少环境变量 ${name}`)
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
  if (!executable) {
    throw new Error('Review concurrency 测试未找到 bun.exe')
  }
  return executable
}
