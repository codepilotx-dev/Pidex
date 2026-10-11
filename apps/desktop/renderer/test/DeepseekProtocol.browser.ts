// Run: bun apps/desktop/renderer/test/DeepseekProtocol.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))

const clientMock = `
export const desktopClient = {
  updateProvider: async (providerId, definition) => {
    window.__savedProvider = { providerId, definition };
  },
};
`

const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProviderEditorDialog } from ${source('features/models/provider-management/ProviderEditorDialog.tsx')};

const provider = {
  providerID: 'deepseek',
  displayName: 'DeepSeek',
  kind: 'openai-compatible',
  providerKind: 'builtin',
  enabled: true,
  baseURL: 'https://api.deepseek.com',
  defaultModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  modelMetadata: {
    'deepseek-v4-flash': { name: 'DeepSeek V4 Flash', providerApi: 'openai-completions' },
    'deepseek-v4-pro': { name: 'DeepSeek V4 Pro', providerApi: 'openai-completions' },
  },
  apiKeyConfigured: true,
  config: {
    kind: 'builtin', id: 'deepseek', enabled: true,
    allowModels: ['deepseek-v4-pro'], denyModels: ['deepseek-v4-flash'], models: [],
    protocol: 'openai-responses',
  },
};

function Harness() {
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState('');
  return <div>
    <div id="saved">{saved}</div>
    <ProviderEditorDialog open={open} provider={provider} deepSeekProtocolSupported
      onOpenChange={next => setOpen(next)}
      onSaved={id => setSaved(String(id))} />
  </div>;
}
createRoot(document.getElementById('root')).render(<Harness />);
`

async function buildHarness(): Promise<string> {
  const build = await Bun.build({
    entrypoints: ['deepseek-protocol-harness'],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'deepseek-protocol-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^react-dom\/client$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^deepseek-protocol-harness$/ }, () => ({
            path: 'harness',
            namespace: 'deepseek-protocol',
          }))
          builder.onLoad({ filter: /^harness$/, namespace: 'deepseek-protocol' }, () => ({
            contents: harness,
            loader: 'jsx',
            resolveDir: rendererRoot,
          }))
          builder.onResolve(
            { filter: /(?:desktop-client\/index\.js$|^deepseek-protocol-client$)/ },
            () => ({ path: 'client', namespace: 'deepseek-protocol' }),
          )
          builder.onLoad({ filter: /^client$/, namespace: 'deepseek-protocol' }, () => ({
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

  const protocols = page.locator('[aria-label="DeepSeek API 协议"] button')
  await expect(page.getByRole('dialog')).toContainText('编辑 DeepSeek')
  expect(await protocols.allTextContents()).toEqual([
    'Chat Completions',
    'Responses',
    'Anthropic Messages',
  ])
  await expect(protocols.nth(1)).toHaveAttribute('data-state', 'on')

  // 已保存的协议与对应 Endpoint 是当前选中项。
  const endpoint = page.locator('input[readonly]')
  await expect(endpoint).toHaveValue('https://api.deepseek.com')
  await expect(page.getByRole('dialog')).toContainText('Endpoint')

  await protocols.nth(2).click()
  await expect(endpoint).toHaveValue('https://api.deepseek.com/anthropic')

  // 模型徽标跟随全局协议，且不再提供逐模型协议下拉框。
  await page.getByRole('tab', { name: /模型管理/ }).click()
  const rows = page.locator(
    '.provider-editor-body .settings-management-dialog-card .settings-management-dialog-row',
  )
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('deepseek-v4-flash')
  await expect(rows.nth(0)).toContainText('anthropic-messages')
  await expect(rows.nth(1)).toContainText('deepseek-v4-pro')
  await expect(page.getByRole('dialog')).not.toContainText('模型 API 协议')
  await expect(page.getByRole('button', { name: '新增模型' })).toHaveCount(0)

  await page.getByRole('button', { name: '保存 Provider' }).click()
  await expect(page.locator('#saved')).toHaveText('deepseek')
  const saved = await page.evaluate(
    () => (window as never as { __savedProvider: unknown }).__savedProvider,
  )
  expect(saved).toEqual({
    providerId: 'deepseek',
    definition: {
      kind: 'builtin',
      id: 'deepseek',
      enabled: true,
      allowModels: ['deepseek-v4-pro'],
      denyModels: ['deepseek-v4-flash'],
      models: [],
      protocol: 'anthropic-messages',
    },
  })
  expect(errors).toEqual([])
  console.log('deepseek-protocol browser checks passed')
} finally {
  await browser.close()
}
