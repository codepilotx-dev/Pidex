import { expect, test } from 'bun:test'

test('edit command actions consumers are isolated from typing and selection events', async () => {
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dir}/EditCommandIsolation.browser.ts`],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
  expect(stdout).toContain('EditCommandIsolation regression passed')
}, 30_000)
