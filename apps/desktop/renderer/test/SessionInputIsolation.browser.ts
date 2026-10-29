// Run: bun apps/desktop/renderer/test/SessionInputIsolation.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))

const harness = `
import React, { StrictMode, useState, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import { createSessionDisplayStore, useSessionDisplayField } from ${source('features/session/state/SessionDisplayStore.ts')};
import { SessionBoundComposer } from ${source('features/session/composer/SessionBoundComposer.tsx')};
import { QuickChatContext, useQuickChatContext } from ${source('features/session/QuickChatContext.ts')};
import { WorkingNewSessionView } from ${source('features/session/WorkingNewSessionView.tsx')};
import { ChatNewSessionView } from ${source('features/session/ChatNewSessionView.tsx')};
import { EditCommandProvider } from ${source('components/ui/EditCommandProvider.tsx')};
import { AppContextMenu } from ${source('components/ui/AppContextMenu.tsx')};

const counts = {
  layout: 0,
  sidebar: 0,
  contextMenu: 0,
  composerRenders: 0,
  workingView: 0,
};

const store = createSessionDisplayStore();
const inputBinding = {
  store,
  replace: (val) => store.setInput(val),
};

const fixture = window.fixture = {
  counts,
  store,
  inputBinding,
  setRoute: null,
  appendComposerText: null,
};

function SidebarWatcher() {
  counts.sidebar++;
  return <aside id="sidebar-watcher">sidebar</aside>;
}

function ContextMenuWatcher() {
  counts.contextMenu++;
  return (
    <AppContextMenu
      trigger={<button id="context-trigger">menu trigger</button>}
      actions={[{ kind: 'item', label: 'Action 1', onSelect: () => {} }]}
      layout="flex"
    />
  );
}

function SessionConversationView() {
  const { composerProps } = useQuickChatContext();
  return (
    <div id="session-conversation-view">
      {composerProps ? <SessionBoundComposer {...composerProps} /> : null}
    </div>
  );
}

function DesktopLayoutMock() {
  const [route, setRoute] = useState('home');
  fixture.setRoute = (r) => flushSync(() => setRoute(r));
  counts.layout++;

  const handleAppendComposerText = useCallback((text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const current = inputBinding.store.getState().input;
    const separator = current.trim() ? '\\n\\n' : '';
    inputBinding.replace(\`\${current}\${separator}\${trimmed}\`);
  }, []);
  fixture.appendComposerText = handleAppendComposerText;

  const composerProps = useMemo(() => ({
    inputBinding,
    placement: route === 'home' ? 'new-session' : 'thread',
    draftKey: route === 'home' ? 'home' : 'session:session-1',
    routedSessionId: route === 'home' ? null : 'session-1',
    sessionStatus: 'idle',
    permissionMode: 'default',
    planModeActive: false,
    enableAutoReviewPermissionMode: false,
    enableFullAccessPermissionMode: false,
    modelConfigured: true,
    selectedModelPreset: 'default',
    messages: [],
    attachments: [],
    onInputChange: inputBinding.replace,
  }), [route]);

  const quickChatValue = useMemo(() => ({
    composerProps,
    composerDraft: {
      store: inputBinding.store,
      replace: inputBinding.replace,
    },
    onAppendComposerText: handleAppendComposerText,
    isConversationRoute: route === 'session',
    isConversationLoading: false,
    activeSessionId: route === 'session' ? 'session-1' : null,
    workspaceName: 'test-workspace',
    workspacePath: '/test/path',
    branchName: 'main',
    gitStatus: null,
    recentTasks: [],
    recentWorkspaces: [],
    providerModelOptions: [],
    browserTabs: [],
  }), [composerProps, handleAppendComposerText, route]);

  return (
    <QuickChatContext.Provider value={quickChatValue}>
      <div id="desktop-layout">
        <SidebarWatcher />
        <ContextMenuWatcher />
        <main id="main-content">
          {route === 'home' && <ChatNewSessionView />}
          {route === 'session' && <SessionConversationView />}
          {route === 'working' && <WorkingNewSessionView />}
        </main>
      </div>
    </QuickChatContext.Provider>
  );
}

let root;
fixture.mount = () => {
  root = createRoot(document.getElementById('root'));
  flushSync(() => {
    root.render(
      <StrictMode>
        <MemoryRouter>
          <EditCommandProvider>
            <DesktopLayoutMock />
          </EditCommandProvider>
        </MemoryRouter>
      </StrictMode>
    );
  });
};
fixture.unmount = () => flushSync(() => root.unmount());
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['session-input-isolation-harness'],
    target: 'browser',
    format: 'iife',
    define: {
      'process.env.NODE_ENV': '"development"',
      'import.meta.env': '{"DEV":true}',
      'import.meta.hot': 'undefined',
    },
    plugins: [
      {
        name: 'session-input-isolation-harness',
        setup(builder) {
          builder.onResolve(
            { filter: /^react(?:-dom)?(?:\/.*)?$|^react-router-dom$|^zustand(?:\/.*)?$/ },
            (args) => ({
              path: Bun.resolveSync(args.path, rendererRoot),
              namespace: 'file',
            }),
          )
          builder.onResolve({ filter: /^session-input-isolation-harness$/ }, () => ({
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
                listRuntimeSkills: async () => ({ state: 'ready', data: [] }),
                onRuntimeSkillsUpdated: () => () => {},
                onPluginsUpdated: () => () => {},
                getTaskSuggestions: async () => ({ suggestions: [], recentTasks: [] }),
              };
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
  await page.goto('http://127.0.0.1/session-input-test')
  await page.addScriptTag({ content: script })
  await page.evaluate(() => (window as any).fixture.mount())
  await settle(page)

  // 1. Home Route Verification
  const initialLayoutRenders = await page.evaluate(() => (window as any).fixture.counts.layout)
  const initialSidebarRenders = await page.evaluate(() => (window as any).fixture.counts.sidebar)
  const initialContextMenuRenders = await page.evaluate(
    () => (window as any).fixture.counts.contextMenu,
  )

  assert.ok(initialLayoutRenders > 0)
  assert.ok(initialSidebarRenders > 0)
  assert.ok(initialContextMenuRenders > 0)

  // Type continuous input on home
  for (const text of ['h', 'he', 'hel', 'hell', 'hello home']) {
    await page.evaluate((val) => (window as any).fixture.inputBinding.replace(val), text)
  }
  await settle(page)

  const layoutRendersAfterHomeType = await page.evaluate(
    () => (window as any).fixture.counts.layout,
  )
  const sidebarRendersAfterHomeType = await page.evaluate(
    () => (window as any).fixture.counts.sidebar,
  )
  const contextMenuRendersAfterHomeType = await page.evaluate(
    () => (window as any).fixture.counts.contextMenu,
  )

  assert.equal(
    layoutRendersAfterHomeType,
    initialLayoutRenders,
    'Typing must not re-render DesktopLayout on Home route',
  )
  assert.equal(
    sidebarRendersAfterHomeType,
    initialSidebarRenders,
    'Typing must not re-render Sidebar on Home route',
  )
  assert.equal(
    contextMenuRendersAfterHomeType,
    initialContextMenuRenders,
    'Typing must not re-render unrelated AppContextMenu on Home route',
  )

  // Append text via onAppendComposerText (tests reading from store.getState().input)
  await page.evaluate(() => (window as any).fixture.appendComposerText('appended text'))
  await settle(page)
  const currentHomeText = await page.evaluate(
    () => (window as any).fixture.store.getState().input,
  )
  assert.equal(currentHomeText, 'hello home\n\nappended text')

  assert.equal(
    await page.evaluate(() => (window as any).fixture.counts.layout),
    initialLayoutRenders,
    'Appending text must not re-render DesktopLayout',
  )

  // 2. Existing Session Route Verification
  await page.evaluate(() => (window as any).fixture.setRoute('session'))
  await settle(page)

  const sessionRouteLayoutRenders = await page.evaluate(
    () => (window as any).fixture.counts.layout,
  )
  const sessionRouteSidebarRenders = await page.evaluate(
    () => (window as any).fixture.counts.sidebar,
  )
  const sessionRouteContextMenuRenders = await page.evaluate(
    () => (window as any).fixture.counts.contextMenu,
  )

  // Type continuous input in existing session
  for (const text of ['s', 'se', 'sess', 'session input']) {
    await page.evaluate((val) => (window as any).fixture.inputBinding.replace(val), text)
  }
  await settle(page)

  assert.equal(
    await page.evaluate(() => (window as any).fixture.counts.layout),
    sessionRouteLayoutRenders,
    'Typing must not re-render DesktopLayout in existing session',
  )
  assert.equal(
    await page.evaluate(() => (window as any).fixture.counts.sidebar),
    sessionRouteSidebarRenders,
    'Typing must not re-render Sidebar in existing session',
  )
  assert.equal(
    await page.evaluate(() => (window as any).fixture.counts.contextMenu),
    sessionRouteContextMenuRenders,
    'Typing must not re-render AppContextMenu in existing session',
  )

  // 3. Working Home Route Verification
  await page.evaluate(() => (window as any).fixture.setRoute('working'))
  await settle(page)

  const workingRouteLayoutRenders = await page.evaluate(
    () => (window as any).fixture.counts.layout,
  )
  const workingRouteSidebarRenders = await page.evaluate(
    () => (window as any).fixture.counts.sidebar,
  )
  const workingRouteContextMenuRenders = await page.evaluate(
    () => (window as any).fixture.counts.contextMenu,
  )

  // Type in Working home
  for (const text of ['w', 'wo', 'work', 'working plan']) {
    await page.evaluate((val) => (window as any).fixture.inputBinding.replace(val), text)
  }
  await settle(page)

  assert.equal(
    await page.evaluate(() => (window as any).fixture.counts.layout),
    workingRouteLayoutRenders,
    'Typing must not re-render DesktopLayout on Working route',
  )
  assert.equal(
    await page.evaluate(() => (window as any).fixture.counts.sidebar),
    workingRouteSidebarRenders,
    'Typing must not re-render Sidebar on Working route',
  )
  assert.equal(
    await page.evaluate(() => (window as any).fixture.counts.contextMenu),
    workingRouteContextMenuRenders,
    'Typing must not re-render AppContextMenu on Working route',
  )

  await page.evaluate(() => (window as any).fixture.unmount())
  console.log('SessionInputIsolation regression passed')
} finally {
  await browser.close()
}
