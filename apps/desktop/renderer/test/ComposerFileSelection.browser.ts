// Run: bun apps/desktop/renderer/test/ComposerFileSelection.browser.ts
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.versions.bun) {
  // Exercise the production handler, including its actual first await, with a real DOM FileList.
  const controller = readFileSync(
    resolve(root, 'src/features/session/composer/UseDesktopComposerController.ts'),
    'utf8',
  )
  const handler = controller.slice(
    controller.indexOf('  async function handleAddFiles('),
    controller.indexOf('  async function handleAddFilePaths('),
  )
  assert.ok(handler.includes('await import('))
  const selection = resolve(
    root,
    'src/features/session/composer/ComposerAttachmentSelection.ts',
  ).replaceAll('\\', '/')
  const source = `
    const draftKey = 'fixture';
    const attachmentGenerationRef = { current: new Map() };
    const nextAttachmentGeneration = () => 1;
    window.selected = [];
    window.granted = [];
    const desktopClient = {
      getComposerFilePath: file => '/fixture/' + file.name,
      grantComposerFilePaths: async paths => { window.granted.push(paths); return paths.map(path => ({path})); }
    };
    const appendAttachments = async (_key, items) => { window.selected.push(...items); };
    ${handler.replace("'./ComposerAttachmentSelection.js'", JSON.stringify(selection))}
    const input = document.querySelector('input');
    input.onchange = event => {
      window.pending = handleAddFiles(event.target.files);
      event.target.value = '';
      window.clearedLength = event.target.files.length;
    };
  `
  const build = await Bun.build({
    entrypoints: ['file-selection-harness'],
    target: 'browser',
    format: 'iife',
    plugins: [
      {
        name: 'fixture',
        setup(builder) {
          builder.onResolve({ filter: /^file-selection-harness$/ }, () => ({
            path: 'fixture',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: source,
            loader: 'ts',
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
  await page.setContent('<input type="file" multiple>')
  await page.addScriptTag({ content: script })
  const files = [
    { name: 'image-a.png', mimeType: 'image/png', buffer: Buffer.from('png-fixture') },
    { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('text-fixture') },
  ]
  for (const names of [['image-a.png', 'note.txt'], ['image-a.png'], ['note.txt']]) {
    await page.locator('input').setInputFiles(files.filter((file) => names.includes(file.name)))
    const result = await page.evaluate(async () => {
      const state = window as unknown as {
        pending: Promise<void>
        selected: { path: string }[]
        clearedLength: number
      }
      await state.pending
      const paths = state.selected.map((item) => item.path)
      state.selected = [] // Remove attachments before selecting the same file again.
      return { paths, clearedLength: state.clearedLength }
    })
    assert.equal(result.clearedLength, 0)
    assert.deepEqual(
      result.paths,
      names.map((name) => '/fixture/' + name),
    )
  }
  console.log('PASS: real input reset, PNG + text, remove and reselect same PNG/text')
} finally {
  await browser.close()
}
