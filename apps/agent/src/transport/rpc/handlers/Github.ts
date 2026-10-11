import type { RpcMethod } from '@pidex/agent-protocol'
import { RpcMethods } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import type { RpcRouter } from '../RpcRouter'
import { optionalRpcRecord as optionalRecord } from '../Decoders'
import {
  AgentError,
  enumValue,
  githubPullRequestIdentity,
  githubRepositoryIdentity,
  positiveIntegerParam,
  resolveProjectWorkspace,
  stringParam,
} from '../RpcRouter'
import type { RpcHandlerGroup } from './Types'
import { ProjectService } from '../../../project/ProjectService'

export const githubHandlers = {
  name: 'github',
  methods: [
    'github/watch/start',
    'github/watch/list',
    'github/watch/read',
    'github/watch/update',
    'github/watch/stop',
    'github/auth/status',
    'github/auth/start',
    'github/auth/poll',
    'github/auth/logout',
    'github/profile',
    'github/profileOverview',
    'github/repositories',
    'github/repository/clone',
    'github/pullRequest/read',
    'github/pullRequest/create',
    'github/pullRequest/createForProject',
    'github/pullRequest/comment',
    'github/pullRequest/resolveThread',
    'github/pullRequest/submitReview',
    'github/push',
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown): Promise<unknown> {
    const { db, projectSources, github } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
      case 'github/watch/start':
      case 'github/watch/list':
      case 'github/watch/read':
      case 'github/watch/update':
      case 'github/watch/stop': {
        const service = runtime.dependencies.prWatches
        if (!service) throw new AgentError('INTERNAL_ERROR', 'PR 监控暂不可用', 503)
        if (method === 'github/watch/start') {
          const input = Schema.decodeUnknownSync(RpcMethods[method].params)(rawParams)
          return service.start({
            projectId: input.projectId,
            url: input.url,
            model: input.model,
            permissionConfig: input.permissionConfig,
            ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
          })
        }
        if (method === 'github/watch/list') return { watches: service.list() }
        const id = stringParam(params, 'id')
        if (method === 'github/watch/read') return service.read(id)
        if (method === 'github/watch/stop') return service.stop(id)
        const input = Schema.decodeUnknownSync(RpcMethods[method].params)(rawParams)
        const current = service.read(id)
        if (input.status === 'active')
          await runtime.dependencies.automation.resume(
            current.automation.id,
            input.expectedRevision,
          )
        else
          await runtime.dependencies.automation.pause(current.automation.id, input.expectedRevision)
        return service.read(id)
      }
      case 'github/auth/status':
        return github.authStatus()
      case 'github/auth/start':
        return github.startAuth(enumValue(params.mode, ['browser', 'device'] as const, 'mode'))
      case 'github/auth/poll':
        return github.pollAuth(stringParam(params, 'loginId'))
      case 'github/auth/logout':
        return github.logout()
      case 'github/profile':
        return github.profile()
      case 'github/profileOverview':
        return github.profileOverview()
      case 'github/repositories':
        return github.repositories()
      case 'github/repository/clone': {
        const repositoryId = positiveIntegerParam(params, 'repositoryId')
        const { repositoryRoot } = await github.cloneRepository({
          repositoryId,
          targetParent: stringParam(params, 'targetParent'),
        })
        return new ProjectService(db, projectSources).create({
          primaryPath: repositoryRoot,
          operationID: crypto.randomUUID(),
        })
      }
      case 'github/pullRequest/read':
        return github.readPullRequest(githubPullRequestIdentity(params))
      case 'github/pullRequest/create':
        return github.createPullRequest({
          ...githubRepositoryIdentity(params),
          title: stringParam(params, 'title'),
          head: stringParam(params, 'head'),
          base: stringParam(params, 'base'),
          ...(typeof params.body === 'string' ? { body: params.body } : {}),
          ...(typeof params.draft === 'boolean' ? { draft: params.draft } : {}),
        })
      case 'github/pullRequest/createForProject': {
        const workspace = await resolveProjectWorkspace(db, stringParam(params, 'projectId'))
        return github.createPullRequestForProject({
          workspaceRoot: workspace.rootPath,
          title: stringParam(params, 'title'),
          ...(typeof params.body === 'string' ? { body: params.body } : {}),
          ...(typeof params.draft === 'boolean' ? { draft: params.draft } : {}),
        })
      }
      case 'github/pullRequest/comment':
        return github.createPullRequestComment({
          ...githubPullRequestIdentity(params),
          body: stringParam(params, 'body'),
          path: stringParam(params, 'path'),
          side: enumValue(params.side, ['LEFT', 'RIGHT'], 'side'),
          line: positiveIntegerParam(params, 'line'),
          expectedHeadRevision: stringParam(params, 'expectedHeadRevision'),
          ...(typeof params.commitId === 'string' ? { commitId: params.commitId } : {}),
          ...(params.startSide === 'LEFT' || params.startSide === 'RIGHT'
            ? { startSide: params.startSide }
            : {}),
          ...(typeof params.startLine === 'number'
            ? { startLine: positiveIntegerParam(params, 'startLine') }
            : {}),
        })
      case 'github/pullRequest/resolveThread':
        return github.setReviewThreadResolved({
          threadId: stringParam(params, 'threadId'),
          ...(typeof params.resolved === 'boolean' ? { resolved: params.resolved } : {}),
        })
      case 'github/pullRequest/submitReview':
        return github.submitPullRequestReview({
          ...githubPullRequestIdentity(params),
          event: enumValue(params.event, ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'], 'event'),
          expectedHeadRevision: stringParam(params, 'expectedHeadRevision'),
          ...(typeof params.body === 'string' ? { body: params.body } : {}),
        })
      case 'github/push': {
        const workspace = await resolveProjectWorkspace(db, stringParam(params, 'projectId'))
        return github.push({
          workspaceRoot: workspace.rootPath,
          ...(typeof params.remote === 'string' ? { remote: params.remote } : {}),
          ...(typeof params.branch === 'string' ? { branch: params.branch } : {}),
          ...(typeof params.setUpstream === 'boolean' ? { setUpstream: params.setUpstream } : {}),
          ...(typeof params.forceWithLease === 'boolean'
            ? { forceWithLease: params.forceWithLease }
            : {}),
        })
      }
      default:
        throw new AgentError('METHOD_NOT_FOUND', `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
