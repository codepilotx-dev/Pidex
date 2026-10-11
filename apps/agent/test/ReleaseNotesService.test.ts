import { describe, expect, test } from 'bun:test'
import { bundledReleaseNotes } from '../src/release-notes/BundledReleaseNotes'
import { ReleaseNotesService } from '../src/release-notes/ReleaseNotesService'

const publishedAt = '2026-07-27T00:00:00.000Z'
const bundledChangelog = `# Changelog

## Unreleased

### Added

- [desktop] 尚未发布

## 0.2.0-beta.1 — 2026-07-27

### Added

- [desktop] 内置当前版本记录

## 0.1.0 — 2026-06-01

### Fixed

- [desktop] 更早版本记录
`

const release = (tagName: string, overrides: Record<string, unknown> = {}) => ({
  tag_name: tagName,
  name: `Release ${tagName}`,
  body: `Notes for ${tagName}`,
  html_url: `https://github.com/codepilotx-dev/Pidex/releases/tag/${tagName}`,
  published_at: publishedAt,
  draft: false,
  prerelease: tagName.includes('-'),
  ...overrides,
})

const jsonResponse = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  })

describe('ReleaseNotesService', () => {
  test('从内置 CHANGELOG 精确生成当前版本记录', () => {
    const result = bundledReleaseNotes(bundledChangelog, '0.2.0-beta.1', Date.parse(publishedAt))

    expect(result).toMatchObject({
      source: 'bundled-changelog',
      currentVersion: '0.2.0-beta.1',
      currentReleaseFound: true,
      truncated: false,
      releases: [
        {
          tagName: 'v0.2.0-beta.1',
          name: 'Pidex 0.2.0-beta.1',
          publishedAt,
          prerelease: true,
        },
      ],
    })
    expect(result?.releases[0]?.body).toContain('内置当前版本记录')
    expect(result?.releases[0]?.body).not.toContain('尚未发布')
    expect(result?.releases[0]?.body).not.toContain('更早版本记录')
    expect(result?.releases[0]?.htmlUrl).toBe(
      'https://github.com/codepilotx-dev/Pidex/releases/tag/v0.2.0-beta.1',
    )
    expect(bundledReleaseNotes(bundledChangelog, '9.9.9', Date.parse(publishedAt))).toBeNull()
  })

  test('匿名分页读取 Release，并从当前版本开始返回历史记录', async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = []
    const firstPage = [
      release('v0.3.0'),
      release('v0.2.1', { draft: true }),
      release('v0.2.0-beta.1'),
      ...Array.from({ length: 97 }, (_, index) => release(`v0.1.${100 - index}`)),
    ]
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      requests.push({ url, ...(init ? { init } : {}) })
      return Number(url.searchParams.get('page')) === 1
        ? jsonResponse(firstPage)
        : jsonResponse([release('v0.1.0')])
    }) as unknown as typeof globalThis.fetch
    const service = new ReleaseNotesService({
      fetch,
      now: () => Date.parse(publishedAt),
    })

    const result = await service.list('0.2.0-beta.1')

    expect(requests).toHaveLength(2)
    expect(requests[0]!.url.toString()).toBe(
      'https://api.github.com/repos/codepilotx-dev/Pidex/releases?per_page=100&page=1',
    )
    const headers = new Headers(requests[0]!.init?.headers)
    expect(headers.get('accept')).toBe('application/vnd.github+json')
    expect(headers.get('x-github-api-version')).toBe('2022-11-28')
    expect(headers.get('user-agent')).toBe('Pidex')
    expect(headers.has('authorization')).toBe(false)
    expect(requests[0]!.init?.redirect).toBe('manual')
    expect(result).toMatchObject({
      source: 'github-releases',
      repository: 'codepilotx-dev/Pidex',
      currentVersion: '0.2.0-beta.1',
      currentReleaseFound: true,
      fetchedAt: publishedAt,
      truncated: false,
    })
    expect(result.releases[0]).toMatchObject({
      tagName: 'v0.2.0-beta.1',
      prerelease: true,
    })
    expect(result.releases.at(-1)?.tagName).toBe('v0.1.0')
    expect(result.releases.some((item) => item.tagName === 'v0.3.0')).toBe(false)
    expect(result.releases.some((item) => item.tagName === 'v0.2.1')).toBe(false)
  })

  test('在线结果缺少当前标签时只回退到内置当前版本', async () => {
    const service = new ReleaseNotesService({
      fetch: (async () =>
        jsonResponse([release('v0.3.0'), release('v0.1.0')])) as unknown as typeof globalThis.fetch,
      bundledChangelog,
    })

    const result = await service.list('0.2.0-beta.1')

    expect(result.source).toBe('bundled-changelog')
    expect(result.releases.map((item) => item.tagName)).toEqual(['v0.2.0-beta.1'])
  })

  test('内置记录缺失时保留在线当前标签缺失状态', async () => {
    const service = new ReleaseNotesService({
      fetch: (async () =>
        jsonResponse([release('v0.3.0'), release('v0.1.0')])) as unknown as typeof globalThis.fetch,
      bundledChangelog,
    })

    const result = await service.list('0.2.0')

    expect(result.currentReleaseFound).toBe(false)
    expect(result.releases).toEqual([])
  })

  test('使用十五分钟内存缓存，refresh 和过期会重新请求', async () => {
    let now = Date.parse(publishedAt)
    let calls = 0
    const service = new ReleaseNotesService({
      now: () => now,
      fetch: (async () => {
        calls += 1
        return jsonResponse([release('v0.2.0-beta.1')])
      }) as unknown as typeof globalThis.fetch,
    })

    await service.list('0.2.0-beta.1')
    await service.list('0.2.0-beta.1')
    expect(calls).toBe(1)
    await service.list('0.2.0-beta.1', true)
    expect(calls).toBe(2)
    await service.list('0.2.0-beta.1')
    expect(calls).toBe(2)

    now += 15 * 60 * 1_000
    await service.list('0.2.0-beta.1')
    expect(calls).toBe(3)
  })

  test('同一版本的并发刷新复用正在执行的请求', async () => {
    let calls = 0
    let resolveResponse!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const service = new ReleaseNotesService({
      fetch: (async () => {
        calls += 1
        return pending
      }) as unknown as typeof globalThis.fetch,
    })

    const first = service.list('0.2.0-beta.1', true)
    const second = service.list('0.2.0-beta.1', true)
    resolveResponse(jsonResponse([release('v0.2.0-beta.1')]))

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(calls).toBe(1)
    expect(secondResult).toBe(firstResult)
  })

  test('优先使用 OAuth token，且 token 不进入返回结果', async () => {
    const requests: RequestInit[] = []
    const accessToken = 'gho_release_notes_secret'
    const service = new ReleaseNotesService({
      getAccessToken: async () => accessToken,
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        requests.push(init ?? {})
        return jsonResponse([release('v0.2.0-beta.1')])
      }) as unknown as typeof globalThis.fetch,
    })

    const result = await service.list('0.2.0-beta.1')

    expect(requests).toHaveLength(1)
    expect(new Headers(requests[0]?.headers).get('authorization')).toBe(`Bearer ${accessToken}`)
    expect(JSON.stringify(result)).not.toContain(accessToken)
  })

  test('OAuth token 返回 401 时仅匿名重试一次', async () => {
    const authorizationHeaders: Array<string | null> = []
    const service = new ReleaseNotesService({
      getAccessToken: async () => 'expired-token',
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get('authorization')
        authorizationHeaders.push(authorization)
        return authorization
          ? new Response(null, { status: 401 })
          : jsonResponse([release('v0.2.0-beta.1')])
      }) as unknown as typeof globalThis.fetch,
    })

    const result = await service.list('0.2.0-beta.1')

    expect(authorizationHeaders).toEqual(['Bearer expired-token', null])
    expect(result.source).toBe('github-releases')
  })

  test('达到五百条分页上限时标记结果已截断', async () => {
    const fetch = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      const page = Number(url.searchParams.get('page'))
      return jsonResponse(
        Array.from({ length: 100 }, (_, index) =>
          release(page === 1 && index === 0 ? 'v0.2.0' : `v0.${6 - page}.${100 - index}`),
        ),
      )
    }) as unknown as typeof globalThis.fetch
    const service = new ReleaseNotesService({ fetch })

    const result = await service.list('0.2.0')

    expect(result.truncated).toBe(true)
    expect(result.releases).toHaveLength(500)
  })

  test('将私有仓库、限流、网络故障和超时映射为安全错误', async () => {
    const cases = [
      {
        fetch: async () => new Response(null, { status: 404 }),
        code: 'RELEASE_NOTES_NOT_PUBLIC',
      },
      {
        fetch: async () =>
          new Response(null, {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0' },
          }),
        code: 'RELEASE_NOTES_RATE_LIMITED',
      },
      {
        fetch: async () => new Response(null, { status: 500 }),
        code: 'RELEASE_NOTES_UNAVAILABLE',
      },
      {
        fetch: async () => {
          throw new Error('private network detail')
        },
        code: 'RELEASE_NOTES_UNAVAILABLE',
      },
    ] as const

    for (const item of cases) {
      const service = new ReleaseNotesService({
        fetch: item.fetch as unknown as typeof globalThis.fetch,
      })
      await expect(service.list('0.2.0')).rejects.toMatchObject({
        code: item.code,
      })
    }

    const timeoutService = new ReleaseNotesService({
      timeoutMs: 1,
      fetch: (async (
        _input: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1],
      ) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        throw new DOMException('request aborted', 'AbortError')
      }) as unknown as typeof globalThis.fetch,
    })
    await expect(timeoutService.list('0.2.0')).rejects.toMatchObject({
      code: 'RELEASE_NOTES_UNAVAILABLE',
    })
  })

  test('声明的在线错误回退到内置记录并缓存，refresh 可恢复历史版本', async () => {
    let calls = 0
    const service = new ReleaseNotesService({
      bundledChangelog,
      fetch: (async () => {
        calls += 1
        if (calls === 1) {
          return new Response(null, {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0' },
          })
        }
        return jsonResponse([release('v0.2.0-beta.1'), release('v0.1.0')])
      }) as unknown as typeof globalThis.fetch,
    })

    const fallback = await service.list('0.2.0-beta.1')
    const cached = await service.list('0.2.0-beta.1')
    const refreshed = await service.list('0.2.0-beta.1', true)

    expect(fallback.source).toBe('bundled-changelog')
    expect(cached).toBe(fallback)
    expect(refreshed.source).toBe('github-releases')
    expect(refreshed.releases).toHaveLength(2)
    expect(calls).toBe(2)
  })

  test('限流、网络和无效响应均回退到内置当前版本', async () => {
    const failures = [
      async () =>
        new Response(null, {
          status: 429,
        }),
      async () => {
        throw new Error('private network detail')
      },
      async () => new Response('{'),
    ]

    for (const fetch of failures) {
      const service = new ReleaseNotesService({
        bundledChangelog,
        fetch: fetch as unknown as typeof globalThis.fetch,
      })
      const result = await service.list('0.2.0-beta.1')
      expect(result.source).toBe('bundled-changelog')
      expect(result.releases.map((item) => item.tagName)).toEqual(['v0.2.0-beta.1'])
    }
  })

  test('拒绝重定向、无效 JSON、异常字段和超大响应', async () => {
    const cases = [
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/releases' },
        }),
      async () => new Response('{'),
      async () => jsonResponse({ releases: [] }),
      async () =>
        jsonResponse([
          release('v0.2.0', {
            body: 'x'.repeat(256 * 1024 + 1),
          }),
        ]),
      async () =>
        new Response('[]', {
          headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
        }),
    ]

    for (const fetch of cases) {
      const service = new ReleaseNotesService({
        fetch: fetch as unknown as typeof globalThis.fetch,
      })
      await expect(service.list('0.2.0')).rejects.toMatchObject({
        code: expect.stringMatching(/^RELEASE_NOTES_(?:UNAVAILABLE|INVALID_RESPONSE)$/),
      })
    }
  })
})
