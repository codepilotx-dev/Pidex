import { rm } from 'node:fs/promises'

// Windows 上 SQLite、watcher 或目录句柄释放后可能短暂占用路径。
// 可恢复窗口按渐退累计最多约 20 秒：共享 runner 并发跑满、Defender 扫描刚写出的
// 大文件时，句柄释放远慢于本地，固定次数重试会让清理本身变成偶发失败。
const FIXTURE_REMOVE_BUDGET_MS = 20_000
const FIXTURE_REMOVE_DELAY_MS = 50
const FIXTURE_REMOVE_MAX_DELAY_MS = 500
const RETRYABLE_REMOVE_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY'])

/** 删除测试夹具路径；路径不存在视为成功，持续句柄占用必须成为真实失败。 */
export async function removeFixturePath(path: string): Promise<void> {
  const deadline = Date.now() + FIXTURE_REMOVE_BUDGET_MS
  let lastCause: unknown
  let delay = FIXTURE_REMOVE_DELAY_MS
  for (;;) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (cause) {
      if (
        !(cause instanceof Error) ||
        !('code' in cause) ||
        !RETRYABLE_REMOVE_CODES.has(String(cause.code))
      ) {
        throw cause
      }
      lastCause = cause
      if (Date.now() >= deadline) break
      // Windows 上 Bun sqlite 的 -wal/-shm 文件句柄要等对象被 GC 才释放；
      // 每次可恢复失败都强制一次完整 GC，让 finalizer 及时关闭句柄。
      Bun.gc(true)
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, FIXTURE_REMOVE_MAX_DELAY_MS)
    }
  }
  throw lastCause
}

/** 严格按顺序清理多个夹具路径，避免 Windows 上多个句柄同时争抢目录。 */
export async function removeFixturePaths(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    await removeFixturePath(path)
  }
}
