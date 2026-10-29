import { expect, test } from 'bun:test'

test('closed popover and menu pruning eliminates list construction across pickers and command suggestions', async () => {
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dir}/ClosedMenuPruning.browser.ts`],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
  expect(stdout).toContain('ClosedMenuPruning regression passed')
}, 30_000)
