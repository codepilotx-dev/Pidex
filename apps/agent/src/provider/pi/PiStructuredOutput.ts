import {
  contentText,
  type Tool,
  type Api,
  type Model as PiModel,
  type Models,
} from '@earendil-works/pi-ai'
import { z } from 'zod'

const jsonPayload = (text: string) => {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]
  const candidate = fenced ?? trimmed
  try {
    return JSON.parse(candidate) as unknown
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) throw new SyntaxError('Pi 模型没有返回有效 JSON')
    return JSON.parse(candidate.slice(start, end + 1)) as unknown
  }
}

const isOfficialOpenAIResponses = (model: PiModel<Api>) => {
  if (model.provider !== 'openai' || model.api !== 'openai-responses') return false
  try {
    return new URL(model.baseUrl).hostname.toLowerCase() === 'api.openai.com'
  } catch {
    return false
  }
}

export class PiStructuredOutputError extends Error {
  readonly code: 'STRUCTURED_OUTPUT_MISSING'

  constructor() {
    super('结构化输出未调用提交工具')
    this.name = 'PiStructuredOutputError'
    this.code = 'STRUCTURED_OUTPUT_MISSING'
  }
}

export type PiGenerationDiagnostic = {
  stage: 'schema' | 'request' | 'tool-result' | 'json' | 'validation'
  reason:
    | 'schema'
    | 'authentication'
    | 'rate-limit'
    | 'network'
    | 'provider'
    | 'missing-tool'
    | 'invalid-json'
    | 'invalid-schema'
    | 'unsupported-api'
    | 'invalid-request'
    | 'runtime-type'
    | 'stream-incomplete'
  status?: number
}

// Only emit fixed categories and HTTP status codes, never provider error text.
function failureDiagnostic(
  stage: PiGenerationDiagnostic['stage'],
  error: unknown,
): PiGenerationDiagnostic {
  const record =
    error !== null && typeof error === 'object' ? (error as Record<string, unknown>) : {}
  const message = error instanceof Error ? error.message : ''
  const rawStatus =
    record.status ?? record.statusCode ?? message.match(/^(?:HTTP\s+)?([45]\d{2})\b/i)?.[1]
  const status = Number(rawStatus)
  const reason: PiGenerationDiagnostic['reason'] =
    stage === 'schema'
      ? 'schema'
      : error instanceof PiStructuredOutputError
        ? 'missing-tool'
        : error instanceof z.ZodError
          ? 'invalid-schema'
          : stage === 'json'
            ? 'invalid-json'
            : status === 401 ||
                status === 403 ||
                /No API key|auth failed|OAuth .*failed|Credential store .*failed/i.test(message)
              ? 'authentication'
              : status === 429
                ? 'rate-limit'
                : /ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network error/i.test(
                      message,
                    )
                  ? 'network'
                  : /No API provider|no API implementation|Mismatched api|not support|unsupported/i.test(
                        message,
                      )
                    ? 'unsupported-api'
                    : error instanceof TypeError ||
                        /is not a function|is not an object|Cannot read propert|undefined is not/i.test(
                          message,
                        )
                      ? 'runtime-type'
                      : /stream ended|without finish_reason|without a stop reason/i.test(message)
                        ? 'stream-incomplete'
                        : status === 400 || status === 422
                          ? 'invalid-request'
                          : 'provider'
  return {
    stage,
    reason,
    ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { status } : {}),
  }
}

export async function generatePiObject<TSchema extends z.ZodType>(input: {
  models: Models
  model: PiModel<Api>
  schema: TSchema
  schemaName: string
  system: string
  prompt: string
  signal?: AbortSignal
  onFailure?: (diagnostic: PiGenerationDiagnostic) => void
}): Promise<z.output<TSchema>> {
  let stage: PiGenerationDiagnostic['stage'] = 'schema'
  try {
    // Type.Unsafe adds function-valued Standard Schema metadata that cannot be
    // structured-cloned by Pi's constrained-sampling conversion.
    const parameters = z.toJSONSchema(input.schema) as Tool['parameters']
    const toolName = `submit_${input.schemaName}`
    const strictToolCall = isOfficialOpenAIResponses(input.model)
    stage = 'request'
    const response = await input.models.completeSimple(
      input.model,
      {
        systemPrompt: [
          input.system,
          `必须调用 ${toolName} 提交符合 ${input.schemaName} 的结果，不要返回说明文字。`,
        ].join('\n'),
        messages: [{ role: 'user', content: input.prompt, timestamp: Date.now() }],
        tools: [
          {
            name: toolName,
            description: `提交符合 ${input.schemaName} schema 的结构化结果`,
            parameters,
            constrainedSampling: {
              type: 'json_schema',
              strict: strictToolCall ? 'require' : 'prefer',
            },
          },
        ],
      },
      {
        ...(input.signal ? { signal: input.signal } : {}),
        maxRetries: 1,
        ...(strictToolCall
          ? {
              onPayload: (payload: unknown) => ({
                ...(payload as Record<string, unknown>),
                tool_choice: { type: 'function', name: toolName },
              }),
            }
          : {}),
      },
    )
    if (response.stopReason === 'error')
      throw new Error(response.errorMessage ?? 'Pi 结构化模型调用失败')
    stage = 'tool-result'
    const toolCall = response.content.find(
      (item) => item.type === 'toolCall' && item.name === toolName,
    )
    if (toolCall?.type === 'toolCall') {
      stage = 'validation'
      return input.schema.parse(toolCall.arguments)
    }
    if (strictToolCall) throw new PiStructuredOutputError()
    stage = 'json'
    const payload = jsonPayload(contentText(response.content, '\n'))
    stage = 'validation'
    return input.schema.parse(payload)
  } catch (error) {
    input.onFailure?.(failureDiagnostic(stage, error))
    throw error
  }
}
