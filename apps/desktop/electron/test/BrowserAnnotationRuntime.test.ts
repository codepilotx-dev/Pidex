import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Playwright process pipes use Node on Windows; Bun owns the test result and cleanup.
test('真实 DOM：重新命中、iframe、Shadow DOM、Range、区域、多选、脱敏与隔离', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cpx-annotation-test-'))
  try {
    const built = await Bun.build({
      entrypoints: [join(import.meta.dir, 'BrowserAnnotationRuntime.fixture.ts')],
      target: 'node',
      format: 'esm',
      external: ['playwright-core'],
    })
    if (!built.success) throw new Error(String(built.logs))
    const path = join(root, 'fixture.mjs')
    const source = (await built.outputs[0]!.text()).replace(
      /(['"])playwright-core\1/g,
      JSON.stringify(
        pathToFileURL(require.resolve('playwright-core').replace(/index\.js$/, 'index.mjs')).href,
      ),
    )
    await Bun.write(path, source)
    const child = Bun.spawn(['node', path], { stdout: 'pipe', stderr: 'pipe' })
    const [code, output, errors] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (code !== 0) throw new Error(output + errors)
    expect(output).toContain('# pass 2')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60000)
