// Run: bun apps/desktop/renderer/test/SideChatModelIsolation.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientMock = `
window.records = [];
const historyGate = new Promise(resolve => { window.releaseHistory = resolve; });
const createGate = new Promise(resolve => { window.releaseCreate = resolve; });
export const desktopClient = {
  getRuntimeCapabilities: async () => ['thread.side-chat.v1'],
  getSession: async id => {
    window.records.push({method:'getSession',id});
    await historyGate;
    return { settings: { providerID:'provider-a', model:'history-a', thinkingMode:'enabled', variant:'high' } };
  },
  getModelProviderState: async id => ({ selectedProviderID:id, model:'WRONG-DEFAULT', baseURL:'https://'+id+'.example' }),
  createSideChat: async input => {
    window.records.push({method:'createSideChat',input});
    await createGate;
    return {sideChat:{threadId:'side-a',sourceThreadId:input.sourceThreadId,inheritedThroughTurnId:null}};
  },
  sendUserMessage: async (id,input,model) => {window.records.push({method:'send',id,input,model});},
};
`
const harness = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useSideChatController} from ${JSON.stringify(resolve(rendererRoot, 'src/features/layout/dock/UseSideChatController.ts').replaceAll('\\', '/'))};
import {sessionModelSelections} from ${JSON.stringify(resolve(rendererRoot, 'src/features/session/state/SessionModelSelectionStore.ts').replaceAll('\\', '/'))};
window.store = sessionModelSelections;
const onError = message => {window.lastError = message;};
function Harness() {
  const [source,setSource] = useState('a');
  const [tab,setTab] = useState(null);
  window.setSource = setSource;
  const api = useSideChatController({
    activeTab:tab,sourceThreadId:source,
    initialSettings:{permissionMode:'default',planModeActive:false,providerID:source==='a'?'':'provider-b',
      model:source==='a'?'':'draft-b',providerBaseURL:'https://WRONG-source.example',
      selectedModelPreset:'',thinkingMode:'default'},
    openRightDockTab:setTab,removeWorkbenchTab:()=>setTab(null),replaceWorkbenchTab:(_,next)=>setTab(next),onError,
  });
  window.api = api;
  return <>
    <output id="ready">{String(api.sideChatSupported)}</output>
    <output id="source">{source}</output>
    <output id="tab">{tab?.threadId ?? ''}</output>
    <output id="selection">{tab ? JSON.stringify(api.getSideChatSettings(tab.id)) : ''}</output>
  </>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
`
async function buildHarness() {
  const build = await Bun.build({
    entrypoints: ['side-isolation-harness'],
    target: 'browser',
    format: 'esm',
    tsconfig: resolve(rendererRoot, 'tsconfig.app.json'),
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'side-isolation-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^react-dom\/client$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^side-isolation-harness$/ }, () => ({
            path: 'harness',
            namespace: 'side-isolation',
          }))
          builder.onLoad({ filter: /^harness$/, namespace: 'side-isolation' }, () => ({
            contents: harness,
            loader: 'jsx',
            resolveDir: rendererRoot,
          }))
          builder.onResolve({ filter: /desktop-client\/index\.js$/ }, () => ({
            path: 'client',
            namespace: 'side-isolation',
          }))
          builder.onLoad({ filter: /^client$/, namespace: 'side-isolation' }, () => ({
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
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://127.0.0.1/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }),
  )
  await page.goto('http://127.0.0.1/')
  await page.addScriptTag({ content: script, type: 'module' })
  await expect(page.locator('#ready')).toHaveText('true')
  await page.evaluate('window.creation = api.createSideChat(); void 0')
  assert.deepEqual(await page.evaluate('records'), [{ method: 'getSession', id: 'a' }])
  await expect(page.locator('#tab')).toHaveText('')
  await page.evaluate('releaseHistory()')
  await expect
    .poll(() => page.evaluate('records.filter(record=>record.method === "createSideChat").length'))
    .toBe(1)
  await expect(page.locator('#selection')).toContainText('history-a')
  await page.evaluate(
    `store.set('b',{providerID:'provider-b',model:'draft-b',thinkingMode:'adaptive',variant:'adaptive'});setSource('b')`,
  )
  await expect(page.locator('#source')).toHaveText('b')
  // A changes too while the side-chat creation RPC is pending; the fork keeps its captured selection.
  await page.evaluate(
    `store.set('a',{providerID:'provider-a',model:'later-a',thinkingMode:'default'});releaseCreate();creation`,
  )
  await expect(page.locator('#tab')).toHaveText('side-a')
  const settings = await page.evaluate('api.getSideChatSettings("side-chat:side-a")')
  assert.equal(settings.providerID, 'provider-a')
  assert.equal(settings.model, 'history-a')
  assert.equal(settings.variant, 'high')
  assert.equal(settings.thinkingMode, 'enabled')
  assert.equal(settings.permissionMode, 'default')
  assert.equal(settings.providerBaseURL, undefined)
  await page.evaluate(`api.sideChatSubmitToSession('side-a','hello')`)
  assert.deepEqual(
    await page.evaluate('records.find(record=>record.method === "createSideChat").input'),
    { sourceThreadId: 'a' },
  )
  assert.deepEqual(await page.evaluate('records.find(record=>record.method === "send").model'), {
    providerID: 'provider-a',
    model: 'history-a',
    variant: 'high',
    providerBaseURL: 'https://provider-a.example',
  })
  assert.equal(await page.evaluate('window.lastError'), undefined)
  assert.deepEqual(errors, [])
  console.log(
    'Side-chat creation waits for source history and freezes its model/variant across source and model changes; passed.',
  )
} finally {
  await browser.close()
}
