// First: bun run build:renderer
// Run: bun apps/desktop/renderer/test/ToastStack.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stackPath = JSON.stringify(
  resolve(rendererRoot, 'src/components/toast/ToastStack.tsx').replaceAll('\\', '/'),
)
const statePath = JSON.stringify(
  resolve(rendererRoot, 'src/components/toast/ToastState.ts').replaceAll('\\', '/'),
)
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ToastStack } from ${stackPath};
import { toastStore } from ${statePath};
window.seed = () => {
  toastStore.show({id: 'old', message: 'Old', tone: 'status'});
  toastStore.show({id: 'new', message: 'New', tone: 'error'});
};
toastStore.show({id: 'first', message: 'First', tone: 'status'});
createRoot(document.getElementById('root')).render(<ToastStack />);
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['toast-stack-harness'],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'toast-stack-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^toast-stack-harness$/ }, () => ({
            path: 'harness',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /^harness$/, namespace: 'fixture' }, () => ({
            contents: harness,
            loader: 'jsx',
            resolveDir: rendererRoot,
          }))
        },
      },
    ],
  })
  assert.ok(build.success, build.logs.map(String).join('\n'))
  const child = Bun.spawn(['node', '--experimental-strip-types', fileURLToPath(import.meta.url)], {
    stdin: new Blob([await build.outputs[0]!.text()]),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  process.exit(await child.exited)
}

let script = ''
for await (const chunk of process.stdin) script += chunk.toString('utf8')

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<button id="outside" style="position:fixed;bottom:10px">Outside</button><div id="root"></div>',
  )
  const assets = resolve(rendererRoot, '../../../dist/renderer/assets')
  const cssFiles = (await readdir(assets)).filter((name) => /^(index|App)-.*\.css$/.test(name))
  assert.ok(cssFiles.length > 0, '先运行 bun run build:renderer')
  for (const name of cssFiles)
    await page.addStyleTag({ content: await readFile(resolve(assets, name), 'utf8') })
  await page.addScriptTag({ content: script })
  const stack = page.getByRole('region', { name: '通知列表' })
  await stack.getByRole('button', { name: '关闭', exact: true }).click()
  await stack.waitFor({ state: 'detached' })
  await page.locator('#outside').click()
  await page.evaluate(() => (window as any).seed())
  await stack.waitFor()
  assert.equal(
    await stack.getAttribute('data-open'),
    null,
    '移除最后一条通知后，新队列必须默认折叠',
  )
  await page.waitForFunction(
    () => {
      const cards = [...document.querySelectorAll<HTMLElement>('.toast-card-wrapper')]
      const back = cards.find((card) => card.querySelector('[data-kind="success"]'))!
      const front = cards.find((card) => card.querySelector('[data-kind="error"]'))!
      const matrix = new DOMMatrixReadOnly(getComputedStyle(back).transform)
      return (
        Math.abs(matrix.a - 0.95) < 0.001 &&
        Math.abs(front.getBoundingClientRect().top - back.getBoundingClientRect().top - 10) < 0.1 &&
        getComputedStyle(back.querySelector('.tst-content')!).opacity === '0' &&
        back.querySelector('.tst-content')!.hasAttribute('inert')
      )
    },
    null,
    { timeout: 2000 },
  )
  await stack.hover()
  assert.equal(await stack.getAttribute('data-open'), 'true')
  await page.locator('#outside').click()
  await page.waitForFunction(
    () => !document.querySelector('.tst')?.hasAttribute('data-open'),
    null,
    { timeout: 2000 },
  )
  assert.equal(await stack.getAttribute('data-open'), null, '指针和焦点离开后必须折叠')
  await stack.hover()
  await stack.getByRole('button', { name: '关闭错误提示' }).click()
  await page.locator('#outside').click()
  await page.evaluate(() => (window as any).seed())
  assert.equal(await stack.getAttribute('data-open'), null, '删除聚焦卡片后也必须释放焦点展开状态')
  await stack.hover()
  await stack.getByRole('button', { name: '关闭错误提示' }).focus()
  await page.mouse.move(20, 650)
  assert.equal(await stack.getAttribute('data-open'), 'true', '真实焦点仍在通知内时保持展开')
  await page.locator('#outside').focus()
  assert.equal(await stack.getAttribute('data-open'), null)
  assert.deepEqual(errors, [])
  console.log('Toast stack: closing last toast, new queue, hover and leave passed')
} finally {
  await browser.close()
}
