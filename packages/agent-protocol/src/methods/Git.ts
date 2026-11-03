import { AgentThread } from '@pidex/shared'
import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { NonEmptyStringSchema, OpaqueIDSchema } from '../wire/Primitives'
import { ReviewGitStatusSchema } from './Review'

const GitWorkspaceErrors = [
  'PROJECT_NOT_FOUND',
  'REPOSITORY_NOT_FOUND',
  'GIT_BRANCH_REQUIRED',
  'GIT_BRANCH_INVALID',
  'GIT_BRANCH_EXISTS',
  'GIT_BRANCH_NOT_FOUND',
  'GIT_CHECKOUT_CONFLICT',
  'GIT_PULL_FAILED',
  'GIT_STATUS_FAILED',
  'GIT_COMMAND_FAILED',
  'GIT_OUTPUT_TOO_LARGE',
  'GIT_OUTPUT_ENCODING_INVALID',
  'PATH_DENIED',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const

const GitWorkspaceResultSchema = Schema.Struct({
  project: AgentThread.ProjectSchema,
  status: ReviewGitStatusSchema,
})

export const GitRpcMethods = {
  'git/message/generate': defineMethod({
    params: Schema.Struct({
      projectId: OpaqueIDSchema,
      threadId: Schema.optional(OpaqueIDSchema),
      kind: Schema.Literals(['commit', 'pullRequest']),
      paths: Schema.optional(Schema.Array(NonEmptyStringSchema)),
    }),
    result: Schema.Struct({ title: Schema.String, body: Schema.String }),
    errors: [...GitWorkspaceErrors, 'MODEL_UNAVAILABLE', 'PERMISSION_DENIED', 'THREAD_NOT_FOUND'],
    capability: 'git.generate.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'git/branch/create': defineMethod({
    params: Schema.Struct({
      projectId: OpaqueIDSchema,
      branchName: NonEmptyStringSchema,
      startPoint: Schema.optional(NonEmptyStringSchema),
    }),
    result: GitWorkspaceResultSchema,
    errors: GitWorkspaceErrors,
    capability: 'git.workspace.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'git/branch/checkout': defineMethod({
    params: Schema.Struct({
      projectId: OpaqueIDSchema,
      branchName: NonEmptyStringSchema,
    }),
    result: GitWorkspaceResultSchema,
    errors: GitWorkspaceErrors,
    capability: 'git.workspace.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'git/fetch': defineMethod({
    params: Schema.Struct({
      projectId: OpaqueIDSchema,
    }),
    result: GitWorkspaceResultSchema,
    errors: GitWorkspaceErrors,
    capability: 'git.sync.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'git/pull': defineMethod({
    params: Schema.Struct({
      projectId: OpaqueIDSchema,
    }),
    result: GitWorkspaceResultSchema,
    errors: GitWorkspaceErrors,
    capability: 'git.sync.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap
