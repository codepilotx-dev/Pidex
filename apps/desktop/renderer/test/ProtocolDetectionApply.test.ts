import { describe, expect, test } from 'bun:test'
import {
  applyProtocolDetection,
  preferredDetectedProtocol,
  type DetectionResultLike,
} from '../src/features/models/provider-management/ProtocolDetectionApply.js'

function cell(protocol: string, status: 'success' | 'failed') {
  return { protocol, status } as const
}

function result(
  models: readonly { model: string; cells: ReturnType<typeof cell>[] }[],
): DetectionResultLike {
  return {
    protocols: [
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
      'google-generative-ai',
    ],
    models,
  }
}

describe('applyProtocolDetection', () => {
  test('单协议成功时把模型切到成功协议并写入对应端点', () => {
    const applied = applyProtocolDetection(
      {
        address: 'https://chat.example/v1',
        endpoints: {
          'openai-completions': 'https://chat.example/v1',
          'anthropic-messages': 'https://messages.example',
        },
        protocol: 'mixed',
        models: [{ id: 'only-model', api: 'openai-completions' }],
      },
      result([{ model: 'only-model', cells: [cell('anthropic-messages', 'success')] }]),
      [{ id: 'only-model', api: 'openai-completions' }],
    )
    expect(applied.models).toEqual([{ id: 'only-model', api: 'anthropic-messages' }])
    expect(applied.endpoints['anthropic-messages']).toBe('https://messages.example')
    // 有模型时由模型 api 表达检测结果，不覆盖草稿默认协议。
    expect(applied.protocol).toBeUndefined()
  })

  test('多协议成功且原协议仍成功时保留原协议', () => {
    const applied = applyProtocolDetection(
      {
        address: 'https://chat.example/v1',
        endpoints: {},
        protocol: 'mixed',
        models: [
          { id: 'chat-model', api: 'openai-completions' },
          { id: 'messages-model', api: 'anthropic-messages' },
        ],
      },
      result([
        {
          model: 'chat-model',
          cells: [cell('openai-responses', 'success'), cell('openai-completions', 'success')],
        },
        {
          model: 'messages-model',
          cells: [cell('anthropic-messages', 'success'), cell('openai-completions', 'success')],
        },
      ]),
      [
        { id: 'chat-model', api: 'openai-completions' },
        { id: 'messages-model', api: 'anthropic-messages' },
      ],
    )
    // 批量检测不覆盖单一默认协议，且保留每个模型原本成功的协议。
    expect(applied.protocol).toBeUndefined()
    expect(applied.models).toEqual([
      { id: 'chat-model', api: 'openai-completions' },
      { id: 'messages-model', api: 'anthropic-messages' },
    ])
    expect(applied.endpoints).toEqual({
      'openai-completions': 'https://chat.example/v1',
      'openai-responses': 'https://chat.example/v1',
      'anthropic-messages': 'https://chat.example/v1',
    })
  })

  test('多协议成功但原协议失败时按 Chat、Responses、Anthropic、Gemini 顺序选择', () => {
    const applied = applyProtocolDetection(
      {
        address: 'https://base.example/v1',
        endpoints: {},
        protocol: 'mixed',
        models: [{ id: 'model', api: 'google-generative-ai' }],
      },
      result([
        {
          model: 'model',
          cells: [
            cell('google-generative-ai', 'failed'),
            cell('anthropic-messages', 'success'),
            cell('openai-responses', 'success'),
          ],
        },
      ]),
      [{ id: 'model', api: 'google-generative-ai' }],
    )
    expect(applied.models).toEqual([{ id: 'model', api: 'openai-responses' }])
  })

  test('失败协议保留原有端点且不新增端点', () => {
    const applied = applyProtocolDetection(
      {
        address: 'https://base.example/v1',
        endpoints: { 'anthropic-messages': 'https://kept.example' },
        protocol: 'mixed',
        models: [{ id: 'model', api: 'anthropic-messages' }],
      },
      result([
        {
          model: 'model',
          cells: [cell('anthropic-messages', 'failed'), cell('openai-responses', 'failed')],
        },
      ]),
      [{ id: 'model', api: 'anthropic-messages' }],
    )
    expect(applied.endpoints).toEqual({ 'anthropic-messages': 'https://kept.example' })
    expect(applied.models).toEqual([{ id: 'model', api: 'anthropic-messages' }])
    expect(applied.protocol).toBeUndefined()
  })

  test('零模型检测把优先成功协议作为默认协议与端点', () => {
    const applied = applyProtocolDetection(
      { address: 'https://base.example/v1', endpoints: {}, protocol: 'mixed' },
      result([
        {
          model: 'upstream-model',
          cells: [cell('google-generative-ai', 'success'), cell('openai-completions', 'success')],
        },
      ]),
      [],
    )
    expect(applied.models).toBeUndefined()
    expect(applied.protocol).toBe('openai-completions')
    expect(applied.endpoints).toEqual({
      'openai-completions': 'https://base.example/v1',
      'google-generative-ai': 'https://base.example/v1',
    })
  })

  test('优先成功协议只统计成功单元格', () => {
    expect(
      preferredDetectedProtocol(
        result([
          {
            model: 'model',
            cells: [cell('anthropic-messages', 'failed'), cell('openai-completions', 'success')],
          },
        ]),
      ),
    ).toBe('openai-completions')
    expect(
      preferredDetectedProtocol(
        result([{ model: 'model', cells: [cell('openai-responses', 'failed')] }]),
      ),
    ).toBeNull()
  })
})
