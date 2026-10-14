// Run: bun apps/desktop/renderer/test/FloatingPortal.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const primitivesPath = JSON.stringify(
  resolve(rendererRoot, 'src/components/ui/floating/Primitives.tsx').replaceAll('\\', '/'),
)
const harness = `
import React, { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Portal, useTopLayer } from ${primitivesPath};
function Surface({ revision }) {
  const ref = useRef(null);
  const popover = useTopLayer(ref, true);
  return <div ref={ref} popover={popover} role="dialog" id="surface">
    <input id="field" /><span>{revision}</span>
  </div>;
}
const root = createRoot(document.getElementById('root'));
window.renderSurface = (revision, container = null, anchor = null) => flushSync(() => {
  root.render(<Portal container={container} anchor={anchor}><Surface revision={revision} /></Portal>);
});
window.unmountSurface = () => flushSync(() => root.render(null));
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['floating-portal-harness'],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{
      name: 'floating-portal-harness',
      setup(builder) {
        builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => ({
          path: Bun.resolveSync(args.path, rendererRoot), namespace: 'file',
        }))
        builder.onResolve({ filter: /^floating-portal-harness$/ }, () => ({
          path: 'harness', namespace: 'fixture',
        }))
        builder.onLoad({ filter: /^harness$/, namespace: 'fixture' }, () => ({
          contents: harness, loader: 'jsx', resolveDir: rendererRoot,
        }))
      },
    }],
  })
  assert.ok(build.success, build.logs.map(String).join('\n'))
  const child = Bun.spawn(['node', '--experimental-strip-types', fileURLToPath(import.meta.url)], {
    stdin: new Blob([await build.outputs[0]!.text()]), stdout: 'inherit', stderr: 'inherit',
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
  await page.setContent('<div id="root"></div><div role="dialog" id="modal"><button id="anchor">Anchor</button></div>')
  await page.addScriptTag({ content: script })
  const result = await page.evaluate(() => {
    const fixture = window as typeof window & {
      renderSurface: (revision: number, container?: HTMLElement | null, anchor?: HTMLElement | null) => void
      unmountSurface: () => void
    }
    fixture.renderSurface(0)
    document.getElementById('field')!.focus()
    fixture.renderSurface(1)
    const stableBodyHost = document.getElementById('surface')?.parentElement === document.body
    fixture.unmountSurface()
    const modal = document.getElementById('modal')!
    const anchor = document.getElementById('anchor')!
    fixture.renderSurface(2, null, anchor)
    const nestedModalHost = document.getElementById('surface')?.parentElement === modal
    const nativeTopLayer = document.getElementById('surface')?.matches(':popover-open')
    fixture.unmountSurface()
    return { stableBodyHost, nestedModalHost, nativeTopLayer, removed: !document.getElementById('surface') }
  })
  assert.deepEqual(result, { stableBodyHost: true, nestedModalHost: true, nativeTopLayer: true, removed: true })
  assert.deepEqual(errors, [])
  console.log('Floating Portal: stable host, nested modal top layer and cleanup passed')
} finally {
  await browser.close()
}
