import type { Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PerformanceSample } from '../../../../scripts/performance/Metrics.js'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const outputDirectory = resolve(repositoryRoot, 'performance-results', 'raw', 'renderer')

export type InteractionMetrics = {
  durationMs: number
  frameCount: number
  frameP95Ms: number
  maxFrameMs: number
  maxLongTaskMs: number
  longTaskP95Ms: number
}

export async function recordRendererSample(
  page: Page,
  scenario: string,
  sample: number,
  metrics: Record<string, number>,
): Promise<void> {
  const batch = Math.max(1, Number.parseInt(process.env.PIDEX_PERF_BATCH ?? '1', 10) || 1)
  const value: PerformanceSample = {
    batch,
    environment: {
      browser: page.context().browser()?.browserType().name() ?? 'unknown',
      browserVersion: page.context().browser()?.version() ?? 'unknown',
      cpuCount: process.env.NUMBER_OF_PROCESSORS ?? null,
      platform: process.platform,
    },
    metrics: roundMetrics(metrics),
    sample,
    scenario,
    suite: 'renderer',
    timestamp: new Date().toISOString(),
  }
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    resolve(outputDirectory, `${scenario}-b${batch}-s${sample}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  )
}

export async function startInteractionProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as typeof window & {
      __pidexPerformanceProbe?: {
        animationFrame: number
        frameGaps: number[]
        lastFrame: number
        longTasks: number[]
        observer: PerformanceObserver | null
        startedAt: number
      }
    }
    const probe = {
      animationFrame: 0,
      frameGaps: [] as number[],
      lastFrame: performance.now(),
      longTasks: [] as number[],
      observer: null as PerformanceObserver | null,
      startedAt: performance.now(),
    }
    const frame = (now: number): void => {
      probe.frameGaps.push(now - probe.lastFrame)
      probe.lastFrame = now
      probe.animationFrame = requestAnimationFrame(frame)
    }
    probe.animationFrame = requestAnimationFrame(frame)
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      probe.observer = new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          probe.longTasks.push(entry.duration)
        }
      })
      probe.observer.observe({ entryTypes: ['longtask'] })
    }
    target.__pidexPerformanceProbe = probe
  })
}

export async function stopInteractionProbe(page: Page): Promise<InteractionMetrics> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  return page.evaluate(() => {
    const target = window as typeof window & {
      __pidexPerformanceProbe?: {
        animationFrame: number
        frameGaps: number[]
        longTasks: number[]
        observer: PerformanceObserver | null
        startedAt: number
      }
    }
    const probe = target.__pidexPerformanceProbe
    if (!probe) throw new Error('Performance probe was not started')
    cancelAnimationFrame(probe.animationFrame)
    probe.observer?.disconnect()
    const sorted = [...probe.frameGaps].sort((left, right) => left - right)
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
    const sortedLongTasks = [...probe.longTasks].sort((left, right) => left - right)
    const longTaskP95Index = Math.max(0, Math.ceil(sortedLongTasks.length * 0.95) - 1)
    delete target.__pidexPerformanceProbe
    return {
      durationMs: performance.now() - probe.startedAt,
      frameCount: sorted.length,
      frameP95Ms: sorted[p95Index] ?? 0,
      maxFrameMs: sorted.at(-1) ?? 0,
      maxLongTaskMs: Math.max(0, ...probe.longTasks),
      longTaskP95Ms: sortedLongTasks[longTaskP95Index] ?? 0,
    }
  })
}

export async function waitForFixture(
  page: Page,
  turns: number,
  sessions: number,
  options: { nestedScroll?: boolean } = {},
) {
  const search = new URLSearchParams({
    performanceCase: options.nestedScroll ? 'nested-scroll-edge-fade' : 'desktop-ux',
    performanceSessions: String(sessions),
    performanceTurns: String(turns),
  })
  await page.goto(`/?${search.toString()}#/threads/performance-session-001`)
  await waitForPerformanceThread(page, 1, turns)
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(finish, { timeout: 1_000 })
      } else {
        finish()
      }
    })
  })
}

export async function measurePerformanceThreadSwitch(
  page: Page,
  previousSessionIndex: number,
  nextSessionIndex: number,
  turnCount: number,
  viaSidebar = true,
): Promise<{
  contentVisibleMs: number
  readyMs: number
  staleVisibleMs: number
}> {
  return page.evaluate(
    async ({ nextIndex, previousIndex, turns, useSidebar }) => {
      const threadId = (index: number): string =>
        `performance-session-${String(index).padStart(3, '0')}`
      const threadTitle = (index: number): string => `性能会话 ${String(index).padStart(3, '0')}`
      const visibleThread = (index: number): boolean => {
        const node = document.querySelector<HTMLElement>(
          `[data-canonical-thread-id="${threadId(index)}"]`,
        )
        return Boolean(
          node && node.offsetParent !== null && getComputedStyle(node).visibility !== 'hidden',
        )
      }
      const readyThread = (index: number, expectedTurns: number): boolean =>
        document.querySelector<HTMLElement>(`[data-canonical-thread-id="${threadId(index)}"]`)
          ?.dataset.canonicalTurnCount === String(expectedTurns)
      const startedAt = performance.now()
      let contentVisibleMs: number | null = null
      let staleVisibleMs: number | null = null
      if (useSidebar) {
        const targetButton = [
          ...document.querySelectorAll<HTMLButtonElement>('.sidebar-session-button'),
        ].find(
          (button) =>
            button.querySelector('.sidebar-session-title')?.textContent?.trim() ===
            threadTitle(nextIndex),
        )
        if (!targetButton) {
          throw new Error(`Performance session ${nextIndex} is not in the sidebar`)
        }
        targetButton.click()
      } else {
        location.hash = `#/threads/${threadId(nextIndex)}`
      }

      while (performance.now() - startedAt < 30_000) {
        const elapsed = performance.now() - startedAt
        if (staleVisibleMs === null && !visibleThread(previousIndex)) {
          staleVisibleMs = elapsed
        }
        if (contentVisibleMs === null && visibleThread(nextIndex)) {
          contentVisibleMs = elapsed
        }
        if (contentVisibleMs !== null && readyThread(nextIndex, turns)) {
          return {
            contentVisibleMs,
            readyMs: elapsed,
            staleVisibleMs: staleVisibleMs ?? elapsed,
          }
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
      throw new Error(`Performance thread ${nextIndex} did not become ready`)
    },
    {
      nextIndex: nextSessionIndex,
      previousIndex: previousSessionIndex,
      turns: turnCount,
      useSidebar: viaSidebar,
    },
  )
}

export async function waitForPerformanceThread(
  page: Page,
  sessionIndex: number,
  turnCount: number,
): Promise<void> {
  const sessionId = `performance-session-${String(sessionIndex).padStart(3, '0')}`
  await page.locator(`[data-canonical-thread-id="${sessionId}"]`).waitFor({ state: 'visible' })
  await page.locator('.composer-editor-content').waitFor()
  await page
    .locator(`[data-canonical-thread-id="${sessionId}"][data-canonical-turn-count="${turnCount}"]`)
    .waitFor({ state: 'visible' })
}

export function nearestRankP95(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!
}

function roundMetrics(metrics: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [key, Number(value.toFixed(3))]),
  )
}
