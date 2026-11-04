import { expect, test } from 'bun:test'
import { normalizeContext, type AssistantMessage, type Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import { normalizePiProviderPayload } from '../src/provider/pi/PiProviderPayload'

const placeholder = '[System: Empty message content sanitised to satisfy protocol]'
const call = { id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{}' } }

test('pi-ai serializes tool-only history without triggering a gateway empty-content replacement', async () => {
  let received: unknown
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      received = await request.json()
      const chunk = {
        id: 'test',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'test',
        choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }],
      }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  })
  const model: Model<'openai-completions'> = {
    id: 'test',
    name: 'test',
    api: 'openai-completions',
    provider: 'test',
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    reasoning: false,
    input: ['text'],
    contextWindow: 4096,
    maxTokens: 128,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { requiresAssistantAfterToolResult: true },
  }
  const assistant: AssistantMessage = {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [
      { type: 'text', text: '' },
      { type: 'toolCall', id: 'call_1', name: 'Read', arguments: {} },
    ],
    stopReason: 'toolUse',
    timestamp: 0,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }
  try {
    const result = await streamSimple(
      model,
      normalizeContext({
        messages: [
          { role: 'user', content: 'Read the file', timestamp: 0 },
          assistant,
          {
            role: 'toolResult',
            toolCallId: 'call_1',
            toolName: 'Read',
            content: [{ type: 'text', text: 'file' }],
            isError: false,
            timestamp: 0,
          },
        ],
      }),
      {
        apiKey: 'test-key',
        onPayload: (payload) => normalizePiProviderPayload(payload, model.api),
      },
    ).result()
    expect(result.stopReason).toBe('stop')
    const messages = (received as { messages: Record<string, unknown>[] }).messages
    expect(messages.find((message) => message.tool_calls)).toMatchObject({ content: null })
    expect(
      messages.some((message) => typeof message.content === 'string' && !message.content.trim()),
    ).toBe(false)
    expect(messages.find((message) => message.role === 'tool')).toMatchObject({
      tool_call_id: 'call_1',
      content: 'file',
    })
  } finally {
    await server.stop(true)
  }
})

test('Chat Completions drops empty text without breaking tool calls or tool results', () => {
  const payload = {
    model: 'test',
    messages: [
      { role: 'system', content: '' },
      {
        role: 'user',
        content: [
          { type: 'text', text: ' ' },
          { type: 'text', text: 'Read the file' },
        ],
      },
      { role: 'assistant', content: '', tool_calls: [call] },
      { role: 'tool', content: '', tool_call_id: 'call_1' },
      { role: 'assistant', content: placeholder, tool_calls: [call] },
      { role: 'assistant', content: null },
      { role: 'assistant', content: ' ', reasoning_content: 'reasoning' },
    ],
  }
  const original = structuredClone(payload)
  expect(normalizePiProviderPayload(payload, 'openai-completions')).toEqual({
    model: 'test',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Read the file' }] },
      { role: 'assistant', content: null, tool_calls: [call] },
      { role: 'tool', content: '', tool_call_id: 'call_1' },
      { role: 'assistant', content: null, tool_calls: [call] },
      { role: 'assistant', content: null, reasoning_content: 'reasoning' },
    ],
  })
  expect(payload).toEqual(original)
})

test('Responses preserves function calls and signed reasoning while removing empty messages', () => {
  const functionCall = { type: 'function_call', call_id: 'call_1', name: 'Read', arguments: '{}' }
  const output = { type: 'function_call_output', call_id: 'call_1', output: '' }
  const reasoning = { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque', summary: [] }
  expect(
    normalizePiProviderPayload(
      {
        input: [
          {
            type: 'message',
            role: 'assistant',
            id: 'msg_1',
            content: [{ type: 'output_text', text: '' }],
          },
          reasoning,
          functionCall,
          output,
        ],
      },
      'openai-responses',
    ),
  ).toEqual({ input: [reasoning, functionCall, output] })
})

test('Anthropic preserves non-text blocks and real discussions of the placeholder', () => {
  const toolUse = { type: 'tool_use', id: 'call_1', name: 'Read', input: {} }
  const thinking = { type: 'thinking', thinking: '', signature: 'opaque' }
  const user = { role: 'user', content: placeholder }
  const answer = { role: 'assistant', content: `The proxy emits ${placeholder}.` }
  expect(
    normalizePiProviderPayload(
      {
        messages: [
          user,
          { role: 'assistant', content: [{ type: 'text', text: placeholder }, thinking, toolUse] },
          answer,
        ],
      },
      'anthropic-messages',
    ),
  ).toEqual({ messages: [user, { role: 'assistant', content: [thinking, toolUse] }, answer] })
  const unsupported = { messages: [{ role: 'assistant', content: '' }] }
  expect(normalizePiProviderPayload(unsupported, 'unknown')).toBe(unsupported)
})
