import { expect, test, type Page } from '@playwright/test'

import {
  recordRendererSample,
  startInteractionProbe,
  stopInteractionProbe,
  waitForFixture,
} from './PerformanceTestHelpers.js'

// 每个 tick 注入多条 delta（~1000 delta/s），刻意远高于帧率：如果提交退化成
// "每个 delta 一次"，每帧提交数会达到 ~8，预算才能把它拦下来。100+ tokens/s 的
// 常规流式是它的子集，因此这里用更严苛的注入速率。
const DELTAS_PER_TICK = 8
const TICK_INTERVAL_MS = 8
const TICK_COUNT = 375
const DELTA_COUNT = DELTAS_PER_TICK * TICK_COUNT
const DELTA_TEXT = '流式片段'

type HarnessSnapshot = {
  counters: {
    canonicalCommitCount: number
    tailNotificationCount: number
    streamingItemRenderCount: number
    pendingDeltaCharacters: number
  }
  appliedSequence: number
  streamedItemTextLength: number
}

async function readHarnessSnapshot(page: Page): Promise<HarnessSnapshot> {
  return page.evaluate(() => {
    const harness = (
      window as typeof window & {
        __pidexStreamingPerfHarness?: {
          snapshot(): HarnessSnapshot
        }
      }
    ).__pidexStreamingPerfHarness
    if (!harness) throw new Error('流式性能钩子未安装')
    return harness.snapshot()
  }) as unknown as Promise<HarnessSnapshot>
}

/** 取一个已经被虚拟列表挂载的 turn，否则注入的 item 不会渲染。 */
async function readMountedTurnId(page: Page): Promise<string> {
  const turnId = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-turn-navigation-id]')
    return row?.dataset.turnNavigationId ?? null
  })
  if (!turnId) throw new Error('没有已挂载的 turn，无法度量流式渲染')
  return turnId
}

test('streaming throughput keeps commits and long tasks bounded', async ({ page }) => {
  await waitForFixture(page, 250, 30)
  await page.evaluate(() => {
    const counters = (
      window as typeof window & {
        __pidexStreamingPerfCounters?: { enable(): void; reset(): void }
      }
    ).__pidexStreamingPerfCounters
    if (!counters) throw new Error('流式性能计数器未安装')
    counters.enable()
  })

  const mountedTurnId = await readMountedTurnId(page)

  for (let sample = 1; sample <= 3; sample += 1) {
    await page.evaluate((turnId: string) => {
      ;(
        window as typeof window & {
          __pidexStreamingPerfCounters?: { reset(): void }
        }
      ).__pidexStreamingPerfCounters?.reset()
      ;(
        window as typeof window & {
          __pidexStreamingPerfHarness?: { beginSample(id?: string): void }
        }
      ).__pidexStreamingPerfHarness?.beginSample(turnId)
    }, mountedTurnId)
    await startInteractionProbe(page)
    // 以突发速率持续注入，模拟工具输出等高频流式场景。
    await page.evaluate(
      async ({ deltasPerTick, tickCount, intervalMs, text }) => {
        const harness = (
          window as typeof window & {
            __pidexStreamingPerfHarness?: {
              pushDelta(delta: string): Promise<void>
              flush(): void
            }
          }
        ).__pidexStreamingPerfHarness
        if (!harness) throw new Error('流式性能钩子未安装')
        await new Promise<void>((resolve) => {
          let tick = 0
          const timer = setInterval(() => {
            if (tick >= tickCount) {
              clearInterval(timer)
              resolve()
              return
            }
            tick += 1
            for (let index = 0; index < deltasPerTick; index += 1) {
              void harness.pushDelta(text)
            }
          }, intervalMs)
        })
        harness.flush()
      },
      {
        deltasPerTick: DELTAS_PER_TICK,
        tickCount: TICK_COUNT,
        intervalMs: TICK_INTERVAL_MS,
        text: DELTA_TEXT,
      },
    )
    const interaction = await stopInteractionProbe(page)
    const snapshot = await readHarnessSnapshot(page)
    const expectedCharacters = DELTA_COUNT * DELTA_TEXT.length
    const frames = Math.max(1, interaction.frameCount)

    // 场景自身的安全性检查；预算门禁由 report 依据采样文件执行。
    expect(snapshot.counters.pendingDeltaCharacters).toBe(0)
    expect(snapshot.streamedItemTextLength).toBe(expectedCharacters)
    expect(snapshot.counters.streamingItemRenderCount).toBeGreaterThan(0)

    await recordRendererSample(page, 'streaming-throughput', sample, {
      ...interaction,
      // 提交次数用"每帧提交数"表达，才能在 60Hz/120Hz 显示器上同样成立。
      canonicalCommitsPerFrame: snapshot.counters.canonicalCommitCount / frames,
      tailNotificationsPerFrame: snapshot.counters.tailNotificationCount / frames,
      streamingItemRendersPerFrame: snapshot.counters.streamingItemRenderCount / frames,
      canonicalCommitCount: snapshot.counters.canonicalCommitCount,
      tailNotificationCount: snapshot.counters.tailNotificationCount,
      streamingItemRenderCount: snapshot.counters.streamingItemRenderCount,
      pendingDeltaCharacters: snapshot.counters.pendingDeltaCharacters,
      streamedItemTextMatches: snapshot.streamedItemTextLength === expectedCharacters ? 1 : 0,
      // 只渲染尾部 item：渲染次数不应超过"尾部通知 + 提交"的量级。
      tailIsolationSlack:
        snapshot.counters.streamingItemRenderCount -
        snapshot.counters.tailNotificationCount -
        snapshot.counters.canonicalCommitCount,
    })
  }
})
