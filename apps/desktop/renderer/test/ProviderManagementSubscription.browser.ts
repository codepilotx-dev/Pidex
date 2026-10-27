// Run: bun apps/desktop/renderer/test/ProviderManagementSubscription.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))
const clientMock = `
export const provider = {providerID: 'deepseek', displayName: 'Verify DeepSeek', kind: 'builtin',
  providerKind: 'builtin', authMethods: ['api-key'], defaultModels: ['chat'], apiKeyConfigured: true, envVars: []};
export const desktopClient = {
  listModelProviders: async () => [provider],
  getModelProviderState: async () => ({selectedProviderID: 'deepseek', provider, model: 'chat',
    apiKeyConfigured: true, modelConfigured: true, models: ['chat']}),
  listProviderCredentials: async () => [],
  listUsageSources: async () => ({sources: []}),
  subscribeAgentEventEnvelopes: () => () => {},
  queryProviderUsage: async input => ({range: input.range, timeZone: input.timeZone,
    generatedAt: Date.now(), sources: []}),
};
`
const harness = `
import React, {Profiler} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {MemoryRouter} from 'react-router-dom';
import {provider} from 'provider-subscription-client';
import {providerManagementStore as store} from ${source('features/provider-management/ProviderManagementStore.ts')};
import {ProviderConnectionSection} from ${source('features/models/provider-management/ProviderConnectionSection.tsx')};
import {SidebarProvidersPane} from ${source('features/layout/sidebar/SidebarProvidersPane.tsx')};
import {RequireConfiguredModel} from ${source('features/models/setup/RequireConfiguredModel.tsx')};
const counts = {sidebar: 0, gate: 0, connection: 0};
const roots = [];
const noop = async () => {};
const props = {provider, apiKeys: [], busy: false, onSubmitKey: async () => true,
  onDeleteKey: noop, onCopyKey: noop, onMoveKey: noop, onTestKey: noop,
  onSetActiveKey: noop, onToggleKeyEnabled: noop, onRefresh: noop,
  onSaveDefinition: noop, onNotice: noop, onError: noop};
window.fixture = {
  counts, store,
  async mount() {
    await store.ensureLoaded();
    for (const [id, component] of [['sidebar', <SidebarProvidersPane/>],
      ['gate', <RequireConfiguredModel/>], ['connection', <ProviderConnectionSection {...props}/>]]) {
      const root = createRoot(document.getElementById(id));
      roots.push(root);
      flushSync(() => root.render(<MemoryRouter initialEntries={['/providers']}>
        <Profiler id={id} onRender={() => counts[id]++}>{component}</Profiler>
      </MemoryRouter>));
    }
  },
  async query(range) {
    await store.querySources({range, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      sourceIds: ['verify-source'], force: true});
  },
  clearQueries() {flushSync(() => store.setState({usageQueries: {}}));},
  updateConfiguration() {
    flushSync(() => store.setState(state => ({configuration: {...state.configuration,
      providers: state.configuration.providers.map(p => ({...p, displayName: 'Updated Provider'}))}})));
  },
  unmount() {for (const root of roots) flushSync(() => root.unmount()); store.dispose();}
};
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['provider-subscription-harness'],
    target: 'browser',
    format: 'iife',
    define: {
      'process.env.NODE_ENV': '"development"',
      'import.meta.env': '{"DEV":true}',
      'import.meta.hot': 'undefined',
    },
    plugins: [
      {
        name: 'provider-subscription-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$|^react-router-dom$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^provider-subscription-harness$/ }, () => ({
            path: 'harness',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /^harness$/, namespace: 'fixture' }, () => ({
            contents: harness,
            loader: 'jsx',
            resolveDir: rendererRoot,
          }))
          builder.onResolve(
            { filter: /desktop-client\/index\.js$|^provider-subscription-client$/ },
            () => ({ path: 'client', namespace: 'fixture' }),
          )
          builder.onLoad({ filter: /^client$/, namespace: 'fixture' }, () => ({
            contents: clientMock,
            loader: 'js',
          }))
          builder.onResolve({ filter: /UseDesktopSettings\.js$/ }, () => ({
            path: 'settings',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /^settings$/, namespace: 'fixture' }, () => ({
            contents:
              'export const useDesktopSettings = () => ({settingsLoaded: true, firstUseSetupCompleted: 1});',
            loader: 'js',
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
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.setContent('<div id="sidebar"></div><div id="gate"></div><div id="connection"></div>')
  await page.addScriptTag({ content: script })
  assert.deepEqual(errors, [], 'harness must initialize')
  await page.evaluate(async () => {
    await (window as any).fixture.mount()
  })
  await page.waitForFunction(() => (window as any).fixture.counts.connection > 0)
  const before = await page.evaluate(() => ({ ...(window as any).fixture.counts }))
  assert.ok(before.connection < 10, 'empty partition must settle without a render loop')
  assert.equal(await page.locator('#connection .model-center-connection-section').count(), 1)
  for (const range of ['today', '7d', 'today']) {
    await page.evaluate(async (range) => {
      await (window as any).fixture.query(range)
    }, range)
    // Drain React work, including passive subscription effects, before measuring.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
  }
  const after = await page.evaluate(() => ({ ...(window as any).fixture.counts }))
  assert.equal(after.sidebar, before.sidebar, 'usage updates must not commit the sidebar')
  assert.equal(after.gate, before.gate, 'usage updates must not commit the configuration gate')
  assert.ok(after.connection > before.connection, 'today query must update the mounted connection')
  await page.evaluate(() => (window as any).fixture.clearQueries())
  await page.evaluate(() => (window as any).fixture.updateConfiguration())
  const configuration = await page.evaluate(() => ({ ...(window as any).fixture.counts }))
  assert.ok(
    configuration.sidebar > after.sidebar,
    'sidebar must remain subscribed to configuration',
  )
  assert.ok(configuration.gate > after.gate, 'gate must remain subscribed to configuration')
  assert.deepEqual(errors, [])
  await page.evaluate(() => (window as any).fixture.unmount())
  console.log(
    'Provider mounted regression passed:',
    JSON.stringify({ before, after, configuration }),
  )
} finally {
  await browser.close()
}
