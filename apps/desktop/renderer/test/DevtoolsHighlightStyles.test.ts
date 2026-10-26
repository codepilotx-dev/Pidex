import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { compile } = createRequire(require.resolve('@tailwindcss/vite'))('@tailwindcss/node') as {
  compile(
    css: string,
    options: { base: string; onDependency: () => void },
  ): Promise<{
    build(candidates: string[]): string
  }>
}

test('compiled selection highlight has no nested declarations that break Electron DevTools Styles', async () => {
  const source = readFileSync(resolve(root, 'src/styles/primitives/session.css'), 'utf8')
  const compiler = await compile(`@import "tailwindcss";\n${source}`, {
    base: root,
    onDependency() {},
  })
  const css = compiler.build([])
  expect(css).toContain('::highlight(conversation-action-selection)')
  // Chromium returns empty selector arrays for these nested highlight declarations.
  expect(css).not.toMatch(/::highlight\([^)]*\)\s*\{[^}]*@supports/)
  expect(css).toContain('32%')
})
