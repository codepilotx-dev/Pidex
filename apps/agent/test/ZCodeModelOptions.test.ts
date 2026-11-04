import { describe, expect, test } from 'bun:test'
import {
  resolveZCodeOptionSpecs,
  resolveZCodeOptionSpecsFrom,
} from '../src/provider/pi/ZCodeModelOptions'
import type { ZCodeOptionRule } from '../src/provider/pi/data/zcode-model-options'

describe('ZCodeModelOptions — 静态规则匹配与覆盖', () => {
  test('后匹配的通用层覆盖先匹配层（ZCode 通用顺序）', () => {
    const rules: ZCodeOptionRule[] = [
      {
        kind: 'model',
        modelMatch: '.*',
        optionSpecs: { reasoningLevel: { values: ['disabled', 'enabled'] } },
      },
      {
        kind: 'model',
        modelMatch: '.*glm-5.*',
        optionSpecs: {
          reasoningLevel: {
            values: ['low', 'high', 'max'],
            map: '{"reasoning_effort": reasoningLevel}',
          },
        },
      },
    ]
    const out = resolveZCodeOptionSpecsFrom(rules, {
      modelId: 'glm-5-air',
      api: 'openai-completions',
    })
    expect(out?.reasoningLevel).toEqual({
      values: ['low', 'high', 'max'],
      map: '{"reasoning_effort": reasoningLevel}',
    })
  })

  test('apiTypeMatch 使用协议别名，且 baseUrlMatch 必须命中', () => {
    const rules: ZCodeOptionRule[] = [
      {
        kind: 'providerSite',
        modelMatch: 'glm-5\\.3-flash',
        apiTypeMatch: 'openai-chat-completions',
        baseUrlMatch: 'https://opencode\\.ai/zen/go/v1/?',
        optionSpecs: { maxOutputTokens: { max: 131072, map: '{"max_tokens": maxOutputTokens}' } },
      },
    ]
    expect(
      resolveZCodeOptionSpecsFrom(rules, {
        modelId: 'glm-5.3-flash',
        api: 'openai-completions',
        baseUrl: 'https://opencode.ai/zen/go/v1',
      })?.maxOutputTokens,
    ).toEqual({ max: 131072, map: '{"max_tokens": maxOutputTokens}' })
    expect(
      resolveZCodeOptionSpecsFrom(rules, {
        modelId: 'glm-5.3-flash',
        api: 'openai-completions',
        baseUrl: 'https://other.example/v1',
      }),
    ).toBeUndefined()
  })

  test('未命中任何规则返回 undefined（不做裸名模糊合并）', () => {
    const rules: ZCodeOptionRule[] = [
      {
        kind: 'model',
        modelMatch: 'glm-5',
        optionSpecs: { reasoningLevel: { values: ['low', 'high'] } },
      },
    ]
    expect(
      resolveZCodeOptionSpecsFrom(rules, { modelId: 'glm-5-air', api: 'openai-completions' }),
    ).toBeUndefined()
  })

  test('真实静态数据：已知模型能解析出思考 values', () => {
    const out = resolveZCodeOptionSpecs({ modelId: 'glm-5', api: 'openai-completions' })
    expect(out?.reasoningLevel?.values?.length).toBeGreaterThan(0)
  })
})
