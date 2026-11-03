import { expect } from 'bun:test'

/**
 * 运行一个浏览器回归脚本并等待其结束。
 *
 * 这些脚本要先 Bun.build 打包再冷启动 Chrome，共享 runner 上分片并发时耗时
 * 远高于本地；固定 30 秒预算会让它们偶发超时。断言保持不变，只是把预算
 * 统一放到这里，避免各包装文件各写一份。
 */
export async function runBrowserRegression(
  scriptPath: string,
  expectedOutput: string,
): Promise<void> {
  const child = Bun.spawn([process.execPath, scriptPath], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
    expect(stdout).toContain(expectedOutput)
  } finally {
    child.kill()
  }
}

/** 浏览器回归脚本共用的超时预算。 */
export const BROWSER_REGRESSION_TIMEOUT_MS = 120_000
