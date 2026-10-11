import { rm } from 'node:fs/promises'

// Windows 上 SQLite、watcher 或目录句柄释放后可能短暂占用路径。
// 固定可恢复窗口：每 50ms 重试一次，最多 100 次（约 5 秒）。
const FIXTURE_REMOVE_ATTEMPTS = 100
const FIXTURE_REMOVE_DELAY_MS = 50
const RETRYABLE_REMOVE_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY'])

/** 删除测试夹具路径；路径不存在视为成功，持续句柄占用必须成为真实失败。 */
export async function removeFixturePath(path: string): Promise<void> {
  let lastCause: unknown
  for (let attempt = 0; attempt < FIXTURE_REMOVE_ATTEMPTS; attempt += 1) {
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
      // Windows 上 Bun sqlite 的 -wal/-shm 文件句柄要等对象被 GC 才释放；
      // 每次可恢复失败都强制一次完整 GC，让 finalizer 及时关闭句柄。
      Bun.gc(true)
      if (attempt < FIXTURE_REMOVE_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, FIXTURE_REMOVE_DELAY_MS))
      }
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
