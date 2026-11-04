import { strict as assert } from 'node:assert'
import { chromium } from '@playwright/test'

async function run() {
  console.log('[anchor-test] Launching Chromium...')
  const browser = await chromium
    .launch({ channel: 'chrome', headless: true })
    .catch(() => chromium.launch({ headless: true }))
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    const html = `<!DOCTYPE html>
<html>
<head>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: sans-serif; }

  .thread-scroll-layout {
    position: relative;
    width: 600px;
    height: 400px;
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-gutter: stable;
    scroll-padding-block-end: var(--thread-scroll-padding-bottom, 0px);
  }

  .thread-scroll-layout__inner {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  .canonical-history-control {
    overflow-anchor: none;
    height: 32px;
    background: #eee;
  }

  .session-timeline-container {
    overflow-anchor: auto;
    width: 100%;
  }

  .session-timeline-virtualizer {
    overflow-anchor: none;
    width: 100%;
  }

  .session-timeline-bottom-sentinel {
    height: 72px;
    position: relative;
    pointer-events: none;
  }
  .session-timeline-bottom-sentinel[data-mode="follow"] {
    overflow-anchor: auto;
  }
  .session-timeline-bottom-sentinel[data-mode="static"] {
    overflow-anchor: none;
  }

  .thread-scroll-layout__footer {
    position: sticky;
    bottom: 0;
    height: 72px;
    overflow-anchor: none;
    background: rgba(200, 200, 200, 0.8);
    pointer-events: none;
  }

  /* ToolCommandCard styles */
  .cmd-scroller {
    max-height: 144px;
    overflow-y: auto;
    border: 1px solid #ccc;
    margin-top: 20px;
  }
  .canonical-command-card__output-text {
    overflow-anchor: none;
    margin: 0;
    padding: 8px;
    white-space: pre;
    font-family: monospace;
  }
  .canonical-command-card__output-pin {
    height: 1px;
    overflow-anchor: none;
    pointer-events: none;
  }
  .canonical-command-card__output-pin[data-following="true"] {
    overflow-anchor: auto;
  }
</style>
</head>
<body>
  <div id="threadScroller" class="thread-scroll-layout" style="--thread-scroll-padding-bottom: 0px;">
    <div class="thread-scroll-layout__inner">
      <div class="canonical-history-control">顶部历史控件</div>
      <div id="timelineContainer" class="session-timeline-container">
        <div class="session-timeline-virtualizer">
          <div id="turnList">
            <div class="turn-item" style="height: 200px; background: #e0e7ff; margin-bottom: 8px;">Turn 1</div>
            <div class="turn-item" style="height: 200px; background: #ede9fe; margin-bottom: 8px;">Turn 2</div>
            <div id="streamingTurn" class="turn-item" style="height: 200px; background: #fae8ff; margin-bottom: 8px;">Turn 3 (Streaming)</div>
          </div>
        </div>
        <div id="sentinel" class="session-timeline-bottom-sentinel" data-mode="follow">
          <div id="observer" style="position: absolute; bottom: 0; height: 1px;"></div>
        </div>
      </div>
      <footer class="thread-scroll-layout__footer">Composer Footer (72px)</footer>
    </div>
  </div>

  <div id="cmdScroller" class="cmd-scroller">
    <pre id="cmdOutput" class="canonical-command-card__output-text">Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10</pre>
    <div id="cmdPin" class="canonical-command-card__output-pin" data-following="true"></div>
  </div>
</body>
</html>`

    await page.setContent(html)

    // ─────────────────────────────────────────────────────────────
    // Verification 1: Composer focused (padding: 0px) and blurred (padding: 88px) streaming growth
    // ─────────────────────────────────────────────────────────────
    console.log('[test 1] Verifying streaming growth anchoring with padding 0px...')
    const result1 = await page.evaluate(async () => {
      const scroller = document.getElementById('threadScroller')!
      const streaming = document.getElementById('streamingTurn')!

      // Scroll to bottom
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight
      const initialScrollTop = scroller.scrollTop

      // Simulate streaming growth (+100px)
      streaming.style.height = '300px'
      // Wait for layout
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const newScrollTop = scroller.scrollTop
      return { initialScrollTop, newScrollTop, delta: newScrollTop - initialScrollTop }
    })
    assert.ok(
      result1.initialScrollTop > 0,
      `initialScrollTop should be > 0, got ${result1.initialScrollTop}`,
    )
    console.log(
      `[test 1] padding 0px: initial=${result1.initialScrollTop}, new=${result1.newScrollTop}, delta=${result1.delta}`,
    )
    assert.strictEqual(
      result1.delta,
      100,
      `Expected scrollTop to increase by 100px, got ${result1.delta}`,
    )

    console.log(
      '[test 1b] Verifying streaming growth anchoring with padding 88px (footerHeight 72px + 16px)...',
    )
    const result1b = await page.evaluate(async () => {
      const scroller = document.getElementById('threadScroller')!
      const streaming = document.getElementById('streamingTurn')!
      scroller.style.setProperty('--thread-scroll-padding-bottom', '88px')

      // Ensure at bottom
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight
      const beforeScrollTop = scroller.scrollTop

      // Simulate another +100px growth
      streaming.style.height = '400px'
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const afterScrollTop = scroller.scrollTop
      return { beforeScrollTop, afterScrollTop, delta: afterScrollTop - beforeScrollTop }
    })
    console.log(
      `[test 1b] padding 88px: before=${result1b.beforeScrollTop}, after=${result1b.afterScrollTop}, delta=${result1b.delta}`,
    )
    assert.strictEqual(
      result1b.delta,
      100,
      `Expected scrollTop with padding 88px to increase by 100px, got ${result1b.delta}`,
    )

    // ─────────────────────────────────────────────────────────────
    // Verification 2: Content shrinking at bottom adjusts scrollTop without misclassifying
    // ─────────────────────────────────────────────────────────────
    console.log('[test 2] Verifying content shrinking anchoring at bottom...')
    const result2 = await page.evaluate(async () => {
      const scroller = document.getElementById('threadScroller')!
      const streaming = document.getElementById('streamingTurn')!

      // At bottom
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight
      const beforeShrinkScrollTop = scroller.scrollTop

      // Shrink content by 80px (e.g. collapsed tool card / accordion)
      streaming.style.height = '320px'
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const afterShrinkScrollTop = scroller.scrollTop
      const distance = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
      return {
        beforeShrinkScrollTop,
        afterShrinkScrollTop,
        delta: afterShrinkScrollTop - beforeShrinkScrollTop,
        distance,
      }
    })
    console.log(
      `[test 2] shrinking: delta=${result2.delta}, distance from bottom=${result2.distance}`,
    )
    assert.strictEqual(
      result2.delta,
      -80,
      `Expected scrollTop to decrease by 80px, got ${result2.delta}`,
    )
    assert.ok(
      result2.distance <= 1,
      `Expected still at bottom (distance <= 1), got ${result2.distance}`,
    )

    // ─────────────────────────────────────────────────────────────
    // Verification 3: Static mode isolation (no bottom pull when scrolled up)
    // ─────────────────────────────────────────────────────────────
    console.log('[test 3] Verifying static mode isolation when user scrolls up...')
    const result3 = await page.evaluate(async () => {
      const scroller = document.getElementById('threadScroller')!
      const sentinel = document.getElementById('sentinel')!
      const streaming = document.getElementById('streamingTurn')!

      // User scrolls up to reading position
      scroller.scrollTop = 120
      // Controller enters static mode -> sentinel overflow-anchor: none
      sentinel.dataset.mode = 'static'

      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const beforeGrowth = scroller.scrollTop

      // Streaming grows by 150px at the bottom
      streaming.style.height = '470px'
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const afterGrowth = scroller.scrollTop
      return { beforeGrowth, afterGrowth, delta: afterGrowth - beforeGrowth }
    })
    console.log(
      `[test 3] static mode: before=${result3.beforeGrowth}, after=${result3.afterGrowth}, delta=${result3.delta}`,
    )
    assert.strictEqual(
      result3.delta,
      0,
      `Expected scrollTop to NOT move in static mode, got ${result3.delta}`,
    )

    // ─────────────────────────────────────────────────────────────
    // Verification 4: ToolCommandCard pin anchoring
    // ─────────────────────────────────────────────────────────────
    console.log('[test 4] Verifying ToolCommandCard output pin anchoring...')
    const result4 = await page.evaluate(async () => {
      const cmdScroller = document.getElementById('cmdScroller')!
      const cmdOutput = document.getElementById('cmdOutput')!
      const cmdPin = document.getElementById('cmdPin')!

      // Scroll command card to bottom
      cmdScroller.scrollTop = cmdScroller.scrollHeight - cmdScroller.clientHeight
      const initialCmdTop = cmdScroller.scrollTop

      // Append lines with data-following="true"
      cmdOutput.textContent += '\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15'
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const followedCmdTop = cmdScroller.scrollTop
      const followDelta = followedCmdTop - initialCmdTop

      // Now set data-following="false" (user scrolled away)
      cmdPin.dataset.following = 'false'
      cmdScroller.scrollTop = 50
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const holdTop = cmdScroller.scrollTop

      // Append more lines
      cmdOutput.textContent += '\nLine 16\nLine 17\nLine 18\nLine 19\nLine 20'
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const afterUnfollowedTop = cmdScroller.scrollTop

      return { initialCmdTop, followedCmdTop, followDelta, holdTop, afterUnfollowedTop }
    })
    console.log(
      `[test 4] ToolCommandCard followDelta=${result4.followDelta}, holdTop=${result4.holdTop}, afterUnfollowed=${result4.afterUnfollowedTop}`,
    )
    assert.ok(result4.followDelta > 0, `Expected followDelta > 0, got ${result4.followDelta}`)
    assert.strictEqual(
      result4.afterUnfollowedTop,
      result4.holdTop,
      `Expected unfollowed scroll to hold position, got ${result4.afterUnfollowedTop}`,
    )

    assert.strictEqual(errors.length, 0, `Page errors: ${errors.join(', ')}`)
    console.log('✅ ALL STAGE 1 GATE VERIFICATIONS PASSED!')
  } finally {
    await browser.close()
  }
}

await run()
