// 按钮尺寸诊断脚本。Bun 运行时下 Playwright 的 chromium.launch 会无限挂起（事件循环级阻塞，
// 连 launch timeout 都不会触发），必须用 node 运行：
//   bun run dev:visual -- --port 47180 --strictPort
//   node probe-temp.mjs
import { chromium } from '@playwright/test'

if (process.versions.bun !== undefined) {
  console.error('Bun 运行时下 Playwright 浏览器启动会无限挂起，请改用 node 运行：node probe-temp.mjs')
  process.exit(1)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } })
  await page.goto('http://127.0.0.1:47180/?visualCase=rich#/threads/visual-rich', {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForTimeout(6000)
  const info = await page.evaluate(() => {
    const fixture = document.createElement('div')
    fixture.id = 'probe-fixture'
    for (const size of ['default', 'iconMd', 'iconSm', 'compact']) {
      const button = document.createElement('button')
      button.className = 'ui-button icon-button'
      button.dataset.size = size
      button.textContent = size
      if (size.startsWith('icon')) {
        button.textContent = ''
        button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 12h16" /></svg>'
      }
      fixture.append(button)
    }
    document.body.append(fixture)
    return [...fixture.children].map((b) => {
      const s = getComputedStyle(b)
      const svg = b.querySelector('svg')
      return {
        size: b.dataset.size,
        box: [b.getBoundingClientRect().width, b.getBoundingClientRect().height],
        cssHeight: s.height,
        display: s.display,
        padding: s.padding,
        font: s.font,
        lineHeight: s.lineHeight,
        svgBox: svg ? [svg.getBoundingClientRect().width, svg.getBoundingClientRect().height] : null,
        svgCss: svg ? [getComputedStyle(svg).width, getComputedStyle(svg).height] : null,
      }
    })
  })
  console.log(JSON.stringify(info, null, 2))
} finally {
  await browser.close()
}
