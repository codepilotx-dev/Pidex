import { ReviewFileDiffsParamsSchema, type RpcMethod } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import type { RpcRouter } from '../RpcRouter'
import { decodeRpcParams as decodeParams, optionalRpcRecord as optionalRecord } from '../Decoders'
import {
  AgentError,
  aiReviewModel,
  aiReviewPrompt,
  aiReviewTitle,
  decodeReviewAiStart,
  decodeReviewApply,
  decodeReviewApplyBatch,
  decodeReviewBranches,
  decodeReviewCommentID,
  decodeReviewCommentList,
  decodeReviewCommentSave,
  decodeReviewCommit,
  decodeReviewCommits,
  decodeReviewFileDiff,
  decodeReviewStatus,
  decodeReviewSummary,
  positiveIntegerParam,
  resolveAiReviewSource,
  resolveProjectWorkspace,
  stringParam,
} from '../RpcRouter'
import type { RpcHandlerGroup } from './Types'

const decodeReviewFileDiffs = Schema.decodeUnknownSync(ReviewFileDiffsParamsSchema)

export const reviewHandlers = {
  name: 'review',
  methods: [
    'review/summary',
    'review/refresh',
    'review/pullRequest/prepare',
    'review/fileDiff',
    'review/file-diffs',
    'review/apply',
    'review/applyBatch',
    'review/branches',
    'review/commits',
    'review/status',
    'review/commit',
    'review/comment/list',
    'review/comment/save',
    'review/comment/resolve',
    'review/comment/delete',
    'review/ai/start',
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown): Promise<unknown> {
    const { db, threads, providers, piModels, review, github } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
      case 'review/summary': {
        const input = decodeParams(decodeReviewSummary, rawParams, method)
        return review.summaryResult(input.projectId, input.source)
      }
      case 'review/refresh': {
        const input = decodeParams(decodeReviewSummary, rawParams, method)
        return review.summaryResult(input.projectId, input.source, true)
      }
      case 'review/pullRequest/prepare': {
        const workspace = await resolveProjectWorkspace(db, stringParam(params, 'projectId'))
        return github.preparePullRequestComparison({
          workspaceRoot: workspace.rootPath,
          owner: stringParam(params, 'owner'),
          repository: stringParam(params, 'repository'),
          number: positiveIntegerParam(params, 'number'),
          ...(typeof params.force === 'boolean' ? { force: params.force } : {}),
        })
      }
      case 'review/fileDiff': {
        const input = decodeParams(decodeReviewFileDiff, rawParams, method)
        return review.fileDiff(input)
      }
      case 'review/file-diffs': {
        const input = decodeParams(decodeReviewFileDiffs, rawParams, method)
        return review.fileDiffs(input)
      }
      case 'review/apply': {
        const input = decodeParams(decodeReviewApply, rawParams, method)
        return review.apply(input)
      }
      case 'review/applyBatch': {
        const input = decodeParams(decodeReviewApplyBatch, rawParams, method)
        return review.applyBatch(input)
      }
      case 'review/branches': {
        const input = decodeParams(decodeReviewBranches, rawParams, method)
        return review.branches(input.projectId)
      }
      case 'review/commits': {
        const input = decodeParams(decodeReviewCommits, rawParams, method)
        return review.commits(input.projectId, input.limit)
      }
      case 'review/status': {
        const input = decodeParams(decodeReviewStatus, rawParams, method)
        return { status: await review.status(input.projectId) }
      }
      case 'review/commit': {
        const input = decodeParams(decodeReviewCommit, rawParams, method)
        return review.commit(input)
      }
      case 'review/comment/list': {
        const input = decodeParams(decodeReviewCommentList, rawParams, method)
        return { comments: review.listComments(input) }
      }
      case 'review/comment/save': {
        const input = decodeParams(decodeReviewCommentSave, rawParams, method)
        return { comment: review.saveComment(input) }
      }
      case 'review/comment/resolve': {
        const input = decodeParams(decodeReviewCommentID, rawParams, method)
        return { comment: review.resolveComment(input) }
      }
      case 'review/comment/delete': {
        const input = decodeParams(decodeReviewCommentID, rawParams, method)
        return review.deleteComment(input)
      }
      case 'review/ai/start': {
        const input = decodeParams(decodeReviewAiStart, rawParams, method)
        const sourceThread = threads.get(input.threadId)
        const projectID = db.threadProjectID(input.threadId)
        if (!projectID) throw new AgentError('PROJECT_REQUIRED', '当前任务未绑定项目', 409)
        const source = await resolveAiReviewSource(review, projectID, input.target)
        const targetThread =
          input.delivery === 'detached'
            ? await threads.create({
                title: aiReviewTitle(input.target),
                workspace: { kind: 'project', projectID },
                settings: sourceThread.settings,
                operationID: crypto.randomUUID(),
              })
            : sourceThread
        const model = await aiReviewModel(
          db,
          providers,
          piModels,
          runtime.dependencies.config,
          input.threadId,
          projectID,
        )
        const submitted = await threads.submit(targetThread.id, {
          content: aiReviewPrompt(input.target),
          model,
          permissionConfig: sourceThread.settings.permissionConfig,
          strategy: 'queue',
          taskMode: 'chat',
        })
        return {
          threadId: targetThread.id,
          turnId: submitted.turnID,
          delivery: input.delivery,
          source,
        }
      }
      default:
        throw new AgentError('METHOD_NOT_FOUND', `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
