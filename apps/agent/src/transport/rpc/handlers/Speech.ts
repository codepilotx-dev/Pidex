import {
  SpeechCancelParamsSchema,
  SpeechInstallParamsSchema,
  SpeechTranscribeParamsSchema,
  type RpcMethod,
} from '@pidex/agent-protocol'
import { Schema } from 'effect'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const decodeInstall = Schema.decodeUnknownSync(SpeechInstallParamsSchema)
const decodeTranscribe = Schema.decodeUnknownSync(SpeechTranscribeParamsSchema)
const decodeCancel = Schema.decodeUnknownSync(SpeechCancelParamsSchema)

export const speechHandlers = {
  name: 'speech',
  methods: ['speech/status', 'speech/install', 'speech/transcribe', 'speech/cancel'],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ) {
    const speech = runtime.dependencies.speech
    switch (method) {
      case 'speech/status':
        return { status: speech.status() }
      case 'speech/install':
        return { status: await speech.install(decodeInstall(rawParams).force === true) }
      case 'speech/transcribe':
        return speech.transcribe(decodeTranscribe(rawParams))
      case 'speech/cancel':
        return speech.cancel(decodeCancel(rawParams).operationId)
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
