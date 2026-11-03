// Run: bun apps/desktop/renderer/test/QueueRemove.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {SessionFollowUpDock} from ${JSON.stringify(
  resolve(rendererRoot, 'src/features/session/SessionFollowUpDock.tsx').replaceAll('\\', '/'),
)};
const fixture = window.fixture = {calls: 0};
function Harness() {
  const [items, setItems] = useState([{id: 'queued', previewText: '目标 等待执行',
    input: {text: '等待执行'}, createdAt: '2026-10-31T00:00:00Z'}]);
  fixture.clear = () => flushSync(() => setItems([]));
  return <SessionFollowUpDock items={items} onEdit={() => {}} onResume={() => {}}
    onRemove={() => {fixture.calls++; return new Promise((resolve, reject) => {
      fixture.resolve = resolve; fixture.reject = reject;
    });}} />;
}
flushSync(() => createRoot(document.getElementById('root')).render(<Harness />));
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['queue-remove-harness'],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'queue-remove-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^queue-remove-harness$/ }, () => ({
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
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: script })
  assert.deepEqual(errors, [])
  assert.match(await page.content(), /移除排队消息/)
  const remove = page.locator('.session-follow-up-action').first()
  await remove.click()
  await remove.evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
  })
  assert.equal(await remove.isDisabled(), true)
  assert.equal(await remove.getAttribute('aria-busy'), 'true')
  assert.equal(await page.getByRole('button', { name: '更多：编辑消息' }).isDisabled(), true)
  assert.equal(await page.evaluate(() => (window as any).fixture.calls), 1)
  await page.evaluate(() => (window as any).fixture.reject(new Error('排队消息已开始执行，请刷新')))
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /已开始执行/)
  assert.equal(await remove.isEnabled(), true)
  assert.equal(await page.getByRole('listitem').count(), 1)
  await remove.click()
  await page.evaluate(() => {
    const f = (window as any).fixture
    f.clear()
    f.resolve()
  })
  await page.getByRole('listitem').waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('alert').count(), 0)
  assert.deepEqual(errors, [])
  console.log('Queue removal pending, duplicate prevention, failure and success passed')
} finally {
  await browser.close()
}
