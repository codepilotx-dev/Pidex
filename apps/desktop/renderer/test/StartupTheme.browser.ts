// Bundle with Bun (--target=node), then run with Node, like IconSize.browser.ts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const html = readFileSync('index.html', 'utf8')
const startupScript = readFileSync('public/startup-theme.js', 'utf8')
const tokens = readFileSync('src/styles/design-system/tokens.css', 'utf8')
const base = readFileSync('src/styles/base.css', 'utf8')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const scenario of [
    { system: 'light', variant: 'dark', surface: '#111111', ink: '#eeeeee', rgb: 'rgb(17, 17, 17)' },
    { system: 'dark', variant: 'light', surface: '#ffffff', ink: '#1f1f1f', rgb: 'rgb(255, 255, 255)' },
    { system: 'light', variant: 'dark', surface: '#121725', ink: '#f4f6ff', rgb: 'rgb(18, 23, 37)' },
    { system: 'dark', rgb: 'rgb(24, 24, 24)' },
    { system: 'light', rgb: 'rgb(255, 255, 255)' },
  ] as const) {
    const page = await browser.newPage({ colorScheme: scenario.system })
    try {
      await page.route('http://startup.test/**', (route) => {
        const path = new URL(route.request().url()).pathname
        return route.fulfill({
          contentType: path === '/startup-theme.js' ? 'text/javascript' : 'text/html',
          body: path === '/startup-theme.js' ? startupScript : path === '/' ? html : '',
        })
      })
      const url = new URL('http://startup.test/')
      if ('variant' in scenario) {
        url.searchParams.set('cpx-startup-theme', JSON.stringify({ version: 1, ...scenario }))
      }
      await page.goto(url.href)
      // Reproduce the interval after global CSS loads but before React applies its theme.
      await page.addStyleTag({ content: `${tokens}\n${base}` })
      const colors = await page.evaluate(() =>
        ['html', 'body', '#startup-splash'].map((selector) =>
          getComputedStyle(document.querySelector(selector)!).backgroundColor,
        ),
      )
      assert.deepEqual(colors, Array(3).fill(scenario.rgb), JSON.stringify(scenario))
      await page.evaluate(() => {
        document.getElementById('startup-splash')!.remove()
        document.documentElement.dataset.theme = 'dark'
        document.documentElement.style.setProperty('--cpx-sys-color-surface-canvas', '#234567')
        const loader = document.createElement('div')
        loader.className = 'full-screen-whale-loader'
        document.body.append(loader)
      })
      assert.deepEqual(await page.evaluate(() =>
        ['body', '.full-screen-whale-loader'].map((selector) =>
          getComputedStyle(document.querySelector(selector)!).backgroundColor,
        ),
      ), ['rgb(35, 69, 103)', 'rgb(35, 69, 103)'])
    } finally {
      await page.close()
    }
  }
  console.log('Startup theme: 5 scenarios and theme handoff passed')
} finally {
  await browser.close()
}
