import { expect, test } from 'bun:test'

test('shared business stores isolate mounted field subscriptions and persist settings', async () => {
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dir}/SharedBusinessSubscription.browser.ts`],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
    expect(stdout).toContain('Shared business mounted subscriptions passed')
  } finally {
    child.kill()
  }
  // 预算覆盖 Bun.build 打包 + 冷启动 Chrome；共享 Windows runner 上分片并发时
  // 这两步都会明显变慢，因此留足余量而不是放宽断言。
}, 120_000)
