import { AgentThread } from '@pidex/shared'
import { AutomationSchema } from '@pidex/shared/automation'
import { ModelRefSchema } from '@pidex/shared/model'
import { PermissionConfigSchema } from '@pidex/shared/thread'
import { ThreadPullRequestListSchema } from '@pidex/shared/thread'
import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import {
  EmptyParamsSchema,
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  OpaqueIDSchema,
  PositiveIntSchema,
} from '../wire/Primitives'

const PrWatchSchema = Schema.Struct({
  id: OpaqueIDSchema,
  projectId: OpaqueIDSchema,
  url: Schema.String,
  automation: AutomationSchema,
  threadId: OpaqueIDSchema,
  worktreeId: OpaqueIDSchema,
  reason: Schema.NullOr(Schema.String),
})
const PrWatchErrors = [
  'INVALID_REQUEST',
  'PROJECT_NOT_FOUND',
  'REPOSITORY_NOT_FOUND',
  'CONFLICT',
  'AUTOMATION_NOT_FOUND',
  'PERMISSION_DENIED',
  'GITHUB_AUTH_REQUIRED',
  'GITHUB_AUTH_INVALID',
  'GITHUB_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const

export const GithubUserSchema = Schema.Struct({
  login: NonEmptyStringSchema,
  id: PositiveIntSchema,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(NonEmptyStringSchema),
  htmlUrl: NonEmptyStringSchema,
})

export const GithubAuthStatusSchema = Schema.Struct({
  configured: Schema.Boolean,
  authenticated: Schema.Boolean,
  user: Schema.NullOr(GithubUserSchema),
  error: Schema.optional(Schema.String),
})

export const GithubAuthModeSchema = Schema.Literals(['browser', 'device'])

export const GithubLoginStatusSchema = Schema.Struct({
  loginId: OpaqueIDSchema,
  mode: GithubAuthModeSchema,
  state: Schema.Literals(['starting', 'awaiting_auth', 'completed', 'failed']),
  authorizationUrl: Schema.NullOr(NonEmptyStringSchema),
  userCode: Schema.NullOr(NonEmptyStringSchema),
  verificationUri: Schema.NullOr(NonEmptyStringSchema),
  expiresAt: Schema.NullOr(NonEmptyStringSchema),
  error: Schema.NullOr(Schema.String),
  auth: Schema.NullOr(GithubAuthStatusSchema),
  elapsedMs: NonNegativeIntSchema,
})

export const GithubRepositorySchema = Schema.Struct({
  id: PositiveIntSchema,
  name: NonEmptyStringSchema,
  fullName: NonEmptyStringSchema,
  owner: NonEmptyStringSchema,
  private: Schema.Boolean,
  fork: Schema.Boolean,
  archived: Schema.Boolean,
  disabled: Schema.Boolean,
  cloneUrl: NonEmptyStringSchema,
  sshUrl: NonEmptyStringSchema,
  htmlUrl: NonEmptyStringSchema,
  description: Schema.NullOr(Schema.String),
  defaultBranch: NonEmptyStringSchema,
  pushedAt: Schema.NullOr(NonEmptyStringSchema),
  updatedAt: Schema.NullOr(NonEmptyStringSchema),
})

export const GithubWorkspaceStatusSchema = Schema.Struct({
  branchName: Schema.NullOr(NonEmptyStringSchema),
  upstream: Schema.NullOr(NonEmptyStringSchema),
  ahead: NonNegativeIntSchema,
  behind: NonNegativeIntSchema,
  clean: Schema.Boolean,
  files: Schema.Array(
    Schema.Struct({
      path: NonEmptyStringSchema,
      originalPath: Schema.optional(NonEmptyStringSchema),
      status: NonEmptyStringSchema,
      stagedStatus: Schema.String,
      unstagedStatus: Schema.String,
      additions: Schema.Null,
      deletions: Schema.Null,
      isUntracked: Schema.Boolean,
    }),
  ),
})

const GithubProfileRepositorySchema = Schema.Struct({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  fullName: NonEmptyStringSchema,
  url: NonEmptyStringSchema,
  description: Schema.NullOr(Schema.String),
  isPrivate: Schema.Boolean,
  isFork: Schema.Boolean,
  primaryLanguage: Schema.NullOr(
    Schema.Struct({
      name: NonEmptyStringSchema,
      color: Schema.NullOr(Schema.String),
    }),
  ),
  stargazerCount: NonNegativeIntSchema,
  forkCount: NonNegativeIntSchema,
  updatedAt: NonEmptyStringSchema,
})

export const GithubProfileOverviewSchema = Schema.Struct({
  user: Schema.Struct({
    ...GithubUserSchema.fields,
    bio: Schema.NullOr(Schema.String),
    company: Schema.NullOr(Schema.String),
    location: Schema.NullOr(Schema.String),
    websiteUrl: Schema.NullOr(Schema.String),
    email: Schema.NullOr(Schema.String),
    followers: NonNegativeIntSchema,
    following: NonNegativeIntSchema,
    repositoryCount: NonNegativeIntSchema,
    starredRepositoryCount: NonNegativeIntSchema,
    status: Schema.NullOr(
      Schema.Struct({
        emoji: Schema.NullOr(Schema.String),
        message: Schema.NullOr(Schema.String),
        indicatesLimitedAvailability: Schema.Boolean,
        expiresAt: Schema.NullOr(NonEmptyStringSchema),
      }),
    ),
  }),
  organizations: Schema.Array(
    Schema.Struct({
      login: NonEmptyStringSchema,
      avatarUrl: NonEmptyStringSchema,
      url: NonEmptyStringSchema,
    }),
  ),
  pinnedRepositories: Schema.Array(GithubProfileRepositorySchema),
  popularRepositories: Schema.Array(GithubProfileRepositorySchema),
  contributions: Schema.Struct({
    totalContributions: NonNegativeIntSchema,
    totalCommitContributions: NonNegativeIntSchema,
    totalIssueContributions: NonNegativeIntSchema,
    totalPullRequestContributions: NonNegativeIntSchema,
    totalPullRequestReviewContributions: NonNegativeIntSchema,
    restrictedContributionsCount: NonNegativeIntSchema,
    weeks: Schema.Array(
      Schema.Struct({
        days: Schema.Array(
          Schema.Struct({
            date: NonEmptyStringSchema,
            count: NonNegativeIntSchema,
            color: NonEmptyStringSchema,
          }),
        ),
      }),
    ),
  }),
})

export const GithubPullRequestSchema = Schema.Struct({
  id: PositiveIntSchema,
  number: PositiveIntSchema,
  title: NonEmptyStringSchema,
  body: Schema.NullOr(Schema.String),
  state: NonEmptyStringSchema,
  draft: Schema.Boolean,
  htmlUrl: NonEmptyStringSchema,
  base: Schema.Struct({ ref: NonEmptyStringSchema, sha: NonEmptyStringSchema }),
  head: Schema.Struct({ ref: NonEmptyStringSchema, sha: NonEmptyStringSchema }),
  additions: NonNegativeIntSchema,
  deletions: NonNegativeIntSchema,
  changedFiles: NonNegativeIntSchema,
  mergeable: Schema.NullOr(Schema.Boolean),
})

const GithubRepositoryIdentityFields = {
  owner: NonEmptyStringSchema,
  repository: NonEmptyStringSchema,
}

const GithubPullRequestIdentityFields = {
  ...GithubRepositoryIdentityFields,
  number: PositiveIntSchema,
}

const GithubErrors = [
  'GITHUB_AUTH_REQUIRED',
  'GITHUB_AUTH_INVALID',
  'GITHUB_OAUTH_FAILED',
  'GITHUB_API_FAILED',
  'GITHUB_UNAVAILABLE',
  'GITHUB_RATE_LIMITED',
  'GITHUB_REMOTE_UNSUPPORTED',
  'GITHUB_PUSH_FAILED',
  'GITHUB_RESPONSE_INVALID',
  'GITHUB_GRAPHQL_FAILED',
  'GIT_REMOTE_NOT_FOUND',
  'GIT_BRANCH_REQUIRED',
  'GIT_STATUS_FAILED',
  'GIT_OUTPUT_TOO_LARGE',
  'GIT_OUTPUT_ENCODING_INVALID',
  'PROJECT_NOT_FOUND',
  'PATH_DENIED',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const

const ThreadPullRequestErrors = [...GithubErrors, 'THREAD_NOT_FOUND', 'INVALID_REQUEST'] as const

const ThreadPullRequestBatchResultSchema = Schema.Struct({
  threads: Schema.Array(ThreadPullRequestListSchema),
})

const ThreadPullRequestThreadResultSchema = Schema.Struct({
  thread: ThreadPullRequestListSchema,
})

export const GithubRpcMethods = {
  'github/watch/start': defineMethod({
    params: Schema.Struct({
      projectId: OpaqueIDSchema,
      url: NonEmptyStringSchema,
      model: ModelRefSchema,
      permissionConfig: PermissionConfigSchema,
      reasoningEffort: Schema.optional(NonEmptyStringSchema),
    }),
    result: PrWatchSchema,
    errors: PrWatchErrors,
    capability: 'github.watch.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'github/watch/list': defineMethod({
    params: EmptyParamsSchema,
    result: Schema.Struct({ watches: Schema.Array(PrWatchSchema) }),
    errors: PrWatchErrors,
    capability: 'github.watch.v1',
    mutation: false,
    exactResult: true,
  }),
  'github/watch/read': defineMethod({
    params: Schema.Struct({ id: OpaqueIDSchema }),
    result: PrWatchSchema,
    errors: PrWatchErrors,
    capability: 'github.watch.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'github/watch/stop': defineMethod({
    params: Schema.Struct({ id: OpaqueIDSchema }),
    result: PrWatchSchema,
    errors: PrWatchErrors,
    capability: 'github.watch.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'github/watch/update': defineMethod({
    params: Schema.Struct({
      id: OpaqueIDSchema,
      expectedRevision: PositiveIntSchema,
      status: Schema.Literals(['active', 'paused']),
    }),
    result: PrWatchSchema,
    errors: PrWatchErrors,
    capability: 'github.watch.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'github/auth/status': defineMethod({
    params: EmptyParamsSchema,
    result: GithubAuthStatusSchema,
    errors: GithubErrors,
    capability: 'github.oauth.v1',
    mutation: false,
    exactResult: true,
  }),
  'github/auth/start': defineMethod({
    params: Schema.Struct({ mode: GithubAuthModeSchema }),
    result: GithubLoginStatusSchema,
    errors: GithubErrors,
    capability: 'github.oauth.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'github/auth/poll': defineMethod({
    params: Schema.Struct({ loginId: OpaqueIDSchema }),
    result: GithubLoginStatusSchema,
    errors: GithubErrors,
    capability: 'github.oauth.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'github/auth/logout': defineMethod({
    params: EmptyParamsSchema,
    result: GithubAuthStatusSchema,
    errors: GithubErrors,
    capability: 'github.oauth.v1',
    mutation: true,
    exactResult: true,
  }),
  'github/profile': defineMethod({
    params: EmptyParamsSchema,
    result: Schema.Struct({ user: GithubUserSchema }),
    errors: GithubErrors,
    capability: 'github.oauth.v1',
    mutation: false,
    exactResult: true,
  }),
  'github/profileOverview': defineMethod({
    params: EmptyParamsSchema,
    result: Schema.Struct({ overview: GithubProfileOverviewSchema }),
    errors: GithubErrors,
    capability: 'github.oauth.v1',
    mutation: false,
    exactResult: true,
  }),
  'github/repositories': defineMethod({
    params: EmptyParamsSchema,
    result: Schema.Struct({ repositories: Schema.Array(GithubRepositorySchema) }),
    errors: GithubErrors,
    capability: 'github.oauth.v1',
    mutation: false,
    exactResult: true,
  }),
  'github/repository/clone': defineMethod({
    params: Schema.Struct({
      repositoryId: PositiveIntSchema,
      targetParent: NonEmptyStringSchema,
    }),
    result: Schema.Struct({ project: AgentThread.ProjectSchema }),
    errors: GithubErrors,
    capability: 'github.oauth.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'github/pullRequest/read': defineMethod({
    params: Schema.Struct(GithubPullRequestIdentityFields),
    result: Schema.Struct({ pullRequest: GithubPullRequestSchema }),
    errors: GithubErrors,
    capability: 'github.pullRequests.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'github/pullRequest/create': defineMethod({
    params: Schema.Struct({
      ...GithubRepositoryIdentityFields,
      title: NonEmptyStringSchema,
      head: NonEmptyStringSchema,
      base: NonEmptyStringSchema,
      body: Schema.optional(Schema.String),
      draft: Schema.optional(Schema.Boolean),
    }),
    result: Schema.Struct({ pullRequest: GithubPullRequestSchema }),
    errors: GithubErrors,
    capability: 'github.pullRequests.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'github/pullRequest/createForProject': defineMethod({
    params: Schema.Struct({
      projectId: OpaqueIDSchema,
      title: NonEmptyStringSchema,
      body: Schema.optional(Schema.String),
      draft: Schema.optional(Schema.Boolean),
      /** When present the agent resolves the thread's real execution directory. */
      threadId: Schema.optional(OpaqueIDSchema),
    }),
    result: Schema.Struct({ pullRequest: GithubPullRequestSchema }),
    errors: GithubErrors,
    capability: 'github.pullRequests.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'github/pullRequest/comment': defineMethod({
    params: Schema.Struct({
      ...GithubPullRequestIdentityFields,
      body: NonEmptyStringSchema,
      path: NonEmptyStringSchema,
      side: Schema.Literals(['LEFT', 'RIGHT']),
      line: PositiveIntSchema,
      expectedHeadRevision: NonEmptyStringSchema,
      commitId: Schema.optional(NonEmptyStringSchema),
      startSide: Schema.optional(Schema.Literals(['LEFT', 'RIGHT'])),
      startLine: Schema.optional(PositiveIntSchema),
    }),
    result: Schema.Struct({
      comment: Schema.Struct({
        id: PositiveIntSchema,
        nodeId: NonEmptyStringSchema,
        htmlUrl: NonEmptyStringSchema,
        body: Schema.String,
      }),
    }),
    errors: GithubErrors,
    capability: 'github.pullRequests.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'github/pullRequest/resolveThread': defineMethod({
    params: Schema.Struct({ threadId: OpaqueIDSchema, resolved: Schema.optional(Schema.Boolean) }),
    result: Schema.Struct({
      thread: Schema.Struct({ id: OpaqueIDSchema, resolved: Schema.Boolean }),
    }),
    errors: GithubErrors,
    capability: 'github.pullRequests.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'github/pullRequest/submitReview': defineMethod({
    params: Schema.Struct({
      ...GithubPullRequestIdentityFields,
      event: Schema.Literals(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']),
      body: Schema.optional(Schema.String),
      expectedHeadRevision: NonEmptyStringSchema,
    }),
    result: Schema.Struct({
      review: Schema.Struct({
        id: PositiveIntSchema,
        state: NonEmptyStringSchema,
        htmlUrl: NonEmptyStringSchema,
      }),
    }),
    errors: GithubErrors,
    capability: 'github.pullRequests.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'github/push': defineMethod({
    params: Schema.Struct({
      projectId: OpaqueIDSchema,
      remote: Schema.optional(NonEmptyStringSchema),
      branch: Schema.optional(NonEmptyStringSchema),
      setUpstream: Schema.optional(Schema.Boolean),
      forceWithLease: Schema.optional(Schema.Boolean),
      /** When present the agent resolves the thread's real execution directory. */
      threadId: Schema.optional(OpaqueIDSchema),
    }),
    result: Schema.Struct({
      remote: NonEmptyStringSchema,
      branch: NonEmptyStringSchema,
      repositoryUrl: NonEmptyStringSchema,
      status: GithubWorkspaceStatusSchema,
    }),
    errors: GithubErrors,
    capability: 'github.pullRequests.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'github/thread/pullRequests': defineMethod({
    params: Schema.Struct({ threadIds: Schema.Array(OpaqueIDSchema) }),
    result: ThreadPullRequestBatchResultSchema,
    errors: ThreadPullRequestErrors,
    capability: 'github.threadPullRequests.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'github/thread/pullRequest/link': defineMethod({
    params: Schema.Struct({
      threadId: OpaqueIDSchema,
      url: NonEmptyStringSchema,
    }),
    result: ThreadPullRequestThreadResultSchema,
    errors: ThreadPullRequestErrors,
    capability: 'github.threadPullRequests.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'github/thread/pullRequest/unlink': defineMethod({
    params: Schema.Struct({
      threadId: OpaqueIDSchema,
      owner: NonEmptyStringSchema,
      repository: NonEmptyStringSchema,
      number: PositiveIntSchema,
    }),
    result: ThreadPullRequestThreadResultSchema,
    errors: ThreadPullRequestErrors,
    capability: 'github.threadPullRequests.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap
