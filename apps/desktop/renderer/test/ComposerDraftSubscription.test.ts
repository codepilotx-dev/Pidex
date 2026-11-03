import { expect, test } from 'bun:test'

test('mounted Composer draft subscriptions settle and preserve edits and draft isolation', async () => {
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dir}/ComposerDraftSubscription.browser.ts`],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
  expect(stdout).toContain('Composer mounted regression passed')
}, 30_000)
