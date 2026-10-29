// Run: bun apps/desktop/renderer/test/EditCommandIsolation.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))

const harness = `
import React, { StrictMode, useRef, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  EditCommandProvider,
  useEditCommandActions,
  useEditCommands,
} from ${source('components/ui/EditCommandProvider.tsx')};

const counts = { actionsConsumer: 0, stateConsumer: 0 };
const fixture = window.fixture = {
  counts,
  executedActions: [],
  lastCapabilities: null,
  actions: null,
};

function ActionsConsumer() {
  const actions = useEditCommandActions();
  fixture.actions = actions;
  counts.actionsConsumer++;
  return <div id="actions-consumer">actions</div>;
}

function StateConsumer() {
  const { activeCapabilities } = useEditCommands();
  fixture.lastCapabilities = activeCapabilities;
  counts.stateConsumer++;
  return <div id="state-consumer">{JSON.stringify(activeCapabilities)}</div>;
}

function EditorTargetA() {
  const { registerTarget } = useEditCommandActions();
  const ref = useRef(null);
  const [val, setVal] = useState('initial text');
  useEffect(() => {
    if (!ref.current) return;
    return registerTarget(ref.current, {
      getCapabilities: () => ({
        undo: true, redo: false, cut: true, copy: true, paste: true, delete: true, selectAll: true,
      }),
      focus: () => ref.current?.focus(),
      perform: (action) => {
        fixture.executedActions.push({ target: 'A', action });
        return true;
      },
    });
  }, [registerTarget]);
  return <textarea id="editorA" ref={ref} value={val} onChange={e => setVal(e.target.value)} />;
}

function EditorTargetB() {
  const { registerTarget } = useEditCommandActions();
  const ref = useRef(null);
  const [val, setVal] = useState('second text');
  useEffect(() => {
    if (!ref.current) return;
    return registerTarget(ref.current, {
      getCapabilities: () => ({
        undo: false, redo: true, cut: false, copy: true, paste: false, delete: false, selectAll: true,
      }),
      focus: () => ref.current?.focus(),
      perform: (action) => {
        fixture.executedActions.push({ target: 'B', action });
        return true;
      },
    });
  }, [registerTarget]);
  return <textarea id="editorB" ref={ref} value={val} onChange={e => setVal(e.target.value)} />;
}

let root;
fixture.mount = () => {
  root = createRoot(document.getElementById('root'));
  flushSync(() => {
    root.render(
      <StrictMode>
        <EditCommandProvider>
          <ActionsConsumer />
          <StateConsumer />
          <EditorTargetA />
          <EditorTargetB />
        </EditCommandProvider>
      </StrictMode>
    );
  });
};
fixture.unmount = () => flushSync(() => root.unmount());
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['edit-command-isolation-harness'],
    target: 'browser',
    format: 'iife',
    define: {
      'process.env.NODE_ENV': '"development"',
      'import.meta.env': '{"DEV":true}',
      'import.meta.hot': 'undefined',
    },
    plugins: [
      {
        name: 'edit-command-isolation-harness',
        setup(builder) {
          builder.onResolve(
            { filter: /^react(?:-dom)?(?:\/.*)?$|^react-router-dom$|^zustand(?:\/.*)?$/ },
            (args) => ({
              path: Bun.resolveSync(args.path, rendererRoot),
              namespace: 'file',
            }),
          )
          builder.onResolve({ filter: /^edit-command-isolation-harness$/ }, () => ({
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
            contents: `export const desktopClient = {};`,
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
async function settle(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}
try {
  const page = await browser.newPage()
  await page.route('http://127.0.0.1/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div id="root"></div>',
    }),
  )
  await page.goto('http://127.0.0.1/edit-command-test')
  await page.addScriptTag({ content: script })
  await page.evaluate(() => (window as any).fixture.mount())
  await settle(page)

  const initialActionsRenders = await page.evaluate(
    () => (window as any).fixture.counts.actionsConsumer,
  )
  assert.ok(initialActionsRenders > 0)

  // Focus editor A
  await page.focus('#editorA')
  await settle(page)
  const stateRendersAfterFocusA = await page.evaluate(
    () => (window as any).fixture.counts.stateConsumer,
  )
  const capsA = await page.evaluate(() => (window as any).fixture.lastCapabilities)
  assert.equal(capsA.undo, true)
  assert.equal(capsA.redo, false)

  // Typing / selection changes without capability change must NOT re-render ActionsConsumer or StateConsumer
  await page.evaluate(() => {
    document.dispatchEvent(new Event('selectionchange'))
    document.dispatchEvent(new Event('input', { bubbles: true }))
    document.dispatchEvent(new Event('input', { bubbles: true }))
    document.dispatchEvent(new Event('selectionchange'))
  })
  await settle(page)

  const actionsRendersAfterInput = await page.evaluate(
    () => (window as any).fixture.counts.actionsConsumer,
  )
  const stateRendersAfterInput = await page.evaluate(
    () => (window as any).fixture.counts.stateConsumer,
  )

  assert.equal(
    actionsRendersAfterInput,
    initialActionsRenders,
    'ActionsConsumer must not re-render when input or selectionchange occurs',
  )
  assert.equal(
    stateRendersAfterInput,
    stateRendersAfterFocusA,
    'StateConsumer must not re-render when capabilities boolean values do not change',
  )

  // Switch to editor B: capabilities differ (undo=false, redo=true)
  await page.focus('#editorB')
  await settle(page)
  const capsB = await page.evaluate(() => (window as any).fixture.lastCapabilities)
  assert.equal(capsB.undo, false)
  assert.equal(capsB.redo, true)

  const actionsRendersAfterSwitch = await page.evaluate(
    () => (window as any).fixture.counts.actionsConsumer,
  )
  assert.equal(
    actionsRendersAfterSwitch,
    initialActionsRenders,
    'ActionsConsumer must remain stable even when active edit target switches',
  )

  // Executing command acts on the active target (Editor B)
  await page.evaluate(() => (window as any).fixture.actions.perform('redo'))
  await settle(page)
  const executed = await page.evaluate(() => (window as any).fixture.executedActions)
  assert.equal(executed.length, 1)
  assert.deepEqual(executed[0], { target: 'B', action: 'redo' })

  // Right-click context menu capturing context targets editor A explicitly and preserves restore semantics
  await page.evaluate(() => {
    const elA = document.getElementById('editorA')
    const ctx = (window as any).fixture.actions.captureContext(elA)
    return (window as any).fixture.actions.perform('cut', ctx)
  })
  await settle(page)

  const executedAfterCapture = await page.evaluate(() => (window as any).fixture.executedActions)
  assert.equal(executedAfterCapture.length, 2)
  assert.deepEqual(executedAfterCapture[1], { target: 'A', action: 'cut' })

  await page.evaluate(() => (window as any).fixture.unmount())
  console.log('EditCommandIsolation regression passed')
} finally {
  await browser.close()
}
