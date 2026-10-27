import { expect, test } from 'bun:test'

test('creation events and RPC completion keep one mounted row per session', async () => {
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dir}/SessionModelSubmission.browser.ts`],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
  expect(stdout).toContain('creation event/list reconciliation passed')
}, 30_000)
