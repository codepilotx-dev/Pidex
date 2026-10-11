// Run: bun apps/desktop/renderer/test/ModelProviderSelection.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientMock = `
const providers = [
  { providerID: 'minimax-cn-coding-plan', displayName: 'MiniMax', kind: 'anthropic', apiKeyConfigured: true, defaultModels: ['MiniMax-M3'] },
  { providerID: 'openai', displayName: 'OpenAI', kind: 'openai', apiKeyConfigured: true, defaultModels: ['gpt-5', 'gpt-5-mini'] },
];
const selected = { providerID: 'minimax-cn-coding-plan', id: 'MiniMax-M3' };
let deferCatalog = false;
const pending = [];
const metadata = { 'gpt-5': { reasoning: true, variants: ['low', 'high'] } };
function state(providerID = selected.providerID) {
  const provider = providers.find(item => item.providerID === providerID);
  return { provider, selectedProviderID: providerID, models: provider.defaultModels, modelMetadata: metadata,
    model: selected.providerID === providerID ? selected.id : provider.defaultModels[0],
    apiKeyConfigured: true, modelConfigured: true, baseURL: '' };
}
export function deferState() { deferCatalog = true; }
export function releaseState() { deferCatalog = false; pending.splice(0).forEach(resolve => resolve()); }
export const desktopClient = {
  getModelProviderState: async providerID => { if (deferCatalog) await new Promise(resolve => pending.push(resolve)); return state(providerID); },
  listModelProviders: async () => providers,
  fetchProviderModels: async ({ providerID }) => ({ models: state(providerID).models, modelMetadata: metadata }),
  saveModelProvider: async () => { document.body.dataset.saveStarted = '1'; throw Error('Global default must not change'); },
};
`
const harness = `
import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useModelProviderController } from ${JSON.stringify(resolve(rendererRoot, 'src/features/layout/UseModelProviderController.ts').replaceAll('\\', '/'))};
import { deferState, releaseState } from 'model-selection-client';
function Harness() {
  const defaults = { providerID: 'minimax-cn-coding-plan', model: 'MiniMax-M3', thinkingMode: 'default' };
  const [selections, setSelections] = useState({ 'session-a': defaults, 'session-b': defaults, home: defaults });
  const [sessionId, setSessionId] = useState('session-a');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const selection = selections[sessionId];
  const update = useCallback(value => setSelections(current => ({ ...current, [sessionId]: value })), [sessionId]);
  const controller = useModelProviderController({ selection: loading ? null : selection, onSelectionChange: update, selectionLoading: loading, sessionId: sessionId === 'home' ? null : sessionId, hasMessages: true, setErrorMessage: setError, setNoticeMessage: () => {} });
  return <>
    <output id="selection">{controller.selectedProviderID + '/' + controller.model}</output>
    <output id="configured">{String(controller.modelConfigured)}</output>
    <output id="preset">{controller.resolvedSelectedModelPreset}</output>
    <output id="variant">{controller.selectedVariant}</output>
    <output id="error">{error}</output>
    <output id="unavailable">{controller.selectedModelUnavailableMessage}</output>
    {controller.providerModelOptions.flatMap(provider => provider.modelPresets.map(preset =>
      <button key={provider.providerID + preset.id} onClick={() => controller.handleProviderModelChange(provider.providerID, preset.id)}>{provider.providerID + '/' + preset.id}</button>
    ))}
    <button onClick={() => update({ ...selection, model: 'missing-model' })}>Missing model</button>
    <button onClick={() => controller.handleVariantChange('high')}>High</button>
    <button onClick={() => window.dispatchEvent(new Event('desktop:model-provider-changed'))}>Refresh catalog</button>
    <button onClick={() => setSessionId('session-b')}>Switch session</button>
    <button onClick={() => setSessionId('session-a')}>First session</button>
    <button onClick={() => setSessionId('home')}>Home</button>
    <button onClick={() => setLoading(value => !value)}>Toggle loading</button>
    <button onClick={deferState}>Defer catalog</button>
    <button onClick={releaseState}>Release catalog</button>
  </>;
}
createRoot(document.getElementById('root')).render(<Harness />);
`
async function buildHarness(): Promise<string> {
  const build = await Bun.build({
    entrypoints: ['model-selection-harness'],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'model-selection-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^react-dom\/client$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^model-selection-harness$/ }, () => ({
            path: 'harness',
            namespace: 'model-selection',
          }))
          builder.onLoad({ filter: /^harness$/, namespace: 'model-selection' }, () => ({
            contents: harness,
            loader: 'jsx',
            resolveDir: rendererRoot,
          }))
          builder.onResolve(
            { filter: /(?:desktop-client\/index\.js$|^model-selection-client$)/ },
            () => ({ path: 'client', namespace: 'model-selection' }),
          )
          builder.onLoad({ filter: /^client$/, namespace: 'model-selection' }, () => ({
            contents: clientMock,
            loader: 'js',
          }))
        },
      },
    ],
  })
  assert.ok(build.success, build.logs.map(String).join('\n'))
  return build.outputs[0]!.text()
}
if (process.versions.bun) {
  // Playwright's Chrome pipe transport needs Node on Windows; Bun only bundles the harness.
  const child = Bun.spawn(['node', '--experimental-strip-types', fileURLToPath(import.meta.url)], {
    stdin: new Blob([await buildHarness()]),
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
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: script })
  const selection = page.locator('#selection')
  const check = async (model: string) => {
    await expect(selection).toHaveText(model)
    await expect(page.locator('#configured')).toHaveText('true')
    await expect(page.locator('#preset')).toHaveText(model.split('/')[1]!)
    await expect(page.locator('#error')).toBeEmpty()
  }
  await expect(page.locator('#configured')).toHaveText('false')
  assert.deepEqual(errors, [])
  await page.getByRole('button', { name: 'Toggle loading' }).click()
  await check('minimax-cn-coding-plan/MiniMax-M3')
  await page.getByRole('button', { name: 'openai/gpt-5', exact: true }).click()
  await check('openai/gpt-5')
  await page.getByRole('button', { name: 'High', exact: true }).click()
  await expect(page.locator('#variant')).toHaveText('high')
  await page.getByRole('button', { name: 'Refresh catalog' }).click()
  await check('openai/gpt-5')
  await expect(page.locator('#variant')).toHaveText('high')
  await page.getByRole('button', { name: 'Switch session' }).click()
  await check('minimax-cn-coding-plan/MiniMax-M3')
  await expect(page.locator('#variant')).toHaveText('default')
  await page.getByRole('button', { name: 'First session' }).click()
  await check('openai/gpt-5')
  await expect(page.locator('#variant')).toHaveText('high')
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await check('minimax-cn-coding-plan/MiniMax-M3')
  await page.getByRole('button', { name: 'First session' }).click()
  await page.getByRole('button', { name: 'Defer catalog' }).click()
  await page.getByRole('button', { name: 'Refresh catalog' }).click()
  await page.getByRole('button', { name: 'Switch session' }).click()
  await page.getByRole('button', { name: 'Release catalog' }).click()
  await check('minimax-cn-coding-plan/MiniMax-M3')
  await page.getByRole('button', { name: 'Toggle loading' }).click()
  await expect(page.locator('#configured')).toHaveText('false')
  await page.getByRole('button', { name: 'openai/gpt-5', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle loading' }).click()
  await check('minimax-cn-coding-plan/MiniMax-M3')
  await expect(page.locator('body')).not.toHaveAttribute('data-save-started')
  await page.getByRole('button', { name: 'Missing model' }).click()
  await expect(selection).toHaveText('minimax-cn-coding-plan/missing-model')
  await expect(page.locator('#configured')).toHaveText('false')
  await expect(page.locator('#unavailable')).toContainText('minimax-cn-coding-plan/missing-model')
  await page.getByRole('button', { name: 'Refresh catalog' }).click()
  await expect(selection).toHaveText('minimax-cn-coding-plan/missing-model')
  assert.deepEqual(errors, [])
  console.log(
    'Session model/variant remain isolated across catalog refresh, delayed requests, home and loading; no global saves.',
  )
} finally {
  await browser.close()
}
