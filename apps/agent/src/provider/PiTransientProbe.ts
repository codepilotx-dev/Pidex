import {
  normalizeContext,
  type Api,
  type AssistantMessage,
  type Model as PiModel,
  type SimpleStreamOptions,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import { piProviderApiStreams } from './pi/PiProviderApis'
import type { CustomProviderApi } from './pi/PiProviderConfig'

/** Standalone provider id for probe models; never registered in the global model catalog. */
export const TRANSIENT_PROBE_PROVIDER_ID = 'pidex-protocol-detection'

/** Per-request timeout of a transient protocol probe. */
export const TRANSIENT_PROBE_TIMEOUT_MS = 12_000

/** Minimal stream contract used by the probe: the terminal assistant message. */
export type TransientProbeStream = {
  result(): Promise<AssistantMessage>
}

/**
 * Adapter-shaped stream entry point. The production default is the Pi adapter
 * for the protocol under test; tests inject a deterministic implementation.
 */
export type TransientProbeStreamSimple = (
  model: PiModel<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions,
) => TransientProbeStream

export type TransientProbeResult =
  | { ok: true; latencyMs: number }
  /** Internal only: callers must classify and translate the cause, never return it as-is. */
  | { ok: false; cause: unknown }

export type TransientProbeInput = {
  readonly protocol: CustomProviderApi
  readonly modelId: string
  readonly baseUrl: string
  readonly headers?: Readonly<Record<string, string>>
  readonly apiKey?: string
  readonly providerId?: string
}

export type TransientProbeOptions = {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

export type PiTransientProbeOptions = {
  /** Test seam; production omits it and uses the real Pi adapter for each protocol. */
  readonly streamSimple?: TransientProbeStreamSimple
  readonly timeoutMs?: number
}

/**
 * Builds the throwaway Pi model used for one probe. It only exists in memory:
 * no Models registry entry, no config write and no active credential switch.
 */
export const createTransientProbeModel = (input: TransientProbeInput): PiModel<Api> => ({
  id: input.modelId,
  name: input.modelId,
  api: input.protocol,
  provider: input.providerId ?? TRANSIENT_PROBE_PROVIDER_ID,
  baseUrl: input.baseUrl,
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_768,
  maxTokens: 8_192,
  ...(input.headers && Object.keys(input.headers).length > 0
    ? { headers: { ...input.headers } }
    : {}),
})

const timeoutCause = (): unknown => new DOMException('Transient probe timed out.', 'TimeoutError')

/**
 * Google adapter failures surface the provider JSON body (including its HTTP
 * `code`) as display text and expose no status hook. Recovering that code lets
 * the shared failure classifier classify it instead of defaulting to unknown.
 */
const googleStatusFromMessage = (message: string | undefined): number | undefined => {
  if (!message) return undefined
  const match = /"code"\s*:\s*(\d{3})\b/.exec(message)
  return match?.[1] ? Number(match[1]) : undefined
}

/**
 * Runs one minimal generation request through a Pi wire-protocol adapter against
 * an ephemeral model. Returns a latency measurement or an internal failure cause;
 * the caller owns error classification and client-safe messages.
 */
export class PiTransientProbe {
  constructor(private readonly options: PiTransientProbeOptions = {}) {}

  async probe(
    input: TransientProbeInput,
    options: TransientProbeOptions = {},
  ): Promise<TransientProbeResult> {
    const timeoutMs = Math.max(
      1,
      options.timeoutMs ?? this.options.timeoutMs ?? TRANSIENT_PROBE_TIMEOUT_MS,
    )
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
    const model = createTransientProbeModel(input)
    const context = normalizeContext({
      messages: [{ role: 'user', content: 'Reply OK.', timestamp: Date.now() }],
    })
    // Adapters surface HTTP failures only as display text. Observing the response
    // status through a request-scoped fetch wrapper lets the existing failure
    // classifier see the real status without changing any adapter or category
    // logic. The Google adapter rejects custom fetch implementations.
    const observedStatus: { status?: number } = {}
    const fetchImpl: typeof globalThis.fetch | undefined =
      input.protocol === 'google-generative-ai'
        ? undefined
        : ((async (request: RequestInfo | URL, init?: RequestInit) => {
            const response = await globalThis.fetch(request, init)
            observedStatus.status = response.status
            return response
          }) as typeof globalThis.fetch)
    const failureCause = (message: string | undefined): unknown => {
      const cause = new Error(message ?? 'Transient probe request failed')
      const status =
        observedStatus.status ??
        (input.protocol === 'google-generative-ai' ? googleStatusFromMessage(message) : undefined)
      if (status !== undefined) Object.assign(cause, { statusCode: status })
      return cause
    }
    const startedAt = performance.now()
    try {
      const streamSimple =
        this.options.streamSimple ?? piProviderApiStreams[input.protocol]().streamSimple
      const stream = streamSimple(model, context, {
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        maxTokens: 8,
        maxRetries: 0,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
        signal,
      })
      const response = await stream.result()
      if (response.stopReason === 'error' || response.stopReason === 'aborted') {
        if (timeoutSignal.aborted) return { ok: false, cause: timeoutCause() }
        return { ok: false, cause: failureCause(response.errorMessage) }
      }
      return { ok: true, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) }
    } catch (cause) {
      if (timeoutSignal.aborted || options.signal?.aborted) {
        return { ok: false, cause: timeoutCause() }
      }
      return { ok: false, cause }
    }
  }
}
