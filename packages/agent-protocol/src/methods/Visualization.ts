import { Schema } from 'effect'
import { defineMethod } from '../wire/Definition'
import { AdmissionSchema, JsonValueSchema, OpaqueIDSchema } from '../wire/Primitives'
import { CoreRpcMethods } from './Core'

export const VisualizationFollowUpParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  itemId: OpaqueIDSchema,
  turnId: Schema.optional(OpaqueIDSchema),
  inputId: OpaqueIDSchema,
  text: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(4000)),
  selection: Schema.optional(JsonValueSchema),
  repair: Schema.optional(Schema.Boolean),
})
export const VisualizationRpcMethods = {
  'visualization/submitFollowUp': defineMethod({
    params: VisualizationFollowUpParamsSchema,
    result: AdmissionSchema,
    errors: ['PERMISSION_DENIED', 'INVALID_REQUEST', ...CoreRpcMethods['turn/start'].errors],
    capability: 'visualizations.v1',
    mutation: true,
    exactParams: true,
  }),
} as const
