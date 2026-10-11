import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  closeTransientErrorToast,
  prepareVisualTheme,
  waitForVisualPage,
} from './VisualTestHelpers.js'

const MOTION_MODES = ['on', 'off'] as const

test.describe('animation contracts', () => {
  for (const motion of MOTION_MODES) {
    test(`editor file tree toggle commits width and unmounts presence (${motion})`, async ({
      page,
    }) => {
      await openVisualFixture(page, 'rich', motion)
      await page.getByRole('button', { name: '显示右侧面板' }).click()
      const rightPanel = page.getByRole('complementary', {
        name: '右侧面板',
      })
      await rightPanel.getByRole('button', { name: '文件 Ctrl+P' }).click()
      await rightPanel.getByText('README.md', { exact: true }).click()
      const preview = rightPanel.locator('.right-dock-file-preview')
      await expect(preview).toBeVisible()
      const treeToggle = preview.locator('.file-breadcrumb-toolbar__action[aria-pressed]')
      await expect(treeToggle).toBeVisible()
      if ((await treeToggle.getAttribute('aria-pressed')) === 'true') {
        await treeToggle.click()
      }
      await expect(treeToggle).toHaveAttribute('aria-pressed', 'false')

      // 显示：一次提交最终 flex 宽度，编辑器与文件树并排。
      await treeToggle.click()
      const presence = rightPanel.locator('.right-dock-editor-file-tree-presence')
      await expect(presence).toHaveAttribute('data-presence', 'present')
      const tree = rightPanel.locator('.right-dock-editor-file-tree')
      const editor = rightPanel.locator('.right-dock-file-selection-target')
      const treeResizeHandle = rightPanel.getByRole('separator', {
        name: '调整文件树宽度',
      })
      await expect
        .poll(async () => {
          const editorBox = await editor.boundingBox()
          const resizeHandleBox = await treeResizeHandle.boundingBox()
          const treeBox = await tree.boundingBox()
          return editorBox && resizeHandleBox && treeBox
            ? Math.max(
                Math.abs(editorBox.x + editorBox.width - resizeHandleBox.x),
                Math.abs(resizeHandleBox.x + resizeHandleBox.width - treeBox.x),
              )
            : -1
        })
        .toBeLessThanOrEqual(1)
      const treeBox = await tree.boundingBox()
      expect(treeBox?.width).toBeCloseTo(288, 0)
      await expect(treeToggle).toHaveAttribute('aria-pressed', 'true')

      // 隐藏：退出后 DOM 卸载、编辑器回到整宽、焦点回到 toggle。
      await treeToggle.click()
      await expect(preview.locator('.right-dock-editor-file-tree-presence')).toHaveCount(0)
      await expect(treeToggle).toBeFocused()
      const layout = preview.locator('.right-dock-file-editor-layout')
      await expect
        .poll(async () => {
          const editorBox = await editor.boundingBox()
          const layoutBox = await layout.boundingBox()
          return editorBox && layoutBox
            ? Math.abs(editorBox.x + editorBox.width - (layoutBox.x + layoutBox.width))
            : -1
        })
        .toBeLessThanOrEqual(1)

      // 重新显示：宽度与并排布局恢复。
      await treeToggle.click()
      await expect(presence).toHaveAttribute('data-presence', 'present')
      const restoredTreeBox = await tree.boundingBox()
      expect(restoredTreeBox?.width).toBeCloseTo(288, 0)
    })

    test(`sidebar section and extra session items collapse keep final layout (${motion})`, async ({
      page,
    }) => {
      await openVisualFixture(page, 'scroll-edge', motion)
      const recentToggle = page.locator('[data-sidebar-section-id="recent"]')
      await expect(recentToggle).toBeVisible()
      await expect(recentToggle).toHaveAttribute('aria-expanded', 'true')
      const recentSection = page.locator('.sidebar-section').filter({ has: recentToggle })
      const recentDisclosure = recentSection.locator(':scope > .sidebar-section-disclosure')
      const recentTransition = await readDisclosureTransition(recentDisclosure)
      expect(recentTransition.opacity).toBe('1')
      expect(recentTransition.property).toBe('grid-template-rows')
      expect(recentTransition.duration).toBe(motion === 'off' ? '0.1s' : '0s')

      // 会话扩展：展开/折叠额外排序项。
      const showMore = page.getByRole('button', { name: '展开显示' })
      await expect(showMore).toBeVisible()
      await showMore.click()
      const extraItems = page.locator('[data-sidebar-session-extra="true"]')
      await expect(extraItems.first()).toBeVisible()
      await page.getByRole('button', { name: '折叠显示' }).click()
      await expect(extraItems).toHaveCount(0)

      // section 折叠：内容保留但不可交互，ARIA 同步、键盘可恢复。
      await recentToggle.click()
      await expect(recentToggle).toHaveAttribute('aria-expanded', 'false')
      await expect(recentDisclosure).toHaveAttribute('aria-hidden', 'true')
      await recentToggle.focus()
      await page.keyboard.press('Enter')
      await expect(recentToggle).toHaveAttribute('aria-expanded', 'true')
      await expect(recentSection.locator('.sidebar-section-content')).toBeVisible()
    })

    test(`process group and turn activity collapse with edge fades (${motion})`, async ({
      page,
    }) => {
      await openVisualFixture(page, 'scroll-edge', motion)
      const turnActivitySummary = page.locator('.canonical-turn-activity__summary')
      await expect(turnActivitySummary).toBeVisible()
      if ((await turnActivitySummary.getAttribute('aria-expanded')) === 'false') {
        await turnActivitySummary.click()
      }
      const processSummary = page.locator('.cpx-agent-activity__header')
      await expect(processSummary).toBeVisible()

      // 展开 process group：items 可滚动，顶部/底部渐隐状态正确。
      await processSummary.click()
      await expect(processSummary).toHaveAttribute('aria-expanded', 'true')
      const edgeFrame = page.locator('.cpx-agent-activity__edge-fade')
      await expect(edgeFrame).toHaveAttribute('data-scrollable', 'true')
      await expect(edgeFrame).toHaveAttribute('data-at-start', 'true')
      await expect(edgeFrame).toHaveAttribute('data-at-end', 'false')

      const items = page.locator('.cpx-agent-activity__list')
      await scrollNested(items, 0.5)
      await expect(edgeFrame).toHaveAttribute('data-at-start', 'false')
      await expect(edgeFrame).toHaveAttribute('data-at-end', 'false')
      await scrollNested(items, 1)
      await expect(edgeFrame).toHaveAttribute('data-at-start', 'false')
      await expect(edgeFrame).toHaveAttribute('data-at-end', 'true')

      // 内容尺寸增长会由 content ResizeObserver 主动重测，无需用户滚动。
      const firstCard = items.locator('.cpx-agent-activity__item').first()
      const firstCardToggle = firstCard.locator('.cpx-agent-activity__item-header')
      const collapsedHeight = await items.evaluate((element) => element.scrollHeight)
      await firstCardToggle.locator('.cpx-agent-activity__chevron').click()
      await expect(firstCard).toHaveAttribute('data-expanded', 'true')
      await expect(firstCardToggle).toHaveAttribute('aria-expanded', 'true')
      await expect
        .poll(() => items.evaluate((element) => element.scrollHeight))
        .toBeGreaterThan(collapsedHeight)
      await expect(edgeFrame).toHaveAttribute('data-at-end', 'false')

      // command shell 的伪元素留在外 frame，只有内层 scroller 移动。
      const commandFrame = firstCard.locator('.canonical-command-shell__edge-fade').first()
      const commandScroller = commandFrame.locator('.canonical-command-shell__scroller')
      await commandFrame.locator('.canonical-command-shell__scroll-content').evaluate((element) => {
        const overflow = document.createElement('div')
        overflow.dataset.visualOverflow = 'true'
        overflow.style.height = '240px'
        element.appendChild(overflow)
      })
      await expect(commandFrame).toHaveAttribute('data-scrollable', 'true')
      const frameBeforeScroll = await commandFrame.boundingBox()
      await scrollNested(commandScroller, 1)
      const frameAfterScroll = await commandFrame.boundingBox()
      expect(frameAfterScroll?.y).toBeCloseTo(frameBeforeScroll?.y ?? 0, 0)
      expect(frameAfterScroll?.height).toBeCloseTo(frameBeforeScroll?.height ?? 0, 0)

      await firstCardToggle.locator('.cpx-agent-activity__chevron').click()
      await expect(firstCard).toHaveAttribute('data-expanded', 'false')
      await scrollNested(items, 0)
      await expect(edgeFrame).toHaveAttribute('data-at-start', 'true')

      // 24ms 内快速反向只复用一个内容实例，不跳到终点或留下空白。
      if (motion === 'off') {
        await processSummary.click()
        await page.waitForTimeout(24)
        await processSummary.click()
        await expect(processSummary).toHaveAttribute('aria-expanded', 'true')
        await expect(
          processSummary.locator('..').locator(':scope > .ui-disclosure-content'),
        ).toHaveCount(1)
        await expect(edgeFrame).toBeVisible()
      }

      // 折叠 process group：普通动效必须经过严格的中间高度，标题保持固定。
      const processRoot = processSummary.locator('..')
      const processDisclosure = processRoot.locator(':scope > .ui-disclosure-content')
      await expect(processDisclosure).toBeVisible()
      const processTransition = await readDisclosureTransition(processDisclosure)
      expect(processTransition.opacity).toBe('1')
      expect(processTransition.property).toBe('grid-template-rows')
      expect(processTransition.duration).toBe(motion === 'off' ? '0.1s' : '0s')
      const processSamples =
        motion === 'off'
          ? await sampleDisclosureCollapse(processSummary)
          : (await processSummary.click(), null)
      await expect(processSummary).toHaveAttribute('aria-expanded', 'false')
      if (processSamples) {
        expect(processSamples.startHeight).toBeGreaterThan(0)
        const distinctHeights = processSamples.samples
          .map((sample) => Math.round(sample.height * 2) / 2)
          .filter((height, index, heights) => index === 0 || height !== heights[index - 1])
        expect(distinctHeights.length).toBeGreaterThanOrEqual(6)
        expect(
          distinctHeights.every(
            (height, index) => index === 0 || height < distinctHeights[index - 1]!,
          ),
        ).toBe(true)
        expect(
          processSamples.samples.some(
            (sample) =>
              sample.elapsed >= 30 &&
              sample.elapsed <= 180 &&
              sample.height > 0 &&
              sample.height < processSamples.startHeight,
          ),
        ).toBe(true)
        expect(processSamples.samples.every((sample) => sample.opacity === '1')).toBe(true)
        expect(
          Math.max(...processSamples.samples.map((sample) => sample.frameGap)),
        ).toBeLessThanOrEqual(50)
        expect(
          processSamples.samples.every(
            (sample) => Math.abs(sample.trackedY - processSamples.startTrackedY) <= 1,
          ),
        ).toBe(true)
      }
      await expect(processDisclosure).toHaveAttribute('aria-hidden', 'true')
      await expect(processDisclosure).toHaveAttribute('inert', '')
      await expect(processDisclosure.locator('.cpx-agent-activity__edge-fade')).toHaveCount(1)
      await expect.poll(() => disclosureHeight(processDisclosure)).toBeLessThanOrEqual(0.5)

      // turn activity 折叠：回答区连续、单调上移，不出现空白中间帧。
      const activitySummary = page.locator('.canonical-turn-activity__summary')
      await expect(activitySummary).toBeVisible()
      const activityRoot = activitySummary.locator('..')
      const activityDisclosure = activityRoot.locator(':scope > .ui-disclosure-content')
      await expect(activityDisclosure).toBeVisible()
      const activitySamples =
        motion === 'off'
          ? await sampleDisclosureCollapse(activitySummary, '.canonical-turn__result')
          : (await activitySummary.click(), null)
      await expect(activitySummary).toHaveAttribute('aria-expanded', 'false')
      if (activitySamples) {
        expect(activitySamples.startHeight).toBeGreaterThan(0)
        const distinctHeights = activitySamples.samples
          .map((sample) => Math.round(sample.height * 2) / 2)
          .filter((height, index, heights) => index === 0 || height !== heights[index - 1])
        expect(distinctHeights.length).toBeGreaterThanOrEqual(6)
        expect(
          distinctHeights.every(
            (height, index) => index === 0 || height < distinctHeights[index - 1]!,
          ),
        ).toBe(true)
        expect(
          activitySamples.samples.some(
            (sample) =>
              sample.elapsed >= 30 &&
              sample.elapsed <= 180 &&
              sample.height > 0 &&
              sample.height < activitySamples.startHeight,
          ),
        ).toBe(true)
        expect(activitySamples.samples.every((sample) => sample.opacity === '1')).toBe(true)
        expect(
          Math.max(...activitySamples.samples.map((sample) => sample.frameGap)),
        ).toBeLessThanOrEqual(50)
        expect(
          activitySamples.samples.every(
            (sample, index, samples) =>
              index === 0 || sample.trackedY <= samples[index - 1]!.trackedY + 0.5,
          ),
        ).toBe(true)
        expect(activitySamples.samples.at(-1)!.trackedY).toBeLessThan(activitySamples.startTrackedY)
      }
      await expect(page.locator('.canonical-turn-activity__content')).toHaveCount(1)
      await expect(activityDisclosure).toHaveAttribute('aria-hidden', 'true')
      await expect(activityDisclosure).toHaveAttribute('inert', '')
      await expect.poll(() => disclosureHeight(activityDisclosure)).toBeLessThanOrEqual(0.5)
      await expect(page.locator('.canonical-turn__result')).toBeVisible()

      if (motion === 'off') {
        await activitySummary.click()
        await expect(activitySummary).toHaveAttribute('aria-expanded', 'true')
        await page.waitForTimeout(260)
        const bottomSamples = await sampleBottomFollowCollapse(activitySummary)
        expect(bottomSamples.length).toBeGreaterThanOrEqual(6)
        expect(Math.max(...bottomSamples.map((sample) => sample.distance))).toBeLessThanOrEqual(2)
        expect(
          bottomSamples.every(
            (sample, index, samples) =>
              index === 0 || sample.scrollTop <= samples[index - 1]!.scrollTop + 0.5,
          ),
        ).toBe(true)
      }
    })

    test(`execution plan steps edge fades follow scroll (${motion})`, async ({ page }) => {
      await openVisualFixture(page, 'scroll-edge', motion)
      const planButton = page.locator('.composer-change-summary__plan')
      await expect(planButton).toBeVisible()
      await planButton.click()
      const stepsFrame = page.locator('.execution-plan-card__edge-fade')
      await expect(stepsFrame).toHaveAttribute('data-scrollable', 'true')
      await expect(stepsFrame).toHaveAttribute('data-at-start', 'true')
      const steps = page.locator('.execution-plan-card__steps-scroller')
      await scrollNested(steps, 1)
      await expect(stepsFrame).toHaveAttribute('data-at-start', 'false')
      await expect(stepsFrame).toHaveAttribute('data-at-end', 'true')
      await scrollNested(steps, 0)
      await expect(stepsFrame).toHaveAttribute('data-at-end', 'false')
    })

    test(`execution plan preview enters at its final width (${motion})`, async ({ page }) => {
      await openVisualFixture(page, 'execution-plan', motion)
      const capsule = page.locator('.composer-change-summary__bar')
      const planButton = page.locator('.composer-change-summary__plan')
      const preview = page.locator('.composer-change-summary__plan-preview')
      const planCard = preview.locator('.execution-plan-card')
      const capsuleBefore = await capsule.boundingBox()
      expect(capsuleBefore).not.toBeNull()

      await page.evaluate(() => {
        type PlanPreviewSample = {
          animationName: string
          transform: string
          width: number
        }
        const runtimeWindow = window as typeof window & {
          __planPreviewSamples?: PlanPreviewSample[]
        }
        runtimeWindow.__planPreviewSamples = []
        const host = document.querySelector('.composer-change-summary')
        if (!host) throw new Error('缺少 Composer 变更摘要容器')

        const observer = new MutationObserver(() => {
          const previewElement = host.querySelector<HTMLElement>(
            '.composer-change-summary__plan-preview',
          )
          const card = previewElement?.querySelector<HTMLElement>('.execution-plan-card')
          if (!previewElement || !card) return
          observer.disconnect()
          const deadline = performance.now() + 220
          const sample = (): void => {
            runtimeWindow.__planPreviewSamples?.push({
              animationName: getComputedStyle(card).animationName,
              transform: getComputedStyle(previewElement).transform,
              width: card.getBoundingClientRect().width,
            })
            if (performance.now() < deadline) requestAnimationFrame(sample)
          }
          sample()
        })
        observer.observe(host, { childList: true, subtree: true })
      })

      await planButton.focus()
      await expect(planCard).toBeVisible()
      await page.waitForTimeout(240)

      const samples = await page.evaluate(() => {
        const runtimeWindow = window as typeof window & {
          __planPreviewSamples?: Array<{
            animationName: string
            transform: string
            width: number
          }>
        }
        return runtimeWindow.__planPreviewSamples ?? []
      })
      expect(samples.length).toBeGreaterThan(0)
      expect(Math.min(...samples.map((sample) => sample.width))).toBeGreaterThanOrEqual(480)
      expect(Math.max(...samples.map((sample) => sample.width))).toBeLessThanOrEqual(760)
      if (motion === 'on') {
        expect(samples.every((sample) => sample.transform === 'none')).toBe(true)
      } else {
        expect(samples.some((sample) => sample.transform !== 'none')).toBe(true)
        expect(samples.at(-1)?.transform).toBe('none')
      }
      expect(samples.every((sample) => sample.animationName === 'none')).toBe(true)

      const capsuleAfter = await capsule.boundingBox()
      expect(capsuleAfter).not.toBeNull()
      expect(capsuleAfter!.width).toBeCloseTo(capsuleBefore!.width, 0)

      await planButton.evaluate((element) => element.blur())
      await expect(preview).toHaveCount(0)
    })
  }

  test('skeleton shimmer and progress bars keep their compositor contract', async ({ page }) => {
    await openVisualFixture(page, 'scroll-edge', 'off')
    const styles = await page.evaluate(() => {
      const skeleton = document.createElement('div')
      skeleton.className = 'ui-skeleton-block'
      skeleton.style.cssText = 'width: 320px; height: 48px;'
      document.body.appendChild(skeleton)
      const skeletonAfter = getComputedStyle(skeleton, '::after')
      const skeletonBefore = getComputedStyle(skeleton)

      const composerTrack = document.createElement('div')
      composerTrack.className = 'composer-status-bar-track'
      composerTrack.innerHTML = '<div class="composer-status-bar-fill"></div>'
      composerTrack.style.cssText = 'width: 320px;'
      const composerFill = composerTrack.querySelector<HTMLElement>('.composer-status-bar-fill')!
      composerFill.style.setProperty('--usage-ratio', '0.6')
      document.body.appendChild(composerTrack)

      const composerStyle = getComputedStyle(composerFill)
      skeleton.remove()
      composerTrack.remove()
      return {
        composerOrigin: composerStyle.transformOrigin,
        composerTransform: composerStyle.transform,
        composerTransition: composerStyle.transitionProperty,
        skeletonAnimation: skeletonAfter.animationName,
        skeletonDuration: skeletonBefore.getPropertyValue('--motion-loading'),
        skeletonSweep: skeletonAfter.animationName === 'ui-skeleton-sweep',
      }
    })

    expect(styles.skeletonSweep).toBe(true)
    expect(styles.skeletonDuration).toBe('900ms')
    expect(styles.composerTransform).toBe('matrix(0.6, 0, 0, 1, 0, 0)')
    expect(styles.composerOrigin.startsWith('0%')).toBe(true)
    expect(styles.composerTransition).toBe('transform')
  })

  test('reduced motion renders a flat skeleton without shimmer', async ({ page }) => {
    await openVisualFixture(page, 'scroll-edge', 'on')
    const styles = await page.evaluate(() => {
      const skeleton = document.createElement('div')
      skeleton.className = 'ui-skeleton-block'
      skeleton.style.cssText = 'width: 320px; height: 48px;'
      document.body.appendChild(skeleton)
      const skeletonAfter = getComputedStyle(skeleton, '::after')
      const result = {
        animationName: skeletonAfter.animationName,
        backgroundImage: skeletonAfter.backgroundImage,
        content: skeletonAfter.content,
      }
      skeleton.remove()
      return result
    })

    expect(styles.animationName).toBe('none')
    expect(styles.backgroundImage).toBe('none')
    expect(styles.content).toBe('none')
  })
})

async function openVisualFixture(
  page: Page,
  visualCase: string,
  motion: (typeof MOTION_MODES)[number],
): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 768 })
  await prepareVisualTheme(page, 'light', { reduceMotion: motion })
  const visualPort = process.env.PIDEX_VISUAL_PORT?.trim() || '47173'
  const fixtureURL = `http://127.0.0.1:${visualPort}/?visualCase=${visualCase}#/threads/visual-${visualCase}`
  await page.evaluate((url) => {
    window.location.assign(url)
  }, fixtureURL)
  await page.waitForURL(fixtureURL, { waitUntil: 'load' })
  await waitForVisualPage(page, 'light')
  await closeTransientErrorToast(page)
}

async function scrollNested(
  scrollArea: import('@playwright/test').Locator,
  progress: number,
): Promise<void> {
  await scrollArea.evaluate((element, target) => {
    element.scrollTop = target * Math.max(0, element.scrollHeight - element.clientHeight)
  }, progress)
  await pageSettle(scrollArea.page())
}

async function pageSettle(page: Page): Promise<void> {
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

async function sampleDisclosureCollapse(
  toggle: import('@playwright/test').Locator,
  trackedSelector?: string,
): Promise<{
  startHeight: number
  startTrackedY: number
  samples: Array<{
    elapsed: number
    frameGap: number
    height: number
    opacity: string
    trackedY: number
  }>
}> {
  return toggle.evaluate(async (node, selector) => {
    if (!(node instanceof HTMLElement)) {
      throw new Error('disclosure toggle 不是 HTML 元素')
    }
    const root = node.parentElement
    const disclosure = root?.querySelector<HTMLElement>(':scope > .ui-disclosure-content')
    const tracked = selector
      ? node.closest('.canonical-turn')?.querySelector<HTMLElement>(selector)
      : node
    if (!disclosure || !(tracked instanceof HTMLElement)) {
      throw new Error('缺少 disclosure 或布局跟踪元素')
    }

    const startHeight = disclosure.getBoundingClientRect().height
    const startTrackedY = tracked.getBoundingClientRect().y
    node.click()
    const startedAt = performance.now()
    const samples = await new Promise<
      Array<{
        elapsed: number
        frameGap: number
        height: number
        opacity: string
        trackedY: number
      }>
    >((resolve) => {
      const values: Array<{
        elapsed: number
        frameGap: number
        height: number
        opacity: string
        trackedY: number
      }> = []
      let previousSampleAt = startedAt
      const sample = (now: number): void => {
        values.push({
          elapsed: now - startedAt,
          frameGap: now - previousSampleAt,
          height: disclosure.getBoundingClientRect().height,
          opacity: getComputedStyle(disclosure).opacity,
          trackedY: tracked.getBoundingClientRect().y,
        })
        previousSampleAt = now
        if (now - startedAt >= 280) resolve(values)
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    return { startHeight, startTrackedY, samples }
  }, trackedSelector)
}

async function readDisclosureTransition(
  disclosure: import('@playwright/test').Locator,
): Promise<{ duration: string; opacity: string; property: string }> {
  return disclosure.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      duration: style.transitionDuration,
      opacity: style.opacity,
      property: style.transitionProperty,
    }
  })
}

async function disclosureHeight(disclosure: import('@playwright/test').Locator): Promise<number> {
  return disclosure.evaluate((element) => element.getBoundingClientRect().height)
}

async function sampleBottomFollowCollapse(
  toggle: import('@playwright/test').Locator,
): Promise<Array<{ distance: number; scrollTop: number }>> {
  return toggle.evaluate(async (node) => {
    if (!(node instanceof HTMLElement)) {
      throw new Error('disclosure toggle 不是 HTML 元素')
    }
    const viewport = node.closest('.thread-scroll-layout')
    if (!(viewport instanceof HTMLElement)) {
      throw new Error('缺少时间线滚动容器')
    }
    viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    viewport.dispatchEvent(new Event('scroll'))
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })

    node.click()
    const startedAt = performance.now()
    return await new Promise<Array<{ distance: number; scrollTop: number }>>((resolve) => {
      const values: Array<{ distance: number; scrollTop: number }> = []
      const sample = (now: number): void => {
        values.push({
          distance: Math.max(0, viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop),
          scrollTop: viewport.scrollTop,
        })
        if (now - startedAt >= 280) resolve(values)
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  })
}
