import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { waitForPlaywright } from '../scripts/RunPlaywright'
import { killProcessTree } from '../../../../scripts/IntegrationTestRunner'

const runner = fileURLToPath(new URL('../scripts/RunPlaywright.ts', import.meta.url))

test('Playwright runner preserves success and failure exit codes and rejects startup errors', async () => {
  for (const code of [0, 7]) {
    expect(
      await waitForPlaywright(
        spawn(process.execPath, ['-e', `process.exit(${code})`], {
          stdio: 'ignore',
          windowsHide: true,
        }),
      ),
    ).toBe(code)
  }
  await expect(
    waitForPlaywright(
      spawn(process.execPath, [], {
        cwd: `${runner}/missing-directory`,
        stdio: 'ignore',
        windowsHide: true,
      }),
    ),
  ).rejects.toThrow()
}, 30_000)

test('Playwright runner forwards grep and worker arguments without opening a browser', async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      runner,
      'playwright.config.ts',
      '--list',
      '--grep',
      '^this-test-does-not-exist-cpx-workflow$',
      '--workers=1',
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const output = await new Response(child.stdout).text()
  await new Response(child.stderr).text()
  expect(await child.exited).toBe(1)
  expect(output).toContain('Total: 0 tests')
}, 30_000)

test('forwarded options cannot override the configuration whitelist', async () => {
  for (const option of ['--config=outside.ts', '-coutside.ts']) {
    const child = Bun.spawn([process.execPath, runner, 'playwright.config.ts', option], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const error = await new Response(child.stderr).text()
    expect(await child.exited).toBe(1)
    expect(error).toContain('不可重复指定 --config/-c')
  }
}, 30_000)

for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  test(`Playwright runner handles ${signal} and removes its listeners`, async () => {
    const before = process.listenerCount(signal)
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
      const { spawn } = require('node:child_process');
      const descendant = spawn(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000)']);
      descendant.stdout.once('data', () => console.log(descendant.pid));
      process.on('SIGTERM', () => descendant.kill());
    `,
      ],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      },
    )
    const completion = waitForPlaywright(child)
    try {
      const descendantPid = await new Promise<number>((resolve, reject) => {
        child.stdout!.once('data', (data: Buffer) => resolve(Number(data.toString().trim())))
        child.once('error', reject)
      })
      // Windows process.kill is a force termination; emit exercises the catchable handler.
      process.emit(signal)
      process.emit(signal)
      expect(await completion).toBe(code)
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
      expect(() => process.kill(descendantPid, 0)).toThrow()
      expect(process.listenerCount(signal)).toBe(before)
    } finally {
      killProcessTree(child)
      await completion
    }
  }, 30_000)
}
