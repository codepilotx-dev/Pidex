// Run: bun apps/desktop/renderer/test/SharedBusinessSubscription.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))
const harness = `
import React, {StrictMode, Profiler} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {MemoryRouter} from 'react-router-dom';
import {useStore} from 'zustand/react';
import {defaultDesktopSettings} from ${source('features/settings/SettingsStorage.ts')};
import {DesktopSettingsProvider, useDesktopSettingsField, useDesktopRuntimeSettingsField, useDesktopSettingsDraftActions, useDesktopSettingsDraftValue} from ${source('features/settings/UseDesktopSettings.ts')};
import {GitBoardProvider, useGitBoard} from ${source('features/git-board/GitBoardContext.tsx')};
import {AutomationControllerProvider, useSharedAutomationController} from ${source('features/automation/AutomationControllerProvider.tsx')};
import {PetCatalogProvider, usePetCatalogController} from ${source('features/pet/PetCatalogProvider.tsx')};
import {SidebarPetsPane} from ${source('features/layout/sidebar/SidebarPetsPane.tsx')};
import {VoiceSettings} from ${source('features/settings/VoiceSettings.tsx')};
import {createGithubAccountCache} from ${source('services/desktop-client/GithubAccountCache.ts')};
import {createDesktopBrowserClient} from ${source('services/desktop-client/BrowserClientService.ts')};
import {createProviderIconStore} from ${source('services/desktop-client/ProviderIconClient.ts')};
import {threadPullRequestStore, useThreadPullRequests} from ${source('features/layout/sidebar/ThreadPullRequestStore.ts')};
window.saveCalls=0;window.savedSettings = {...defaultDesktopSettings(), 'desktop.voice.preferredInputDeviceId':'verify-mic'};
const counts = {};
const tick = key => {counts[key] = (counts[key] ?? 0) + 1;};
const github = createGithubAccountCache({getGithubAuthStatus: async()=>({authenticated:true,user:{id:'verify'}}),getGithubProfileOverview:async()=>({ok:true,overview:{user:{id:'verify'}}}),setGithubUserStatus:async()=>({ok:true})});
const browser = createDesktopBrowserClient({onDesktopBrowserStateChange: listener => {window.browserEvent = listener;}});
const icons = createProviderIconStore({resolveProviderIcon:async()=>({source:null}),onProviderIconChange:listener=>{window.iconEvent=listener;}});
const f = window.fixture = {counts,github,browser,icons,pr:threadPullRequestStore};
function Model(){const model=useDesktopRuntimeSettingsField(s=>s.values.model);tick('model');return <output id="model">{model}</output>;}
function PetSetting(){useDesktopSettingsDraftValue('pet');tick('petSetting');return null;}
function Draft(){const value=useDesktopSettingsDraftValue('gitBranchPrefix');tick('draft');return <output id="draft">{value}</output>;}
function Git(){const view=useGitBoard(s=>s.remoteView);tick('git');return <output id="git">{view}</output>;}
function Query(){const query=useSharedAutomationController(s=>s.query);tick('query');return <output id="query">{query}</output>;}
function Loading(){const loading=useSharedAutomationController(s=>s.loading);tick('loading');return null;}
function Pets(){const pets=usePetCatalogController(s=>s.pets);tick('pets');return <output id="pets">{pets.length}</output>;}
function Busy(){const busy=usePetCatalogController(s=>s.busy);tick('busy');return <output id="busy">{String(busy)}</output>;}
function Auth(){useStore(github.githubAccountStore,s=>s.auth);tick('auth');return null;}
function Overview(){useStore(github.githubAccountStore,s=>s.overview);tick('overview');return null;}
function BrowserA(){const title=useStore(browser.tabsStore,s=>s.tabs.get('a')?.title);tick('browserA');return <output id="browser-a">{title}</output>;}
function IconA(){const icon=useStore(icons.state,s=>s.overrides.get('a'));tick('iconA');return <output id="icon-a">{icon?.source}</output>;}
function PR(){const state=useThreadPullRequests(['a']);tick('pr');return <output id="pr">{state.byThread.get('a')?.length??0}</output>;}
function Controls(){f.settingsLoaded=useDesktopSettingsField(s=>s.settingsLoaded);f.actions=useDesktopSettingsDraftActions();f.setQuery=useSharedAutomationController(s=>s.setQuery);f.openView=useGitBoard(s=>s.openRemoteView);f.refreshPets=usePetCatalogController(s=>s.refreshPets);return null;}
let root;
f.mount=(access="read-write")=>{root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<StrictMode><MemoryRouter initialEntries={['/new']}><DesktopSettingsProvider access={access}><GitBoardProvider><AutomationControllerProvider enabled={false}><PetCatalogProvider><Controls/><Model/><PetSetting/><VoiceSettings/><Profiler id="pet-sidebar" onRender={()=>tick("petSidebar")}><SidebarPetsPane/></Profiler><Draft/><Git/><Query/><Loading/><Pets/><Busy/><Auth/><Overview/><BrowserA/><IconA/><PR/></PetCatalogProvider></AutomationControllerProvider></GitBoardProvider></DesktopSettingsProvider></MemoryRouter></StrictMode>));};
f.unmount=()=>flushSync(()=>root.unmount());
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['shared-business-harness'],
    target: 'browser',
    format: 'iife',
    define: {
      'process.env.NODE_ENV': '"development"',
      'import.meta.env': '{"DEV":true}',
      'import.meta.hot': 'undefined',
    },
    plugins: [
      {
        name: 'shared-business-harness',
        setup(builder) {
          builder.onResolve(
            { filter: /^react(?:-dom)?(?:\/.*)?$|^react-router-dom$|^zustand(?:\/.*)?$/ },
            (args) => ({
              path: Bun.resolveSync(args.path, rendererRoot),
              namespace: 'file',
            }),
          )
          builder.onResolve({ filter: /^shared-business-harness$/ }, () => ({
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
export const CONFIG_UPDATED_EVENT='fixture-config';
export const desktopClient={
 getDesktopSettings:async()=>window.savedSettings,
 saveDesktopSettings:async settings=>{window.saveCalls++;window.savedSettings=settings;return settings;},
 onDesktopSettingsChange:()=>()=>{},
 getSpeechStatus:async()=>({state:"ready"}),
 onSpeechStatusUpdated:()=>()=>{},
 listProjects:async()=>[],
 listPets:()=>new Promise(resolve=>{window.resolvePets=resolve;}),
 listThreadPullRequests:async()=>({threads:[]}),
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
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.setContent('<div id="root"></div>')
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: async () => [
          { deviceId: 'verify-mic', kind: 'audioinput', label: 'Verify Mic' },
        ],
        addEventListener() {},
        removeEventListener() {},
      },
    }),
  )
  await page.addScriptTag({ content: script })
  await page.evaluate(() => (window as any).fixture.mount())
  const settle = () => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
  await page.waitForFunction(() => (window as any).fixture.settingsLoaded)
  await settle()
  const counts = () => page.evaluate(() => ({ ...(window as any).fixture.counts }))
  assert.ok((await page.getByLabel('听写输入设备').textContent())?.includes('Verify Mic'))
  let before = await counts()
  await page.evaluate(() => (window as any).fixture.actions.setValue('gitBranchPrefix', 'verify/'))
  await settle()
  assert.equal(await page.locator('#draft').textContent(), 'verify/')
  assert.equal((await counts()).model, before.model)
  assert.equal((await counts()).petSetting, before.petSetting)
  await page.evaluate(() => (window as any).fixture.actions.saveFields(['gitBranchPrefix']))
  await settle()
  assert.equal(await page.evaluate(() => (window as any).savedSettings.gitBranchPrefix), 'verify/')
  assert.equal((await counts()).model, before.model)
  assert.equal((await counts()).petSetting, before.petSetting)
  before = await counts()
  await page.evaluate(() =>
    (window as any).fixture.actions.setValue('pet', (current) => ({
      ...current,
      size: current.size + 1,
    })),
  )
  await settle()
  assert.equal((await counts()).petSidebar, before.petSidebar)
  before = await counts()
  await page.evaluate(() => (window as any).fixture.setQuery('verify'))
  await settle()
  assert.equal(await page.locator('#query').textContent(), 'verify')
  await page.evaluate(() => {
    const f = (window as any).fixture
    f.setQuery((current) => current + '1')
    f.setQuery((current) => current + '2')
  })
  await settle()
  assert.equal(await page.locator('#query').textContent(), 'verify12')
  const stableQuery = (await counts()).query
  await page.evaluate(() => (window as any).fixture.setQuery('verify12'))
  await settle()
  assert.equal((await counts()).query, stableQuery)
  assert.equal((await counts()).loading, before.loading)
  assert.equal((await counts()).pets, before.pets)
  before = await counts()
  await page.evaluate(() => (window as any).fixture.openView())
  await settle()
  assert.equal(await page.locator('#git').textContent(), 'github')
  assert.equal((await counts()).query, before.query)
  before = await counts()
  await page.evaluate(() => {
    void (window as any).fixture.refreshPets()
  })
  await settle()
  assert.equal(await page.locator('#busy').textContent(), 'true')
  assert.equal((await counts()).pets, before.pets)
  await page.evaluate(() =>
    (window as any).resolvePets([
      {
        id: 'verify',
        displayName: 'Verify',
        spriteVersionNumber: 1,
        spritesheetUrl:
          'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      },
    ]),
  )
  await settle()
  assert.equal(await page.locator('#pets').textContent(), '1')
  await page.evaluate(async () => {
    const f = (window as any).fixture
    await f.github.getGithubAuthStatus()
    await f.github.getGithubProfileOverview()
  })
  await settle()
  before = await counts()
  await page.evaluate(() =>
    (window as any).fixture.github.setGithubUserStatus({ message: 'verify' }),
  )
  await settle()
  assert.equal((await counts()).auth, before.auth)
  assert.ok((await counts()).overview > before.overview)
  const tab = (id: string, title: string, revision: number) => ({
    tabId: id,
    title,
    revision,
    open: true,
    allowedSites: [],
    sitePermissions: [],
  })
  await page.evaluate((t) => (window as any).browserEvent(t), tab('a', 'A', 1))
  await settle()
  before = await counts()
  await page.evaluate((t) => (window as any).browserEvent(t), tab('b', 'B', 1))
  await settle()
  assert.equal((await counts()).browserA, before.browserA)
  await page.evaluate((t) => (window as any).browserEvent(t), tab('a', 'A2', 2))
  await settle()
  assert.equal(await page.locator('#browser-a').textContent(), 'A2')
  before = await counts()
  await page.evaluate(() => (window as any).iconEvent({ providerID: 'b', source: 'b.svg' }))
  await settle()
  assert.equal((await counts()).iconA, before.iconA)
  await page.evaluate(() => (window as any).iconEvent({ providerID: 'a', source: 'a.svg' }))
  await settle()
  assert.equal(await page.locator('#icon-a').textContent(), 'a.svg')
  await page.evaluate(() => {
    const f = (window as any).fixture
    f.pr.setState({ supported: true, byThread: new Map([['a', []]]) })
  })
  await settle()
  before = await counts()
  await page.evaluate(() => {
    const f = (window as any).fixture
    f.pr.setState((s) => ({ byThread: new Map(s.byThread).set('b', []) }))
  })
  await settle()
  assert.equal((await counts()).pr, before.pr)
  await page.evaluate(() => {
    const f = (window as any).fixture
    f.pr.setState((s) => ({ byThread: new Map(s.byThread).set('a', [{}, {}]) }))
  })
  await settle()
  assert.equal(await page.locator('#pr').textContent(), '2')
  const idle = await counts()
  await settle()
  assert.deepEqual(await counts(), idle)
  assert.deepEqual(errors, [])
  await page.evaluate(() => (window as any).fixture.unmount())
  const writes = await page.evaluate(() => (window as any).saveCalls)
  await page.evaluate(() => (window as any).fixture.mount('read-only'))
  await page.waitForFunction(() => (window as any).fixture.settingsLoaded)
  assert.match(
    await page.evaluate(async () => {
      try {
        await (window as any).fixture.actions.saveFields(['gitBranchPrefix'])
        return ''
      } catch (error) {
        return String(error)
      }
    }),
    /不允许保存/,
  )
  assert.equal(await page.evaluate(() => (window as any).saveCalls), writes)
  await page.evaluate(() => (window as any).fixture.unmount())
  assert.deepEqual(errors, [])
  await page.close()
  console.log('Shared business mounted subscriptions passed')
} finally {
  await browser.close()
}
