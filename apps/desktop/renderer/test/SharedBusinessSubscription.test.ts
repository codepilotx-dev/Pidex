import { expect, test } from 'bun:test'

test('shared business stores isolate mounted field subscriptions and persist settings', async () => {
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dir}/SharedBusinessSubscription.browser.ts`],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
  expect(stdout).toContain('Shared business mounted subscriptions passed')
}, 30_000)
