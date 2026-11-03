// Run: bun apps/desktop/renderer/test/ModelControls.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelSelectTrigger } from ${JSON.stringify(resolve(root, 'src/features/session/composer/ModelSelectTrigger.tsx').replaceAll('\\', '/'))};
import { Popover } from ${JSON.stringify(resolve(root, 'src/components/ui/floating/Popover.tsx').replaceAll('\\', '/'))};
import { ApiKeyQuickAdd } from ${JSON.stringify(resolve(root, 'src/features/models/ApiKeyEditorDialog.tsx').replaceAll('\\', '/'))};
function Harness() {
  const [open, setOpen] = useState(false);
  const [changes, setChanges] = useState(0);
  const [keys, setKeys] = useState([]);
  return <>
    <Popover.Root open={open} onOpenChange={value => { setOpen(value); setChanges(n => n + 1); }}>
      <Popover.Trigger asChild><ModelSelectTrigger modelName="fixture/model" isOpen={open}
        showThinkingOptions thinkingLabel="默认" thinkingOptions={[{ value: 'high', label: '高' }]}
        onThinkingChange={() => {}} /></Popover.Trigger>
      <Popover.Portal><Popover.Content align="end"><input aria-label="搜索模型" /></Popover.Content></Popover.Portal>
    </Popover.Root>
    <output id="changes">{changes}</output>
    <ApiKeyQuickAdd busy={false} maskedValue="***old" onAdd={async key => {
      await new Promise(resolve => setTimeout(resolve, 30));
      if (key === 'reject') return false;
      setKeys(values => [...values, key]); return true;
    }} />
    <output id="keys">{JSON.stringify(keys)}</output>
  </>;
}
createRoot(document.getElementById('root')).render(<Harness />);
`
if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['model-controls-harness'],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: Bun.resolveSync(args.path, root),
          }))
          builder.onResolve({ filter: /^react-dom\/client$/ }, (args) => ({
            path: Bun.resolveSync(args.path, root),
          }))
          builder.onResolve({ filter: /^model-controls-harness$/ }, () => ({
            path: 'harness',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: source,
            loader: 'jsx',
            resolveDir: root,
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
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: script })
  const trigger = page.getByRole('button', {
    name: '模型与推理设置：fixture/model，默认',
    exact: true,
  })
  await trigger.evaluate((button: HTMLButtonElement) => button.click())
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const controls = await trigger.getAttribute('aria-controls')
  assert.ok(controls)
  await expect(page.getByRole('dialog')).toHaveAttribute('id', controls!)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.press('Enter')
  await expect(page.getByRole('textbox', { name: '搜索模型' })).toBeVisible()
  await page.keyboard.press('Escape')
  await trigger.press('Space')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(page.locator('#changes')).toHaveText('6')
  await page
    .getByRole('button', { name: '推理思考强度：默认', exact: true })
    .evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Escape')
  await expect(page.locator('#changes')).toHaveText('6')
  const input = page.getByLabel('新增 API 密钥')
  await input.fill('fixture-new-key')
  await expect(page.getByRole('button', { name: '添加', exact: true })).toHaveCount(0)
  await input.press('Tab')
  await expect(input).toHaveValue('')
  await expect(page.locator('#keys')).toHaveText('["fixture-new-key"]')
  await input.fill('fixture-second')
  await input.evaluate((element: HTMLInputElement) => {
    element.form!.requestSubmit()
    element.form!.requestSubmit()
  })
  await expect(input).toHaveValue('')
  await expect(page.locator('#keys')).toHaveText('["fixture-new-key","fixture-second"]')
  await input.fill('reject')
  await input.press('Tab')
  await expect(input).toBeEnabled()
  await expect(input).toHaveValue('reject')
  assert.deepEqual(errors, [])
  console.log(
    'PASS: semantic click, Enter/Space, expanded/controls, Escape focus return, quick Key add and failed save retention',
  )
} finally {
  await browser.close()
}
