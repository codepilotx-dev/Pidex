import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { EmptyParamsSchema, NonNegativeIntSchema, OperationParamsSchema } from '../wire/Primitives'

export const SpeechStateSchema = Schema.Literals([
  'unsupported',
  'not-installed',
  'downloading',
  'installing',
  'ready',
  'transcribing',
  'error',
])

export const SpeechStatusSchema = Schema.Struct({
  state: SpeechStateSchema,
  provider: Schema.Literal('sensevoice-llamacpp'),
  runtimeVersion: Schema.Literal('0.1.9'),
  model: Schema.Literal('sensevoice-small-q8'),
  variant: Schema.NullOr(Schema.Literals(['avx2', 'generic'])),
  progress: Schema.optional(
    Schema.Struct({
      receivedBytes: NonNegativeIntSchema,
      totalBytes: Schema.optional(NonNegativeIntSchema),
    }),
  ),
  maxDurationMs: Schema.Literal(120_000),
  maxAudioBytes: Schema.Literal(4_194_304),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.String,
      message: Schema.String,
    }),
  ),
})

export const SpeechStatusResultSchema = Schema.Struct({ status: SpeechStatusSchema })
export const SpeechInstallParamsSchema = Schema.Struct({
  force: Schema.optional(Schema.Boolean),
})
export const SpeechTranscribeParamsSchema = Schema.Struct({
  ...OperationParamsSchema.fields,
  audio: Schema.Struct({
    mediaType: Schema.Literal('audio/wav'),
    encoding: Schema.Literal('base64'),
    data: Schema.String,
  }),
})
export const SpeechTranscribeResultSchema = Schema.Struct({
  text: Schema.String,
  detectedLanguage: Schema.optional(Schema.Literals(['zh', 'yue', 'en', 'ja', 'ko', 'nospeech'])),
  durationMs: NonNegativeIntSchema,
})
export const SpeechCancelParamsSchema = OperationParamsSchema
export const SpeechCancelResultSchema = Schema.Struct({ cancelled: Schema.Boolean })

const SpeechErrors = [
  'SPEECH_PLATFORM_UNSUPPORTED',
  'SPEECH_RUNTIME_NOT_READY',
  'SPEECH_INSTALL_FAILED',
  'SPEECH_AUDIO_INVALID',
  'SPEECH_AUDIO_TOO_LARGE',
  'SPEECH_DURATION_LIMIT',
  'SPEECH_BUSY',
  'SPEECH_TIMEOUT',
  'SPEECH_CANCELLED',
  'SPEECH_TRANSCRIPTION_FAILED',
  'PERMISSION_DENIED',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const

export const SpeechRpcMethods = {
  'speech/status': defineMethod({
    params: Schema.Record(Schema.String, Schema.Never),
    result: SpeechStatusResultSchema,
    errors: SpeechErrors,
    capability: 'speech.transcription.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'speech/install': defineMethod({
    params: SpeechInstallParamsSchema,
    result: SpeechStatusResultSchema,
    errors: SpeechErrors,
    capability: 'speech.transcription.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'speech/transcribe': defineMethod({
    params: SpeechTranscribeParamsSchema,
    result: SpeechTranscribeResultSchema,
    errors: SpeechErrors,
    capability: 'speech.transcription.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'speech/cancel': defineMethod({
    params: SpeechCancelParamsSchema,
    result: SpeechCancelResultSchema,
    errors: SpeechErrors,
    capability: 'speech.transcription.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type SpeechStatus = typeof SpeechStatusSchema.Type
