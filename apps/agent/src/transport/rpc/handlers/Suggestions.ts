import {
  ComposerPredictionGenerateParamsSchema,
  TaskSuggestionGenerateParamsSchema,
  type RpcMethod,
} from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { AgentError } from '../../../Domain'
import { TaskSuggestionServiceError } from '../../../suggestion/TaskSuggestionService'
import { resolveMemoryProjectKey, type RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const decodeGenerate = Schema.decodeUnknownSync(TaskSuggestionGenerateParamsSchema)
const decodeComposerPrediction = Schema.decodeUnknownSync(ComposerPredictionGenerateParamsSchema)

export const suggestionHandlers = {
  name: 'suggestions',
  methods: ['task-suggestion/generate', 'composer-prediction/generate'],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    if (method === 'composer-prediction/generate') {
      const service = runtime.dependencies.composerPredictions
      if (!service) {
        throw new AgentError('PREDICTION_UNAVAILABLE', '输入预测服务未配置', 503)
      }
      const params = decodeComposerPrediction(rawParams)
      return await service.predict(params)
    }
    if (method !== 'task-suggestion/generate') return undefined
    const service = runtime.dependencies.suggestions
    if (!service) {
      throw new AgentError('SUGGESTION_UNAVAILABLE', '任务建议服务未配置', 503)
    }
    const params = decodeGenerate(rawParams)
    try {
      const projectKey =
        params.workspace.kind === 'project'
          ? await resolveMemoryProjectKey(runtime.dependencies.db, {
              projectId: params.workspace.projectId,
            })
          : undefined
      return await service.generate(params, projectKey)
    } catch (cause) {
      if (cause instanceof TaskSuggestionServiceError) {
        throw new AgentError('SUGGESTION_UNAVAILABLE', cause.message, 503)
      }
      throw cause
    }
  },
} as const satisfies RpcHandlerGroup
