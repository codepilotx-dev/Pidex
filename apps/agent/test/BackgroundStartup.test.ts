import { expect, test } from 'bun:test'
import { mkdtemp, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { removeFixturePaths } from './FixtureCleanup'

test('后台实例端口已占用时在 bootstrap 前退出，不打开数据库或重复启动调度器', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-background-startup-'))
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(null) })
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '../src/index.ts')], {
    env: { ...process.env, PIDEX_BACKGROUND_AGENT: '1', PIDEX_DATA_DIR: root, PIDEX_PORT: String(server.port) },
    stdout: 'ignore', stderr: 'ignore',
  })
  try {
    const exitCode = await Promise.race([child.exited, Bun.sleep(15_000).then(() => null)])
    expect(exitCode).not.toBeNull()
    expect(exitCode).not.toBe(0)
    const files = await readdir(root, { recursive: true })
    expect(files.some((file) => /\.(sqlite|db)(-|$)/.test(file))).toBe(false)
  } finally {
    child.kill()
    await child.exited
    await server.stop(true)
    await removeFixturePaths([root])
  }
}, 20_000)
