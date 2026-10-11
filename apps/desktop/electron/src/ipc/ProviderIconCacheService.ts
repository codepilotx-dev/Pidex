import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type {
  DesktopProviderIconChange,
  DesktopProviderIconResolution,
} from '@pidex/shared/desktop-provider-icon-ipc'
import { isRecord } from '@pidex/shared/guards'
import { writeJsonAtomically } from '../windows/DebouncedAtomicJsonWriter.js'

/**
 * 供应商图标本地缓存：命中即立即显示，只有距最近一次成功更新满 5 小时才在后台
 * 重新下载。刷新失败保留旧内容与旧的更新时间，因此离线或上游故障时仍显示
 * 可用图标，而不是退回占位图。
 */
export const PROVIDER_ICON_CACHE_TTL_MS = 5 * 60 * 60 * 1000
/** 运行期间检查到期图标的间隔；只覆盖本次运行已加载过的图标。 */
export const PROVIDER_ICON_EXPIRY_SWEEP_INTERVAL_MS = 5 * 60 * 1000

const ICON_RECORD_VERSION = 1
const MAX_ICON_BYTES = 512 * 1024
const MAX_ICON_BASE64_LENGTH = Math.ceil(MAX_ICON_BYTES / 3) * 4
const MAX_ICON_URL_LENGTH = 2048
const DOWNLOAD_TIMEOUT_MS = 10_000
const ALLOWED_ICON_HOST = 'models.dev'
const ALLOWED_ICON_MEDIA_TYPES = new Set([
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])
const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

type ProviderIconRecord = {
  version: number
  url: string
  mediaType: string
  updatedAt: number
  data: string
}

type CachedProviderIcon = {
  url: string
  updatedAt: number
  source: string
}

export type ProviderIconCacheLogger = {
  warn(event: string, fields?: Record<string, unknown>): void
}

export type ProviderIconCacheDependencies = {
  /** 独立图标缓存目录，位于宿主应用数据目录下。 */
  rootDirectory: string
  publish: (change: DesktopProviderIconChange) => void
  fetch?: typeof fetch
  now?: () => number
  logger?: ProviderIconCacheLogger
}

export class ProviderIconCacheService {
  readonly #rootDirectory: string
  readonly #publish: (change: DesktopProviderIconChange) => void
  readonly #fetch: typeof fetch
  readonly #now: () => number
  readonly #logger: ProviderIconCacheLogger | undefined
  readonly #memory = new Map<string, CachedProviderIcon>()
  readonly #usedURLs = new Set<string>()
  readonly #inFlight = new Map<string, Promise<CachedProviderIcon | null>>()
  readonly #failedAt = new Map<string, number>()
  #timer: ReturnType<typeof setInterval> | undefined

  constructor(dependencies: ProviderIconCacheDependencies) {
    this.#rootDirectory = dependencies.rootDirectory
    this.#publish = dependencies.publish
    this.#fetch = dependencies.fetch ?? globalThis.fetch
    this.#now = dependencies.now ?? Date.now
    this.#logger = dependencies.logger
  }

  /**
   * 返回可显示的本地图标地址。已有缓存时立即返回旧内容，到期只在后台刷新；
   * 首次加载且尚无缓存时等待下载结果，失败返回 `null` 由客户端保留占位图标。
   */
  async resolve(input: unknown): Promise<DesktopProviderIconResolution> {
    const url = requireProviderIconURL(input)
    this.#usedURLs.add(url)

    const cached = this.#memory.get(url) ?? (await this.#readRecord(url))
    if (!cached) {
      if (!this.#canAttempt(url)) return { source: null }
      const downloaded = await this.#download(url, false)
      return { source: downloaded?.source ?? null }
    }

    this.#memory.set(url, cached)
    if (this.#isExpired(cached) && this.#canAttempt(url)) void this.#download(url, true)
    return { source: cached.source }
  }

  startExpirySweep(): void {
    if (this.#timer) return
    this.#timer = setInterval(() => this.#sweepExpired(), PROVIDER_ICON_EXPIRY_SWEEP_INTERVAL_MS)
    this.#timer.unref()
  }

  dispose(): void {
    if (!this.#timer) return
    clearInterval(this.#timer)
    this.#timer = undefined
  }

  #sweepExpired(): void {
    for (const url of this.#usedURLs) {
      const cached = this.#memory.get(url)
      if (!cached || !this.#isExpired(cached) || !this.#canAttempt(url)) continue
      void this.#download(url, true)
    }
  }

  #isExpired(icon: CachedProviderIcon): boolean {
    return this.#now() - icon.updatedAt >= PROVIDER_ICON_CACHE_TTL_MS
  }

  /** 失败后同样等待一个完整周期再重试，避免反复打开页面触发密集请求。 */
  #canAttempt(url: string): boolean {
    return this.#now() - (this.#failedAt.get(url) ?? 0) >= PROVIDER_ICON_CACHE_TTL_MS
  }

  #download(url: string, notify: boolean): Promise<CachedProviderIcon | null> {
    const pending = this.#inFlight.get(url)
    if (pending) return pending

    let request: Promise<CachedProviderIcon | null>
    request = this.#performDownload(url)
      .then((icon) => {
        this.#failedAt.delete(url)
        this.#memory.set(url, icon)
        if (notify) this.#publish({ url, source: icon.source })
        return icon
      })
      .catch((error: unknown) => {
        this.#failedAt.set(url, this.#now())
        this.#logger?.warn('provider-icon.download-failed', { url, error })
        return null
      })
      .finally(() => {
        if (this.#inFlight.get(url) === request) this.#inFlight.delete(url)
      })
    this.#inFlight.set(url, request)
    return request
  }

  async #performDownload(url: string): Promise<CachedProviderIcon> {
    const response = await this.#fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { accept: 'image/svg+xml,image/*;q=0.8' },
    })
    if (!response.ok) throw new Error(`供应商图标下载失败：${response.status}`)

    const mediaType = resolveIconMediaType(response.headers.get('content-type'), url)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ICON_BYTES) {
      throw new Error('供应商图标内容无效')
    }

    const updatedAt = this.#now()
    const data = bytes.toString('base64')
    try {
      await writeJsonAtomically(this.#recordPath(url), {
        version: ICON_RECORD_VERSION,
        url,
        mediaType,
        updatedAt,
        data,
      } satisfies ProviderIconRecord)
    } catch (error) {
      // 落盘失败不阻断本次显示，仅当前运行内存缓存可用。
      this.#logger?.warn('provider-icon.persist-failed', { url, error })
    }
    return { url, updatedAt, source: `data:${mediaType};base64,${data}` }
  }

  async #readRecord(url: string): Promise<CachedProviderIcon | null> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.#recordPath(url), 'utf8'))
    } catch {
      return null
    }
    if (!isRecord(parsed)) return null
    if (parsed.version !== ICON_RECORD_VERSION || parsed.url !== url) return null
    if (typeof parsed.mediaType !== 'string' || !ALLOWED_ICON_MEDIA_TYPES.has(parsed.mediaType)) {
      return null
    }
    if (typeof parsed.updatedAt !== 'number' || !Number.isFinite(parsed.updatedAt)) return null
    if (
      typeof parsed.data !== 'string' ||
      parsed.data.length === 0 ||
      parsed.data.length > MAX_ICON_BASE64_LENGTH
    ) {
      return null
    }
    return {
      url,
      updatedAt: parsed.updatedAt,
      source: `data:${parsed.mediaType};base64,${parsed.data}`,
    }
  }

  #recordPath(url: string): string {
    return join(this.#rootDirectory, `${createHash('sha256').update(url).digest('hex')}.json`)
  }
}

/** 只接受 models.dev 的绝对 https 图标地址；地址原样保留作为缓存键。 */
export function requireProviderIconURL(input: unknown): string {
  if (!isRecord(input) || typeof input.url !== 'string') throw new Error('供应商图标地址无效')
  const raw = input.url
  if (raw.length === 0 || raw.length > MAX_ICON_URL_LENGTH) throw new Error('供应商图标地址无效')
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('供应商图标地址无效')
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== ALLOWED_ICON_HOST) {
    throw new Error('供应商图标地址无效')
  }
  return raw
}

export function resolveIconMediaType(contentType: string | null, url: string): string {
  const declared = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (ALLOWED_ICON_MEDIA_TYPES.has(declared)) return declared
  const byExtension = MEDIA_TYPE_BY_EXTENSION[extname(new URL(url).pathname).toLowerCase()]
  if (byExtension) return byExtension
  throw new Error('供应商图标类型不受支持')
}
