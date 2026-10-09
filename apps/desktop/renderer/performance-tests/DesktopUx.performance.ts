import { expect, test } from '@playwright/test'
import {
  measurePerformanceThreadSwitch,
  nearestRankP95,
  recordRendererSample,
  startInteractionProbe,
  stopInteractionProbe,
  waitForFixture,
  waitForPerformanceThread,
} from './PerformanceTestHelpers.js'

test.describe('desktop UX performance', () => {
  test('sidebar resize commits storage once after pointer release', async ({ page }) => {
    await page.addInitScript(() => {
      const target = window as typeof window & {
        __sidebarWidthWrites?: number
      }
      target.__sidebarWidthWrites = 0
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === 'layout.sidebarWidth') {
          target.__sidebarWidthWrites = (target.__sidebarWidthWrites ?? 0) + 1
        }
        return original.call(this, key, value)
      }
    })
    await waitForFixture(page, 100, 30)
    const handle = page.locator('.sidebar-resizer')
    await expect(handle).toBeVisible()
    await performSidebarDrag(page, handle, 10, true)
    await settlePage(page)

    for (let sample = 1; sample <= 3; sample += 1) {
      await page.evaluate(() => {
        ;(window as typeof window & { __sidebarWidthWrites?: number }).__sidebarWidthWrites = 0
      })
      await startInteractionProbe(page)
      await performSidebarDrag(page, handle, 60, false)
      const writesDuringDrag = await page.evaluate(
        () =>
          (window as typeof window & { __sidebarWidthWrites?: number }).__sidebarWidthWrites ?? 0,
      )
      await page.mouse.up()
      const interaction = await stopInteractionProbe(page)
      const writesAfterDrop = await page.evaluate(
        () =>
          (window as typeof window & { __sidebarWidthWrites?: number }).__sidebarWidthWrites ?? 0,
      )
      await recordRendererSample(page, 'sidebar-resize', sample, {
        ...interaction,
        writesAfterDrop,
        writesDuringDrag,
      })
    }
  })

  test('workbench panels reflow live and persist only after release', async ({ page }) => {
    await page.addInitScript(() => {
      const target = window as typeof window & {
        __workbenchSizeWrites?: Record<string, number>
      }
      target.__workbenchSizeWrites = {}
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function setItem(key, value) {
        if (
          key === 'pidex.desktop.rightDockWidthRatio.v2' ||
          key === 'pidex.desktop.bottomPanelHeightRatio.v3'
        ) {
          const writes = target.__workbenchSizeWrites ?? {}
          writes[key] = (writes[key] ?? 0) + 1
          target.__workbenchSizeWrites = writes
        }
        return original.call(this, key, value)
      }
    })
    await waitForFixture(page, 500, 30)

    await page.getByRole('button', { name: '显示右侧面板' }).click()
    const rightHandle = page.getByRole('separator', {
      name: '调整右侧面板宽度',
    })
    const rightShell = page.locator('.desktop-workspace-panel--right')
    const mainRoute = page.locator('.desktop-main-route')
    await expect(rightHandle).toBeVisible()

    for (let sample = 1; sample <= 3; sample += 1) {
      await rightHandle.press('Home')
      await settlePage(page)
      await resetWorkbenchWriteCount(page)
      const before = await readRightPanelGeometry(rightShell, mainRoute)
      await startInteractionProbe(page)
      await performPanelDrag(page, rightHandle, 96, 0, 120, false)
      const during = await readRightPanelGeometry(rightShell, mainRoute)
      const writesDuringDrag = await readWorkbenchWriteCount(
        page,
        'pidex.desktop.rightDockWidthRatio.v2',
      )
      await page.mouse.up()
      const interaction = await stopInteractionProbe(page)
      const writesAfterDrop = await readWorkbenchWriteCount(
        page,
        'pidex.desktop.rightDockWidthRatio.v2',
      )
      await recordRendererSample(page, 'workbench-right-live-resize', sample, {
        ...interaction,
        liveMainSizeChanged: Math.abs(during.mainSize - before.mainSize) > 48 ? 1 : 0,
        livePanelSizeChanged: Math.abs(during.panelSize - before.panelSize) > 48 ? 1 : 0,
        panelBoundaryGap: during.panelBoundaryGap,
        writesAfterDrop,
        writesDuringDrag,
      })
    }

    await page.getByRole('menuitem', { name: '查看' }).click()
    await page.getByRole('menuitem', { name: '切换底部面板' }).click()
    const bottomHandle = page.getByRole('separator', {
      name: '调整底部面板高度',
    })
    const bottomShell = page.locator('.desktop-workspace-panel--bottom')
    const bottomSpacer = page.locator('.desktop-workspace-panel-spacer--bottom')
    const upperRegion = page.locator('.desktop-workspace__upper')
    await expect(bottomHandle).toBeVisible()

    for (let sample = 1; sample <= 3; sample += 1) {
      await bottomHandle.press('Home')
      await settlePage(page)
      await resetWorkbenchWriteCount(page)
      const before = await readPanelGeometry(bottomShell, bottomSpacer, upperRegion, 'height')
      await startInteractionProbe(page)
      await performPanelDrag(page, bottomHandle, 0, -80, 120, false)
      const during = await readPanelGeometry(bottomShell, bottomSpacer, upperRegion, 'height')
      const writesDuringDrag = await readWorkbenchWriteCount(
        page,
        'pidex.desktop.bottomPanelHeightRatio.v3',
      )
      await page.mouse.up()
      const interaction = await stopInteractionProbe(page)
      const writesAfterDrop = await readWorkbenchWriteCount(
        page,
        'pidex.desktop.bottomPanelHeightRatio.v3',
      )
      await recordRendererSample(page, 'bottom-panel-live-resize', sample, {
        ...interaction,
        liveMainSizeChanged: Math.abs(during.mainSize - before.mainSize) > 48 ? 1 : 0,
        livePanelSizeChanged: Math.abs(during.panelSize - before.panelSize) > 48 ? 1 : 0,
        panelSpacerDelta: Math.abs(during.panelSize - during.spacerSize),
        writesAfterDrop,
        writesDuringDrag,
      })
    }
  })

  test('window continuous resize maintains 60fps and settles storage writes', async ({ page }) => {
    await page.addInitScript(() => {
      const target = window as typeof window & {
        __workbenchLayoutWrites?: number
      }
      target.__workbenchLayoutWrites = 0
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === 'pidex.desktop.workbenchLayout.v1') {
          target.__workbenchLayoutWrites = (target.__workbenchLayoutWrites ?? 0) + 1
        }
        return original.call(this, key, value)
      }
    })
    await waitForFixture(page, 500, 30)

    const initialViewport = { width: 1280, height: 800 }
    await page.setViewportSize(initialViewport)
    await page.waitForTimeout(600)
    await settlePage(page)
    await performWindowResize(page, 1280, 800, -20, -10, 6)
    await page.waitForTimeout(600)
    await page.setViewportSize(initialViewport)
    await page.waitForTimeout(600)
    await settlePage(page)
    for (let sample = 1; sample <= 3; sample += 1) {
      await page.setViewportSize(initialViewport)
      await page.waitForTimeout(600)
      await settlePage(page)
      await page.evaluate(() => {
        ;(window as typeof window & { __workbenchLayoutWrites?: number }).__workbenchLayoutWrites =
          0
      })

      await startInteractionProbe(page)
      await performWindowResize(page, 1280, 800, -200, -100, 30)
      const writesDuringDrag = await page.evaluate(
        () =>
          (window as typeof window & { __workbenchLayoutWrites?: number })
            .__workbenchLayoutWrites ?? 0,
      )
      await page.waitForFunction(
        () =>
          ((window as typeof window & { __workbenchLayoutWrites?: number })
            .__workbenchLayoutWrites ?? 0) >= 1,
        undefined,
        { timeout: 5_000 },
      )
      await settlePage(page)
      const writesAfterDrop = await page.evaluate(
        () =>
          (window as typeof window & { __workbenchLayoutWrites?: number })
            .__workbenchLayoutWrites ?? 0,
      )
      const interaction = await stopInteractionProbe(page)
      await recordRendererSample(page, 'window-resize', sample, {
        ...interaction,
        writesAfterDrop,
        writesDuringDrag,
      })
    }

    await page.getByRole('button', { name: '显示右侧面板' }).click()
    const rightShell = page.locator('.desktop-workspace-panel--right')
    await expect(rightShell).toBeVisible()
    await page.setViewportSize({ width: 1400, height: 900 })
    await settlePage(page)

    const beforeRightBox = await rightShell.boundingBox()
    if (!beforeRightBox) {
      throw new Error('Right panel should be visible before resize')
    }

    await performWindowResize(page, 1400, 900, -100, -50, 30)
    const duringRightBox = await rightShell.boundingBox()
    if (!duringRightBox) {
      throw new Error('Right panel should remain visible during resize')
    }
    expect(duringRightBox.width).toBeLessThan(beforeRightBox.width)

    await performWindowResize(page, 1300, 850, -100, -50, 30)
    await settlePage(page)

    const afterRightBox = await rightShell.boundingBox()
    if (!afterRightBox) {
      throw new Error('Right panel should remain visible after resize')
    }
    expect(afterRightBox.width).toBeLessThan(duringRightBox.width)
  })

  test('long conversation scrolling remains virtualized', async ({ page }) => {
    await waitForFixture(page, 250, 30)
    const scrollArea = page.locator('.workflow-main-scroll-area')
    await expect(scrollArea).toBeVisible()
    await scrollTimeline(scrollArea)

    for (let sample = 1; sample <= 3; sample += 1) {
      await startInteractionProbe(page)
      await scrollTimeline(scrollArea)
      const interaction = await stopInteractionProbe(page)
      const mountedTurns = await page.locator('[data-turn-navigation-id]').count()
      await recordRendererSample(page, 'timeline-scroll', sample, {
        ...interaction,
        mountedTurns,
      })
    }
  })

  test('cold and cached session switches remove stale content', async ({ page }) => {
    await waitForFixture(page, 100, 30)

    for (let targetIndex = 2; targetIndex <= 30; targetIndex += 1) {
      const switchMetrics = await measurePerformanceThreadSwitch(
        page,
        targetIndex - 1,
        targetIndex,
        10,
        false,
      )
      await recordRendererSample(page, 'cold-switch', targetIndex - 1, {
        readyMs: switchMetrics.readyMs,
        staleVisibleMs: switchMetrics.staleVisibleMs,
      })
    }

    await page.evaluate(() => {
      location.hash = '#/threads/performance-session-001'
    })
    await waitForPerformanceThread(page, 1, 100)
    await page.evaluate(() => {
      location.hash = '#/threads/performance-session-002'
    })
    await waitForPerformanceThread(page, 2, 10)

    const cachedSwitch = await measurePerformanceThreadSwitch(page, 2, 1, 100, false)
    await recordRendererSample(page, 'cached-switch', 1, {
      cachedContentMs: cachedSwitch.contentVisibleMs,
      readyMs: cachedSwitch.readyMs,
    })
  })

  test('composer input remains responsive in a long conversation', async ({ page }) => {
    await waitForFixture(page, 500, 30)

    for (let sample = 1; sample <= 3; sample += 1) {
      await page.evaluate(() => {
        location.hash = '#/threads/performance-session-002'
      })
      await waitForPerformanceThread(page, 2, 10)
      const shortP95 = await measureComposerInput(page)
      await page.evaluate(() => {
        location.hash = '#/threads/performance-session-001'
      })
      await waitForPerformanceThread(page, 1, 500)
      const longP95 = await measureComposerInput(page)
      // Sub-frame headless rAF timings fluctuate by fractions of a frame.
      // Normalize the paired regression to one 60 Hz frame so the relative
      // budget detects user-visible degradation instead of timer phase noise.
      await recordRendererSample(page, 'composer-input', sample, {
        inputToPaintP95Ms: longP95,
        relativeDegradationPercent: ((longP95 - shortP95) / Math.max(1000 / 60, shortP95)) * 100,
      })
    }
  })

  test('heap remains bounded across fifty session switches', async ({ page }) => {
    await waitForFixture(page, 10, 50)
    const before = await collectHeapAfterGc(page)
    for (let index = 1; index <= 50; index += 1) {
      await page.evaluate((threadIndex) => {
        location.hash = `#/threads/performance-session-${String(threadIndex).padStart(3, '0')}`
      }, index)
      await waitForPerformanceThread(page, index, 10)
    }
    const after = await collectHeapAfterGc(page)
    const heapDeltaBytes = after - before
    const heapDeltaPercent = (heapDeltaBytes / Math.max(1, before)) * 100
    await recordRendererSample(page, 'memory-stability', 1, {
      heapDeltaMiB: heapDeltaBytes / 1024 / 1024,
      heapDeltaPercent,
      heapRegressionScore: heapDeltaPercent > 25 && heapDeltaBytes > 25 * 1024 * 1024 ? 1 : 0,
    })
  })

  test('sidebar drag and drop settles without rebuilding the full catalog', async ({ page }) => {
    await waitForFixture(page, 10, 50)
    const rows = page.locator('.sidebar-session-row[draggable="true"]')
    if ((await rows.count()) === 0) {
      await page.locator('[data-sidebar-section-id="recent"]').click()
    }
    await expect(rows.first()).toBeVisible()
    const showMore = page.getByRole('button', { name: '展开显示' })
    while ((await rows.count()) < 50 && (await showMore.count()) > 0) {
      await showMore.first().click()
    }
    expect(await rows.count()).toBe(50)
    await measureSidebarDrop(page, rows.nth(0), rows.nth(1))
    await settlePage(page)

    for (let sample = 1; sample <= 3; sample += 1) {
      const source = rows.nth(sample % 2)
      const target = rows.nth((sample + 1) % 2)
      const dropMetrics = await measureSidebarDrop(page, source, target)
      await recordRendererSample(page, 'sidebar-dnd', sample, {
        ...dropMetrics,
      })
    }
  })

  test('editor file tree toggle commits width once and FLIPs', async ({ page }) => {
    await waitForFixture(page, 250, 30)
    await page.getByRole('button', { name: '显示右侧面板' }).click()
    const rightPanel = page.getByRole('complementary', {
      name: '右侧面板',
    })
    await rightPanel.getByRole('button', { name: '文件 Ctrl+P' }).click()
    await rightPanel.getByText('README.md', { exact: true }).click()
    const showTree = rightPanel.getByRole('button', { name: '显示文件树' })
    await expect(showTree).toBeVisible()
    await showTree.click()
    const hideTree = rightPanel.getByRole('button', { name: '隐藏文件树' })
    await expect(hideTree).toBeVisible()

    for (let sample = 1; sample <= 3; sample += 1) {
      await settlePage(page)
      await startInteractionProbe(page)
      await hideTree.click()
      await showTree.waitFor()
      const interaction = await stopInteractionProbe(page)
      await recordRendererSample(page, 'editor-file-tree-toggle', sample, {
        ...interaction,
      })
      await showTree.click()
      await hideTree.waitFor()
    }
  })

  test('nested process list scrolling keeps edge fades frame-cheap', async ({ page }) => {
    // 这里只测嵌套 scroller；使用小型外层会话避免虚拟列表把目标 turn
    // 卸载后将外层 timeline 成本混入样本。
    await waitForFixture(page, 10, 30, { nestedScroll: true })
    const activitySummary = page.locator('.canonical-turn-activity__summary').last()
    await expect(activitySummary).toBeVisible()
    if ((await activitySummary.getAttribute('aria-expanded')) === 'false') {
      await activitySummary.click()
    }
    const processSummary = page.locator('.canonical-process-group__summary')
    await expect(processSummary.first()).toBeVisible()
    await processSummary.first().click()
    const processItems = page.locator('.canonical-process-group__items')
    await expect(processItems.first()).toBeVisible()
    await expect(
      processItems.first().locator('.canonical-process-group__items-content > *'),
    ).toHaveCount(12)
    const edgeFrame = page.locator('.canonical-process-edge-fade').first()
    await expect(edgeFrame).toHaveAttribute('data-scrollable', 'true')

    for (let sample = 1; sample <= 3; sample += 1) {
      await startInteractionProbe(page)
      await scrollNestedTimeline(processItems.first())
      const interaction = await stopInteractionProbe(page)
      await recordRendererSample(page, 'nested-scroll-edge-fade', sample, {
        ...interaction,
      })
    }
  })

  test('skeleton shimmer stays on the compositor path', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await waitForFixture(page, 10, 30)
    await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'off')
    await page.evaluate(() => {
      const block = document.createElement('div')
      block.className = 'ui-skeleton-block'
      block.style.cssText = 'position: fixed; inset: 0;'
      document.body.appendChild(block)
    })
    const shimmer = await page.evaluate(() => {
      const block = document.querySelector<HTMLElement>('.ui-skeleton-block')
      if (!block) throw new Error('Skeleton performance fixture was not mounted')
      const style = getComputedStyle(block, '::after')
      return {
        animationDuration: style.animationDuration,
        animationName: style.animationName,
        loadingToken: getComputedStyle(block).getPropertyValue('--motion-loading').trim(),
      }
    })
    expect(shimmer).toEqual({
      animationDuration: '0.9s',
      animationName: 'ui-skeleton-sweep',
      loadingToken: '900ms',
    })

    for (let sample = 1; sample <= 3; sample += 1) {
      await startInteractionProbe(page)
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            let frames = 0
            const tick = (): void => {
              if (frames >= 48) {
                resolve()
              } else {
                frames += 1
                requestAnimationFrame(tick)
              }
            }
            requestAnimationFrame(tick)
          }),
      )
      const interaction = await stopInteractionProbe(page)
      await recordRendererSample(page, 'skeleton-shimmer', sample, {
        ...interaction,
      })
    }
  })
})

async function measureComposerInput(page: import('@playwright/test').Page): Promise<number> {
  const editor = page.locator('.composer-editor-content')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  const latencies: number[] = []
  for (const character of 'Pidex-performance-input-response-0123456789-abcdefghij') {
    await page.evaluate(() => {
      const targetWindow = window as typeof window & {
        __pidexInputPaint?: Promise<number>
      }
      targetWindow.__pidexInputPaint = new Promise((resolve) => {
        document.addEventListener(
          'input',
          () => {
            const startedAt = performance.now()
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(performance.now() - startedAt)),
            )
          },
          { capture: true, once: true },
        )
      })
    })
    await page.keyboard.type(character)
    latencies.push(
      await page.evaluate(() => {
        const targetWindow = window as typeof window & {
          __pidexInputPaint?: Promise<number>
        }
        return targetWindow.__pidexInputPaint
      }),
    )
  }
  return nearestRankP95(latencies)
}

async function measureSidebarDrop(
  page: import('@playwright/test').Page,
  source: import('@playwright/test').Locator,
  target: import('@playwright/test').Locator,
): Promise<{ dropReadyMs: number; moveMs: number }> {
  await target.evaluate((element) => {
    const targetWindow = window as typeof window & {
      __pidexDropReady?: Promise<{
        dropReadyMs: number
        moveMs: number
      }>
    }
    targetWindow.__pidexDropReady = new Promise((resolve) => {
      let dropReadyMs: number | null = null
      let moveMs: number | null = null
      const finish = (): void => {
        if (dropReadyMs === null || moveMs === null) return
        resolve({ dropReadyMs, moveMs })
      }
      element.addEventListener(
        'dragover',
        () => {
          const movedAt = performance.now()
          requestAnimationFrame(() => {
            moveMs = performance.now() - movedAt
            finish()
          })
        },
        { capture: true, once: true },
      )
      element.addEventListener(
        'drop',
        () => {
          const droppedAt = performance.now()
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              dropReadyMs = performance.now() - droppedAt
              finish()
            }),
          )
        },
        { capture: true, once: true },
      )
    })
  })
  await source.dragTo(target)
  return page.evaluate(() => {
    const targetWindow = window as typeof window & {
      __pidexDropReady?: Promise<{
        dropReadyMs: number
        moveMs: number
      }>
    }
    return targetWindow.__pidexDropReady
  })
}

async function performSidebarDrag(
  page: import('@playwright/test').Page,
  handle: import('@playwright/test').Locator,
  steps: number,
  release: boolean,
): Promise<void> {
  const box = await handle.boundingBox()
  if (!box) throw new Error('Sidebar resize handle has no bounds')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(box.x + box.width / 2 + step * (90 / steps), box.y + box.height / 2)
  }
  if (release) await page.mouse.up()
}

async function performPanelDrag(
  page: import('@playwright/test').Page,
  handle: import('@playwright/test').Locator,
  deltaX: number,
  deltaY: number,
  steps: number,
  release: boolean,
): Promise<void> {
  const box = await handle.boundingBox()
  if (!box) throw new Error('Workbench resize handle has no bounds')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(startX + (deltaX * step) / steps, startY + (deltaY * step) / steps)
  }
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  if (release) await page.mouse.up()
}

async function readRightPanelGeometry(
  panel: import('@playwright/test').Locator,
  main: import('@playwright/test').Locator,
): Promise<{ mainSize: number; panelSize: number; panelBoundaryGap: number }> {
  const [panelBox, mainBox] = await Promise.all([panel.boundingBox(), main.boundingBox()])
  if (!panelBox || !mainBox) {
    throw new Error('Workbench right panel geometry is unavailable')
  }
  return {
    mainSize: mainBox.width,
    panelSize: panelBox.width,
    panelBoundaryGap: Math.abs(mainBox.x + mainBox.width - panelBox.x),
  }
}

async function performWindowResize(
  page: import('@playwright/test').Page,
  startWidth: number,
  startHeight: number,
  deltaWidth: number,
  deltaHeight: number,
  steps = 60,
): Promise<void> {
  for (let step = 1; step <= steps; step += 1) {
    const currentWidth = Math.round(startWidth + (deltaWidth * step) / steps)
    const currentHeight = Math.round(startHeight + (deltaHeight * step) / steps)
    await page.setViewportSize({ width: currentWidth, height: currentHeight })
  }
}

async function readPanelGeometry(
  panel: import('@playwright/test').Locator,
  spacer: import('@playwright/test').Locator,
  main: import('@playwright/test').Locator,
  axis: 'width' | 'height' = 'width',
): Promise<{ mainSize: number; panelSize: number; spacerSize: number }> {
  const [panelBox, spacerBox, mainBox] = await Promise.all([
    panel.boundingBox(),
    spacer.boundingBox(),
    main.boundingBox(),
  ])
  if (!panelBox || !spacerBox || !mainBox) {
    throw new Error('Workbench panel geometry is unavailable')
  }
  return {
    mainSize: mainBox[axis],
    panelSize: panelBox[axis],
    spacerSize: spacerBox[axis],
  }
}

async function resetWorkbenchWriteCount(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    ;(
      window as typeof window & {
        __workbenchSizeWrites?: Record<string, number>
      }
    ).__workbenchSizeWrites = {}
  })
}

async function readWorkbenchWriteCount(
  page: import('@playwright/test').Page,
  key: string,
): Promise<number> {
  return page.evaluate(
    (storageKey) =>
      (
        window as typeof window & {
          __workbenchSizeWrites?: Record<string, number>
        }
      ).__workbenchSizeWrites?.[storageKey] ?? 0,
    key,
  )
}

async function scrollTimeline(scrollArea: import('@playwright/test').Locator): Promise<void> {
  await scrollArea.evaluate(async (element) => {
    for (let step = 0; step < 100; step += 1) {
      element.scrollTop = (step / 99) * Math.max(0, element.scrollHeight - element.clientHeight)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  })
}

async function scrollNestedTimeline(scrollArea: import('@playwright/test').Locator): Promise<void> {
  await scrollArea.evaluate(async (element) => {
    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
    for (let step = 0; step < 100; step += 1) {
      // 顶部 → 底部 → 顶部，完整覆盖两个边缘的渐隐状态切换。
      const progress = step < 50 ? step / 49 : 2 - step / 49
      element.scrollTop = progress * maxScroll
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  })
}

async function settlePage(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const finish = (): void => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(finish, { timeout: 1_000 })
        } else {
          finish()
        }
      }),
  )
}

async function collectHeapAfterGc(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(async () => {
    const target = globalThis as typeof globalThis & { gc?: () => void }
    target.gc?.()
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    return (
      (
        performance as Performance & {
          memory?: { usedJSHeapSize: number }
        }
      ).memory?.usedJSHeapSize ?? 0
    )
  })
}
