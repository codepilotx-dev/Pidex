import { expect, test } from 'bun:test'

test('session input updates isolate from DesktopLayout, sidebar, and context menus across routes', async () => {
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dir}/SessionInputIsolation.browser.ts`],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
  expect(stdout).toContain('SessionInputIsolation regression passed')
}, 30_000)
