import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isRecord } from '@pidex/shared/guards'

export { isRecord }

export interface StateLogger {
  warn(event: string, fields?: Record<string, unknown>): void
}

export type DesktopWindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

export class DebouncedAtomicJsonWriter<T> {
  readonly #filePath: string
  readonly #delayMs: number
  readonly #logCategory: string
  readonly #logger?: StateLogger
  #pending?: T
  #timer?: ReturnType<typeof setTimeout>
  #queue: Promise<void> = Promise.resolve()

  constructor(filePath: string, delayMs = 250, logCategory = 'state', logger?: StateLogger) {
    this.#filePath = filePath
    this.#delayMs = delayMs
    this.#logCategory = logCategory
    this.#logger = logger
  }

  get filePath(): string {
    return this.#filePath
  }

  async load<R>(fallback: () => R, normalize: (parsed: unknown) => R): Promise<R> {
    try {
      const source = await readFile(this.#filePath, 'utf8')
      return normalize(JSON.parse(source))
    } catch (error) {
      if (!isMissingFileError(error)) {
        this.#logger?.warn(`${this.#logCategory}.load-failed`, { error })
      }
      return fallback()
    }
  }

  scheduleSave(state: T): void {
    this.#pending = state
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      this.#enqueue()
    }, this.#delayMs)
  }

  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = undefined
    }
    this.#enqueue()
    await this.#queue
  }

  #enqueue(): void {
    const state = this.#pending
    if (!state) return
    this.#pending = undefined
    const write = this.#queue.then(() => writeJsonAtomically(this.#filePath, state))
    this.#queue = write.catch((error) => {
      this.#logger?.warn(`${this.#logCategory}.save-failed`, { error })
    })
  }
}

export async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const directory = dirname(filePath)
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await replaceFileWithRetry(temporaryPath, filePath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

// Windows 上 rename 覆盖目标时，Defender、索引器或另一个写入方短暂持有句柄
// 会返回 EPERM/EACCES/EBUSY；这些是可恢复竞争，重试几次即可，不能直接失败。
const REPLACE_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const REPLACE_RETRY_ATTEMPTS = 20
const REPLACE_RETRY_DELAY_MS = 25

async function replaceFileWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target)
      return
    } catch (cause) {
      const code = isRecord(cause) ? cause.code : undefined
      if (
        attempt >= REPLACE_RETRY_ATTEMPTS ||
        typeof code !== 'string' ||
        !REPLACE_RETRY_CODES.has(code)
      ) {
        throw cause
      }
      await new Promise((resolve) => setTimeout(resolve, REPLACE_RETRY_DELAY_MS))
    }
  }
}

export function intersectionArea(left: DesktopWindowBounds, right: DesktopWindowBounds): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  )
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  )
  return width * height
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.round(Math.min(maximum, Math.max(minimum, value)))
}

export function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}
