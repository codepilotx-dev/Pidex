import { describe, expect, test } from 'bun:test'
import { fauxAssistantMessage, fauxProvider, type Context } from '@earendil-works/pi-ai'
import { contextBudget, RequestContextUsage } from '../src/context/ContextBudget'

const model = fauxProvider({
  models: [{ id: 'budget', contextWindow: 200_000, maxTokens: 64_000 }],
}).getModel()

describe('request context budget', () => {
  test('reserves the configured output, SDK headroom and a smaller explicit input limit', () => {
    expect(contextBudget(model)).toMatchObject({
      inputBudgetTokens: 131_904,
      triggerTokens: 131_904,
      targetTokens: 110_000,
    })
    expect(contextBudget({ ...model, maxInputTokens: 90_000 })).toMatchObject({
      inputBudgetTokens: 90_000,
      triggerTokens: 90_000,
      targetTokens: 89_999,
    })
    expect(() => contextBudget({ ...model, maxTokens: 200_000 })).toThrow('模型输入与输出额度')
  })

  test('anchors real cache-inclusive usage, estimates new tool results and invalidates changed requests', () => {
    const usage = new RequestContextUsage()
    const request: Context = {
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
    }
    const identity = usage.identity(model, request, 'session:boundary')
    const response = fauxAssistantMessage('tool request')
    response.usage = {
      ...response.usage,
      input: 100,
      cacheRead: 900,
      cacheWrite: 10,
      output: 20,
      totalTokens: 1030,
    }
    const anchor = usage.measured(request, identity, response)!
    const next: Context = {
      ...request,
      messages: [
        ...request.messages,
        response,
        {
          role: 'toolResult',
          toolCallId: 'tool',
          toolName: 'read',
          content: [{ type: 'text', text: 'x'.repeat(4000) }],
          isError: false,
          timestamp: 2,
        },
      ],
    }
    expect(usage.estimate(next, identity)).toBe(2030)
    expect(JSON.stringify(anchor)).not.toContain('tool request')
    const restored = new RequestContextUsage(anchor)
    expect(restored.estimate(next, identity)).toBe(2030)
    expect(
      restored.estimate(
        next,
        restored.identity({ ...model, id: 'other-model' }, next, 'session:boundary'),
      ),
    ).not.toBe(2030)
    expect(
      restored.estimate(next, restored.identity(model, next, 'session:new-boundary')),
    ).not.toBe(2030)
    expect(
      usage.measured(next, identity, fauxAssistantMessage([], { stopReason: 'error' })),
    ).toBeNull()
    expect(usage.estimate(next, identity)).toBe(2030)
    const changed = { ...next, messages: next.messages.slice(1) }
    expect(usage.estimate(changed, identity)).not.toBe(2030)
  })

  test('media size does not count base64 as text', () => {
    const usage = new RequestContextUsage()
    const context: Context = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', data: 'x'.repeat(1_000_000), mimeType: 'image/png' }],
          timestamp: 1,
        },
      ],
    }
    expect(usage.estimate(context, '')).toBeLessThan(2000)
  })
})
