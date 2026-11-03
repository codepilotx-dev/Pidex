import { expect, test } from 'bun:test'

test('direct pet settings entry loads the shared catalog once', async () => {
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dir}/PetSettingsSubscription.browser.ts`],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
  expect(stdout).toContain('Pet settings mounted regression passed')
}, 30_000)
