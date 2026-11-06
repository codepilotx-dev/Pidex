import { afterEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PERMISSION_CONFIG } from '@pidex/shared/thread'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { AgentError } from '../src/Domain'
import { ThreadPullRequestService } from '../src/github/ThreadPullRequestService'
import { createAttachPullRequestDefinition } from '../src/tool/AttachPullRequest/Definition'
import { ToolCatalog } from '../src/tool/ToolRegistry'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []

afterEach(async () => {
  await removeFixturePaths(paths.splice(0))
})

const PR_URL = 'https://github.com/octocat/fixture/pull/7'

const watch = () =>
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
  }) as never

const restPullRequest = {
  id: 10,
  number: 7,
  title: 'Fixture pull request',
  body: null,
  state: 'open',
  draft: false,
  htmlUrl: PR_URL,
  base: { ref: 'main', sha: 'base-sha' },
  head: { ref: 'feature', sha: 'head-sha' },
  additions: 0,
  deletions: 0,
  changedFiles: 0,
  mergeable: true,
}

const fixture = async (
  options: { readPullRequest?: () => unknown } = {},
) => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-attach-pr-'))
  paths.push(root)
  const db = new AgentDatabase({
    historyPath: join(root, 'history.sqlite'),
    profilePath: join(root, 'profile.sqlite'),
  })
  const thread = db.repositories.threads.createThread('会话')
  const github = {
    readPullRequest: async () =>
      options.readPullRequest
        ? options.readPullRequest()
        : { pullRequest: { ...restPullRequest, htmlUrl: PR_URL } },
    readWatch: async () => watch(),
    repositoryIdentity: async () => ({ owner: 'octocat', repository: 'fixture' }),
  } as never
  const hub = { publish: () => Effect.succeed(undefined) } as never
  const git = { run: async () => ({ code: 0, stdout: 'feature\n', stderr: '' }) }
  const service = new ThreadPullRequestService(db, github, hub, { git })
  const definition = createAttachPullRequestDefinition(service)
  const catalog = new ToolCatalog([definition])
  return { db, thread, service, definition, catalog }
}

const invocationFor = (threadId: string) => ({
  threadID: threadId,
  turnID: 'turn:1',
  agentID: 'agent:1',
  toolCallID: 'tool:1',
})

const contextFor = (threadId?: string) => ({
  signal: new AbortController().signal,
  taskMode: 'chat' as const,
  profile: 'main' as const,
  workspace: {},
  permissionConfig: DEFAULT_PERMISSION_CONFIG,
  ...(threadId ? { invocation: invocationFor(threadId) } : {}),
})

describe('attach_pull_request 工具', () => {
  test('缺少宿主会话身份时以 PERMISSION_DENIED 拒绝', async () => {
    const { definition, db } = await fixture()
    const error = await definition.execute({ url: PR_URL }, {} as never).then(
      () => null,
      (cause) => cause,
    )
    expect(error).toBeInstanceOf(AgentError)
    if (!(error instanceof AgentError)) throw error
    expect(error.code).toBe('PERMISSION_DENIED')
    expect(error.status).toBe(403)
    db.close()
  })

  test('是 eager、chat 下 main/default/worker 可用，且声明真实能力', async () => {
    const { definition, catalog, db } = await fixture()
    expect(definition).toMatchObject({
      sdkName: 'attach_pull_request',
      approvalStrategy: 'policy',
      visibility: 'eager',
      executionMode: 'sequential',
      allowedModes: ['chat'],
      allowedProfiles: ['main', 'default', 'worker'],
    })
    expect(definition.capabilities).toMatchObject({
      filesystem: 'none',
      network: 'declared',
      process: false,
      externalState: true,
      userInteraction: false,
    })
    for (const profile of ['main', 'default', 'worker'] as const) {
      expect(catalog.list('chat', 'workspace-write', profile).map(({ sdkName }) => sdkName)).toContain(
        'attach_pull_request',
      )
    }
    expect(catalog.list('plan', 'workspace-write', 'main')).toEqual([])
    expect(catalog.list('grill', 'workspace-write', 'main')).toEqual([])
    expect(catalog.list('chat', 'workspace-write', 'explorer')).toEqual([])
    expect(catalog.deferred('chat', 'workspace-write', 'main')).toEqual([])
    expect(definition.description).toContain('都必须携带返回的真实 URL 调用')
    expect(definition.description).toContain('包括只读分析')
    expect(definition.description).toContain('在最终回复前调用')
    expect(definition.description).toContain('背景的 PR 不绑定')
    db.close()
  })

  test('explorer profile 执行被拒绝', async () => {
    const { catalog, thread, db } = await fixture()
    await expect(
      catalog.execute(
        'attach_pull_request',
        { url: PR_URL },
        { ...contextFor(thread.id), profile: 'explorer' } as never,
      ),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_ALLOWED_FOR_PROFILE' })
    db.close()
  })

  test.each(['default', 'worker'] as const)('%s profile 可以绑定 PR', async (profile) => {
    const { catalog, thread, db } = await fixture()
    await expect(catalog.execute('attach_pull_request', { url: PR_URL }, { ...contextFor(thread.id), profile } as never))
      .resolves.toMatchObject({ thread: { items: [{ url: PR_URL }] } })
    db.close()
  })

  test('参数校验：缺少/空 url 走 INVALID_TOOL_INPUT，非 PR URL 由服务返回 INVALID_REQUEST', async () => {
    const { catalog, thread, db } = await fixture()
    await expect(
      catalog.execute('attach_pull_request', {}, contextFor(thread.id) as never),
    ).rejects.toMatchObject({ code: 'INVALID_TOOL_INPUT' })
    await expect(
      catalog.execute('attach_pull_request', { url: '   ' }, contextFor(thread.id) as never),
    ).rejects.toMatchObject({ code: 'INVALID_TOOL_INPUT' })
    await expect(
      catalog.execute(
        'attach_pull_request',
        { url: 'https://example.com/not-a-pr' },
        contextFor(thread.id) as never,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    db.close()
  })

  test('成功绑定后写入关联并返回成功文案，重复绑定不产生重复关联', async () => {
    const { catalog, definition, thread, db } = await fixture()
    const first = (await catalog.execute(
      'attach_pull_request',
      { url: PR_URL },
      contextFor(thread.id) as never,
    )) as { thread: { items: Array<{ url: string }> } }
    expect(first.thread.items.map((item) => item.url)).toEqual([PR_URL])
    const formatted = definition.formatResult!(first as never, {} as never)
    expect(formatted.content).toContain('已将 Pull Request 绑定到当前会话')
    expect(formatted.content).toContain(PR_URL)
    expect(formatted.content).not.toContain('失败')

    await expect(
      catalog.execute('attach_pull_request', { url: PR_URL }, contextFor(thread.id) as never),
    ).resolves.toMatchObject({ thread: { items: [{ url: PR_URL, number: 7, origin: 'manual' }] } })

    const linked = db.repositories.threadPullRequests.list(thread.id)
    expect(linked).toHaveLength(1)
    expect(linked[0]).toMatchObject({ number: 7, origin: 'manual' })
    db.close()
  })

  test('服务抛出的 AgentError 原样透传', async () => {
    const { definition, thread, db } = await fixture()
    await expect(
      definition.execute({ url: 'not-a-url' }, { invocation: invocationFor(thread.id) } as never),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
    db.close()
  })

  test('非 AgentError 服务失败包装为安全的 PULL_REQUEST_BIND_FAILED', async () => {
    const { catalog, thread, db } = await fixture({
      readPullRequest: () => {
        throw new Error('boom upstream detail')
      },
    })
    const error = await catalog
      .execute('attach_pull_request', { url: PR_URL }, contextFor(thread.id) as never)
      .then(
        () => null,
        (cause) => cause,
      )
    expect(error).toBeInstanceOf(AgentError)
    if (!(error instanceof AgentError)) throw error
    expect(error.code).toBe('PULL_REQUEST_BIND_FAILED')
    expect(error.status).toBe(502)
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain('boom')
    db.close()
  })
})
