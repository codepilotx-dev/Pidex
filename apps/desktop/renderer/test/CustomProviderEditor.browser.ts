// Run: bun apps/desktop/renderer/test/CustomProviderEditor.browser.ts
// Layout regression: bun run build:renderer, then run this file with --layout
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))

const clientMock = `
window.__calls = [];
window.__releaseTests = [];
window.__modelPages = [];
export const desktopClient = {
  discoverProviderModels: async input => {window.__discoveries = (window.__discoveries ?? 0) + 1; window.__lastDiscovery = input; return [{id: 'remote-only', name: 'Remote', api: input.api, enabled: false}];},
  syncProviderModels: async providerID => {window.__syncs = (window.__syncs ?? 0) + 1; return {providerId: providerID, api: 'openai-completions', fetchedAt: 1, candidates: [{id: 'remote-only', name: 'Remote', api: 'openai-completions', enabled: false}], removedModelIds: [], baselineCreated: true, totalFetched: 3, catalogVersion: 1};},
  fetchProviderModels: async options => {window.__modelPages.push(options); return {models: ['chat', 'messages', 'remote-only']};},
  testModelProvider: async (providerID, model) => {
    window.__calls.push({kind: 'test', providerID, id: model.id});
    if (window.__holdTests) await new Promise(resolve => window.__releaseTests.push(resolve));
    return {status: 'reachable', latencyMs: 42};
  },
  createProvider: async definition => {
    window.__calls.push({ kind: 'create', definition });
    if (window.__failNext) { window.__failNext = false; throw new Error('模拟保存失败'); }
    window.__providers[definition.id] = summary(definition);
  },
  updateProvider: async (id, definition) => {
    window.__calls.push({ kind: 'update', definition });
    if (window.__holdUpdates) await new Promise(resolve => { window.__releaseUpdate = resolve; });
    if (window.__failNext) { window.__failNext = false; throw new Error('模拟保存失败'); }
    window.__providers[id] = summary(definition);
  },
};
function summary(config) {
  return { ...window.__providers[config.id], providerID: config.id, displayName: config.name ?? config.id, providerKind: config.kind,
    baseURL: config.baseUrl, enabled: config.enabled, defaultModels: config.models.map(model => model.id),
    config, authMethods: ['api-key'] };
}
`

const storeMock = `
const snapshot = {loaded: true, providers: [], currentProviderState: null, apiKeys: [], credentials: [], usageSources: [], usageResults: [], refreshingSourceIds: []};
export const useProviderManagementSnapshot = () => snapshot;
export const providerManagementStore = {refresh: async () => ({...snapshot, providers: Object.values(window.__providers), configurationError: window.__failRefresh ? (window.__failRefresh = false, '模拟刷新失败') : null}), refreshAllProviderData: async () => {window.__catalogRefreshes = (window.__catalogRefreshes ?? 0) + 1; return snapshot;}, querySources: async () => {window.__queries = (window.__queries ?? 0) + 1; return {};}};
`

const harness = `
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, Link, Outlet, useLocation, useSearchParams, useNavigate } from 'react-router-dom';
import { ProviderEditorForm } from ${source('features/models/provider-management/ProviderEditorForm.tsx')};
import { useModelCenterController } from ${source('features/models/UseModelCenterController.ts')};
import { ProviderConnectionSection } from ${source('features/models/provider-management/ProviderConnectionSection.tsx')};
import { ProviderModelsSection } from ${source('features/models/provider-management/ProviderModelsSection.tsx')};
import { ProviderDetail } from ${source('features/models/ProviderDetail.tsx')};
import { WorkspaceHeaderProvider, DesktopWorkspaceHeader } from ${source('features/layout/workspace-header/index.ts')};
import { parseModelCenterSearchParams, updateModelCenterSearchParams } from ${source('features/models/ModelCenterState.ts')};
const model = (id, api) => ({ id, name: id, api, enabled: true, contextWindow: 32768,
  maxTokens: 8192, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
const config = { kind: 'custom', id: 'mixed', name: 'Mixed', enabled: true,
  baseUrl: 'https://example.com/v1', auth: 'api-key', env: ['CUSTOM_KEY'], allowInsecureHttp: false,
  headers: { 'X-Client': 'Pidex' }, models: [
    { ...model('chat', 'openai-completions'), headers: { 'X-Model': 'retained' },
      compat: { supportsStore: false }, thinkingLevelMap: { high: 'high' } },
    model('messages', 'anthropic-messages') ] };
window.__providers = { mixed: { providerID: 'mixed', displayName: 'Mixed', baseURL: config.baseUrl,
  logoURL: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22512%22%20height=%22512%22%3E%3Crect%20width=%22512%22%20height=%22512%22/%3E%3C/svg%3E', providerKind: 'custom', defaultModels: ['chat', 'messages'], enabled: true, config } };
window.__providers.google = {nativeApis: ['google-generative-ai'], defaultApi: 'google-generative-ai', endpointDefaults: {'google-generative-ai': 'https://native.example/v1', 'openai-completions': 'https://compatible.example/v1'}, providerID: 'google', displayName: 'Google', providerKind: 'builtin', enabled: true, baseURL: 'https://native.example/v1', defaultModels: ['native'], modelMetadata: {native: {name: 'Native', nativeApi: 'google-generative-ai', contextWindow: 131072, outputTokens: 32768, reasoning: true}}, config: {kind: 'builtin', id: 'google', enabled: true, allowModels: [], denyModels: [], models: []}};
function PanelHarness() {
  const [tab, setTab] = useState(null);
  const [host, setHost] = useState(null);
  const beforeChange = useRef(null);
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const providerId = location.pathname === '/providers' && !params.has('newProvider') && !params.has('edit') ? params.get('provider') : null;
  const visibleTab = providerId && tab ? {...tab, providerId} : null;
  const panel = {tab: visibleTab, host, beforeChange, claimProvider: () => {},
    open: (id, section) => {void (visibleTab ? Promise.resolve(true) : (beforeChange.current?.() ?? Promise.resolve(true))).then(ok => {if(ok) setTab({id: 'provider-management', kind: 'provider-management', providerId: id, section});});},
    close: () => {void (beforeChange.current?.() ?? Promise.resolve(true)).then(ok => {if(ok) setTab(null);});}};
  return <WorkspaceHeaderProvider routeScope={location.pathname + location.search}><DesktopWorkspaceHeader rightDockOpen={!!visibleTab} shellControls={<button aria-label='显示右侧边栏' onClick={() => panel.open(providerId, 'credentials')}>显示右侧边栏</button>}/><Outlet context={{providerManagement: panel}}/>{visibleTab ? <aside aria-label='供应商设置'><button onClick={panel.close}>关闭供应商设置</button><div ref={setHost}/></aside> : null}</WorkspaceHeaderProvider>;
}
function Harness() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [, refresh] = useState(0);
  const controller = useModelCenterController({onInitialProviderState: () => {}, onNotice: () => {}, onError: () => {}});
  const [testProvider, setTestProvider] = useState(params.get('provider') ?? 'mixed');
  useEffect(() => {setTestProvider(params.get('provider') ?? 'mixed')}, [params.get('provider')]);
  const testSummary = window.__providers[testProvider] ?? {...window.__providers.mixed, providerID: testProvider};
  const usageSource = {sourceId: 'balance', canonicalProviderId: 'mixed', providerIds: ['mixed'], displayName: '测试余额', scope: 'account', stability: 'official', availability: 'queryable', capabilities: ['balance'], queryPolicy: 'cached', connection: {kind: 'provider-key', disconnectible: false}, connectionMethod: {kind: 'provider-credential'}};
  const keys = [{id: 'saved', label: 'Primary', maskedValue: '••••1111', enabled: true, active: true, health: {status: 'untested'}}, {id: 'backup', label: 'Backup', maskedValue: '••••2222', enabled: true, active: false, health: {status: 'untested'}}];
  const connection = {id: 'saved', kind: params.get('auth') ?? 'inference-key', origin: 'credential', active: true, enabled: true, label: '已保存凭据', credentialId: 'saved'};
  const group = {provider: testSummary, connections: testProvider === 'mixed' ? [connection] : [], activeConnection: testProvider === 'mixed' ? connection : null, apiKeys: [], usageSources: [usageSource], oauthAvailable: false};
  const isNew = params.get('newProvider') === '1';
  const provider = isNew ? undefined : window.__providers[params.get('provider')];
  const route = parseModelCenterSearchParams(params, Object.keys(window.__providers), Object.keys(window.__providers));
  const returnToDetail = () => navigate('/providers?' + updateModelCenterSearchParams(params, {providerId: route.providerId, section: route.section}));
  return <div>
    <nav><Link to='/providers'>返回供应商</Link><Link to='/providers?provider=mixed'>Mixed</Link><Link to='/elsewhere'>离开页面</Link><Link to='/providers?provider=google&controller=1'>Google</Link><button onClick={() => navigate(-1)}>历史后退</button><button onClick={() => navigate(1)}>历史前进</button>
      <button onClick={() => { if (provider) window.__providers[provider.providerID] = {...provider}; refresh(n => n+1); }}>模拟密钥刷新</button>
    </nav>
    <output id='location'>{params.toString()}</output>
    {params.has('controller') ? <div>
      <button onClick={() => controller.testModels(testSummary, ['chat'])}>单模型测试</button>
      <button onClick={() => controller.testModels(testSummary, ['chat', 'messages'])}>批量模型测试</button>
      <button onClick={() => setTestProvider(testProvider === 'mixed' ? 'second' : 'mixed')}>切换测试供应商</button>
      <ProviderConnectionSection key={testProvider} provider={testSummary} group={group} apiKeys={testProvider === 'mixed' ? keys : []} busy={false}
        onSubmitKey={async () => {if(window.__failNext){window.__failNext=false; return false;} return true;}} onSaveDefinition={definition => controller.saveProviderDefinition(definition, testSummary.providerID)} onRefresh={async () => {refresh(n => n+1);}} onNotice={message => (window.__notices ??= []).push(message)} onError={message => (window.__noticeErrors ??= []).push(message)} />
      <ProviderModelsSection key={'models-' + testProvider} provider={testSummary} models={testSummary.defaultModels} modelMetadata={testSummary.modelMetadata}
        busy={controller.busyProviderIds.includes(testProvider)} testResults={controller.modelTestResults}
        onTestModels={ids => controller.testModels(testSummary, ids)} onFetchModels={() => controller.fetchModels(testSummary)}
        onSaveDefinition={controller.saveProviderDefinition} onRefresh={async () => {refresh(n => n+1);}} onNotice={() => {}} onError={() => {}} />
      <output id='test-status'>{controller.modelTestResults[testProvider + '/chat']?.state ?? 'idle'}</output>
    </div> : null}
    {isNew || route.editing ? <ProviderEditorForm key={isNew ? 'new' : provider.providerID}
      onSaveDefinition={controller.saveProviderDefinition}
      embedded open provider={provider} existingProviderIds={['custom-provider', ...Object.keys(window.__providers)]}
      onOpenChange={() => isNew ? navigate('/providers') : returnToDetail()}
      onSaved={async (id, select = true) => {
        const saved = await controller.readSavedProvider(id);
        refresh(n => n+1);
        if (select) navigate('/providers?' + updateModelCenterSearchParams(params, {providerId: id, section: isNew ? 'connection' : route.section}));
        return saved;
      }} /> : provider ? <ProviderDetail section={route.section}
        provider={{id: provider.providerID, name: provider.displayName, logoURL: provider.logoURL, status: {label: '已配置', tone: 'positive'}}}
        actions={<button onClick={() => navigate('/providers?' + updateModelCenterSearchParams(params, {providerId: route.providerId, section: route.section, editing: true}))}>编辑配置</button>}>
        <div data-provider-section="connection">多密钥入口</div><div data-provider-section="models">模型测试入口</div>
      </ProviderDetail> : <div>供应商目录</div>}
  </div>;
}
const router = createMemoryRouter([{element: <PanelHarness />, children: [{path: '*', element: <Harness />}]}], { initialEntries: [window.__entry] });
createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
`

async function buildHarness(): Promise<string> {
  const build = await Bun.build({
    entrypoints: ['custom-provider-editor-harness'],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.DEV': 'false' },
    plugins: [
      {
        name: 'custom-provider-editor-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^(?:react-dom\/client|react-router-dom)$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^custom-provider-editor-harness$/ }, () => ({
            path: 'harness',
            namespace: 'custom-provider-editor',
          }))
          builder.onLoad({ filter: /^harness$/, namespace: 'custom-provider-editor' }, () => ({
            contents: harness,
            loader: 'jsx',
            resolveDir: rendererRoot,
          }))
          builder.onResolve({ filter: /provider-management\/index\.js$/ }, () => ({
            path: 'store',
            namespace: 'custom-provider-editor',
          }))
          builder.onLoad({ filter: /^store$/, namespace: 'custom-provider-editor' }, () => ({
            contents: storeMock,
            loader: 'js',
          }))
          builder.onResolve(
            { filter: /(?:desktop-client\/index\.js$|^custom-provider-editor-client$)/ },
            () => ({ path: 'client', namespace: 'custom-provider-editor' }),
          )
          builder.onLoad({ filter: /^client$/, namespace: 'custom-provider-editor' }, () => ({
            contents: clientMock,
            loader: 'js',
          }))
        },
      },
    ],
  })
  assert.ok(build.success, build.logs.map(String).join('\n'))
  const script = await build.outputs[0]!.text()
  if (!process.argv.includes('--layout')) return script
  const assets = resolve(rendererRoot, '../../../dist/renderer/assets')
  const cssFiles = [...new Bun.Glob('index-*.css').scanSync({ cwd: assets })]
  assert.equal(cssFiles.length, 1, '布局检查前请先运行 bun run build:renderer')
  const css = await Bun.file(resolve(assets, cssFiles[0]!)).text()
  return 'window.__rendererCss = ' + JSON.stringify(css) + ';' + script
}

if (process.versions.bun) {
  // Playwright's Chrome pipe transport needs Node on Windows; Bun only bundles the harness.
  const child = Bun.spawn(
    [
      'node',
      '--experimental-strip-types',
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    {
      stdin: new Blob([await buildHarness()]),
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  process.exit(await child.exited)
}

let script = ''
for await (const chunk of process.stdin) script += chunk.toString('utf8')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const errors: string[] = []
  async function mount(entry: string, editing = true) {
    const page = await browser.newPage()
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error(error.message)
    })
    await page.setContent('<div id="root"></div>')
    await page.evaluate((value) => {
      ;(window as any).__entry = value
      if (value.includes('icons=1')) {
        const manualSource =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
        if (value.includes('manualIcon=1')) (window as any).__manualProviderIcon = true
        let iconListener: ((change: any) => void) | null = null
        ;(window as any).DesktopBridge = {
          resolveProviderIcon: async (input: any) => {
            ;(window as any).__iconResolutions = [
              ...((window as any).__iconResolutions ?? []),
              input,
            ]
            if ((window as any).__manualProviderIcon && input.providerID) {
              return { source: manualSource, override: true }
            }
            return { source: input.url || null }
          },
          onProviderIconChange: (listener: (change: any) => void) => {
            iconListener = listener
            return () => {
              iconListener = null
            }
          },
          setProviderWebsiteIcon: async (input: any) => {
            if ((window as any).__iconFailure)
              throw new Error("No handler registered for 'desktop-provider-icon:website'")
            const source = input.website ? manualSource : null
            if (!input.website) (window as any).__manualProviderIcon = false
            iconListener?.({ url: '', providerID: input.providerID, source })
            return { source }
          },
          setProviderUploadedIcon: async (input: any) => {
            ;(window as any).__uploadedIcons = [...((window as any).__uploadedIcons ?? []), input]
            if ((window as any).__iconUploadFailure)
              throw new Error("No handler registered for 'desktop-provider-icon:upload'")
            iconListener?.({ url: '', providerID: input.providerID, source: input.dataURL })
            return { source: input.dataURL }
          },
        }
      }
    }, entry)
    await page.addScriptTag({ content: script })
    try {
      await expect(
        page.getByRole('button', { name: editing ? '保存配置' : '编辑配置', exact: true }),
      ).toBeVisible()
    } catch (error) {
      console.error(await page.locator('body').innerText())
      throw error
    }
    return page
  }

  const iconsPage = await mount('/providers?provider=mixed&controller=1&icons=1', false)
  await iconsPage.getByRole('button', { name: '显示右侧边栏', exact: true }).click()
  await expect(iconsPage.getByText('图标单独保存并立即生效，仅访问公网 HTTPS 网站。')).toHaveCount(
    0,
  )
  await iconsPage.getByRole('button', { name: '从网站获取', exact: true }).click()
  await expect
    .poll(() => iconsPage.evaluate(() => (window as any).__notices?.at(-1)))
    .toBe('网站图标已保存')
  await iconsPage.evaluate(() => {
    ;(window as any).__iconFailure = true
  })
  await iconsPage.getByRole('button', { name: '从网站获取', exact: true }).click()
  await expect
    .poll(() => iconsPage.evaluate(() => (window as any).__noticeErrors?.at(-1)))
    .toContain('完全退出并重新启动 Pidex')
  await iconsPage.evaluate(() => {
    ;(window as any).__iconFailure = false
  })
  const iconFile = {
    name: 'provider-logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    ),
  }
  await iconsPage.locator('input[type="file"]').setInputFiles(iconFile)
  await expect
    .poll(() => iconsPage.evaluate(() => (window as any).__notices?.at(-1)))
    .toBe('图标已更新')
  const uploadedIcon = await iconsPage.evaluate(() => (window as any).__uploadedIcons?.at(-1))
  assert.equal(uploadedIcon.providerID, 'mixed')
  assert.ok(uploadedIcon.dataURL.startsWith('data:image/png;base64,'))
  await iconsPage.evaluate(() => {
    ;(window as any).__iconUploadFailure = true
  })
  await iconsPage.locator('input[type="file"]').setInputFiles(iconFile)
  await expect
    .poll(() => iconsPage.evaluate(() => (window as any).__noticeErrors?.at(-1)))
    .toContain('完全退出并重新启动 Pidex')
  await iconsPage.evaluate(() => {
    ;(window as any).__iconUploadFailure = false
  })
  const uploadedCount = await iconsPage.evaluate(() => (window as any).__uploadedIcons.length)
  await iconsPage.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const canvas = document.createElement('canvas')
        canvas.width = 600
        canvas.height = 300
        const context = canvas.getContext('2d')!
        context.fillStyle = '#336699'
        context.fillRect(0, 0, 600, 300)
        canvas.toBlob((blob) => {
          const transfer = new DataTransfer()
          transfer.items.add(new File([blob!], 'large-logo.png', { type: 'image/png' }))
          const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
          input.files = transfer.files
          input.dispatchEvent(new Event('change', { bubbles: true }))
          resolve()
        }, 'image/png')
      }),
  )
  await expect
    .poll(() => iconsPage.evaluate(() => (window as any).__uploadedIcons.length))
    .toBe(uploadedCount + 1)
  const normalizedIcon = await iconsPage.evaluate(async () => {
    const source = (window as any).__uploadedIcons.at(-1).dataURL
    const image = new Image()
    image.src = source
    await image.decode()
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      png: source.startsWith('data:image/png;base64,'),
    }
  })
  // 上传的大图按最长边缩放到 256px，并保持宽高比。
  assert.deepEqual(normalizedIcon, { width: 256, height: 128, png: true })
  await iconsPage.getByRole('button', { name: '恢复默认图标', exact: true }).click()
  await expect
    .poll(() => iconsPage.evaluate(() => (window as any).__notices?.at(-1)))
    .toBe('已恢复默认图标')
  await iconsPage.close()

  // 手动图标不请求目录图标；恢复默认后才重新加载目录图标并参与 5 小时刷新。
  const manualPage = await mount(
    '/providers?provider=mixed&controller=1&icons=1&manualIcon=1',
    false,
  )
  await manualPage.getByRole('button', { name: '显示右侧边栏', exact: true }).click()
  await expect(manualPage.locator('.provider-icon-settings-preview .ui-remote-image')).toHaveCount(
    1,
  )
  const mixedResolutions = await manualPage.evaluate(() =>
    (window as any).__iconResolutions.filter((input: any) => input.providerID === 'mixed'),
  )
  assert.deepEqual(mixedResolutions, [{ url: '', providerID: 'mixed' }])
  await manualPage.getByRole('button', { name: '恢复默认图标', exact: true }).click()
  await expect
    .poll(() =>
      manualPage.evaluate(() =>
        (window as any).__iconResolutions.some(
          (input: any) =>
            input.providerID === 'mixed' && input.url === (window as any).__providers.mixed.logoURL,
        ),
      ),
    )
    .toBe(true)
  await expect(manualPage.locator('.provider-icon-settings-preview .ui-remote-image')).toHaveCount(
    1,
  )
  await manualPage.close()

  // 新建只保留草稿；校验失败、保存失败均不离开。首次保存选中真实身份。
  const page = await mount('/providers?newProvider=1')
  await expect(page.getByText('当前没有配置模型，添加并保存后可在聊天中使用。')).toBeVisible()
  assert.equal(await page.evaluate(() => (window as any).__calls.length), 0)
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.getByText('Provider ID、名称和 Base URL 不能为空。')).toBeVisible()
  await page.getByPlaceholder('如：Ollama 本地服务').fill('My Provider')
  await page.getByPlaceholder('https://example.com/v1').fill('https://example.com/v1')
  await page.getByRole('button', { name: '新增模型', exact: true }).click()
  await page.getByPlaceholder('如：llama3.2 或 gpt-4o').fill('test-model')
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await page.evaluate(() => {
    ;(window as any).__failNext = true
  })
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.getByText('模拟保存失败')).toBeVisible()
  await expect(page.getByPlaceholder('如：Ollama 本地服务')).toHaveValue('My Provider')
  await expect(page.locator('#location')).toHaveText('newProvider=1')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.locator('#location')).toHaveText(
    'provider=custom-provider-2&section=connection',
  )
  await expect(page.getByText('多密钥入口')).toBeVisible()
  const created = await page.evaluate(() => (window as any).__calls.at(-1).definition)
  assert.equal(created.models[0].api, 'anthropic-messages')
  await page.close()

  // 新供应商保存前可从 /models 获取候选，并把上游基线随创建写入 modelSync。
  const presave = await mount('/providers?newProvider=1')
  await presave.getByPlaceholder('https://example.com/v1').fill('https://pre-save.example/v1')
  await presave.getByRole('button', { name: '从 /models 获取', exact: true }).click()
  await expect(presave.getByText('发现 1 个候选模型')).toBeVisible()
  await presave.getByRole('button', { name: '导入已选 (1)', exact: true }).click()
  await presave.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect
    .poll(() => presave.evaluate(() => (window as any).__calls.at(-1)?.kind))
    .toBe('create')
  const presaved = await presave.evaluate(() => (window as any).__calls.at(-1).definition)
  assert.equal(presaved.models[0].id, 'remote-only')
  assert.deepEqual(presaved.modelSync.models, ['remote-only'])
  assert.equal(presaved.modelSync.api, 'openai-completions')
  await presave.close()

  // 混合协议与隐藏扩展字段保留；凭据刷新不覆盖草稿；离开选择能保存或放弃。
  const mixed = await mount('/providers?provider=mixed&section=models', false)
  await expect(mixed.getByText('模型测试入口')).toBeVisible()
  const headingIcon = mixed.locator('.model-center-provider-identity-logo .ui-remote-image')
  await expect(headingIcon).toHaveAttribute('data-state', 'ready')
  await expect(headingIcon.locator('[style*="mask-image"]')).toHaveCount(1)
  await headingIcon.locator('img').dispatchEvent('error')
  await expect(headingIcon).toHaveAttribute('data-state', 'error')
  await expect(headingIcon.locator('.ui-remote-image-fallback svg')).toHaveCount(1)
  await expect(
    mixed
      .getByRole('toolbar', { name: '工作区工具栏' })
      .locator('.desktop-workspace-header-route-left'),
  ).toContainText('Mixed')
  await expect(
    mixed.locator('.model-center-provider-detail .model-center-provider-detail-header'),
  ).toHaveCount(0)
  await expect(
    mixed.getByRole('toolbar').locator('.desktop-workspace-header-route-right'),
  ).toContainText('编辑配置')
  await expect(
    mixed.getByRole('toolbar').locator('.desktop-workspace-header-route-left'),
  ).not.toContainText('编辑配置')
  await expect(mixed.getByRole('button', { name: '保存配置', exact: true })).toHaveCount(0)
  await mixed.getByRole('button', { name: '编辑配置', exact: true }).click()
  await expect(mixed.locator('#location')).toHaveText('provider=mixed&section=models&edit=1')
  await expect(mixed.getByText('多密钥入口')).toHaveCount(0)
  await expect(mixed.locator('[aria-label="默认 API 格式"]')).toContainText('按模型设置')
  await mixed.getByPlaceholder('如：Ollama 本地服务').fill('Renamed')
  await mixed.getByRole('button', { name: '模拟密钥刷新' }).click()
  await expect(mixed.getByPlaceholder('如：Ollama 本地服务')).toHaveValue('Renamed')
  await mixed.getByRole('link', { name: '返回供应商', exact: true }).click()
  await expect(mixed.getByRole('dialog')).toContainText('供应商有未保存修改')
  await mixed.getByRole('button', { name: '继续编辑' }).click()
  await expect(mixed.getByRole('dialog')).toHaveCount(0)
  await mixed.getByRole('link', { name: '离开页面' }).click()
  await mixed.evaluate(() => {
    ;(window as any).__failNext = true
  })
  await mixed.getByRole('button', { name: '保存后离开' }).click()
  await expect(mixed.getByText('模拟保存失败')).toBeVisible()
  await expect(mixed.locator('#location')).toHaveText('provider=mixed&section=models&edit=1')
  await mixed.getByRole('button', { name: '保存后离开' }).click()
  await expect(mixed.getByText('供应商目录')).toBeVisible()
  const updated = await mixed.evaluate(() => (window as any).__calls.at(-1).definition)
  assert.deepEqual(
    updated.models.map((model: any) => model.api),
    ['openai-completions', 'anthropic-messages'],
  )
  assert.deepEqual(updated.headers, { 'X-Client': 'Pidex' })
  assert.deepEqual(updated.models[0].headers, { 'X-Model': 'retained' })
  assert.deepEqual(updated.models[0].compat, { supportsStore: false })
  assert.deepEqual(updated.models[0].thinkingLevelMap, { high: 'high' })
  await mixed.close()

  const discard = await mount('/providers?provider=mixed&edit=1')
  await discard.getByPlaceholder('https://example.com/v1').fill('https://changed.example/v1')
  await discard.getByRole('link', { name: '返回供应商', exact: true }).click()
  await discard.getByRole('button', { name: '放弃修改' }).click()
  await expect(discard.getByText('供应商目录')).toBeVisible()
  assert.equal(await discard.evaluate(() => (window as any).__calls.length), 0)
  await discard.close()

  // 明确选择统一协议才修改全部模型，并成为后续新增模型的默认值。
  const uniform = await mount('/providers?provider=mixed&section=models&edit=1')
  await uniform.locator('[aria-label="默认 API 格式"]').click()
  await uniform
    .locator('.settings-dropdown-item')
    .filter({ hasText: 'OpenAI Responses (/responses)' })
    .click()
  await uniform.getByRole('button', { name: '新增模型', exact: true }).click()
  await uniform.getByPlaceholder('如：llama3.2 或 gpt-4o').fill('new-responses-model')
  await uniform.getByRole('button', { name: '完成', exact: true }).click()
  await uniform.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(uniform.locator('#location')).toHaveText('provider=mixed&section=models')
  await expect(uniform.getByText('模型测试入口')).toBeVisible()
  assert.deepEqual(
    await uniform.evaluate(() =>
      (window as any).__calls.at(-1).definition.models.map((model: any) => model.api),
    ),
    ['openai-responses', 'openai-responses', 'openai-responses'],
  )
  await uniform.getByRole('button', { name: '编辑配置', exact: true }).click()
  await uniform.getByPlaceholder('如：Ollama 本地服务').fill('Discarded name')
  await uniform.getByRole('button', { name: '取消', exact: true }).click()
  await uniform.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(uniform.locator('#location')).toHaveText('provider=mixed&section=models')
  assert.equal(await uniform.evaluate(() => (window as any).__providers.mixed.displayName), 'Mixed')
  await uniform.close()

  // 创建成功但刷新失败时，重试更新同一身份，不重复创建。
  const retry = await mount('/providers?newProvider=1')
  await retry.getByRole('button', { name: 'Ollama', exact: true }).click()
  await retry.evaluate(() => {
    ;(window as any).__failRefresh = true
  })
  await retry.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(retry.getByText('模拟刷新失败')).toBeVisible()
  await retry.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(retry.locator('#location')).toHaveText('provider=custom-ollama&section=connection')
  assert.deepEqual(
    await retry.evaluate(() => (window as any).__calls.map((call: any) => call.kind)),
    ['create', 'update'],
  )
  await retry.close()
  const tests = await mount('/providers?provider=mixed&controller=1', false)
  await expect(tests.getByText('多密钥入口')).toBeVisible()
  await expect(tests.getByText('模型测试入口')).toBeVisible()
  await expect(tests.getByRole('tab')).toHaveCount(0)
  await expect(tests.locator('.model-center-model-row')).toHaveCount(2)
  await tests.getByRole('button', { name: '搜索模型', exact: true }).click()
  await tests.getByRole('searchbox', { name: '搜索模型', exact: true }).fill('chat')
  await expect(tests.locator('.model-center-model-row')).toHaveCount(1)
  await tests.getByRole('searchbox', { name: '搜索模型', exact: true }).fill('')
  await expect(tests.getByRole('dialog')).toHaveCount(0)
  assert.equal(await tests.evaluate(() => (window as any).__queries ?? 0), 0)
  await tests.clock.install()
  await tests.getByRole('button', { name: '显示右侧边栏', exact: true }).click()
  await expect(tests.getByRole('complementary')).toContainText('Primary')
  await expect(tests.getByRole('complementary')).toContainText('Backup')
  await expect(
    tests.getByRole('complementary').getByRole('heading', { name: '认证与密钥', exact: true }),
  ).toBeVisible()
  await expect(tests.getByRole('complementary').getByRole('radio')).toHaveCount(0)
  // 「用量与余额」与认证、请求配置同级且不折叠：打开侧栏即展示并查询已连接来源。
  await expect(
    tests.getByRole('complementary').getByRole('heading', { name: '用量与余额', exact: true }),
  ).toBeVisible()
  await expect(
    tests.getByRole('complementary').getByRole('heading', { name: '请求配置', exact: true }),
  ).toBeVisible()
  await expect.poll(() => tests.evaluate(() => (window as any).__queries)).toBe(1)
  await tests.getByRole('button', { name: '刷新余额', exact: true }).click()
  await expect.poll(() => tests.evaluate(() => (window as any).__queries)).toBe(2)
  await tests.clock.runFor(60_000)
  assert.equal(await tests.evaluate(() => (window as any).__queries), 3)
  await tests.getByRole('button', { name: '关闭供应商设置', exact: true }).click()
  await tests.clock.runFor(60_000)
  assert.equal(await tests.evaluate(() => (window as any).__queries), 3)
  await tests.clock.resume()

  await tests.evaluate(() => {
    ;(window as any).__holdTests = true
  })
  await tests.getByRole('button', { name: '批量模型测试', exact: true }).click()
  await expect(tests.locator('#test-status')).toHaveText('testing')
  await expect(tests.getByRole('button', { name: '测试模型 chat', exact: true })).toBeDisabled()
  await tests.getByRole('button', { name: '单模型测试', exact: true }).click()
  assert.equal(
    await tests.evaluate(
      () => (window as any).__calls.filter((call: any) => call.kind === 'test').length,
    ),
    1,
  )
  await tests.getByRole('button', { name: '切换测试供应商', exact: true }).click()
  await expect(tests.locator('#test-status')).toHaveText('idle')
  await expect(tests.getByRole('dialog')).toHaveCount(0)
  await tests.evaluate(() => {
    ;(window as any).__holdTests = false
    ;(window as any).__releaseTests.splice(0).forEach((resolve: any) => resolve())
  })
  await expect
    .poll(() =>
      tests.evaluate(
        () => (window as any).__calls.filter((call: any) => call.kind === 'test').length,
      ),
    )
    .toBe(2)
  await expect(tests.locator('#test-status')).toHaveText('idle')
  await tests.getByRole('button', { name: '切换测试供应商', exact: true }).click()
  await expect(tests.locator('#test-status')).toHaveText('reachable')
  assert.deepEqual(
    await tests.evaluate(() =>
      (window as any).__calls
        .filter((call: any) => call.kind === 'test')
        .map((call: any) => call.providerID),
    ),
    ['mixed', 'mixed'],
  )
  await tests.getByRole('button', { name: '同步模型', exact: true }).click()
  await expect.poll(() => tests.evaluate(() => (window as any).__syncs)).toBe(1)
  await expect(tests.getByRole('dialog')).toContainText('remote-only')
  await tests.getByRole('button', { name: '关闭模型发现' }).click()
  assert.equal(
    await tests.evaluate(() => (window as any).__providers.mixed.config.models.length),
    2,
  )
  assert.deepEqual(await tests.evaluate(() => (window as any).__modelPages), [])
  assert.equal(
    await tests.evaluate(
      () =>
        (window as any).__calls.filter(
          (call: any) => call.kind === 'create' || call.kind === 'update',
        ).length,
    ),
    0,
  )
  await tests.close()

  const modelPage = await mount('/providers?provider=mixed&controller=1', false)
  await modelPage.getByRole('button', { name: '添加模型', exact: true }).click()
  const modelDialog = modelPage.getByRole('dialog', { name: '添加模型', exact: true })
  await expect(modelDialog.getByRole('button', { name: '高级设置', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await modelDialog.getByPlaceholder('如：llama3.2 或 gpt-4o').fill('new-model')
  await modelPage
    .locator('nav button')
    .last()
    .evaluate((button) => (button as HTMLButtonElement).click())
  await expect(modelDialog.getByPlaceholder('如：llama3.2 或 gpt-4o')).toHaveValue('new-model')
  await modelPage.evaluate(() => {
    ;(window as any).__failNext = true
  })
  await modelDialog.getByRole('button', { name: '添加模型', exact: true }).click()
  await expect(modelDialog.getByRole('alert')).toContainText('模拟保存失败')
  await modelDialog.getByRole('button', { name: '添加模型', exact: true }).click()
  await expect(modelPage.getByRole('dialog')).toHaveCount(0)
  await expect(modelPage.locator('.model-center-model-row')).toHaveCount(3)
  await modelPage.getByRole('button', { name: '编辑模型 chat', exact: true }).click()
  const editDialog = modelPage.getByRole('dialog', { name: '编辑模型', exact: true })
  await editDialog.getByLabel('选择已有分组', { exact: true }).click()
  await modelPage.getByRole('option', { name: 'mixed', exact: true }).click()
  await expect(editDialog.getByLabel('分组名称', { exact: true })).toHaveValue('mixed')
  await editDialog.getByLabel('分组名称', { exact: true }).fill('常用模型')
  await expect(editDialog.getByPlaceholder('如：llama3.2 或 gpt-4o')).toHaveAttribute(
    'readonly',
    '',
  )
  await editDialog.getByRole('button', { name: '高级设置', exact: true }).click()
  const inputLimit = editDialog.getByRole('spinbutton', { name: '最大输入 Token', exact: true })
  await inputLimit.locator('..').getByRole('button', { name: '128K', exact: true }).click()
  await expect(inputLimit).toHaveValue('128000')
  await inputLimit.fill('125000')
  await expect(inputLimit).toHaveValue('125000')
  const reasoningChip = editDialog.getByRole('button', { name: '推理', exact: true })
  const originalReasoning = await reasoningChip.getAttribute('aria-pressed')
  await reasoningChip.click()
  const back = editDialog.getByRole('button', { name: '回退高级配置', exact: true })
  const reset = editDialog.getByRole('button', { name: '重置高级配置', exact: true })
  await back.click()
  await expect(reasoningChip).toHaveAttribute('aria-pressed', originalReasoning!)
  await expect(inputLimit).toHaveValue('125000')
  await editDialog.getByRole('spinbutton', { name: '输入价格', exact: true }).fill('9')
  await reset.click()
  await expect(editDialog.getByLabel('分组名称', { exact: true })).toHaveValue('常用模型')
  await expect(inputLimit).toHaveValue('')
  await expect(editDialog.getByRole('spinbutton', { name: '输入价格', exact: true })).toHaveValue(
    '0',
  )
  await expect(reset).toBeDisabled()
  await back.click()
  await expect(inputLimit).toHaveValue('125000')
  await expect(editDialog.getByRole('spinbutton', { name: '输入价格', exact: true })).toHaveValue(
    '9',
  )
  await expect(reasoningChip).toHaveAttribute('aria-pressed', originalReasoning!)
  await editDialog.getByRole('button', { name: '高级设置', exact: true }).click()
  await editDialog.getByRole('button', { name: '协议参数', exact: true }).click()
  await expect(editDialog.getByPlaceholder('X-Model-Specific: value')).toBeVisible()
  await editDialog.getByPlaceholder('默认使用模型 ID').fill('Changed')
  await editDialog.getByRole('button', { name: '取消', exact: true }).click()
  await modelPage.getByRole('button', { name: '放弃修改', exact: true }).click()
  assert.equal(
    await modelPage.evaluate(
      () =>
        (window as any).__providers.mixed.config.models.find((model: any) => model.id === 'chat')
          .name,
    ),
    'chat',
  )
  await modelPage.getByRole('button', { name: '显示右侧边栏', exact: true }).click()
  await modelPage
    .getByRole('complementary')
    .getByRole('textbox', { name: 'API 地址', exact: true })
    .fill('https://changed.example/v1')
  await modelPage.getByRole('link', { name: '离开页面', exact: true }).evaluate((link: HTMLAnchorElement) => link.click())
  await modelPage.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(
    modelPage.getByRole('complementary').getByRole('textbox', { name: 'API 地址', exact: true }),
  ).toHaveValue('https://changed.example/v1')
  await modelPage.getByRole('button', { name: '关闭供应商设置', exact: true }).evaluate((button: HTMLButtonElement) => button.click())
  await modelPage.getByRole('button', { name: '继续编辑', exact: true }).click()
  await modelPage.getByRole('button', { name: '模拟密钥刷新', exact: true }).evaluate((button: HTMLButtonElement) => button.click())
  await expect(
    modelPage.getByRole('complementary').getByRole('textbox', { name: 'API 地址', exact: true }),
  ).toHaveValue('https://changed.example/v1')
  await modelPage.getByRole('button', { name: '关闭供应商设置', exact: true }).evaluate((button: HTMLButtonElement) => button.click())
  await modelPage.evaluate(() => {
    ;(window as any).__failNext = true
  })
  await modelPage.getByRole('button', { name: '保存后离开', exact: true }).click()
  await expect(modelPage.getByRole('alert', { includeHidden: true })).toContainText('模拟保存失败')
  await modelPage.getByRole('button', { name: '保存后离开', exact: true }).click()
  await expect(modelPage.getByRole('complementary')).toHaveCount(0)
  await modelPage.getByRole('button', { name: '显示右侧边栏', exact: true }).last().click()
  await expect(modelPage.getByRole('button', { name: '保存配置', exact: true })).toHaveCount(0)
  assert.equal(
    await modelPage.evaluate(() => (window as any).__providers.mixed.config.baseUrl),
    'https://changed.example/v1',
  )
  const autoAddress = modelPage.getByRole('complementary').getByRole('textbox', { name: 'API 地址', exact: true })
  await modelPage.evaluate(() => { (window as any).__holdUpdates = true })
  await autoAddress.fill('https://first.example/v1')
  await autoAddress.press('Tab')
  await expect.poll(() => modelPage.evaluate(() => Boolean((window as any).__releaseUpdate))).toBe(true)
  await autoAddress.fill('https://latest.example/v1')
  await autoAddress.press('Tab')
  await modelPage.evaluate(() => {
    ;(window as any).__holdUpdates = false
    ;(window as any).__releaseUpdate()
  })
  await expect.poll(() => modelPage.evaluate(() => (window as any).__providers.mixed.config.baseUrl)).toBe('https://latest.example/v1')
  await expect(autoAddress).toHaveValue('https://latest.example/v1')
  await modelPage.evaluate(() => { (window as any).__failNext = true })
  await autoAddress.fill('https://retry.example/v1')
  await autoAddress.press('Tab')
  await expect(modelPage.getByRole('alert', { includeHidden: true })).toContainText('模拟保存失败')
  await expect(autoAddress).toHaveValue('https://retry.example/v1')
  await autoAddress.focus()
  await autoAddress.press('Tab')
  await expect.poll(() => modelPage.evaluate(() => (window as any).__providers.mixed.config.baseUrl)).toBe('https://retry.example/v1')
  await modelPage.close()
  const endpointPage = await mount('/providers?provider=mixed&controller=1', false)
  await endpointPage.getByRole('button', { name: '显示右侧边栏', exact: true }).click()
  const endpointPanel = endpointPage.getByRole('complementary')
  await expect(endpointPanel).not.toContainText('Responses')
  await expect(endpointPanel.getByRole('combobox', { name: '请求协议' })).toHaveCount(0)
  await endpointPanel
    .getByRole('textbox', { name: 'API 地址', exact: true })
    .fill('https://chat.example/v1')
  await endpointPanel
    .getByRole('textbox', { name: 'Anthropic Messages API 地址', exact: true })
    .fill('https://messages.example')
  await endpointPanel.getByRole('button', { name: '设为默认', exact: true }).last().click()
  await expect.poll(() => endpointPage.evaluate(() => (window as any).__providers.mixed.config.baseUrl)).toBe('https://messages.example')
  await expect(endpointPanel.getByRole('button', { name: '保存配置', exact: true })).toHaveCount(0)
  const endpointsSaved = await endpointPage.evaluate(() => (window as any).__providers.mixed.config)
  assert.equal(endpointsSaved.baseUrl, 'https://messages.example')
  assert.deepEqual(endpointsSaved.endpoints, {
    'openai-completions': 'https://chat.example/v1',
    'anthropic-messages': 'https://messages.example',
  })
  assert.ok(endpointsSaved.models.every((model: any) => model.api === 'anthropic-messages'))
  await endpointPanel.getByRole('button', { name: '添加端点', exact: true }).click()
  await endpointPanel.getByRole('button', { name: '新端点协议', exact: true }).click()
  await endpointPage.getByRole('option', { name: 'Embeddings', exact: true }).click()
  await endpointPanel
    .getByRole('textbox', { name: '新端点 API 地址', exact: true })
    .fill('https://vectors.example/v1')
  await endpointPage.getByRole('button', { name: '关闭供应商设置', exact: true }).click()
  await endpointPage.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(
    endpointPanel.getByRole('textbox', { name: '新端点 API 地址', exact: true }),
  ).toHaveValue('https://vectors.example/v1')
  await endpointPanel.getByRole('button', { name: '添加', exact: true }).click()
  await expect(
    endpointPanel.getByRole('textbox', { name: 'Embeddings API 地址', exact: true }),
  ).toHaveValue('https://vectors.example/v1')
  await expect.poll(() => endpointPage.evaluate(() => (window as any).__providers.mixed.config.endpoints['openai-embeddings'])).toBe('https://vectors.example/v1')
  assert.equal(
    await endpointPage.evaluate(
      () => (window as any).__providers.mixed.config.endpoints['openai-embeddings'],
    ),
    'https://vectors.example/v1',
  )
  await endpointPage.close()
  const builtinPage = await mount('/providers?provider=google&controller=1', false)
  await builtinPage.getByRole('button', { name: '编辑模型 native', exact: true }).click()
  const builtinDialog = builtinPage.getByRole('dialog', { name: '编辑模型', exact: true })
  await builtinDialog.getByPlaceholder('默认使用模型 ID').fill('Renamed native')
  await builtinDialog.getByLabel('分组名称', { exact: true }).fill('常用')
  await builtinDialog.getByRole('button', { name: '高级设置', exact: true }).click()
  await expect(builtinDialog.getByText('模型 API 协议', { exact: true })).toHaveCount(0)
  await builtinDialog
    .getByRole('spinbutton', { name: '最大输入 Token', exact: true })
    .fill('100000')
  await builtinDialog.getByRole('button', { name: '保存模型', exact: true }).click()
  assert.deepEqual(
    await builtinPage.evaluate(() => (window as any).__providers.google.config.models),
    [
      {
        id: 'native',
        enabled: true,
        name: 'Renamed native',
        group: '常用',
        maxInputTokens: 100000,
      },
    ],
  )
  await builtinPage.getByRole('button', { name: '添加模型', exact: true }).click()
  await builtinPage
    .getByRole('dialog')
    .getByPlaceholder('如：llama3.2 或 gpt-4o')
    .fill('private-model')
  await builtinPage
    .getByRole('dialog')
    .getByRole('button', { name: '添加模型', exact: true })
    .click()
  assert.equal(
    await builtinPage.evaluate(() => (window as any).__providers.google.config.models.at(-1).api),
    undefined,
  )
  const addedNative = await builtinPage.evaluate(() =>
    (window as any).__providers.google.config.models.at(-1),
  )
  assert.equal(addedNative.contextWindow, 32768)
  assert.equal(addedNative.maxTokens, 8192)
  assert.equal(addedNative.reasoning, false)
  assert.deepEqual(addedNative.input, ['text'])
  assert.deepEqual(addedNative.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  await builtinPage.getByRole('button', { name: '显示右侧边栏', exact: true }).click()
  await builtinPage
    .getByRole('complementary')
    .getByRole('textbox', { name: 'API 地址', exact: true })
    .fill('https://override.example/v1')
  await builtinPage.getByRole('complementary').getByRole('textbox', { name: 'API 地址', exact: true }).press('Tab')
  await expect.poll(() => builtinPage.evaluate(() => (window as any).__providers.google.config.baseUrl)).toBe('https://override.example/v1')
  assert.equal(
    await builtinPage.evaluate(() => (window as any).__providers.google.config.baseUrl),
    'https://override.example/v1',
  )
  await builtinPage.getByRole('button', { name: '显示右侧边栏', exact: true }).click()
  const builtinPanel = builtinPage.getByRole('complementary')
  await expect(builtinPanel).not.toContainText('当前提供商配置只读')
  await expect(builtinPanel).not.toContainText('Responses')
  await builtinPanel.getByRole('button', { name: '高级与网络设置', exact: true }).click()
  await builtinPanel
    .getByRole('textbox', { name: '允许模型（逗号分隔，留空表示全部）', exact: true })
    .fill('native, private-model')
  await builtinPanel.getByRole('textbox', { name: '允许模型（逗号分隔，留空表示全部）', exact: true }).press('Tab')
  await expect.poll(() => builtinPage.evaluate(() => (window as any).__providers.google.config.allowModels)).toEqual(['native', 'private-model'])
  assert.deepEqual(
    await builtinPage.evaluate(() => (window as any).__providers.google.config.allowModels),
    ['native', 'private-model'],
  )
  assert.equal(
    await builtinPage.evaluate(() => (window as any).__providers.google.config.protocol),
    undefined,
  )

  await builtinPanel
    .getByRole('textbox', { name: 'Chat Completions API 地址', exact: true })
    .fill('https://custom-compatible.example/v1')
  await builtinPanel.getByRole('button', { name: '设为默认', exact: true }).click()
  await expect.poll(() => builtinPage.evaluate(() => (window as any).__providers.google.config.protocol)).toBe('openai-completions')
  assert.equal(
    await builtinPage.evaluate(() => (window as any).__providers.google.config.protocol),
    'openai-completions',
  )
  assert.equal(
    await builtinPage.evaluate(() => (window as any).__providers.google.config.baseUrl),
    'https://custom-compatible.example/v1',
  )
  await builtinPage.close()
  const navigationPage = await mount('/providers?provider=mixed&controller=1', false)
  await navigationPage.getByRole('button', { name: '添加模型', exact: true }).click()
  await navigationPage
    .getByRole('dialog')
    .getByPlaceholder('如：llama3.2 或 gpt-4o')
    .fill('navigation-model')
  await navigationPage
    .locator('nav a')
    .filter({ hasText: '离开页面' })
    .evaluate((link) => (link as HTMLAnchorElement).click())
  await navigationPage.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(
    navigationPage.getByRole('dialog').getByPlaceholder('如：llama3.2 或 gpt-4o'),
  ).toHaveValue('navigation-model')
  await navigationPage
    .locator('nav a')
    .filter({ hasText: '离开页面' })
    .evaluate((link) => (link as HTMLAnchorElement).click())
  await navigationPage.getByRole('button', { name: '保存后离开', exact: true }).click()
  await expect(navigationPage.getByText('供应商目录')).toBeVisible()
  assert.ok(
    await navigationPage.evaluate(() =>
      (window as any).__providers.mixed.config.models.some(
        (model: any) => model.id === 'navigation-model',
      ),
    ),
  )
  await navigationPage.close()
  const keyPage = await mount('/providers?provider=mixed&controller=1', false)
  await keyPage.getByRole('button', { name: '显示右侧边栏', exact: true }).click()
  await keyPage.getByRole('button', { name: '操作 Primary', exact: true }).click()
  await keyPage.getByText('编辑 Key', { exact: true }).click()
  await keyPage.getByPlaceholder('例如：个人主账号').fill('Changed key')
  await keyPage
    .getByRole('complementary')
    .getByRole('textbox', { name: 'API 地址', exact: true })
    .fill('https://key-draft.example/v1')
  await keyPage.getByRole('button', { name: '模拟密钥刷新', exact: true }).click()
  await expect(keyPage.getByPlaceholder('例如：个人主账号')).toHaveValue('Changed key')
  await keyPage.getByRole('button', { name: '关闭供应商设置', exact: true }).click()
  await keyPage.getByRole('button', { name: '继续编辑', exact: true }).click()
  await keyPage.getByRole('button', { name: '关闭供应商设置', exact: true }).click()
  await keyPage.evaluate(() => {
    ;(window as any).__failNext = true
  })
  await keyPage.getByRole('button', { name: '保存后离开', exact: true }).click()
  await expect(keyPage.getByRole('alert', { includeHidden: true })).toContainText('密钥未保存')
  await keyPage.getByRole('button', { name: '保存后离开', exact: true }).click()
  await expect(keyPage.getByRole('complementary')).toHaveCount(0)
  assert.equal(
    await keyPage.evaluate(() => (window as any).__providers.mixed.config.baseUrl),
    'https://key-draft.example/v1',
  )
  await keyPage.close()
  const routePage = await mount('/providers?provider=mixed&controller=1', false)
  await routePage.getByRole('button', { name: '显示右侧边栏', exact: true }).click()
  await routePage.getByRole('link', { name: 'Google', exact: true }).click()
  await expect(
    routePage.getByRole('complementary').getByRole('textbox', { name: 'API 地址', exact: true }),
  ).toHaveValue('https://native.example/v1')
  await routePage
    .getByRole('complementary')
    .getByRole('textbox', { name: 'API 地址', exact: true })
    .fill('https://draft.example/v1')
  await routePage.getByRole('button', { name: '历史后退', exact: true }).evaluate((button: HTMLButtonElement) => button.click())
  await routePage.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(routePage.locator('#location')).toHaveText('provider=google&controller=1')
  await routePage.getByRole('button', { name: '历史后退', exact: true }).evaluate((button: HTMLButtonElement) => button.click())
  await routePage.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(
    routePage.getByRole('complementary').getByRole('textbox', { name: 'API 地址', exact: true }),
  ).toHaveValue('https://example.com/v1')
  await routePage.getByRole('button', { name: '历史前进', exact: true }).click()
  await expect(
    routePage.getByRole('complementary').getByRole('textbox', { name: 'API 地址', exact: true }),
  ).toHaveValue('https://native.example/v1')
  await routePage.getByRole('link', { name: '返回供应商', exact: true }).click()
  await expect(routePage.getByRole('complementary')).toHaveCount(0)
  await routePage.close()
  for (const auth of ['oauth', 'env']) {
    const authPage = await mount('/providers?provider=mixed&controller=1&auth=' + auth, false)
    await expect(
      authPage.getByRole('heading', {
        name: auth === 'oauth' ? '账号授权' : '环境凭据',
        exact: true,
      }),
    ).toBeVisible()
    await expect(authPage.getByRole('textbox', { name: '当前 API 密钥', exact: true })).toHaveCount(
      0,
    )
    await authPage.close()
  }
  if (process.argv.includes('--layout')) {
    const layoutPage = await mount('/providers?provider=mixed&controller=1&icons=1', false)
    await layoutPage.addStyleTag({
      content: await layoutPage.evaluate(() => (window as any).__rendererCss),
    })
    await layoutPage
      .getByRole('button', { name: '显示右侧边栏', exact: true })
      .evaluate((button) => (button as HTMLButtonElement).click())
    await expect(layoutPage.getByRole('heading', { name: '供应商图标', exact: true })).toBeVisible()
    const iconGeometry = await layoutPage
      .locator('section[aria-label="供应商图标"]')
      .evaluate((section) => {
        const bounds = section.getBoundingClientRect()
        const preview = section
          .querySelector('.provider-icon-settings-preview')!
          .getBoundingClientRect()
        const input = section.querySelector('input:not([type="file"])')!.getBoundingClientRect()
        return {
          sectionRight: bounds.right,
          previewWidth: preview.width,
          previewRight: preview.right,
          inputLeft: input.left,
          inputRight: input.right,
          inputWidth: input.width,
        }
      })
    // 预览槽必须保持固定尺寸，不能把来源输入框顶出面板。
    assert.ok(
      iconGeometry.previewWidth > 0 && iconGeometry.previewWidth <= 48,
      JSON.stringify(iconGeometry),
    )
    assert.ok(iconGeometry.inputLeft >= iconGeometry.previewRight, JSON.stringify(iconGeometry))
    assert.ok(
      iconGeometry.inputWidth > 100 && iconGeometry.inputRight <= iconGeometry.sectionRight + 1,
      JSON.stringify(iconGeometry),
    )
    await layoutPage.getByRole('button', { name: '关闭供应商设置', exact: true }).click()
    const geometry = await layoutPage
      .locator('.model-center-model-row')
      .first()
      .evaluate((row) => {
        const bounds = row.getBoundingClientRect()
        const icon = row.querySelector('.ui-remote-image')!.getBoundingClientRect()
        const name = row.querySelector('button')!.getBoundingClientRect()
        const actions = row.lastElementChild!.getBoundingClientRect()
        return {
          rowWidth: bounds.width,
          iconWidth: icon.width,
          nameWidth: name.width,
          nameLeft: name.left,
          iconRight: icon.right,
          actionsRight: actions.right,
          rowRight: bounds.right,
        }
      })
    assert.ok(geometry.iconWidth > 0 && geometry.iconWidth < 32, JSON.stringify(geometry))
    assert.ok(
      geometry.nameWidth > 0 && geometry.nameLeft >= geometry.iconRight,
      JSON.stringify(geometry),
    )
    assert.ok(geometry.actionsRight <= geometry.rowRight, JSON.stringify(geometry))
    await layoutPage.getByRole('button', { name: '编辑模型 chat', exact: true }).click()
    const scrollDialog = layoutPage.getByRole('dialog', { name: '编辑模型', exact: true })
    await scrollDialog.getByRole('button', { name: '高级设置', exact: true }).click()
    for (const name of ['回退高级配置', '重置高级配置']) {
      const buttonGeometry = await scrollDialog
        .getByRole('button', { name, exact: true })
        .evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          width: element.getBoundingClientRect().width,
          radius: getComputedStyle(element).borderRadius,
        }))
      assert.deepEqual(buttonGeometry, { height: 24, width: 24, radius: '10px' })
    }

    await scrollDialog.getByRole('button', { name: '协议参数', exact: true }).click()
    await scrollDialog.getByPlaceholder('X-Model-Specific: value').scrollIntoViewIfNeeded()
    await scrollDialog.getByText('API Compat (JSON)', { exact: true }).scrollIntoViewIfNeeded()
    const scrolling = await scrollDialog
      .locator('.settings-management-dialog-body')
      .evaluate((element) => ({
        height: element.clientHeight,
        content: element.scrollHeight,
        top: element.scrollTop,
      }))
    assert.ok(scrolling.content > scrolling.height && scrolling.top > 0, JSON.stringify(scrolling))
    await layoutPage.close()
  }
  assert.deepEqual(errors, [])
  console.log('custom-provider-editor browser checks passed')
} finally {
  await browser.close()
}
