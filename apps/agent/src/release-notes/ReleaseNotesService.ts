import type { ReleaseNote, ReleaseNotesListResult } from '@pidex/agent-protocol'
import { AgentError } from '../Domain'
import { bundledReleaseNotes, DEFAULT_BUNDLED_CHANGELOG } from './BundledReleaseNotes'

const REPOSITORY = 'codepilotx-dev/Pidex' as const
const RELEASES_API_URL = `https://api.github.com/repos/${REPOSITORY}/releases`
const RELEASES_PAGE_SIZE = 100
const MAX_RELEASES = 500
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_RELEASE_BODY_LENGTH = 256 * 1024
const CACHE_TTL_MS = 15 * 60 * 1_000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/

type ReleaseNotesServiceOptions = {
  fetch?: typeof globalThis.fetch
  getAccessToken?: () => Promise<string | null>
  bundledChangelog?: string
  now?: () => number
  timeoutMs?: number
}

type CachedReleaseNotes = {
  expiresAt: number
  result: ReleaseNotesListResult
}

export class ReleaseNotesService {
  private readonly fetch: typeof globalThis.fetch
  private readonly getAccessToken: () => Promise<string | null>
  private readonly bundledChangelog: string
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly cache = new Map<string, CachedReleaseNotes>()
  private readonly refreshes = new Map<string, Promise<ReleaseNotesListResult>>()

  constructor(options: ReleaseNotesServiceOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.getAccessToken = options.getAccessToken ?? (async () => null)
    this.bundledChangelog = options.bundledChangelog ?? DEFAULT_BUNDLED_CHANGELOG
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async list(currentVersion: string, refresh = false): Promise<ReleaseNotesListResult> {
    if (!VERSION_PATTERN.test(currentVersion)) {
      throw new AgentError('RELEASE_NOTES_INVALID_RESPONSE', '当前应用版本格式无效', 400)
    }

    const cached = this.cache.get(currentVersion)
    if (!refresh && cached && this.now() < cached.expiresAt) {
      return cached.result
    }

    const active = this.refreshes.get(currentVersion)
    if (active) return active

    const request = this.download(currentVersion)
      .then((result) => {
        if (result.currentReleaseFound) return result
        return this.bundled(currentVersion) ?? result
      })
      .catch((cause: unknown) => {
        const fallback = isReleaseNotesFetchError(cause) ? this.bundled(currentVersion) : null
        if (fallback) return fallback
        throw cause
      })
      .then((result) => {
        this.cache.set(currentVersion, {
          expiresAt: this.now() + CACHE_TTL_MS,
          result,
        })
        return result
      })
      .finally(() => {
        this.refreshes.delete(currentVersion)
      })
    this.refreshes.set(currentVersion, request)
    return request
  }

  private async download(currentVersion: string): Promise<ReleaseNotesListResult> {
    const accessToken = await this.optionalAccessToken()
    const releases: ReleaseNote[] = []
    const seenTags = new Set<string>()
    let totalBytes = 0
    let rawReleaseCount = 0
    let truncated = false

    for (let page = 1; page <= MAX_RELEASES / RELEASES_PAGE_SIZE; page += 1) {
      const response = await this.fetchPage(page, accessToken)
      const bytes = await readLimitedBody(response, MAX_RESPONSE_BYTES - totalBytes)
      totalBytes += bytes.byteLength
      const values = parseReleasePage(bytes)
      if (values.length > RELEASES_PAGE_SIZE) {
        throw invalidResponse('GitHub Releases 单页条目过多')
      }

      rawReleaseCount += values.length
      for (const value of values) {
        const release = normalizeRelease(value)
        if (!release) continue
        if (seenTags.has(release.tagName)) {
          throw invalidResponse('GitHub Releases 包含重复标签')
        }
        seenTags.add(release.tagName)
        releases.push(release)
      }

      if (values.length < RELEASES_PAGE_SIZE) break
      if (rawReleaseCount >= MAX_RELEASES) {
        truncated = true
        break
      }
    }

    const currentTag = `v${currentVersion}`
    const currentIndex = releases.findIndex((release) => release.tagName === currentTag)
    return {
      source: 'github-releases',
      repository: REPOSITORY,
      currentVersion,
      currentReleaseFound: currentIndex >= 0,
      fetchedAt: new Date(this.now()).toISOString(),
      truncated,
      releases: currentIndex >= 0 ? releases.slice(currentIndex) : [],
    }
  }

  private bundled(currentVersion: string): ReleaseNotesListResult | null {
    return bundledReleaseNotes(this.bundledChangelog, currentVersion, this.now())
  }

  private async optionalAccessToken(): Promise<string | null> {
    try {
      const token = await this.getAccessToken()
      return token?.trim() || null
    } catch {
      return null
    }
  }

  private async fetchPage(page: number, accessToken: string | null): Promise<Response> {
    const url = new URL(RELEASES_API_URL)
    url.searchParams.set('per_page', String(RELEASES_PAGE_SIZE))
    url.searchParams.set('page', String(page))
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'api.github.com' ||
      url.pathname !== `/repos/${REPOSITORY}/releases`
    ) {
      throw new AgentError('RELEASE_NOTES_UNAVAILABLE', 'GitHub Releases 地址无效', 502)
    }

    let response = await this.requestPage(url, accessToken)
    if (accessToken && response.status === 401) {
      response = await this.requestPage(url, null)
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      throw new AgentError('RELEASE_NOTES_UNAVAILABLE', 'GitHub Releases 请求不允许重定向', 502)
    }
    if (response.status === 404) {
      throw new AgentError('RELEASE_NOTES_NOT_PUBLIC', '更新日志仓库尚未公开', 404)
    }
    if (
      response.status === 429 ||
      (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
    ) {
      throw new AgentError(
        'RELEASE_NOTES_RATE_LIMITED',
        'GitHub 请求已达到频率限制，请稍后重试',
        429,
      )
    }
    if (!response.ok) {
      throw new AgentError('RELEASE_NOTES_UNAVAILABLE', 'GitHub 更新日志暂时不可用', 502)
    }
    return response
  }

  private async requestPage(url: URL, accessToken: string | null): Promise<Response> {
    try {
      return await this.fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Pidex',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new AgentError('RELEASE_NOTES_UNAVAILABLE', '暂时无法连接 GitHub 获取更新日志', 502)
    }
  }
}

function parseReleasePage(bytes: Uint8Array): unknown[] {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw invalidResponse('GitHub Releases 返回的内容不是有效 JSON')
  }
  if (!Array.isArray(value)) {
    throw invalidResponse('GitHub Releases 返回格式无效')
  }
  return value
}

function normalizeRelease(value: unknown): ReleaseNote | null {
  const release = record(value)
  if (release.draft === true) return null
  if (release.draft !== false || typeof release.prerelease !== 'boolean') {
    throw invalidResponse('GitHub Release 状态无效')
  }

  const tagName = requiredString(release.tag_name, 200)
  const body =
    release.body === null ? '' : requiredString(release.body, MAX_RELEASE_BODY_LENGTH, true)
  const name = release.name === null ? tagName : requiredString(release.name, 500)
  const htmlUrl = normalizeHtmlUrl(release.html_url)
  const publishedAt = normalizePublishedAt(release.published_at)
  return {
    tagName,
    name,
    body,
    htmlUrl,
    publishedAt,
    prerelease: release.prerelease,
  }
}

function normalizeHtmlUrl(value: unknown): string {
  const raw = requiredString(value, 2_048)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw invalidResponse('GitHub Release 链接无效')
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    !url.pathname.startsWith(`/${REPOSITORY}/releases/`)
  ) {
    throw invalidResponse('GitHub Release 链接无效')
  }
  return url.toString()
}

function normalizePublishedAt(value: unknown): string | null {
  if (value === null) return null
  const publishedAt = requiredString(value, 100)
  if (!Number.isFinite(Date.parse(publishedAt))) {
    throw invalidResponse('GitHub Release 发布时间无效')
  }
  return publishedAt
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponse('GitHub Release 条目格式无效')
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw invalidResponse('GitHub Release 文本字段无效')
  }
  const normalized = value.trim()
  if (!allowEmpty && !normalized) {
    throw invalidResponse('GitHub Release 文本字段无效')
  }
  return allowEmpty ? value : normalized
}

async function readLimitedBody(response: Response, limit: number): Promise<Uint8Array> {
  if (limit <= 0) {
    throw invalidResponse('GitHub Releases 响应超过大小限制')
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw invalidResponse('GitHub Releases 响应超过大小限制')
  }

  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw invalidResponse('GitHub Releases 响应超过大小限制')
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function invalidResponse(message: string): AgentError {
  return new AgentError('RELEASE_NOTES_INVALID_RESPONSE', message, 502)
}

function isReleaseNotesFetchError(cause: unknown): cause is AgentError {
  return (
    cause instanceof AgentError &&
    (cause.code === 'RELEASE_NOTES_NOT_PUBLIC' ||
      cause.code === 'RELEASE_NOTES_UNAVAILABLE' ||
      cause.code === 'RELEASE_NOTES_RATE_LIMITED' ||
      cause.code === 'RELEASE_NOTES_INVALID_RESPONSE')
  )
}
