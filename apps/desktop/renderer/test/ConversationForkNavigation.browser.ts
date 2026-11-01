// Run: bun apps/desktop/renderer/test/ConversationForkNavigation.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { useConversationForkController } from './src/features/session/workflow/fork/UseConversationForkController';
import { ForkOriginDivider } from './src/features/session/timeline/ForkOriginDivider';
window.records = [];
window.failSync = false;
window.addEventListener('desktop:error', event => window.records.push('error'));
function App() {
  const [source, setSource] = useState('source');
  const fork = useConversationForkController({ canUseNewWorktree: false, sourceRunning: false,
    sourceThreadId: source, onNavigateTarget: id => window.records.push('navigate:' + id) });
  return <MemoryRouter>
    <button disabled={!fork.onForkFromMessage} onClick={() => fork.onForkFromMessage({itemId:'item', turnId:'turn'})}>fork</button>
    <button onClick={() => setSource('other')}>switch</button>
    {fork.dialog}
    <ForkOriginDivider sourceThreadId="source" />
  </MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<App />);
`
const client = `
export const desktopClient = { synchronizeSession: id => new Promise((resolve, reject) => {
  window.records.push('sync:' + id);
  window.releaseSync = () => {
    if (window.failSync) { reject(new Error('同步失败')); return; }
    window.records.push('published:' + id); resolve();
  };
}) };
`
const forkClient = `
const operation = {status:'completed', targetThreadId:'target', sourceThreadId:'source', operationId:'fork', revision:1};
export const conversationForkClient = () => ({ supportsThreadFork: async () => true,
  pendingThreadFork: async () => ({operation:null}),
  startThreadFork: async () => ({operation}),
  threadForkStatus: async () => ({operation, output:{data:'', cursor:0, truncated:false}}),
});
`
const dialog = `
import React from 'react';
export function ConversationForkDialog(props) { return props.open ? <div>
  <button disabled={props.busy} onClick={() => props.onSelectDestination({kind:'same-worktree'})}>choose</button>
  <button onClick={() => props.onOpenChange(false)}>close</button>
</div> : null; }
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['fork-navigation-harness'],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'harness',
        setup(builder) {
          builder.onResolve(
            { filter: /^react(?:\/.*)?$|^react-dom\/client$|^react-router-dom$/ },
            (args) => ({
              path: Bun.resolveSync(args.path, root),
            }),
          )
          builder.onResolve({ filter: /^\.\/src\// }, (args) => ({
            path: resolve(root, args.path + '.tsx'),
          }))
          builder.onResolve({ filter: /^fork-navigation-harness$/ }, () => ({
            path: 'entry',
            namespace: 'fixture',
          }))
          builder.onResolve({ filter: /services\/desktop-client\/index\.js$/ }, () => ({
            path: 'client',
            namespace: 'fixture',
          }))
          builder.onResolve({ filter: /\/ForkClient\.js$/ }, () => ({
            path: 'fork-client',
            namespace: 'fixture',
          }))
          builder.onResolve({ filter: /\/ConversationForkDialog\.js$/ }, () => ({
            path: 'dialog',
            namespace: 'fixture',
          }))
          builder.onResolve({ filter: /components\/GlobalErrorModal\.js$/ }, () => ({
            path: 'notice',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents: (
              {
                entry: source,
                client,
                'fork-client': forkClient,
                dialog,
                notice: 'export const GlobalErrorModal = () => null;',
              } as Record<string, string>
            )[args.path],
            loader: 'jsx',
            resolveDir: root,
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
  await page.route('http://localhost/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div id="root"></div>',
    }),
  )
  const start = async () => {
    await page.goto('http://localhost/')
    await page.addScriptTag({ content: script })
    await expect(page.getByRole('button', { name: 'fork', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'fork', exact: true }).click()
    await page.getByRole('button', { name: 'choose', exact: true }).click()
    await page.waitForFunction('typeof releaseSync === "function"')
  }
  await start()
  assert.deepEqual(await page.evaluate('records'), ['sync:target'])
  // 同步阻塞超过原路由的 1.5 秒回退窗口，不能提前导航。
  await page.waitForTimeout(1600)
  assert.deepEqual(await page.evaluate('records'), ['sync:target'])
  await page.evaluate('releaseSync()')
  await page.waitForFunction('records.includes("navigate:target")')
  assert.deepEqual(await page.evaluate('records'), [
    'sync:target',
    'published:target',
    'navigate:target',
  ])
  const cdp = await page.context().newCDPSession(page)
  const tree = await cdp.send('Accessibility.getFullAXTree')
  assert.ok(
    tree.nodes.some((node) => node.role?.value === 'link' && node.name?.value === '从聊天中继续'),
  )
  await page.getByRole('link', { name: '从聊天中继续' }).focus()
  await expect(page.getByRole('link', { name: '从聊天中继续' })).toBeFocused()
  await cdp.detach()

  await start()
  await page.getByRole('button', { name: 'switch', exact: true }).click()
  await page.evaluate('releaseSync()')
  await expect.poll(() => page.evaluate('records')).toEqual(['sync:target', 'published:target'])
  await page.waitForTimeout(50)
  assert.ok(!(await page.evaluate('records')).includes('navigate:target'))

  await start()
  await page.getByRole('button', { name: 'close', exact: true }).click()
  await page.evaluate('releaseSync()')
  await page.waitForTimeout(50)
  assert.deepEqual(await page.evaluate('records'), ['sync:target', 'published:target'])

  await start()
  await page.evaluate('failSync = true; releaseSync()')
  await page.waitForFunction('records.includes("error")')
  assert.deepEqual(await page.evaluate('records'), ['sync:target', 'error'])
  await expect(page.getByRole('button', { name: 'choose', exact: true })).toBeEnabled()
  assert.deepEqual(errors, [])
  console.log('fork navigation ordering, failure, cancellation and AX link checks passed')
} finally {
  await browser.close()
}
