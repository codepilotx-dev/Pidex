// Run: bun apps/desktop/renderer/test/PetSettingsSubscription.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))
const harness = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {MemoryRouter, useNavigate} from 'react-router-dom';
import {PetCatalogProvider, usePetCatalogController} from ${source('features/pet/PetCatalogProvider.tsx')};
import {PetSettings} from ${source('features/settings/PetSettings.tsx')};
window.listCalls = 0;
function CatalogConsumer() {
  const pets = usePetCatalogController(state => state.pets);
  window.navigate = useNavigate();
  return <output id="catalog">{pets.map(pet => pet.displayName).join(',')}</output>;
}
let root;
window.mount = path => {
  root = createRoot(document.getElementById('root'));
  flushSync(() => root.render(<MemoryRouter initialEntries={[path]}><PetCatalogProvider>
    <CatalogConsumer/><PetSettings onError={message => {throw Error(message)}}/>
  </PetCatalogProvider></MemoryRouter>));
};
window.unmount = () => flushSync(() => root.unmount());
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['pet-settings-harness'],
    target: 'browser',
    format: 'iife',
    define: {
      'process.env.NODE_ENV': '"development"',
      'import.meta.env': '{"DEV":true}',
      'import.meta.hot': 'undefined',
    },
    plugins: [
      {
        name: 'pet-settings-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$|^react-router-dom$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^pet-settings-harness$/ }, () => ({
            path: 'harness',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /^harness$/, namespace: 'fixture' }, () => ({
            contents: harness,
            loader: 'jsx',
            resolveDir: rendererRoot,
          }))
          builder.onResolve({ filter: /desktop-client\/index\.js$/ }, () => ({
            path: 'client',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /^client$/, namespace: 'fixture' }, () => ({
            contents: `
        export const desktopClient = {
          listPets: async () => {window.listCalls++; return [{id: 'verify-pet', displayName: 'Verify Pet'}];},
          onDesktopSettingsChange: () => () => {},
        };`,
            loader: 'js',
          }))
          builder.onResolve({ filter: /UseDesktopSettings\.js$/ }, () => ({
            path: 'settings',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /^settings$/, namespace: 'fixture' }, () => ({
            contents: `
        const pet = {enabled: false, selectedPetId: 'verify-pet', size: 120};
        const actions = {setValue() {}, autoSave() {}, save: async () => ({pet})};
        export const useDesktopSettingsDraftValue = () => pet;
        export const useDesktopSettingsDraftActions = () => actions;
      `,
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
  for (const initialPath of ['/settings/pets', '/pets', '/new']) {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: script })
    await page.evaluate((path) => (window as any).mount(path), initialPath)
    if (initialPath === '/new') {
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      assert.equal(await page.evaluate(() => (window as any).listCalls), 0)
      await page.evaluate(() => (window as any).navigate('/settings/pets'))
    }
    await expect(page.locator('#catalog')).toHaveText('Verify Pet')
    await expect(page.getByRole('button', { name: '选择宠物', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: '选择宠物', exact: true })).toContainText(
      'Verify Pet',
    )
    assert.equal(
      await page.evaluate(() => (window as any).listCalls),
      1,
      'settings and catalog consumers must share one initial request',
    )
    await page.evaluate(() => (window as any).navigate('/pets'))
    await expect(page.locator('#catalog')).toHaveText('Verify Pet')
    assert.equal(await page.evaluate(() => (window as any).listCalls), 1)
    assert.deepEqual(errors, [])
    await page.evaluate(() => (window as any).unmount())
    await page.close()
  }
  console.log('Pet settings mounted regression passed')
} finally {
  await browser.close()
}
