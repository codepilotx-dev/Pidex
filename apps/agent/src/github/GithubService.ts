import { Effect } from 'effect'
import { z } from 'zod'
import { lstat, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { AgentError } from '../Domain'
import type { EncryptedCredentialRepository } from '../auth/EncryptedCredentialRepository'
import { GitCommandRunner, type GitCommandResult } from '../git/GitCommandRunner'
import {
  GithubAuthService,
  githubUserFromApi,
  type GithubAuthMode,
  type GithubAuthServiceOptions,
  type GithubOAuthCallback,
  type GithubUser,
  type StoredGithubCredential,
} from './auth/GithubAuthService'
export type {
  GithubAuthMode,
  GithubAuthStatus,
  GithubLoginStatus,
  GithubUser,
} from './auth/GithubAuthService'

const GITHUB_INTEGRATION_ID = 'github'
const GITHUB_API = 'https://api.github.com'
const GITHUB_GRAPHQL = `${GITHUB_API}/graphql`
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024
const DEFAULT_GIT_TIMEOUT_MS = 120_000

type CredentialRepository = Pick<EncryptedCredentialRepository, 'get' | 'set' | 'remove'>
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type GithubRepository = {
  id: number
  name: string
  fullName: string
  owner: string
  private: boolean
  fork: boolean
  archived: boolean
  disabled: boolean
  cloneUrl: string
  sshUrl: string
  htmlUrl: string
  description: string | null
  defaultBranch: string
  pushedAt: string | null
  updatedAt: string | null
}

export type GithubPullRequest = {
  id: number
  number: number
  title: string
  body: string | null
  state: string
  draft: boolean
  htmlUrl: string
  base: { ref: string; sha: string }
  head: { ref: string; sha: string }
  additions: number
  deletions: number
  changedFiles: number
  mergeable: boolean | null
}

export type GithubProfileRepository = {
  id: string
  name: string
  fullName: string
  url: string
  description: string | null
  isPrivate: boolean
  isFork: boolean
  primaryLanguage: {
    name: string
    color: string | null
  } | null
  stargazerCount: number
  forkCount: number
  updatedAt: string
}

export type GithubProfileOverview = {
  user: GithubUser & {
    bio: string | null
    company: string | null
    location: string | null
    websiteUrl: string | null
    email: string | null
    followers: number
    following: number
    repositoryCount: number
    starredRepositoryCount: number
    status: {
      emoji: string | null
      message: string | null
      indicatesLimitedAvailability: boolean
      expiresAt: string | null
    } | null
  }
  organizations: Array<{
    login: string
    avatarUrl: string
    url: string
  }>
  pinnedRepositories: GithubProfileRepository[]
  popularRepositories: GithubProfileRepository[]
  contributions: {
    totalContributions: number
    totalCommitContributions: number
    totalIssueContributions: number
    totalPullRequestContributions: number
    totalPullRequestReviewContributions: number
    restrictedContributionsCount: number
    weeks: Array<{
      days: Array<{
        date: string
        count: number
        color: string
      }>
    }>
  }
}

export type GithubWorkspaceStatus = {
  branchName: string | null
  upstream: string | null
  ahead: number
  behind: number
  clean: boolean
  files: Array<{
    path: string
    originalPath?: string
    status: string
    stagedStatus: string
    unstagedStatus: string
    additions: null
    deletions: null
    isUntracked: boolean
  }>
}

type GithubServiceOptions = GithubAuthServiceOptions & {
  gitTimeoutMs?: number
}

const nonEmpty = (value: string, name: string) => {
  const normalized = value.trim()
  if (!normalized) throw new AgentError('INVALID_REQUEST', `${name} 参数无效`, 400)
  return normalized
}

const repositoryFromApi = (value: unknown): GithubRepository => {
  const input = asRecord(value, 'GitHub 仓库')
  const owner = asRecord(input.owner, 'GitHub 仓库 owner')
  return {
    id: numberField(input, 'id'),
    name: stringField(input, 'name'),
    fullName: stringField(input, 'full_name'),
    owner: stringField(owner, 'login'),
    private: booleanField(input, 'private'),
    fork: booleanField(input, 'fork'),
    archived: booleanField(input, 'archived'),
    disabled: booleanField(input, 'disabled'),
    cloneUrl: stringField(input, 'clone_url'),
    sshUrl: stringField(input, 'ssh_url'),
    htmlUrl: stringField(input, 'html_url'),
    description: nullableStringField(input, 'description'),
    defaultBranch: stringField(input, 'default_branch'),
    pushedAt: nullableStringField(input, 'pushed_at'),
    updatedAt: nullableStringField(input, 'updated_at'),
  }
}

const pullRequestFromApi = (value: unknown): GithubPullRequest => {
  const input = asRecord(value, 'GitHub Pull Request')
  const base = asRecord(input.base, 'GitHub Pull Request base')
  const head = asRecord(input.head, 'GitHub Pull Request head')
  return {
    id: numberField(input, 'id'),
    number: numberField(input, 'number'),
    title: stringField(input, 'title'),
    body: nullableStringField(input, 'body'),
    state: stringField(input, 'state'),
    draft: input.draft === true,
    htmlUrl: stringField(input, 'html_url'),
    base: { ref: stringField(base, 'ref'), sha: stringField(base, 'sha') },
    head: { ref: stringField(head, 'ref'), sha: stringField(head, 'sha') },
    additions: optionalNumberField(input, 'additions'),
    deletions: optionalNumberField(input, 'deletions'),
    changedFiles: optionalNumberField(input, 'changed_files'),
    mergeable: typeof input.mergeable === 'boolean' ? input.mergeable : null,
  }
}

const connectionNodes = (value: unknown, name: string): unknown[] => {
  const connection = asRecord(value, name)
  if (!Array.isArray(connection.nodes))
    throw new AgentError('GITHUB_RESPONSE_INVALID', `${name} nodes 响应无效`, 502)
  return connection.nodes.filter((node) => node != null)
}

const connectionTotalCount = (value: unknown, name: string) =>
  numberField(asRecord(value, name), 'totalCount')

const profileRepositoryFromGraphql = (value: unknown): GithubProfileRepository => {
  const repository = asRecord(value, 'GitHub profile repository')
  const language =
    repository.primaryLanguage == null
      ? null
      : asRecord(repository.primaryLanguage, 'GitHub repository language')
  return {
    id: stringField(repository, 'id'),
    name: stringField(repository, 'name'),
    fullName: stringField(repository, 'nameWithOwner'),
    url: stringField(repository, 'url'),
    description: nullableStringField(repository, 'description'),
    isPrivate: booleanField(repository, 'isPrivate'),
    isFork: booleanField(repository, 'isFork'),
    primaryLanguage: language
      ? {
          name: stringField(language, 'name'),
          color: nullableStringField(language, 'color'),
        }
      : null,
    stargazerCount: numberField(repository, 'stargazerCount'),
    forkCount: numberField(repository, 'forkCount'),
    updatedAt: stringField(repository, 'updatedAt'),
  }
}

export class GithubService {
  private readonly fetch: Fetch
  private readonly gitRunner: GitCommandRunner
  private readonly auth: GithubAuthService
  private readonly preparedPullRequestComparisons = new Map<
    string,
    { baseSha: string; headSha: string }
  >()

  constructor(
    private readonly credentials: CredentialRepository,
    options: GithubServiceOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.gitRunner = new GitCommandRunner({
      maxOutputBytes: MAX_GIT_OUTPUT_BYTES,
      timeoutMs: options.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
    })
    this.auth = new GithubAuthService(credentials, options)
  }

  async authStatus() {
    return this.auth.authStatus()
  }

  async startAuth(mode: GithubAuthMode) {
    return this.auth.start(mode)
  }

  async startDeviceFlow(clientId?: string) {
    return this.auth.start('device', clientId)
  }

  async pollDeviceFlow(loginId: string) {
    return this.auth.poll(loginId)
  }

  async pollAuth(loginId: string) {
    return this.auth.poll(loginId)
  }

  async handleOAuthCallback(input: GithubOAuthCallback) {
    return this.auth.handleCallback(input)
  }

  async logout() {
    return this.auth.logout()
  }

  async optionalAccessToken(): Promise<string | null> {
    return (await this.credential())?.accessToken ?? null
  }

  async profile() {
    return { user: githubUserFromApi(await this.rest('GET', '/user')) }
  }

  async profileOverview(): Promise<{ overview: GithubProfileOverview }> {
    const result = await this.graphql(
      `
      query PidexProfileOverview {
        viewer {
          login
          databaseId
          name
          avatarUrl
          url
          bio
          company
          location
          websiteUrl
          email
          followers { totalCount }
          following { totalCount }
          repositories { totalCount }
          starredRepositories { totalCount }
          status {
            emoji
            message
            indicatesLimitedAvailability
            expiresAt
          }
          organizations(first: 100) {
            nodes {
              login
              avatarUrl
              url
            }
          }
          pinnedItems(first: 6, types: REPOSITORY) {
            nodes {
              ... on Repository {
                id
                name
                nameWithOwner
                url
                description
                isPrivate
                isFork
                primaryLanguage { name color }
                stargazerCount
                forkCount
                updatedAt
              }
            }
          }
          popularRepositories: repositories(
            first: 6
            ownerAffiliations: OWNER
            orderBy: { field: STARGAZERS, direction: DESC }
          ) {
            nodes {
              id
              name
              nameWithOwner
              url
              description
              isPrivate
              isFork
              primaryLanguage { name color }
              stargazerCount
              forkCount
              updatedAt
            }
          }
          contributionsCollection {
            totalCommitContributions
            totalIssueContributions
            totalPullRequestContributions
            totalPullRequestReviewContributions
            restrictedContributionsCount
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  date
                  contributionCount
                  color
                }
              }
            }
          }
        }
      }
    `,
      {},
    )
    const viewer = asRecord(result.viewer, 'GitHub Profile viewer')
    const organizations = connectionNodes(viewer.organizations, 'GitHub organizations').map(
      (value) => {
        const organization = asRecord(value, 'GitHub organization')
        return {
          login: stringField(organization, 'login'),
          avatarUrl: stringField(organization, 'avatarUrl'),
          url: stringField(organization, 'url'),
        }
      },
    )
    const statusValue = viewer.status == null ? null : asRecord(viewer.status, 'GitHub user status')
    const contributions = asRecord(viewer.contributionsCollection, 'GitHub contributions')
    const calendar = asRecord(contributions.contributionCalendar, 'GitHub contribution calendar')
    const weeksValue = calendar.weeks
    if (!Array.isArray(weeksValue))
      throw new AgentError('GITHUB_RESPONSE_INVALID', 'GitHub contribution weeks 响应无效', 502)

    return {
      overview: {
        user: {
          login: stringField(viewer, 'login'),
          id: numberField(viewer, 'databaseId'),
          name: nullableStringField(viewer, 'name'),
          avatarUrl: nullableStringField(viewer, 'avatarUrl'),
          htmlUrl: stringField(viewer, 'url'),
          bio: nullableStringField(viewer, 'bio'),
          company: nullableStringField(viewer, 'company'),
          location: nullableStringField(viewer, 'location'),
          websiteUrl: nullableStringField(viewer, 'websiteUrl'),
          email: nullableStringField(viewer, 'email'),
          followers: connectionTotalCount(viewer.followers, 'GitHub followers'),
          following: connectionTotalCount(viewer.following, 'GitHub following'),
          repositoryCount: connectionTotalCount(viewer.repositories, 'GitHub repositories'),
          starredRepositoryCount: connectionTotalCount(
            viewer.starredRepositories,
            'GitHub starred repositories',
          ),
          status: statusValue
            ? {
                emoji: nullableStringField(statusValue, 'emoji'),
                message: nullableStringField(statusValue, 'message'),
                indicatesLimitedAvailability: booleanField(
                  statusValue,
                  'indicatesLimitedAvailability',
                ),
                expiresAt: nullableStringField(statusValue, 'expiresAt'),
              }
            : null,
        },
        organizations,
        pinnedRepositories: connectionNodes(viewer.pinnedItems, 'GitHub pinned repositories').map(
          profileRepositoryFromGraphql,
        ),
        popularRepositories: connectionNodes(
          viewer.popularRepositories,
          'GitHub popular repositories',
        ).map(profileRepositoryFromGraphql),
        contributions: {
          totalContributions: numberField(calendar, 'totalContributions'),
          totalCommitContributions: numberField(contributions, 'totalCommitContributions'),
          totalIssueContributions: numberField(contributions, 'totalIssueContributions'),
          totalPullRequestContributions: numberField(
            contributions,
            'totalPullRequestContributions',
          ),
          totalPullRequestReviewContributions: numberField(
            contributions,
            'totalPullRequestReviewContributions',
          ),
          restrictedContributionsCount: numberField(contributions, 'restrictedContributionsCount'),
          weeks: weeksValue.map((weekValue) => {
            const week = asRecord(weekValue, 'GitHub contribution week')
            if (!Array.isArray(week.contributionDays))
              throw new AgentError(
                'GITHUB_RESPONSE_INVALID',
                'GitHub contribution days 响应无效',
                502,
              )
            return {
              days: week.contributionDays.map((dayValue) => {
                const day = asRecord(dayValue, 'GitHub contribution day')
                return {
                  date: stringField(day, 'date'),
                  count: numberField(day, 'contributionCount'),
                  color: stringField(day, 'color'),
                }
              }),
            }
          }),
        },
      },
    }
  }

  async repositories(): Promise<{ repositories: GithubRepository[] }> {
    const result = await this.rest(
      'GET',
      '/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=pushed',
    )
    if (!Array.isArray(result))
      throw new AgentError('GITHUB_RESPONSE_INVALID', 'GitHub 仓库响应无效', 502)
    return { repositories: result.map(repositoryFromApi) }
  }

  async cloneRepository(input: {
    repositoryId: number
    targetParent: string
  }): Promise<{ repositoryRoot: string }> {
    const repositoryId = positiveInteger(input.repositoryId, 'repositoryId')
    let targetParent: string
    try {
      targetParent = await realpath(nonEmpty(input.targetParent, 'targetParent'))
      if (!(await stat(targetParent)).isDirectory()) throw new Error('not a directory')
    } catch {
      throw new AgentError('PATH_DENIED', '克隆目标父目录不存在或不可访问', 400)
    }

    const repository = repositoryFromApi(await this.rest('GET', `/repositories/${repositoryId}`))
    validateGithubRepositorySlug(repository.owner, repository.name)
    const repositoryRoot = join(targetParent, repository.name)
    const nested = relative(targetParent, repositoryRoot)
    if (nested === '' || nested.startsWith('..') || isAbsolute(nested)) {
      throw new AgentError('PATH_DENIED', '克隆目标目录无效', 400)
    }
    if (
      await lstat(repositoryRoot)
        .then(() => true)
        .catch(() => false)
    ) {
      throw new AgentError('CONFLICT', '克隆目标目录已经存在', 409)
    }

    const credential = await this.requiredCredential()
    const helperRoot = await mkdtemp(join(tmpdir(), 'pidex-github-askpass-'))
    let cloneStarted = false
    try {
      const helperPath = await writeAskPassHelper(helperRoot)
      cloneStarted = true
      const result = await this.git(
        targetParent,
        [
          '-c',
          'credential.helper=',
          '-c',
          'credential.useHttpPath=true',
          'clone',
          '--origin',
          'origin',
          '--',
          `https://x-access-token@github.com/${repository.owner}/${repository.name}.git`,
          repositoryRoot,
        ],
        {
          GIT_ASKPASS: helperPath,
          GIT_TERMINAL_PROMPT: '0',
          PIDEX_GITHUB_TOKEN: credential.accessToken,
        },
      )
      if (result.code !== 0) {
        throw new AgentError(
          'GIT_COMMAND_FAILED',
          '克隆 GitHub 仓库失败，请检查仓库权限和目标目录。',
          409,
        )
      }
      return { repositoryRoot: await realpath(repositoryRoot) }
    } finally {
      await rm(helperRoot, { recursive: true, force: true }).catch(() => undefined)
      if (cloneStarted && !(await isGitRepository(repositoryRoot))) {
        await rm(repositoryRoot, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }

  async readPullRequest(input: { owner: string; repository: string; number: number }) {
    validateRepositoryInput(input)
    return {
      pullRequest: pullRequestFromApi(
        await this.rest(
          'GET',
          `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/pulls/${positiveInteger(input.number, 'number')}`,
        ),
      ),
    }
  }

  async readWatch(input: { owner: string; repository: string; number: number }) {
    const data = await this.graphql(
      `query($owner:String!,$repository:String!,$number:Int!){repository(owner:$owner,name:$repository){pullRequest(number:$number){id state isDraft headRefOid headRefName mergeable mergeStateStatus reviewDecision headRepository{name owner{login}} statusCheckRollup{state} reviews(last:100){nodes{id state body submittedAt}}}}}`,
      input,
    )
    const result = z
      .object({
        repository: z.object({
          pullRequest: z.object({
            id: z.string(),
            state: z.enum(['OPEN', 'MERGED', 'CLOSED']),
            isDraft: z.boolean(),
            headRefOid: z.string().regex(/^[a-f0-9]{40}$/),
            headRefName: z.string(),
            mergeable: z.string(),
            mergeStateStatus: z.string(),
            reviewDecision: z.string().nullable(),
            headRepository: z
              .object({ name: z.string(), owner: z.object({ login: z.string() }) })
              .nullable(),
            statusCheckRollup: z.object({ state: z.string() }).nullable(),
            reviews: z.object({
              nodes: z.array(
                z.object({
                  id: z.string(),
                  state: z.string(),
                  body: z.string(),
                  submittedAt: z.string().nullable(),
                }),
              ),
            }),
          }),
        }),
      })
      .safeParse(data)
    if (!result.success) throw new AgentError('GITHUB_PR_NOT_FOUND', '无法读取 PR 监控状态', 404)
    return result.data.repository.pullRequest
  }

  async mergeWatchedPullRequest(input: {
    owner: string
    repository: string
    number: number
    headSha: string
    method: 'merge' | 'squash'
  }) {
    const current = await this.readWatch(input)
    if (
      current.headRefOid !== input.headSha ||
      current.state !== 'OPEN' ||
      current.isDraft ||
      current.mergeable !== 'MERGEABLE' ||
      current.mergeStateStatus !== 'CLEAN' ||
      (current.reviewDecision !== null && current.reviewDecision !== 'APPROVED') ||
      (current.statusCheckRollup !== null && current.statusCheckRollup.state !== 'SUCCESS')
    )
      throw new AgentError('CONFLICT', 'PR 当前尚未满足合并条件或 head 已变化', 409)
    const merged = await this.graphql(
      'mutation($input:MergePullRequestInput!){mergePullRequest(input:$input){pullRequest{merged}}}',
      {
        input: {
          pullRequestId: current.id,
          expectedHeadOid: input.headSha,
          mergeMethod: input.method.toUpperCase(),
        },
      },
    )
    const mutation = asRecord(merged.mergePullRequest, 'PR merge')
    if (asRecord(mutation.pullRequest, 'PR merge result').merged !== true)
      throw new AgentError('CONFLICT', 'PR 未完成合并，请重新检查', 409)
  }

  async watchGit(input: {
    workspaceRoot: string
    owner: string
    repository: string
    args: string[]
  }) {
    const credential = await this.requiredCredential()
    const helperRoot = await mkdtemp(join(tmpdir(), 'pidex-github-askpass-'))
    try {
      const helperPath = await writeAskPassHelper(helperRoot)
      const result = await this.git(
        input.workspaceRoot,
        [
          '-c',
          'credential.helper=',
          '-c',
          `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
          ...input.args.map((arg) =>
            arg === '__WATCH_REMOTE__'
              ? `https://x-access-token@github.com/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}.git`
              : arg,
          ),
        ],
        {
          GIT_ASKPASS: helperPath,
          GIT_TERMINAL_PROMPT: '0',
          PIDEX_GITHUB_TOKEN: credential.accessToken,
        },
      )
      if (result.code !== 0)
        throw new AgentError('GIT_COMMAND_FAILED', 'PR 工作树 Git 操作失败', 409)
      return result
    } finally {
      await rm(helperRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async createPullRequest(input: {
    owner: string
    repository: string
    title: string
    head: string
    base: string
    body?: string
    draft?: boolean
  }) {
    validateRepositoryInput(input)
    return {
      pullRequest: pullRequestFromApi(
        await this.rest(
          'POST',
          `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/pulls`,
          {
            title: nonEmpty(input.title, 'title'),
            head: nonEmpty(input.head, 'head'),
            base: nonEmpty(input.base, 'base'),
            body: input.body ?? '',
            draft: input.draft === true,
          },
        ),
      ),
    }
  }

  async createPullRequestForProject(input: {
    workspaceRoot: string
    title: string
    body?: string
    draft?: boolean
  }) {
    const workspaceRoot = nonEmpty(input.workspaceRoot, 'workspaceRoot')
    const remote = await this.githubRemote(workspaceRoot, 'origin')
    const branch = await this.currentBranch(workspaceRoot)
    const repository = asRecord(
      await this.rest(
        'GET',
        `/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repository)}`,
      ),
      'GitHub repository',
    )
    return this.createPullRequest({
      owner: remote.owner,
      repository: remote.repository,
      title: input.title,
      head: branch,
      base: stringField(repository, 'default_branch'),
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.draft === undefined ? {} : { draft: input.draft }),
    })
  }

  async createPullRequestComment(input: {
    owner: string
    repository: string
    number: number
    body: string
    path: string
    side: 'LEFT' | 'RIGHT'
    line: number
    commitId?: string
    startSide?: 'LEFT' | 'RIGHT'
    startLine?: number
    expectedHeadRevision: string
  }) {
    validateRepositoryInput(input)
    const pullRequest = (
      await this.readPullRequest({
        owner: input.owner,
        repository: input.repository,
        number: input.number,
      })
    ).pullRequest
    this.assertExpectedHeadRevision(input.expectedHeadRevision, pullRequest.head.sha)
    const commitId = input.commitId?.trim() || pullRequest.head.sha
    const result = asRecord(
      await this.rest(
        'POST',
        `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/pulls/${positiveInteger(input.number, 'number')}/comments`,
        {
          body: nonEmpty(input.body, 'body'),
          path: nonEmpty(input.path, 'path'),
          side: input.side,
          line: positiveInteger(input.line, 'line'),
          commit_id: commitId,
          ...(input.startSide ? { start_side: input.startSide } : {}),
          ...(input.startLine ? { start_line: positiveInteger(input.startLine, 'startLine') } : {}),
        },
      ),
      'GitHub Pull Request comment',
    )
    return {
      comment: {
        id: numberField(result, 'id'),
        nodeId: stringField(result, 'node_id'),
        htmlUrl: stringField(result, 'html_url'),
        body: stringField(result, 'body'),
      },
    }
  }

  async setReviewThreadResolved(input: { threadId: string; resolved?: boolean }) {
    const resolved = input.resolved !== false
    const mutation = resolved
      ? 'mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}'
      : 'mutation($threadId:ID!){unresolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}'
    const result = await this.graphql(mutation, { threadId: nonEmpty(input.threadId, 'threadId') })
    const root = asRecord(result, 'GitHub GraphQL')
    const payload = asRecord(
      root[resolved ? 'resolveReviewThread' : 'unresolveReviewThread'],
      'GitHub Review Thread',
    )
    const thread = asRecord(payload.thread, 'GitHub Review Thread')
    return {
      thread: { id: stringField(thread, 'id'), resolved: booleanField(thread, 'isResolved') },
    }
  }

  async submitPullRequestReview(input: {
    owner: string
    repository: string
    number: number
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
    body?: string
    expectedHeadRevision: string
  }) {
    validateRepositoryInput(input)
    if (input.event !== 'APPROVE') nonEmpty(input.body ?? '', 'body')
    const pullRequest = (await this.readPullRequest(input)).pullRequest
    this.assertExpectedHeadRevision(input.expectedHeadRevision, pullRequest.head.sha)
    const result = asRecord(
      await this.rest(
        'POST',
        `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/pulls/${positiveInteger(input.number, 'number')}/reviews`,
        { event: input.event, body: input.body ?? '', commit_id: pullRequest.head.sha },
      ),
      'GitHub Pull Request review',
    )
    return {
      review: {
        id: numberField(result, 'id'),
        state: stringField(result, 'state'),
        htmlUrl: stringField(result, 'html_url'),
      },
    }
  }

  async preparePullRequestComparison(input: {
    workspaceRoot: string
    owner: string
    repository: string
    number: number
    force?: boolean
  }): Promise<{ baseSha: string; headSha: string }> {
    const workspaceRoot = nonEmpty(input.workspaceRoot, 'workspaceRoot')
    validateRepositoryInput(input)
    const cacheKey = pullRequestComparisonKey(input)
    const cached = this.preparedPullRequestComparisons.get(cacheKey)
    if (cached && input.force !== true) return cached
    const pullRequest = (await this.readPullRequest(input)).pullRequest
    const missing = async (sha: string) => {
      const result = await this.git(workspaceRoot, ['cat-file', '-e', `${sha}^{commit}`])
      return result.code !== 0
    }
    if ((await missing(pullRequest.base.sha)) || (await missing(pullRequest.head.sha))) {
      const credential = await this.requiredCredential()
      const helperRoot = await mkdtemp(join(tmpdir(), 'pidex-github-askpass-'))
      try {
        const helperPath = await writeAskPassHelper(helperRoot)
        const env = {
          GIT_ASKPASS: helperPath,
          GIT_TERMINAL_PROMPT: '0',
          PIDEX_GITHUB_TOKEN: credential.accessToken,
        }
        const remote = `https://github.com/${input.owner}/${input.repository}.git`
        const baseFetch = await this.git(
          workspaceRoot,
          ['fetch', '--no-tags', remote, pullRequest.base.ref],
          env,
        )
        if (baseFetch.code !== 0)
          throw new AgentError('GITHUB_API_FAILED', safeGitError(baseFetch.stderr), 409)
        const headFetch = await this.git(
          workspaceRoot,
          [
            'fetch',
            '--no-tags',
            remote,
            `refs/pull/${positiveInteger(input.number, 'number')}/head`,
          ],
          env,
        )
        if (headFetch.code !== 0)
          throw new AgentError('GITHUB_API_FAILED', safeGitError(headFetch.stderr), 409)
      } finally {
        await rm(helperRoot, { recursive: true, force: true }).catch(() => undefined)
      }
    }
    if ((await missing(pullRequest.base.sha)) || (await missing(pullRequest.head.sha))) {
      throw new AgentError(
        'REVIEW_SOURCE_UNAVAILABLE',
        '无法在本地解析 Pull Request 的提交对象',
        409,
      )
    }
    const prepared = {
      baseSha: pullRequest.base.sha,
      headSha: pullRequest.head.sha,
    }
    this.preparedPullRequestComparisons.set(cacheKey, prepared)
    return prepared
  }

  async preparedPullRequestComparison(input: {
    workspaceRoot: string
    owner: string
    repository: string
    number: number
  }): Promise<{ baseSha: string; headSha: string }> {
    const prepared = this.preparedPullRequestComparisons.get(pullRequestComparisonKey(input))
    if (!prepared) {
      throw new AgentError(
        'REVIEW_SOURCE_NOT_PREPARED',
        'Pull Request Review 尚未准备，请刷新后重试',
        409,
      )
    }
    return prepared
  }

  async push(input: {
    workspaceRoot: string
    remote?: string
    branch?: string
    setUpstream?: boolean
    forceWithLease?: boolean
  }): Promise<{
    remote: string
    branch: string
    repositoryUrl: string
    status: GithubWorkspaceStatus
  }> {
    const credential = await this.requiredCredential()
    const workspaceRoot = nonEmpty(input.workspaceRoot, 'workspaceRoot')
    const remote = input.remote?.trim() || 'origin'
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote))
      throw new AgentError('INVALID_REQUEST', 'remote 参数无效', 400)
    const repository = await this.githubRemote(workspaceRoot, remote)
    const branch = input.branch?.trim() || (await this.currentBranch(workspaceRoot))
    const branchCheck = await this.git(workspaceRoot, ['check-ref-format', '--branch', branch])
    if (branchCheck.code !== 0) throw new AgentError('INVALID_REQUEST', 'branch 参数无效', 400)
    const helperRoot = await mkdtemp(join(tmpdir(), 'pidex-github-askpass-'))
    try {
      const helperPath = await writeAskPassHelper(helperRoot)
      const result = await this.git(
        workspaceRoot,
        [
          '-c',
          'credential.helper=',
          '-c',
          'credential.useHttpPath=true',
          '-c',
          `remote.${remote}.url=https://x-access-token@github.com/${repository.owner}/${repository.repository}.git`,
          'push',
          ...(input.setUpstream === true ? ['--set-upstream'] : []),
          ...(input.forceWithLease === true ? ['--force-with-lease'] : []),
          remote,
          `refs/heads/${branch}:refs/heads/${branch}`,
        ],
        {
          GIT_ASKPASS: helperPath,
          GIT_TERMINAL_PROMPT: '0',
          PIDEX_GITHUB_TOKEN: credential.accessToken,
        },
      )
      if (result.code !== 0)
        throw new AgentError('GITHUB_PUSH_FAILED', safeGitError(result.stderr), 409)
      return {
        remote,
        branch,
        repositoryUrl: `https://github.com/${repository.owner}/${repository.repository}`,
        status: await this.workspaceStatus(workspaceRoot),
      }
    } finally {
      await rm(helperRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async workspaceStatus(workspaceRoot: string): Promise<GithubWorkspaceStatus> {
    const result = await this.git(nonEmpty(workspaceRoot, 'workspaceRoot'), [
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
    ])
    if (result.code !== 0)
      throw new AgentError('GIT_STATUS_FAILED', safeGitError(result.stderr), 409)
    return parseGitStatus(result.stdout)
  }
  repositoryIdentity(workspaceRoot: string) {
    return this.githubRemote(workspaceRoot, 'origin')
  }

  async readWatchChecks(input: {
    owner: string
    repository: string
    number: number
    headSha: string
  }) {
    const current = await this.readWatch(input)
    if (current.headRefOid !== input.headSha)
      throw new AgentError('CONFLICT', 'PR head 已变化', 409)
    const output: unknown[] = []
    for (let page = 1; ; page++) {
      const result = asRecord(
        await this.rest(
          'GET',
          `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/commits/${input.headSha}/check-runs?per_page=100&page=${page}`,
        ),
        'CI checks',
      )
      const checks = Array.isArray(result.check_runs) ? result.check_runs : []
      for (const check of checks) {
        const item = asRecord(check, 'CI check')
        const detail =
          item.output && typeof item.output === 'object'
            ? (item.output as Record<string, unknown>)
            : {}
        output.push({
          id: item.id,
          name: item.name,
          conclusion: item.conclusion,
          status: item.status,
          detailsUrl: item.details_url,
          completedAt: item.completed_at,
          summary: detail.summary,
          text: detail.text,
        })
      }
      if (checks.length < 100) break
    }
    return { pullRequest: current, checks: output }
  }

  private async githubRemote(workspaceRoot: string, remote: string) {
    const remoteResult = await this.git(workspaceRoot, ['remote', 'get-url', remote])
    if (remoteResult.code !== 0)
      throw new AgentError('GIT_REMOTE_NOT_FOUND', 'Git remote 不存在', 404)
    return parseGithubRemote(remoteResult.stdout.trim())
  }

  private async currentBranch(workspaceRoot: string) {
    const result = await this.git(workspaceRoot, ['branch', '--show-current'])
    if (result.code !== 0 || !result.stdout.trim())
      throw new AgentError('GIT_BRANCH_REQUIRED', '当前工作区未处于可推送分支', 409)
    return result.stdout.trim()
  }

  private async rest(method: string, path: string, body?: unknown, token?: string) {
    const accessToken = token ?? (await this.requiredCredential()).accessToken
    return this.fetchJson(
      `${GITHUB_API}${path}`,
      {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Pidex',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      true,
    )
  }

  private async graphql(query: string, variables: Record<string, unknown>) {
    const accessToken = (await this.requiredCredential()).accessToken
    const result = asRecord(
      await this.fetchJson(
        GITHUB_GRAPHQL,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Pidex',
          },
          body: JSON.stringify({ query, variables }),
        },
        true,
      ),
      'GitHub GraphQL',
    )
    if (Array.isArray(result.errors) && result.errors.length) {
      const first = asRecord(result.errors[0], 'GitHub GraphQL error')
      throw new AgentError(
        'GITHUB_GRAPHQL_FAILED',
        typeof first.message === 'string' ? first.message : 'GitHub GraphQL 请求失败',
        409,
      )
    }
    return asRecord(result.data, 'GitHub GraphQL data')
  }

  private async fetchJson(
    url: string,
    init: RequestInit,
    authenticated: boolean,
  ): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetch(url, init)
    } catch {
      throw new AgentError('GITHUB_UNAVAILABLE', '无法连接 GitHub，请检查网络后重试。', 503)
    }
    const value = (await response.json().catch(() => null)) as unknown
    if (!response.ok) {
      const message = githubApiMessage(value, response.status)
      if (response.status === 401)
        throw new AgentError('GITHUB_AUTH_INVALID', 'GitHub 登录已失效，请重新登录。', 401)
      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        throw new AgentError(
          'GITHUB_RATE_LIMITED',
          'GitHub API 请求次数已达上限，请稍后重试。',
          429,
        )
      }
      throw new AgentError(
        authenticated ? 'GITHUB_API_FAILED' : 'GITHUB_OAUTH_FAILED',
        message,
        response.status,
      )
    }
    return value
  }

  private async credential() {
    const stored = await Effect.runPromise(
      this.credentials.get<StoredGithubCredential>(GITHUB_INTEGRATION_ID),
    )
    if (
      !stored ||
      stored.value.type !== 'oauth' ||
      typeof stored.value.accessToken !== 'string' ||
      !stored.value.accessToken
    )
      return null
    return stored.value
  }

  private async requiredCredential() {
    const credential = await this.credential()
    if (!credential) throw new AgentError('GITHUB_AUTH_REQUIRED', '请先登录 GitHub。', 401)
    return credential
  }

  private assertExpectedHeadRevision(
    expectedHeadRevision: string,
    actualHeadRevision: string,
  ): void {
    const expected = nonEmpty(expectedHeadRevision, 'expectedHeadRevision')
    if (expected === actualHeadRevision) return
    throw new AgentError('CONFLICT', 'Pull Request 已更新，请刷新后重试。', 409, {
      expectedHeadRevision: expected,
      actualHeadRevision,
    })
  }

  private git(
    cwd: string,
    args: readonly string[],
    extraEnv: Record<string, string> = {},
  ): Promise<GitCommandResult> {
    return this.gitRunner.run({
      cwd,
      args,
      env: extraEnv,
      acceptedCodes: null,
    })
  }
}

const parseGithubRemote = (value: string) => {
  const scp = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i.exec(value)
  if (scp) return validateGithubRepositorySlug(scp[1]!, stripGitSuffix(scp[2]!))
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AgentError('GITHUB_REMOTE_UNSUPPORTED', '当前 remote 不是 GitHub.com 仓库', 400)
  }
  if (url.hostname.toLowerCase() !== 'github.com')
    throw new AgentError('GITHUB_REMOTE_UNSUPPORTED', '当前 remote 不是 GitHub.com 仓库', 400)
  const parts = url.pathname.replace(/^\/+/, '').split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1])
    throw new AgentError('GITHUB_REMOTE_UNSUPPORTED', 'GitHub remote 地址无效', 400)
  return validateGithubRepositorySlug(parts[0], stripGitSuffix(parts[1]))
}

const parseGitStatus = (value: string): GithubWorkspaceStatus => {
  let branchName: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const files: GithubWorkspaceStatus['files'] = []
  const records = value.split('\0')
  for (let index = 0; index < records.length; index += 1) {
    const entry = records[index]
    if (!entry) continue
    if (entry.startsWith('# branch.head ')) {
      const head = entry.slice('# branch.head '.length)
      branchName = head === '(detached)' ? null : head
      continue
    }
    if (entry.startsWith('# branch.upstream ')) {
      upstream = entry.slice('# branch.upstream '.length) || null
      continue
    }
    if (entry.startsWith('# branch.ab ')) {
      const match = /^\+(\d+) -(\d+)$/.exec(entry.slice('# branch.ab '.length))
      if (match) {
        ahead = Number.parseInt(match[1]!, 10)
        behind = Number.parseInt(match[2]!, 10)
      }
      continue
    }
    if (entry.startsWith('? ')) {
      files.push(statusFile(entry.slice(2), '??', undefined))
      continue
    }
    const ordinary = /^1 ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(entry)
    if (ordinary) {
      files.push(statusFile(ordinary[2]!, ordinary[1]!, undefined))
      continue
    }
    const renamed = /^2 ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(entry)
    if (renamed) {
      const originalPath = records[index + 1]
      if (originalPath) index += 1
      files.push(statusFile(renamed[2]!, renamed[1]!, originalPath))
      continue
    }
    const unmerged = /^u ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(entry)
    if (unmerged) files.push(statusFile(unmerged[2]!, unmerged[1]!, undefined))
  }
  return {
    branchName,
    upstream,
    ahead,
    behind,
    clean: files.length === 0,
    files,
  }
}

const statusFile = (
  path: string,
  rawStatus: string,
  originalPath: string | undefined,
): GithubWorkspaceStatus['files'][number] => {
  const staged = rawStatus[0] === '.' || rawStatus[0] === '?' ? '' : (rawStatus[0] ?? '')
  const unstaged = rawStatus[1] === '.' ? '' : (rawStatus[1] ?? '')
  return {
    path,
    ...(originalPath ? { originalPath } : {}),
    status: rawStatus,
    stagedStatus: staged,
    unstagedStatus: unstaged,
    additions: null,
    deletions: null,
    isUntracked: rawStatus === '??',
  }
}

const stripGitSuffix = (value: string) => value.replace(/\.git$/i, '')
const validateGithubRepositorySlug = (owner: string, repository: string) => {
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) ||
    !/^[A-Za-z0-9._-]+$/.test(repository) ||
    repository === '.' ||
    repository === '..'
  ) {
    throw new AgentError('GITHUB_REMOTE_UNSUPPORTED', 'GitHub remote 地址无效', 400)
  }
  return { owner, repository }
}

const pullRequestComparisonKey = (input: {
  workspaceRoot: string
  owner: string
  repository: string
  number: number
}) => {
  const workspace = resolve(input.workspaceRoot).replaceAll('\\', '/')
  return [
    process.platform === 'win32' ? workspace.toLowerCase() : workspace,
    input.owner.toLowerCase(),
    input.repository.toLowerCase(),
    positiveInteger(input.number, 'number'),
  ].join('\u0000')
}

const isGitRepository = async (root: string) =>
  stat(join(root, '.git'))
    .then((metadata) => metadata.isDirectory() || metadata.isFile())
    .catch(() => false)

const writeAskPassHelper = async (root: string) => {
  if (process.platform === 'win32') {
    const path = join(root, 'askpass.cmd')
    await writeFile(path, ['@echo off', 'echo %PIDEX_GITHUB_TOKEN%'].join('\r\n'), 'utf8')
    return path
  }
  const path = join(root, 'askpass.sh')
  await writeFile(path, ['#!/bin/sh', 'printf \'%s\\n\' "$PIDEX_GITHUB_TOKEN"'].join('\n'), {
    encoding: 'utf8',
    mode: 0o700,
  })
  return path
}

const safeGitError = (_value: string) => 'Git 操作失败，请检查仓库权限、分支和网络设置。'

const githubApiMessage = (value: unknown, status: number) => {
  if (
    value &&
    typeof value === 'object' &&
    'message' in value &&
    typeof value.message === 'string'
  ) {
    return value.message.slice(0, 500)
  }
  return `GitHub 请求失败（HTTP ${status}）`
}

const asRecord = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AgentError('GITHUB_RESPONSE_INVALID', `${name}响应无效`, 502)
  return value as Record<string, unknown>
}

const stringField = (value: Record<string, unknown>, key: string) => {
  if (typeof value[key] !== 'string')
    throw new AgentError('GITHUB_RESPONSE_INVALID', `GitHub 响应缺少 ${key}`, 502)
  return value[key]
}

const nullableStringField = (value: Record<string, unknown>, key: string) =>
  typeof value[key] === 'string' ? value[key] : null
const numberField = (value: Record<string, unknown>, key: string) => {
  if (typeof value[key] !== 'number' || !Number.isFinite(value[key]))
    throw new AgentError('GITHUB_RESPONSE_INVALID', `GitHub 响应缺少 ${key}`, 502)
  return value[key]
}
const optionalNumberField = (value: Record<string, unknown>, key: string) =>
  typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] : 0
const booleanField = (value: Record<string, unknown>, key: string) => {
  if (typeof value[key] !== 'boolean')
    throw new AgentError('GITHUB_RESPONSE_INVALID', `GitHub 响应缺少 ${key}`, 502)
  return value[key]
}
const positiveInteger = (value: number, name: string) => {
  if (!Number.isInteger(value) || value <= 0)
    throw new AgentError('INVALID_REQUEST', `${name} 参数无效`, 400)
  return value
}
const validateRepositoryInput = (input: { owner: string; repository: string }) => {
  nonEmpty(input.owner, 'owner')
  nonEmpty(input.repository, 'repository')
}

export const __test = {
  parseGithubRemote,
  parseGitStatus,
}
