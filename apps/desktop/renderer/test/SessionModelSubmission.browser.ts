// Run: bun apps/desktop/renderer/test/SessionModelSubmission.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientMock = `
const permissionConfig = { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' };
const workspace = { id: 'project', name: 'Test', path: '/test' };
function snapshot(id, full = false) {
  return { item: { id, sessionName: id, workspaceName: 'Test', workspacePath: '/test', standalone: false,
    permissionMode: 'default', planModeActive: false, localRouterMode: 'off', model: null, thinkingMode: 'default',
    hasSystemPrompt: false, hasAppendSystemPrompt: false, additionalDirectoryCount: 0, status: 'idle',
    createdAt: '2026-01-01', lastMessageAt: '2026-01-01' }, workspace,
    settings: { permissionConfig, additionalDirectories: [], thinkingMode: id === 'a' ? 'enabled' : 'adaptive',
      ...(full ? { providerID: 'provider-' + id, model: 'history-' + id, variant: id === 'a' ? 'high' : 'adaptive' } : {}) },
    view: { messages: [], toolLog: [], pendingPermissions: [], contextUsage: null }, updatedAt: '2026-01-01' };
}
let deferredB;
let sessionListener;
window.records = [];
window.deferB = () => { window.releaseB = undefined; deferredB = new Promise(resolve => { window.releaseB = resolve }); };
window.failB = false;
export const desktopClient = {
  listSessions: async () => ['a', 'b'].map(id => snapshot(id)),
  getSessionCatalogStatus: async () => ({ state: 'ready', error: null }),
  onWorkflowEvent: () => () => {},
  onSessionStoreChange: listener => { sessionListener = listener; return () => { sessionListener = undefined }; },
  markSessionRead: async () => {}, setActiveSession: async () => {},
  getSession: async id => { if (id === 'b') { if (deferredB) { const gate = deferredB; deferredB = null; await gate; } if (window.failB) throw Error('B history failed'); } return snapshot(id, true); },
  getModelProviderState: async () => ({ selectedProviderID: 'global', model: 'global-model', modelConfigured: true, variant: 'high' }),
  createSession: async options => {
    window.createdOptions = options;
    window.releaseCreate = undefined;
    await new Promise(resolve => { window.releaseCreate = resolve });
    const id = window.creationId ?? 'created';
    if (window.emitCreationEvent !== false) {
      const created = snapshot(id, true);
      created.item.sessionName = 'Canonical created title';
      created.item.status = 'running';
      sessionListener?.({sessions: [snapshot('a'), snapshot('b'), created]});
    }
    return { sessionId: id, workspace, standalone: false };
  },
  sendUserMessage: async (id, input, model, inputId) => { window.records.push({ id, input, model, inputId, delivery: 'start' }); },
  submitSessionFollowUp: async (id, input, delivery, inputId, model) => { window.records.push({ id, input, model, inputId, delivery }); return delivery === 'steer' ? 'steered' : 'queued'; },
  saveModelProvider: async () => { throw Error('Default model must not be changed'); },
  listModelProviders: async () => ['home-provider', 'other-home'].map(providerID => ({
    providerID, apiKeyConfigured: true, defaultModels: ['home-draft', 'later-home'] })),
  fetchProviderModels: async () => ({ models: ['home-draft', 'later-home'], modelMetadata: {
    'home-draft': {variants: ['home-variant']}, 'later-home': {variants: ['adaptive']} } }),
  getRecentNewThreadModel: async () => null,
  saveRecentNewThreadModel: async () => {},
  resolveFirstAvailableModel: async () => ({ providerID: 'home-provider', id: 'home-draft' }),
};
`
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useSessionState } from ${JSON.stringify(resolve(rendererRoot, 'src/features/session/state/UseSessionState.ts').split(String.fromCharCode(92)).join('/'))};
import { sessionModelSelections } from ${JSON.stringify(resolve(rendererRoot, 'src/features/session/state/SessionModelSelectionStore.ts').split(String.fromCharCode(92)).join('/'))};
window.store = sessionModelSelections;
function Harness() {
  const state = useSessionState({
    permissionMode: 'default', permissionConfig: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' },
    planModeActive: false, localRouterMode: 'off', providerID: 'WRONG-GLOBAL', providerBaseURL: 'https://wrong.example', model: 'WRONG-MODEL',
    thinkingMode: 'disabled', sessionName: '', systemPrompt: '', appendSystemPrompt: '', additionalDirectories: '',
    installPidexDependencies: false, enableMemory: false, rustSearchAndDiffKernels: false,
    onError: message => { document.body.dataset.error = message }, onDiffForActive() {}, onRefreshActiveWorkspace() {}, onOpenDrawerPermissions() {},
  });
  window.api = state;
  return <>
    <output id="ready">{String(state.sessionsHydrated)}</output>
    <output id="session">{state.sessionId ?? 'home'}</output>
    <output id="selection">{JSON.stringify(state.modelSelection)}</output>
    <output id="loading">{String(state.modelSelectionLoading)}</output>
    <output id="error">{state.modelSelectionError ?? ''}</output>
    <ul id="sessions">{state.sessions.map(session => <li key={session.id} data-id={session.id}
      data-status={session.status}>{session.sessionName}</li>)}</ul>
    <button onClick={() => state.activateSessionById('a')}>A</button>
    <button onClick={() => state.activateSessionById('b')}>B</button>
    <button onClick={state.reloadModelSelection}>Retry</button>
  </>;
}
createRoot(document.getElementById('root')).render(<Harness />);
`
async function buildHarness() {
  const build = await Bun.build({
    entrypoints: ['submission-harness'],
    target: 'browser',
    format: 'esm',
    tsconfig: resolve(rendererRoot, 'tsconfig.app.json'),
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{"DEV":true}', 'import.meta.hot': 'undefined' },
    plugins: [
      {
        name: 'submission-harness',
        setup(builder) {
          builder.onResolve({ filter: /^@pidex/ }, (args) =>
            args.path.startsWith('@pidex/core/')
              ? {
                  path: resolve(
                    rendererRoot,
                    'src/shims/core',
                    args.path.slice('@pidex/core/'.length).replace(/[.]js$/, '.ts'),
                  ).replaceAll('\\', '/'),
                  namespace: 'file',
                }
              : {path: Bun.resolveSync(args.path, args.resolveDir || rendererRoot).replaceAll('\\', '/'), namespace: 'file'},
          )
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot).replaceAll('\\', '/'),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^react-dom\/client$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot).replaceAll('\\', '/'),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^submission-harness$/ }, () => ({
            path: 'harness',
            namespace: 'submission',
          }))
          builder.onLoad({ filter: /^harness$/, namespace: 'submission' }, () => ({
            contents: harness,
            loader: 'jsx',
            resolveDir: rendererRoot,
          }))
          builder.onResolve({ filter: /desktop-client\/index\.js$/ }, () => ({
            path: 'client',
            namespace: 'submission',
          }))
          builder.onLoad({ filter: /^client$/, namespace: 'submission' }, () => ({
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
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('http://session-test.local/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }),
  )
  await page.goto('http://session-test.local/')
  await page.addScriptTag({ content: script, type: 'module' })
  await expect(page.locator('#ready')).toHaveText('true')
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await expect(page.locator('#selection')).toContainText('history-a')
  await page.evaluate(
    `api.setModelSelection({providerID:'provider-a',model:'draft-a',thinkingMode:'enabled',variant:'high'}); deferB()`,
  )
  await page.getByRole('button', { name: 'B', exact: true }).click()
  await expect(page.locator('#loading')).toHaveText('true')
  await expect(page.locator('#selection')).toHaveText('null')
  // The active B history is unresolved, but an explicit target A must still send A.
  await page.evaluate(`api.submitToSession('a', {text:'normal'})`)
  await page.evaluate(
    `api.submitToSession('a', {text:'queue'}, {delivery:'follow-up',inputId:'queued-input'})`,
  )
  await page.evaluate(`api.submitToSession('a', {text:'edited'}, {inputId:'edited-input'})`)
  let records = await page.evaluate('records')
  assert.equal(records.length, 3)
  for (const record of records) {
    assert.equal(record.id, 'a')
    assert.deepEqual(record.model, {
      providerID: 'provider-a',
      model: 'draft-a',
      variant: 'high',
      providerBaseURL: undefined,
      localRouterMode: undefined,
    })
  }
  assert.equal(records[1].delivery, 'follow-up')
  assert.equal(records[1].inputId, 'queued-input')
  assert.equal(records[2].inputId, 'edited-input')
  await page.evaluate(`window.pendingB = api.submitToSession('b', {text:'wait for B'}); void 0`)
  assert.equal((await page.evaluate('records')).length, 3)
  await page.evaluate('releaseB()')
  await expect(page.locator('#selection')).toContainText('history-b')
  await page.evaluate('pendingB')
  records = await page.evaluate('records')
  assert.deepEqual(records[3].model, {
    providerID: 'provider-b',
    model: 'history-b',
    variant: 'adaptive',
    providerBaseURL: undefined,
    localRouterMode: undefined,
  })
  // Capture at submission time, even when a menu mutation happens in the same tick.
  await page.evaluate(
    `window.captured = api.submitToSession('a', {text:'captured'}); store.set('a',{providerID:'new-provider',model:'new-a',thinkingMode:'default'}); captured`,
  )
  assert.equal((await page.evaluate('records'))[4].model.model, 'draft-a')
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await expect(page.locator('#selection')).toContainText('new-a')
  await page.getByRole('button', { name: 'B', exact: true }).click()
  await expect(page.locator('#selection')).toContainText('history-b')
  await page.evaluate(`store.delete('b'); failB = true; api.reloadModelSelection()`)
  await expect(page.locator('#error')).toHaveText('B history failed')
  await expect(page.locator('#selection')).toHaveText('null')
  const count = (await page.evaluate('records')).length
  assert.equal(await page.evaluate(`api.submitToSession('b',{text:'blocked'})`), null)
  assert.equal((await page.evaluate('records')).length, count)
  await page.evaluate('failB = false')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('#selection')).toContainText('history-b')
  // Creation binds the captured home draft even if the user changes it and navigates away.
  await page.evaluate(`api.activateSessionById(null)`)
  await expect(page.locator('#session')).toHaveText('home')
  await page.evaluate(
    `store.set(null,{providerID:'home-provider',model:'home-draft',thinkingMode:'enabled',variant:'home-variant'}); window.creation = api.createSessionForWorkspace({projectId:'project',name:'Test',path:'/test'}); void 0`,
  )
  await page.waitForFunction('typeof releaseCreate === "function"')
  await page.evaluate(
    `store.set(null,{providerID:'other-home',model:'later-home',thinkingMode:'adaptive',variant:'adaptive'}); api.activateSessionById('b')`,
  )
  await expect(page.locator('#session')).toHaveText('b')
  await page.evaluate('releaseCreate()')
  assert.equal(await page.evaluate('creation'), 'created')
  await expect(page.locator('#session')).toHaveText('created')
  await expect(page.locator('#sessions li[data-id="created"]')).toHaveCount(1)
  await expect(page.locator('#sessions li[data-id="created"]')).toHaveText('Canonical created title')
  await expect(page.locator('#sessions li[data-id="created"]')).toHaveAttribute('data-status', 'running')
  assert.deepEqual(await page.evaluate('store.getSnapshot("created").selection'), {
    providerID: 'home-provider',
    model: 'home-draft',
    thinkingMode: 'enabled',
    variant: 'home-variant',
  })
  assert.equal(await page.evaluate('store.getSnapshot(null).selection.model'), 'later-home')
  assert.equal(await page.evaluate('createdOptions.model'), 'home-draft')
  await page.evaluate(`api.submitToSession('created',{text:'first message'})`)
  const createdSend = (await page.evaluate('records')).at(-1)
  assert.equal(createdSend.id, 'created')
  assert.deepEqual(createdSend.model, {
    providerID: 'home-provider',
    model: 'home-draft',
    variant: 'home-variant',
    providerBaseURL: undefined,
    localRouterMode: undefined,
  })
  await page.evaluate(`window.emitCreationEvent = false; window.creationId = 'created-without-event'; window.releaseCreate = undefined; window.creation = api.createSessionForWorkspace({projectId:'project',name:'Test',path:'/test'}); void 0`)
  await page.waitForFunction('typeof releaseCreate === "function"')
  await page.evaluate('releaseCreate()')
  assert.equal(await page.evaluate('creation'), 'created-without-event')
  await expect(page.locator('#sessions li[data-id="created-without-event"]')).toHaveCount(1)
  await expect(page.locator('#sessions li')).toHaveCount(4)
  assert.deepEqual(errors, [])
  console.log(
    'Target-session model binding and creation event/list reconciliation passed.',
  )
} finally {
  await browser.close()
}
