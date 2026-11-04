import { Schema } from 'effect'
import { VisualizationFollowUpParamsSchema } from '@pidex/agent-protocol'
import { submitVisualizationFollowUp } from '../../../tool/IntelligentUi/FollowUp'
import { globalEventSequence } from '../../../storage/events/EventPublisher'
import type { RpcHandlerGroup } from './Types'

const decode = Schema.decodeUnknownSync(VisualizationFollowUpParamsSchema)
export const visualizationHandlers = {
  name: 'visualization',
  methods: ['visualization/submitFollowUp'],
  async handle(runtime, _method, rawParams) {
    const input = decode(rawParams)
    runtime.dependencies.handoff.assertAdmissionOpen(input.threadId)
    const submitted = await submitVisualizationFollowUp(
      runtime.dependencies.db,
      runtime.dependencies.threads,
      input,
    )
    return {
      inputId: submitted.inputID,
      turnId: submitted.turnID,
      disposition: submitted.disposition === 'duplicate' ? 'duplicate' : 'accepted',
      streamPosition: {
        streamId: input.threadId,
        sequence: globalEventSequence(runtime.dependencies.db),
      },
    }
  },
} as const satisfies RpcHandlerGroup
