import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { startInteractionProbe, stopInteractionProbe, waitForPerformanceThread } from './PerformanceTestHelpers.js'

test.use({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' })

for (const count of [500, 1000]) {
  test(`full sidebar drag with ${count} sessions and ${count / 20} projects`, async ({ page }, info) => {
    test.setTimeout(300_000)
    page.setDefaultTimeout(30_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`/?performanceCase=sidebar-dnd&performanceSessions=${count}&performanceTurns=100&performanceWorkspace=true#/threads/performance-session-001`)
    await waitForPerformanceThread(page, 1, 100)
    const sidebar = page.locator('.desktop-sidebar')
    await expect(sidebar.locator('.sidebar-project-button').first()).toBeVisible()
    const showMore = sidebar.getByRole('button', { name: '展开显示', exact: true })
    for (let step = 0; step < count && await showMore.count(); step++) {
      await showMore.evaluateAll(buttons => buttons.forEach(button => (button as HTMLElement).click()))
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    }
    await expect(sidebar.locator('.sidebar-project-button')).toHaveCount(count / 20)
    await expect(sidebar.locator('.sidebar-session-row')).toHaveCount(count)
    await page.evaluate(() => document.fonts.ready)
    const inventory = await page.evaluate(() => ({
      domNodes: document.querySelectorAll('*').length,
      sessionRows: document.querySelectorAll('.desktop-sidebar .sidebar-session-row').length,
      projectRows: document.querySelectorAll('.desktop-sidebar .sidebar-project-button').length,
    }))
    console.log(JSON.stringify({count, inventory}))
    const session = await page.context().newCDPSession(page)
    await session.send('Performance.enable')
    await session.send('Profiler.enable')
    await session.send('Profiler.start')
    const samples: Record<string, unknown>[] = []
    const measure = async (phase: string, action: () => Promise<void>) => {
      const before = await session.send('Performance.getMetrics')
      await startInteractionProbe(page)
      await action()
      const frames = await stopInteractionProbe(page)
      const after = await session.send('Performance.getMetrics')
      const metric = (value: typeof after, name: string) => value.metrics.find(item => item.name === name)?.value ?? 0
      const sample = {phase, ...frames,
        startedAtUs: metric(before, 'Timestamp') * 1_000_000,
        endedAtUs: metric(after, 'Timestamp') * 1_000_000,
        scriptMs: (metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')) * 1000,
        layoutMs: (metric(after, 'LayoutDuration') - metric(before, 'LayoutDuration')) * 1000,
        recalcStyleMs: (metric(after, 'RecalcStyleDuration') - metric(before, 'RecalcStyleDuration')) * 1000,
      }
      samples.push(sample)
      console.log(JSON.stringify({count, ...sample}))
    }
    const source = sidebar.locator('[data-sidebar-session-id="performance-session-006"] .sidebar-session-button')
    const sameProjectTarget = sidebar.locator('[data-sidebar-session-id="performance-session-009"] .sidebar-session-button')
    const otherProject = sidebar.locator('.sidebar-project-button').filter({hasText: 'project-02'})
    for (let sample = 0; sample < 3; sample++) {
      await source.scrollIntoViewIfNeeded()
      const box = await source.boundingBox()
      if (!box) throw new Error('Missing drag source')
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await page.mouse.move(x, y)
      await measure(`start-${sample}`, async () => {
        await page.mouse.down()
        await page.mouse.move(x + 15, y, {steps: 3})
        await expect(sidebar.locator('[data-dragging="true"]')).toHaveCount(1)
      })
      await measure(`steady-${sample}`, async () => {
        const target = await sameProjectTarget.boundingBox()
        if (!target) throw new Error('Missing drag target')
        for (let move = 0; move < 60; move++) {
          await page.mouse.move(x + move % 15, y + (target.y + target.height / 2 - y) * (move % 10) / 9)
        }
      })
      await measure(`cross-project-${sample}`, async () => {
        await otherProject.scrollIntoViewIfNeeded()
        const target = await otherProject.boundingBox()
        if (!target) throw new Error('Missing project target')
        for (let move = 0; move < 30; move++) {
          await page.mouse.move(target.x + target.width / 2 + move % 10, target.y + target.height / 2)
        }
      })
      await measure(`cancel-${sample}`, async () => {
        await page.keyboard.press('Escape')
        await page.mouse.up()
        await expect(sidebar.locator('[data-dragging="true"]')).toHaveCount(0)
      })
    }
    await measure('drop', async () => {
      await source.scrollIntoViewIfNeeded()
      const box = await source.boundingBox()
      if (!box) throw new Error('Missing source')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2, {steps: 3})
      await expect(sidebar.locator('[data-dragging="true"]')).toHaveCount(1)
      const target = await sameProjectTarget.boundingBox()
      if (!target) throw new Error('Missing target')
      await page.mouse.move(target.x + target.width / 2, target.y + target.height - 3, {steps: 8})
      await expect(page.locator('.sidebar-drop-indicator')).toHaveCount(1)
      await page.mouse.up()
      await expect(sidebar.locator('[data-dragging="true"]')).toHaveCount(0)
    })
    const sourceProject = sidebar.locator('.sidebar-project-button').filter({hasText: 'project-01'})
    await sourceProject.scrollIntoViewIfNeeded()
    const projectBox = await sourceProject.boundingBox()
    if (!projectBox) throw new Error('Missing project source')
    const projectX = projectBox.x + projectBox.width / 2
    const projectY = projectBox.y + projectBox.height / 2
    await page.mouse.move(projectX, projectY)
    await measure('project-start', async () => {
      await page.mouse.down()
      await page.mouse.move(projectX + 15, projectY, {steps: 3})
      await expect(sidebar.locator('[data-dragging="true"]')).toHaveCount(1)
    })
    await measure('project-steady', async () => {
      for (let move = 0; move < 60; move++) {
        await page.mouse.move(projectX + move % 20, projectY + move % 15)
      }
    })
    await measure('project-scroll-drop', async () => {
      await otherProject.scrollIntoViewIfNeeded()
      const target = await otherProject.boundingBox()
      if (!target) throw new Error('Missing project target')
      await page.mouse.move(target.x + target.width / 2, target.y + 2, {steps: 10})
      await page.mouse.up()
      await expect(sidebar.locator('[data-dragging="true"]')).toHaveCount(0)
    })
    const { profile } = await session.send('Profiler.stop')
    await writeFile(info.outputPath(`sidebar-${count}.cpuprofile`), JSON.stringify(profile), 'utf8')
    await writeFile(info.outputPath(`sidebar-${count}.json`), JSON.stringify({inventory, samples, errors}, null, 2), 'utf8')
    expect(errors).toEqual([])
  })
}
