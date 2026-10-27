// Run: bun apps/desktop/renderer/test/ComposerDraftSubscription.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))
const harness = `
import React, {StrictMode, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {MemoryRouter} from 'react-router-dom';
import {useDesktopComposerController} from ${source('features/session/composer/UseDesktopComposerController.ts')};
import {composerDraftStore as store} from ${source('features/session/composer/ComposerDraftStore.ts')};
const noop = () => {};
const fixture = window.fixture = {store, renders: {}, writes: 0, sends: 0, controllers: {}, setters: {}};
store.subscribe(() => fixture.writes++);
function Composer({id, initialKey, placement}) {
  const [draftKey, setKey] = useState(initialKey);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [planModeActive, setPlan] = useState(false);
  const [revision, setRevision] = useState(0);
  fixture.renders[id] = (fixture.renders[id] ?? 0) + 1;
  if (fixture.renders[id] > 80) throw new Error('Composer subscription failed to settle: ' + id);
  const controller = useDesktopComposerController({
    input, messages: [], placement, draftKey,
    routedSessionId: placement === 'new-session' ? null : draftKey.split(':').slice(1).join(':'),
    permissionMode: 'default', enableAutoReviewPermissionMode: false,
    enableFullAccessPermissionMode: false, planModeActive, sessionBusy: false,
    modelConfigured: true, workspace: null,
    // Parent projections can return fresh arrays with equal attachment values.
    attachments: attachments.map(item => ({...item})), subagentMode: false,
    onAttachmentsChange: setAttachments, createSessionForWorkspace: async () => 'created',
    submitToSession: async () => {fixture.sends++; return 'sent';},
  });
  fixture.controllers[id] = controller;
  fixture.setters[id] = {setKey, setInput, setAttachments, setPlan,
    rerender: () => setRevision(n => n + 1)};
  return <output id={id} data-revision={revision}>{JSON.stringify({
    text: controller.composerDocument.text,
    tokens: controller.composerDocument.tokens,
    goal: controller.goalModeEnabled,
    outcome: controller.lastSubmitOutcome,
  })}</output>;
}
const root = createRoot(document.getElementById('root'));
fixture.mount = () => flushSync(() => root.render(<StrictMode><MemoryRouter>
  <Composer id="home" initialKey="home" placement="new-session"/>
  <Composer id="session" initialKey="session:a" placement="thread"/>
  <Composer id="side" initialKey="side-chat:a" placement="side-task"/>
</MemoryRouter></StrictMode>));
fixture.change = (id, action, value) => flushSync(() => fixture.setters[id][action](value));
fixture.unmount = () => flushSync(() => root.unmount());
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['composer-subscription-harness'],
    target: 'browser',
    format: 'iife',
    define: {
      'process.env.NODE_ENV': '"development"',
      'import.meta.env': '{"DEV":true}',
      'import.meta.hot': 'undefined',
    },
    plugins: [
      {
        name: 'composer-subscription-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$|^react-router-dom$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^composer-subscription-harness$/ }, () => ({
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
          isComposerFileAttachmentAvailable: async () => true,
          listRuntimeSkills: async () => ({state: 'ready', data: []}),
          onRuntimeSkillsUpdated: () => () => {}, onPluginsUpdated: () => () => {},
        };`,
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
async function counters(page: Page) {
  return page.evaluate(() => {
    const fixture = (window as any).fixture
    return { renders: { ...fixture.renders }, writes: fixture.writes }
  })
}
async function settle(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}
try {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('http://127.0.0.1/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div id="root"></div>',
    }),
  )
  await page.goto('http://127.0.0.1/composer-test')
  await page.addScriptTag({ content: script })
  await page.evaluate(() => (window as any).fixture.mount())
  await settle(page)
  assert.deepEqual(errors, [], 'Composer must mount with its actual Store and effects')
  const idle = await counters(page)
  await settle(page)
  assert.deepEqual(await counters(page), idle, 'idle Composer must stop rendering and writing')
  assert.equal(idle.writes, 0, 'mounting empty drafts must not publish unchanged content')

  await page.evaluate(() => (window as any).fixture.change('home', 'setInput', 'home draft'))
  await settle(page)
  const edited = await counters(page)
  assert.equal(edited.renders.session, idle.renders.session)
  assert.equal(edited.renders.side, idle.renders.side)
  await page.evaluate(() => (window as any).fixture.change('home', 'rerender'))
  await settle(page)
  assert.equal(
    (await counters(page)).writes,
    edited.writes,
    'equal parent values must not publish again',
  )

  await page.evaluate(() => {
    const f = (window as any).fixture
    f.change('home', 'setAttachments', [
      {
        id: 'file',
        name: 'note.txt',
        path: '/fixture/note.txt',
        mediaType: 'text/plain',
        sizeBytes: 4,
        kind: 'text',
        status: 'ready',
        textContent: 'text',
      },
    ])
  })
  await settle(page)
  const attachmentWrites = (await counters(page)).writes
  await page.evaluate(() => (window as any).fixture.change('home', 'rerender'))
  await settle(page)
  assert.equal((await counters(page)).writes, attachmentWrites)
  await page.evaluate(() => {
    const f = (window as any).fixture
    f.change(
      'home',
      'setAttachments',
      f.store.get('home').attachments.map((item) => ({
        ...item,
        status: 'error',
        error: 'test attachment unavailable',
      })),
    )
  })
  await settle(page)
  assert.equal(
    await page.evaluate(() => (window as any).fixture.store.get('home').attachments[0].status),
    'error',
  )

  await page.evaluate(() => {
    const f = (window as any).fixture
    f.store.setSkillInvocation('session:a', { name: 'review', path: '/fixture/review' })
  })
  await settle(page)
  assert.ok((await page.locator('#session').textContent())?.includes('/fixture/review'))
  assert.ok(!(await page.locator('#side').textContent())?.includes('/fixture/review'))
  await page.evaluate(() => {
    const f = (window as any).fixture
    f.controllers.side.handleComposerDocumentChange({
      text: '',
      tokens: [
        {
          id: 'context',
          kind: 'thread',
          label: 'Context',
          value: 'pidex://threads/context',
          from: 0,
          to: 0,
        },
      ],
    })
  })
  await settle(page)
  assert.ok((await page.locator('#side').textContent())?.includes('pidex://threads/context'))
  await page.evaluate(() =>
    (window as any).fixture.controllers.side.handleComposerDocumentChange({ text: '', tokens: [] }),
  )
  await settle(page)
  assert.ok(!(await page.locator('#side').textContent())?.includes('pidex://threads/context'))
  await page.evaluate(() => (window as any).fixture.controllers.home.setGoalModeEnabled(true))
  await page.evaluate(() => (window as any).fixture.change('home', 'setPlan', true))
  await settle(page)
  assert.deepEqual(
    await page.evaluate(() => {
      const draft = (window as any).fixture.store.get('home')
      return { goal: draft.goalModeEnabled, mode: draft.collaborationMode }
    }),
    { goal: true, mode: 'plan' },
  )
  await page.evaluate(() => (window as any).fixture.change('session', 'setKey', 'session:b'))
  await settle(page)
  assert.ok(!(await page.locator('#session').textContent())?.includes('/fixture/review'))
  await page.evaluate(() => (window as any).fixture.change('session', 'setKey', 'session:a'))
  await settle(page)
  assert.ok((await page.locator('#session').textContent())?.includes('/fixture/review'))
  await page.evaluate(() => (window as any).fixture.controllers.session.handleSkillDeselect())
  await settle(page)
  assert.ok(!(await page.locator('#session').textContent())?.includes('/fixture/review'))
  const beforeOutcome = await counters(page)
  await page.evaluate(() =>
    (window as any).fixture.store.setSubmitOutcome('session:a', {
      status: 'failed',
      phase: 'prepare',
      message: 'asynchronous attachment failure',
    }),
  )
  await settle(page)
  assert.equal(
    await page.evaluate(
      () => (window as any).fixture.controllers.session.lastSubmitOutcome?.message,
    ),
    'asynchronous attachment failure',
  )
  const afterOutcome = await counters(page)
  assert.ok(afterOutcome.renders.session > beforeOutcome.renders.session)
  assert.equal(afterOutcome.renders.home, beforeOutcome.renders.home)
  assert.equal(afterOutcome.renders.side, beforeOutcome.renders.side)
  await page.evaluate(() => (window as any).fixture.store.clearSubmitOutcome('session:a'))
  await settle(page)
  assert.equal(
    await page.evaluate(() => (window as any).fixture.controllers.session.lastSubmitOutcome),
    null,
  )
  const final = await counters(page)
  await settle(page)
  assert.deepEqual(await counters(page), final, 'edits and draft switches must settle')
  assert.equal(await page.evaluate(() => (window as any).fixture.sends), 0)
  assert.deepEqual(errors, [])
  await page.evaluate(() => (window as any).fixture.unmount())
  console.log('Composer mounted regression passed:', JSON.stringify({ idle, edited, final }))
} finally {
  await browser.close()
}
