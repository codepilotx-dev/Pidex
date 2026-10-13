// Run: bun apps/desktop/renderer/test/CustomProviderEditor.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))

const clientMock = `
window.__calls = [];
export const desktopClient = {
  createProvider: async definition => {
    window.__calls.push({ kind: 'create', definition });
    if (window.__failNext) { window.__failNext = false; throw new Error('模拟保存失败'); }
    window.__providers[definition.id] = summary(definition);
  },
  updateProvider: async (id, definition) => {
    window.__calls.push({ kind: 'update', definition });
    if (window.__failNext) { window.__failNext = false; throw new Error('模拟保存失败'); }
    window.__providers[id] = summary(definition);
  },
};
function summary(config) {
  return { providerID: config.id, displayName: config.name, providerKind: 'custom',
    baseURL: config.baseUrl, enabled: config.enabled, defaultModels: config.models.map(model => model.id),
    config, authMethods: ['api-key'] };
}
`

const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { ProviderEditorForm } from ${source('features/models/provider-management/ProviderEditorForm.tsx')};
const model = (id, api) => ({ id, name: id, api, enabled: true, contextWindow: 32768,
  maxTokens: 8192, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
const config = { kind: 'custom', id: 'mixed', name: 'Mixed', enabled: true,
  baseUrl: 'https://example.com/v1', auth: 'api-key', env: ['CUSTOM_KEY'], allowInsecureHttp: false,
  headers: { 'X-Client': 'Pidex' }, models: [
    { ...model('chat', 'openai-completions'), headers: { 'X-Model': 'retained' },
      compat: { supportsStore: false }, thinkingLevelMap: { high: 'high' } },
    model('messages', 'anthropic-messages') ] };
window.__providers = { mixed: { providerID: 'mixed', displayName: 'Mixed', baseURL: config.baseUrl,
  providerKind: 'custom', defaultModels: ['chat', 'messages'], enabled: true, config } };
function Harness() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [, refresh] = useState(0);
  const isNew = params.get('newProvider') === '1';
  const provider = isNew ? undefined : window.__providers[params.get('provider')];
  return <div>
    <nav><Link to='/providers'>返回供应商</Link><Link to='/providers?provider=mixed'>Mixed</Link><Link to='/elsewhere'>离开页面</Link>
      <button onClick={() => { if (provider) window.__providers[provider.providerID] = {...provider}; refresh(n => n+1); }}>模拟密钥刷新</button>
    </nav>
    <output id='location'>{params.toString()}</output>
    {isNew || provider ? <ProviderEditorForm key={isNew ? 'new' : provider.providerID}
      embedded open provider={provider} existingProviderIds={['custom-provider', ...Object.keys(window.__providers)]}
      connectionSection={<div>多密钥入口</div>} onOpenChange={() => {}}
      onSaved={async (id, select = true) => {
        if (window.__failRefresh) { window.__failRefresh = false; throw new Error('模拟刷新失败'); }
        refresh(n => n+1);
        if (select) navigate('/providers?provider=' + id);
        return window.__providers[id];
      }} /> : <div>供应商目录</div>}
  </div>;
}
const router = createMemoryRouter([{ path: '*', element: <Harness /> }], { initialEntries: [window.__entry] });
createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
`

async function buildHarness(): Promise<string> {
  const build = await Bun.build({
    entrypoints: ['custom-provider-editor-harness'],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
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
  const errors: string[] = []
  async function mount(entry: string) {
    const page = await browser.newPage()
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error(error.message)
    })
    await page.setContent('<div id="root"></div>')
    await page.evaluate((value) => {
      ;(window as any).__entry = value
    }, entry)
    await page.addScriptTag({ content: script })
    try {
      await expect(page.getByRole('button', { name: '保存 Provider', exact: true })).toBeVisible()
    } catch (error) {
      console.error(await page.locator('body').innerText())
      throw error
    }
    return page
  }

  // 新建只保留草稿；校验失败、保存失败均不离开。首次保存选中真实身份。
  const page = await mount('/providers?newProvider=1')
  await expect(page.getByText('当前没有配置模型，添加并保存后可在聊天中使用。')).toBeVisible()
  assert.equal(await page.evaluate(() => (window as any).__calls.length), 0)
  await page.getByRole('button', { name: '保存 Provider', exact: true }).click()
  await expect(page.getByText('Provider ID、名称和 Base URL 不能为空。')).toBeVisible()
  await page.getByPlaceholder('如：Ollama 本地服务').fill('My Provider')
  await page.getByPlaceholder('https://example.com/v1').fill('https://example.com/v1')
  await page.getByRole('button', { name: '新增模型', exact: true }).click()
  await page.getByPlaceholder('如：llama3.2 或 gpt-4o').fill('test-model')
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await page.evaluate(() => {
    ;(window as any).__failNext = true
  })
  await page.getByRole('button', { name: '保存 Provider', exact: true }).click()
  await expect(page.getByText('模拟保存失败')).toBeVisible()
  await expect(page.getByPlaceholder('如：Ollama 本地服务')).toHaveValue('My Provider')
  await expect(page.locator('#location')).toHaveText('newProvider=1')
  await page.getByRole('button', { name: '保存 Provider', exact: true }).click()
  await expect(page.locator('#location')).toHaveText('provider=custom-provider-2')
  await expect(page.getByText('多密钥入口')).toBeVisible()
  const created = await page.evaluate(() => (window as any).__calls.at(-1).definition)
  assert.equal(created.models[0].api, 'anthropic-messages')
  await page.close()

  // 混合协议与隐藏扩展字段保留；凭据刷新不覆盖草稿；离开选择能保存或放弃。
  const mixed = await mount('/providers?provider=mixed')
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
  await expect(mixed.locator('#location')).toHaveText('provider=mixed')
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

  const discard = await mount('/providers?provider=mixed')
  await discard.getByPlaceholder('https://example.com/v1').fill('https://changed.example/v1')
  await discard.getByRole('link', { name: '返回供应商', exact: true }).click()
  await discard.getByRole('button', { name: '放弃修改' }).click()
  await expect(discard.getByText('供应商目录')).toBeVisible()
  assert.equal(await discard.evaluate(() => (window as any).__calls.length), 0)
  await discard.close()

  // 明确选择统一协议才修改全部模型，并成为后续新增模型的默认值。
  const uniform = await mount('/providers?provider=mixed')
  await uniform.locator('[aria-label="默认 API 格式"]').click()
  await uniform
    .locator('.settings-dropdown-item')
    .filter({ hasText: 'OpenAI Responses (/responses)' })
    .click()
  await uniform.getByRole('button', { name: '新增模型', exact: true }).click()
  await uniform.getByPlaceholder('如：llama3.2 或 gpt-4o').fill('new-responses-model')
  await uniform.getByRole('button', { name: '完成', exact: true }).click()
  await uniform.getByRole('button', { name: '保存 Provider', exact: true }).click()
  await expect(uniform.getByRole('button', { name: '保存 Provider', exact: true })).toBeDisabled()
  assert.deepEqual(
    await uniform.evaluate(() =>
      (window as any).__calls.at(-1).definition.models.map((model: any) => model.api),
    ),
    ['openai-responses', 'openai-responses', 'openai-responses'],
  )
  await uniform.close()

  // 创建成功但刷新失败时，重试更新同一身份，不重复创建。
  const retry = await mount('/providers?newProvider=1')
  await retry.getByRole('button', { name: 'Ollama', exact: true }).click()
  await retry.evaluate(() => {
    ;(window as any).__failRefresh = true
  })
  await retry.getByRole('button', { name: '保存 Provider', exact: true }).click()
  await expect(retry.getByText('模拟刷新失败')).toBeVisible()
  await retry.getByRole('button', { name: '保存 Provider', exact: true }).click()
  await expect(retry.locator('#location')).toHaveText('provider=custom-ollama')
  assert.deepEqual(
    await retry.evaluate(() => (window as any).__calls.map((call: any) => call.kind)),
    ['create', 'update'],
  )
  await retry.close()
  assert.deepEqual(errors, [])
  console.log('custom-provider-editor browser checks passed')
} finally {
  await browser.close()
}
