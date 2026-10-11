import { describe, expect, test } from 'bun:test'
import {
  fauxAssistantMessage,
  fauxToolCall,
  normalizeContext,
  type Api,
  type Context,
  type Model as PiModel,
  type Models,
} from '@earendil-works/pi-ai'
import { z } from 'zod'
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek'
import {
  generatePiObject,
  PiStructuredOutputError,
  type PiGenerationDiagnostic,
} from '../src/provider/pi/PiStructuredOutput'

const schema = z.object({
  value: z.string(),
})

describe('PiStructuredOutput', () => {
  test('DeepSeek 真实请求构造能复制 JSON schema 并到达发送前回调', async () => {
    const provider = deepseekProvider()
    const model = provider.getModels()[0]!
    let reachedPayload = false
    const models = {
      completeSimple: async (selected: PiModel<Api>, context: Context) =>
        provider
          .streamSimple(
            selected as Parameters<typeof provider.streamSimple>[0],
            normalizeContext(context),
            {
              apiKey: 'fixture-only',
              onPayload: () => {
                reachedPayload = true
                throw new Error('fixture-stop-before-network')
              },
            },
          )
          .result(),
    } as unknown as Models
    await expect(
      generatePiObject({
        models,
        model,
        schema: z.object({ title: z.string().trim().min(1).max(80) }),
        schemaName: 'thread_title',
        system: 'test',
        prompt: 'test',
      }),
    ).rejects.toThrow('fixture-stop-before-network')
    expect(reachedPayload).toBe(true)
  })

  test('诊断区分请求、JSON 和结构错误，且不携带敏感原文', async () => {
    const sensitive = 'private-response credential=fixture-secret C:\\private\\file'
    const cases: Array<{
      complete: () => Promise<ReturnType<typeof fauxAssistantMessage>>
      expected: PiGenerationDiagnostic
    }> = [
      {
        complete: async () => {
          throw new TypeError(sensitive)
        },
        expected: { stage: 'request', reason: 'runtime-type' },
      },
      {
        complete: async () =>
          fauxAssistantMessage('', {
            stopReason: 'error',
            errorMessage: `No API key for provider: ${sensitive}`,
          }),
        expected: { stage: 'request', reason: 'authentication' },
      },
      {
        complete: async () => {
          throw Object.assign(new Error(sensitive), { status: 401 })
        },
        expected: { stage: 'request', reason: 'authentication', status: 401 },
      },
      {
        complete: async () =>
          fauxAssistantMessage('', { stopReason: 'error', errorMessage: `429 ${sensitive}` }),
        expected: { stage: 'request', reason: 'rate-limit', status: 429 },
      },
      {
        complete: async () => fauxAssistantMessage(sensitive),
        expected: { stage: 'json', reason: 'invalid-json' },
      },
      {
        complete: async () => fauxAssistantMessage('{"value":42}'),
        expected: { stage: 'validation', reason: 'invalid-schema' },
      },
    ]
    for (const fixture of cases) {
      const diagnostics: PiGenerationDiagnostic[] = []
      await expect(
        generatePiObject({
          models: { completeSimple: fixture.complete } as unknown as Models,
          model: {
            provider: 'compatible',
            api: 'openai-responses',
            baseUrl: 'https://example.com/v1',
          } as PiModel<Api>,
          schema,
          schemaName: 'example',
          system: 'test',
          prompt: 'test',
          onFailure: (diagnostic) => diagnostics.push(diagnostic),
        }),
      ).rejects.toThrow()
      expect(diagnostics).toEqual([fixture.expected])
      expect(JSON.stringify(diagnostics)).not.toContain(sensitive)
    }
  })

  const officialOpenAIModel = {
    provider: 'openai',
    api: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
  } as PiModel<Api>

  test('官方 OpenAI 强制唯一 strict 工具接收结构化结果', async () => {
    let capturedContext: Context | undefined
    let capturedOptions: Record<string, unknown> | undefined
    const models = {
      completeSimple: async (
        _model: PiModel<Api>,
        context: Context,
        options: Record<string, unknown>,
      ) => {
        capturedContext = context
        capturedOptions = options
        return fauxAssistantMessage(fauxToolCall('submit_example', { value: 'structured' }), {
          stopReason: 'toolUse',
        })
      },
    } as unknown as Models

    const result = await generatePiObject({
      models,
      model: officialOpenAIModel,
      schema,
      schemaName: 'example',
      system: '生成示例',
      prompt: '开始',
    })

    expect(result).toEqual({ value: 'structured' })
    expect(capturedContext?.tools).toHaveLength(1)
    expect(capturedContext?.tools?.[0]?.name).toBe('submit_example')
    expect(capturedContext?.tools?.[0]?.constrainedSampling).toEqual({
      type: 'json_schema',
      strict: 'require',
    })
    const payload = await (capturedOptions?.onPayload as (payload: unknown) => unknown)({
      model: 'gpt-6-astra',
    })
    expect(payload).toEqual({
      model: 'gpt-6-astra',
      tool_choice: { type: 'function', name: 'submit_example' },
    })
  })

  test('官方 OpenAI 缺少工具调用时返回稳定错误', async () => {
    const models = {
      completeSimple: async () => fauxAssistantMessage('{"value":"do not parse"}'),
    } as unknown as Models

    await expect(
      generatePiObject({
        models,
        model: officialOpenAIModel,
        schema,
        schemaName: 'example',
        system: '生成示例',
        prompt: '开始',
      }),
    ).rejects.toMatchObject({
      name: 'PiStructuredOutputError',
      code: 'STRUCTURED_OUTPUT_MISSING',
    } satisfies Partial<PiStructuredOutputError>)
  })

  test('未调用工具的模型仍可使用 JSON 文本回退', async () => {
    const models = {
      completeSimple: async () => fauxAssistantMessage('{"value":"fallback"}'),
    } as unknown as Models

    await expect(
      generatePiObject({
        models,
        model: {
          provider: 'compatible',
          api: 'openai-responses',
          baseUrl: 'https://example.com/v1',
        } as PiModel<Api>,
        schema,
        schemaName: 'example',
        system: '生成示例',
        prompt: '开始',
      }),
    ).resolves.toEqual({ value: 'fallback' })
  })
})
