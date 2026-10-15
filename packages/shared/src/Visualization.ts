import { Schema } from 'effect'

export const VISUALIZATION_TOOL = 'generate_interactive_ui'
export const VISUALIZATION_MAX_SOURCE = 512_000
export const VisualizationLibrarySchema = Schema.Literals(['chartjs', 'd3', 'three'])
export type VisualizationLibrary = typeof VisualizationLibrarySchema.Type
const source = Schema.String.check(Schema.isMaxLength(VISUALIZATION_MAX_SOURCE))
export const VisualizationDocumentSchema = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200)),
  summary: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(4000)),
  libraries: Schema.Array(VisualizationLibrarySchema).check(Schema.isMaxLength(3)),
  initialHeight: Schema.Number.check(Schema.isBetween({ minimum: 50, maximum: 4000 })),
  css: source,
  html: source,
  jsFunctions: source,
  jsExpressions: Schema.Array(source).check(Schema.isMaxLength(20)),
})
export type VisualizationDocument = typeof VisualizationDocumentSchema.Type
export const VisualizationEnvelopeSchema = Schema.Struct({
  kind: Schema.Literal('pidex.visualization'),
  version: Schema.Literal(1),
  document: VisualizationDocumentSchema,
  resources: Schema.Array(
    Schema.Struct({
      library: VisualizationLibrarySchema,
      artifactId: Schema.String.check(Schema.isMinLength(1)),
    }),
  ).check(Schema.isMaxLength(3)),
})
export type VisualizationEnvelope = typeof VisualizationEnvelopeSchema.Type
const decode = Schema.decodeUnknownSync(VisualizationEnvelopeSchema)
export function decodeVisualization(value: unknown): VisualizationEnvelope | null {
  try {
    if (JSON.stringify(value).length > VISUALIZATION_MAX_SOURCE) return null
    const result = decode(value)
    if (new Set(result.document.libraries).size !== result.document.libraries.length) return null
    if (
      result.resources.length !== result.document.libraries.length ||
      result.document.libraries.some(
        (library) => result.resources.filter((r) => r.library === library).length !== 1,
      )
    )
      return null
    return result
  } catch {
    return null
  }
}
export const VisualizationPreviewSchema = Schema.Struct({
  toolCallId: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  title: Schema.String.check(Schema.isMaxLength(200)),
  summary: Schema.String.check(Schema.isMaxLength(4000)),
  initialHeight: Schema.Number.check(Schema.isBetween({ minimum: 50, maximum: 4000 })),
  css: source,
  html: source,
  cssComplete: Schema.Boolean,
})
export type VisualizationPreview = typeof VisualizationPreviewSchema.Type

export function visualizationFromBlocks(
  blocks: readonly { type: string; value?: unknown }[] | undefined,
) {
  for (const block of blocks ?? []) {
    if (block.type === 'json') {
      const envelope = decodeVisualization(block.value)
      if (envelope) return envelope
    }
  }
  return null
}
