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

const fixture = async (options: { openPullRequests?: unknown[]; now?: () => number } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-thread-pr-'))
  paths.push(root)
  const historyPath = join(root, 'history.sqlite')
  const profilePath = join(root, 'profile.sqlite')
  const db = new AgentDatabase({ historyPath, profilePath })
  const thread = db.repositories.threads.createThread('会话')
  const published: unknown[] = []
  const github = {
    readPullRequest: async () => ({ pullRequest: restPullRequest }),
    readWatch: async () => watch(),
    repositoryIdentity: async () => ({ owner: 'octocat', repository: 'fixture' }),
    listOpenPullRequestsForBranch: async () => options.openPullRequests ?? [],
  } as never
  const hub = {
    publish: (event: unknown) => {
      published.push(event)
      return Effect.succeed(undefined)
    },
  } as never
  const git = { run: async () => ({ code: 0, stdout: 'feature\n', stderr: '' }) }
  const service = new ThreadPullRequestService(db, github, hub, {
    git,
    ...(options.now ? { now: options.now } : {}),
  })
  return { db, historyPath, profilePath, thread, published, service, git }
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
  test('discovers new PRs alongside existing links and emits only changed associations', async () => {
    let now = 0
    const openPullRequests = [restPullRequest]
    const { db, thread, service, published, git } = await fixture({
      openPullRequests,
      now: () => now,
    })
    await service.link({ threadId: thread.id, url: restPullRequest.htmlUrl })
    const read = () => service.read({ threadIds: [thread.id], resolveCwd: async () => 'C:\\repo' })
    await read()
    expect(published).toHaveLength(1)
    openPullRequests.push({
      ...restPullRequest,
      number: 8,
      htmlUrl: 'https://github.com/octocat/fixture/pull/8',
    })
    expect((await read()).threads[0]!.items).toHaveLength(1)
    now = 60_000
    expect((await read()).threads[0]!.items).toHaveLength(2)
    expect(published).toHaveLength(2)
    expect(
      db.repositories.threadPullRequests.list(thread.id).find((pr) => pr.number === 7)?.origin,
    ).toBe('manual')
    now += 60_000
    await read()
    expect(published).toHaveLength(2)
    expect(
      db.sqlite
        .query("SELECT method FROM events WHERE method = 'thread/pull-requests/updated'")
        .all(),
    ).toHaveLength(2)
    git.run = async () => ({ code: 0, stdout: 'next-feature\n', stderr: '' })
    openPullRequests.splice(0, openPullRequests.length, {
      ...restPullRequest,
      number: 9,
      htmlUrl: 'https://github.com/octocat/fixture/pull/9',
      head: { ...restPullRequest.head, ref: 'next-feature' },
    })
    now += 60_000
    const switched = (await read()).threads[0]!.items
    expect(switched).toHaveLength(3)
    expect(switched[0]).toMatchObject({ number: 9, primary: true })
    expect(published).toHaveLength(3)
    openPullRequests[0] = { ...openPullRequests[0]!, title: 'Updated title' }
    now += 60_000
    expect((await read()).threads[0]!.items[0]!.title).toBe('Updated title')
    expect(published).toHaveLength(4)
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

  test('discovers an open PR for the execution directory branch and marks it primary', async () => {
    const { thread, service } = await fixture({ openPullRequests: [restPullRequest] })
    const discovered = await service.read({
      threadIds: [thread.id],
      resolveCwd: async () => 'C:\\repo',
    })
    expect(discovered.threads[0]!.items).toHaveLength(1)
    expect(discovered.threads[0]!.items[0]).toMatchObject({
      owner: 'octocat',
      repository: 'fixture',
      number: 7,
      origin: 'discovered',
      primary: true,
      status: { state: 'mergeable' },
    })
  })
})
