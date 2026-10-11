import { expect, test } from 'bun:test'
import type { DesktopGithubProfileOverviewResult } from '../shared/Types.js'
import { createBrowserMockDesktopClient } from '../src/services/desktop-client/BrowserMockClient.js'
import { mockGithubLogin } from '../src/services/desktop-client/Fixtures.js'
import { createGithubAccountCache } from '../src/services/desktop-client/GithubAccountCache.js'

const user = {
  id: 1,
  login: 'octocat',
  name: 'Octocat',
  avatarUrl: null,
  htmlUrl: 'https://github.com/octocat',
}
const auth = { configured: true, authenticated: true, user }
const profile: DesktopGithubProfileOverviewResult = {
  ok: true,
  overview: {
    user: {
      ...user,
      bio: null,
      company: null,
      location: null,
      websiteUrl: null,
      email: null,
      followers: 0,
      following: 0,
      repositoryCount: 0,
      starredRepositoryCount: 0,
      status: null,
    },
    organizations: [],
    pinnedRepositories: [],
    popularRepositories: [],
    contributions: {
      totalContributions: 0,
      totalCommitContributions: 0,
      totalIssueContributions: 0,
      totalPullRequestContributions: 0,
      totalPullRequestReviewContributions: 0,
      restrictedContributionsCount: 0,
      weeks: [],
    },
  },
}

test('GitHub cache reuses fresh reads, merges requests, expires, forces refresh and preserves data on failure', async () => {
  let now = 0
  let authCalls = 0
  let profileCalls = 0
  let result = profile
  const cache = createGithubAccountCache(
    {
      ...createBrowserMockDesktopClient(undefined),
      getGithubAuthStatus: async () => {
        authCalls += 1
        return auth
      },
      getGithubProfileOverview: async () => {
        profileCalls += 1
        return result
      },
    },
    () => now,
  )
  const unsubscribe = cache.onGithubAccountChange(() => {
    notifications += 1
  })
  let notifications = 0

  await Promise.all([cache.getGithubAuthStatus(), cache.getGithubAuthStatus()])
  await Promise.all([cache.getGithubProfileOverview(), cache.getGithubProfileOverview()])
  const snapshot = cache.getGithubAccountSnapshot()
  await cache.getGithubAuthStatus()
  await cache.getGithubProfileOverview()
  expect([authCalls, profileCalls]).toEqual([1, 1])
  expect(cache.getGithubAccountSnapshot()).toBe(snapshot)
  expect(snapshot).toEqual({ auth, overview: profile.overview })

  now = 5 * 60 * 1000
  await cache.getGithubAuthStatus()
  await cache.getGithubProfileOverview()
  expect([authCalls, profileCalls]).toEqual([2, 2])
  await cache.getGithubAuthStatus({ force: true })
  await cache.getGithubProfileOverview({ force: true })
  expect([authCalls, profileCalls]).toEqual([3, 3])

  result = { ok: false, error: '网络暂不可用' }
  const previous = cache.getGithubAccountSnapshot()
  expect(await cache.getGithubProfileOverview({ force: true })).toEqual(result)
  expect(cache.getGithubAccountSnapshot()).toBe(previous)
  now += 5 * 60 * 1000
  await cache.getGithubProfileOverview()
  await cache.getGithubProfileOverview()
  expect(profileCalls).toBe(6)
  expect(notifications).toBe(6)
  unsubscribe()
})

test('GitHub login, logout and account changes invalidate old data and ignore late responses', async () => {
  let currentAuth = auth
  let pendingProfile: Promise<DesktopGithubProfileOverviewResult> = Promise.resolve(profile)
  const client = createBrowserMockDesktopClient(undefined)
  const cache = createGithubAccountCache({
    ...client,
    getGithubAuthStatus: async () => currentAuth,
    getGithubProfileOverview: () => pendingProfile,
    pollGithubLogin: async () => ({ ...mockGithubLogin(), state: 'completed', auth: currentAuth }),
  })
  await cache.getGithubAuthStatus()
  await cache.getGithubProfileOverview()
  currentAuth = { ...auth, user: { ...user, id: 2, login: 'another-user' } }
  await cache.getGithubAuthStatus({ force: true })
  expect(cache.getGithubAccountSnapshot().overview).toBeNull()

  await cache.startGithubLogin({ mode: 'browser' })
  expect(cache.getGithubAccountSnapshot()).toEqual({ auth: null, overview: null })
  await cache.pollGithubLogin()
  expect(cache.getGithubAccountSnapshot().auth).toEqual(currentAuth)

  let resolveProfile!: (value: DesktopGithubProfileOverviewResult) => void
  pendingProfile = new Promise((resolve) => {
    resolveProfile = resolve
  })
  const oldRequest = cache.getGithubProfileOverview()
  await cache.logoutGithub()
  resolveProfile(profile)
  await oldRequest
  expect(cache.getGithubAccountSnapshot().auth?.authenticated).toBeFalse()
  expect(cache.getGithubAccountSnapshot().overview).toBeNull()
})
