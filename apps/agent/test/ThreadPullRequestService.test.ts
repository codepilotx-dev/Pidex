import { afterEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import {
  ThreadPullRequestService,
  threadPullRequestStatus,
} from '../src/github/ThreadPullRequestService'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []

afterEach(async () => {
  await removeFixturePaths(paths.splice(0))
})

const watch = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'PR_kw1',
    state: 'OPEN',
    isDraft: false,
    headRefOid: 'a'.repeat(40),
    headRefName: 'feature',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    headRepository: { name: 'fixture', owner: { login: 'octocat' } },
    statusCheckRollup: { state: 'SUCCESS' },
    reviews: { nodes: [] },
    ...overrides,
  }) as never

const restPullRequest = {
  id: 10,
  number: 7,
  title: 'Fixture pull request',
  body: null,
  state: 'open',
  draft: false,
  htmlUrl: 'https://github.com/octocat/fixture/pull/7',
  base: { ref: 'main', sha: 'base-sha' },
  head: { ref: 'feature', sha: 'head-sha' },
  additions: 0,
  deletions: 0,
  changedFiles: 0,
  mergeable: true,
}

const fixture = async (
  options: {
    now?: () => number
    readWatch?: (input: { owner: string; repository: string; number: number }) => unknown
  } = {},
) => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-thread-pr-'))
  paths.push(root)
  const historyPath = join(root, 'history.sqlite')
  const profilePath = join(root, 'profile.sqlite')
  const db = new AgentDatabase({ historyPath, profilePath })
  const thread = db.repositories.threads.createThread('会话')
  const published: Array<{ method?: string; params?: unknown }> = []
  const counts = { watchReads: 0 }
  const github = {
    readPullRequest: async (input: { owner: string; repository: string; number: number }) => ({
      pullRequest: {
        ...restPullRequest,
        number: input.number,
        title: `PR ${input.number}`,
        htmlUrl: `https://github.com/${input.owner}/${input.repository}/pull/${input.number}`,
      },
    }),
    readWatch: async (input: { owner: string; repository: string; number: number }) => {
      counts.watchReads += 1
      return options.readWatch ? options.readWatch(input) : watch()
    },
    repositoryIdentity: async () => ({ owner: 'octocat', repository: 'fixture' }),
  } as never
  const hub = {
    publish: (event: unknown) => {
      published.push(event as { method?: string; params?: unknown })
      return Effect.succeed(undefined)
    },
  } as never
  const git = { run: async () => ({ code: 0, stdout: 'feature\n', stderr: '' }) }
  const service = new ThreadPullRequestService(db, github, hub, {
    git,
    ...(options.now ? { now: options.now } : {}),
  })
  return { db, historyPath, profilePath, thread, published, service, git, counts }
}

describe('thread pull request status', () => {
  test('closed, merged and draft win over conflicts and checks', () => {
    expect(
      threadPullRequestStatus(watch({ state: 'MERGED', mergeStateStatus: 'DIRTY' })).state,
    ).toBe('merged')
    expect(threadPullRequestStatus(watch({ state: 'CLOSED' })).state).toBe('closed')
    expect(threadPullRequestStatus(watch({ isDraft: true })).state).toBe('draft')
  })

  test('conflicts and failed checks stay red before mergeability', () => {
    expect(threadPullRequestStatus(watch({ mergeable: 'CONFLICTING' })).state).toBe('conflicts')
    expect(threadPullRequestStatus(watch({ statusCheckRollup: { state: 'FAILURE' } })).state).toBe(
      'checks-failed',
    )
  })

  test('green states separate mergeable from checks-only passing', () => {
    expect(threadPullRequestStatus(watch())).toEqual({ state: 'mergeable', reason: null })
    expect(threadPullRequestStatus(watch({ reviewDecision: 'CHANGES_REQUESTED' }))).toEqual({
      state: 'checks-passing',
      reason: null,
    })
  })

  test('waiting states always carry a reason and never a green dot', () => {
    expect(
      threadPullRequestStatus(
        watch({ mergeStateStatus: 'BEHIND', statusCheckRollup: { state: 'PENDING' } }),
      ),
    ).toEqual({ state: 'waiting', reason: 'behind-base' })
    expect(threadPullRequestStatus(watch({ statusCheckRollup: { state: 'PENDING' } }))).toEqual({
      state: 'waiting',
      reason: 'checks-running',
    })
    expect(
      threadPullRequestStatus(
        watch({
          reviewDecision: 'CHANGES_REQUESTED',
          mergeStateStatus: 'BLOCKED',
          statusCheckRollup: null,
        }),
      ),
    ).toEqual({ state: 'waiting', reason: 'review-required' })
    expect(
      threadPullRequestStatus(
        watch({ reviewDecision: null, mergeStateStatus: 'BLOCKED', statusCheckRollup: null }),
      ),
    ).toEqual({ state: 'waiting', reason: 'blocked' })
  })
})

describe('thread pull request associations', () => {
  test('shares directory and branch without linking: only the explicit thread returns a PR', async () => {
    let now = 0
    const { db, thread, service, published } = await fixture({ now: () => now })
    const sibling = db.repositories.threads.createThread('同目录会话')
    await service.link({ threadId: thread.id, url: restPullRequest.htmlUrl })
    published.length = 0
    const read = () =>
      service.read({
        threadIds: [thread.id, sibling.id],
        resolveCwd: async () => 'C:\\repo',
      })

    const first = await read()
    expect(first.threads.map((entry) => entry.items.map((item) => item.number))).toEqual([
      [7],
      [],
    ])
    for (let cycle = 0; cycle < 3; cycle += 1) {
      now += 60_000
      const repeated = await read()
      expect(repeated.threads.map((entry) => entry.items.map((item) => item.number))).toEqual([
        [7],
        [],
      ])
    }
    expect(published).toEqual([])
    expect(db.repositories.threadPullRequests.list(sibling.id)).toEqual([])
    expect(
      db.sqlite.query("SELECT method FROM events WHERE method = 'thread/pull-requests/updated'").all(),
    ).toHaveLength(1)
    db.close()
  })

  test('无可见关联时跳过环境探测与状态刷新', async () => {
    let identityProbes = 0
    const { db, thread, counts } = await fixture()
    // The shared fixture probes `repositoryIdentity` for the sidebar environment.
    let gitCalls = 0
    const countingGit = {
      run: async () => {
        gitCalls += 1
        return { code: 0, stdout: 'feature\n', stderr: '' }
      },
    }
    const noProbeGithub = {
      readPullRequest: async () => ({ pullRequest: restPullRequest }),
      readWatch: async () => {
        counts.watchReads += 1
        return watch()
      },
      repositoryIdentity: async () => {
        identityProbes += 1
        return { owner: 'octocat', repository: 'fixture' }
      },
    } as never
    const countingService = new ThreadPullRequestService(
      db,
      noProbeGithub,
      { publish: () => Effect.succeed(undefined) } as never,
      { git: countingGit },
    )
    const result = await countingService.read({
      threadIds: [thread.id],
      resolveCwd: async () => 'C:\\repo',
    })
    // No association means nothing to sort: the read must not pay for probing.
    expect(result.threads).toEqual([{ threadId: thread.id, items: [] }])
    expect(identityProbes).toBe(0)
    expect(gitCalls).toBe(0)
    expect(counts.watchReads).toBe(0)
    // An explicit association still probes and refreshes as before.
    await countingService.link({ threadId: thread.id, url: restPullRequest.htmlUrl })
    const linked = await countingService.read({
      threadIds: [thread.id],
      resolveCwd: async () => 'C:\\repo',
    })
    expect(linked.threads[0]?.items.map((item) => item.number)).toEqual([7])
    expect(identityProbes).toBeGreaterThan(0)
    db.close()
  })

  test('persists links, prefers explicit origins and survives reopen', async () => {
    const { db, historyPath, profilePath, thread } = await fixture()
    const repository = db.repositories.threadPullRequests
    const link = {
      threadId: thread.id,
      owner: 'OctoCat',
      repository: 'Fixture',
      number: 7,
      url: restPullRequest.htmlUrl,
      title: 'A',
      headRef: 'feature',
    }
    repository.upsert({ ...link, origin: 'discovered' })
    repository.upsert({ ...link, origin: 'manual', title: 'B' })

    expect(repository.list(thread.id)).toEqual([
      {
        threadId: thread.id,
        owner: 'octocat',
        repository: 'fixture',
        number: 7,
        url: restPullRequest.htmlUrl,
        title: 'B',
        headRef: 'feature',
        origin: 'manual',
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      },
    ])
    db.close()

    const reopened = new AgentDatabase({ historyPath, profilePath })
    expect(reopened.repositories.threadPullRequests.list(thread.id)).toHaveLength(1)
    expect(
      reopened.repositories.threadPullRequests.remove(thread.id, {
        owner: 'octocat',
        repository: 'fixture',
        number: 7,
      }),
    ).toBe(true)
    expect(reopened.repositories.threadPullRequests.list(thread.id)).toEqual([])
    reopened.close()
  })

  test('linking records the association and publishes a durable event', async () => {
    const { db, thread, published, service } = await fixture()
    const result = await service.link({ threadId: thread.id, url: restPullRequest.htmlUrl })

    expect(result.thread.items).toHaveLength(1)
    expect(result.thread.items[0]).toMatchObject({
      owner: 'octocat',
      repository: 'fixture',
      number: 7,
      origin: 'manual',
      primary: true,
      status: { state: 'mergeable', stale: false },
    })
    expect(published).toHaveLength(1)
    expect(
      db.sqlite
        .query("SELECT method FROM events WHERE method = 'thread/pull-requests/updated'")
        .all(),
    ).toHaveLength(1)

    const unlinked = await service.unlink({
      threadId: thread.id,
      owner: 'octocat',
      repository: 'fixture',
      number: 7,
    })
    expect(unlinked.thread.items).toEqual([])
    expect(published).toHaveLength(2)
  })

  test('hides historical discovered rows from reads, mutation results and events', async () => {
    const { db, thread, service, published } = await fixture()
    const repository = db.repositories.threadPullRequests
    const historical = {
      threadId: thread.id,
      owner: 'octocat',
      repository: 'fixture',
      number: 7,
      url: restPullRequest.htmlUrl,
      title: '旧自动发现',
      headRef: 'feature',
      origin: 'discovered' as const,
    }
    repository.upsert(historical)
    const read = () => service.read({ threadIds: [thread.id], resolveCwd: async () => 'C:\\repo' })

    expect((await read()).threads[0]!.items).toEqual([])

    const linked = await service.link({
      threadId: thread.id,
      url: 'https://github.com/octocat/fixture/pull/8',
    })
    expect(linked.thread.items.map((item) => [item.number, item.origin])).toEqual([[8, 'manual']])
    expect(repository.list(thread.id)).toHaveLength(2)

    const unlinked = await service.unlink({
      threadId: thread.id,
      owner: 'octocat',
      repository: 'fixture',
      number: 8,
    })
    expect(unlinked.thread.items).toEqual([])

    expect(published).toHaveLength(2)
    for (const event of published) {
      const items = (event.params as { items: Array<{ number: number }> }).items
      expect(items.map((item) => item.number)).not.toContain(7)
    }
    // 历史记录只从展示与状态查询中隐去，数据库原行保留。
    expect(repository.list(thread.id)).toEqual([
      expect.objectContaining({ number: 7, origin: 'discovered', title: '旧自动发现' }),
    ])
    db.close()
  })

  test('keeps created, manual and watch associations visible', async () => {
    const { db, thread, service } = await fixture()
    const record = (number: number, origin: 'created' | 'watch') =>
      service.record({
        threadId: thread.id,
        owner: 'octocat',
        repository: 'fixture',
        number,
        url: `https://github.com/octocat/fixture/pull/${number}`,
        title: `PR ${number}`,
        headRef: 'feature',
        origin,
      })
    record(7, 'created')
    record(8, 'watch')
    await service.link({
      threadId: thread.id,
      url: 'https://github.com/octocat/fixture/pull/9',
    })

    const items = (
      await service.read({ threadIds: [thread.id], resolveCwd: async () => 'C:\\repo' })
    ).threads[0]!.items
    expect(items.map((item) => [item.number, item.origin]).sort()).toEqual([
      [7, 'created'],
      [8, 'watch'],
      [9, 'manual'],
    ])
    expect(items.filter((item) => item.primary)).toHaveLength(1)
    db.close()
  })

  test('re-linking a historical PR upgrades it to an explicit origin and shows it', async () => {
    const { db, thread, service } = await fixture()
    db.repositories.threadPullRequests.upsert({
      threadId: thread.id,
      owner: 'octocat',
      repository: 'fixture',
      number: 7,
      url: restPullRequest.htmlUrl,
      title: '旧自动发现',
      headRef: 'feature',
      origin: 'discovered',
    })

    const linked = await service.link({ threadId: thread.id, url: restPullRequest.htmlUrl })
    expect(linked.thread.items).toHaveLength(1)
    expect(linked.thread.items[0]).toMatchObject({ number: 7, origin: 'manual', primary: true })
    expect(db.repositories.threadPullRequests.list(thread.id)).toEqual([
      expect.objectContaining({ number: 7, origin: 'manual' }),
    ])
    db.close()
  })

  test('unlinking stays unlinked across refresh cycles', async () => {
    let now = 0
    const { db, thread, service, published } = await fixture({ now: () => now })
    await service.link({ threadId: thread.id, url: restPullRequest.htmlUrl })
    const read = () => service.read({ threadIds: [thread.id], resolveCwd: async () => 'C:\\repo' })
    expect((await read()).threads[0]!.items).toHaveLength(1)

    await service.unlink({
      threadId: thread.id,
      owner: 'octocat',
      repository: 'fixture',
      number: 7,
    })
    const events = published.length
    for (let cycle = 0; cycle < 3; cycle += 1) {
      now += 60_000
      expect((await read()).threads[0]!.items).toEqual([])
    }
    expect(published).toHaveLength(events)
    expect(db.repositories.threadPullRequests.list(thread.id)).toEqual([])
    db.close()
  })

  test('caches status within the freshness window and ranks the matching branch first', async () => {
    let now = 1_000
    const { db, thread, service, counts } = await fixture({ now: () => now })
    const repository = db.repositories.threadPullRequests
    const link = (number: number, headRef: string) =>
      repository.upsert({
        threadId: thread.id,
        owner: 'octocat',
        repository: 'fixture',
        number,
        url: `https://github.com/octocat/fixture/pull/${number}`,
        title: `PR ${number}`,
        headRef,
        origin: 'manual',
      })
    link(8, 'other')
    link(7, 'feature')
    const read = () => service.read({ threadIds: [thread.id], resolveCwd: async () => 'C:\\repo' })

    const items = (await read()).threads[0]!.items
    expect(items.map((item) => item.number)).toEqual([7, 8])
    expect(items[0]).toMatchObject({ primary: true, status: { state: 'mergeable' } })
    expect(items[1]).toMatchObject({ primary: false })

    const reads = counts.watchReads
    now += 30_000
    await read()
    expect(counts.watchReads).toBe(reads)
    now += 60_000
    await read()
    expect(counts.watchReads).toBeGreaterThan(reads)
    db.close()
  })
})
