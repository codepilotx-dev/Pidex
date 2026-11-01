import { describe, expect, test } from 'bun:test'
import type { Model } from '@pidex/model-schema'
import { applyModelOptionMap, compileOptionSpecs } from '../src/provider/pi/PiModelOptionMapping'

const specs = (input: Model.OptionSpecs) => input

describe('PiModelOptionMapping — 双层 values/map 协议映射', () => {
  test('无 optionSpecs 时返回 undefined，请求体原样保留（旧配置等价路径）', () => {
    expect(compileOptionSpecs(undefined)).toBeUndefined()
    const body = { model: 'x', max_tokens: 1024, reasoning_effort: 'low' }
    const compiled = compileOptionSpecs(specs({}))
    expect(compiled).toBeUndefined()
    expect(applyModelOptionMap(body, compiled ?? {}, { reasoningLevel: 'high' })).toBe(body)
  })

  test('openai-completions：reasoningLevel 显式 map 成为唯一权威并清除旧字段', () => {
    const compiled = compileOptionSpecs(
      specs({ reasoningLevel: { values: ['low', 'high', 'max'], map: '{"reasoning_effort": reasoningLevel}' } }),
    )!
    const body = {
      model: 'gpt-x',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      max_tokens: 1024,
      reasoning: 'low',
      reasoning_effort: 'low',
      thinking: { type: 'enabled' },
    }
    const out = applyModelOptionMap(body, compiled, { reasoningLevel: 'high' }) as Record<string, unknown>
    expect(out.reasoning_effort).toBe('high')
    expect('reasoning' in out).toBe(false)
    expect('thinking' in out).toBe(false)
    expect(out.max_tokens).toBe(1024)
    expect(out.stream).toBe(true)
    expect(out.messages).toEqual(body.messages)
  })

  test('openai-responses：maxOutputTokens 独立 map 覆盖输出上限字段并去重', () => {
    const compiled = compileOptionSpecs(
      specs({ maxOutputTokens: { max: 8192, map: '{"max_output_tokens": maxOutputTokens}' } }),
    )!
    const body = { input: [], stream: true, max_tokens: 1024, max_completion_tokens: 1024 }
    const out = applyModelOptionMap(body, compiled, { maxOutputTokens: 4096 }) as Record<string, unknown>
    expect(out.max_output_tokens).toBe(4096)
    expect('max_tokens' in out).toBe(false)
    expect('max_completion_tokens' in out).toBe(false)
  })

  test('anthropic-messages：thinking 预算由 map 生成，stream 保持不变', () => {
    const compiled = compileOptionSpecs(
      specs({ maxOutputTokens: { max: 8192, map: '{"thinking": {"type": "enabled", "budget_tokens": maxOutputTokens}}' } }),
    )!
    const body = { max_tokens: 1024, stream: true, thinking: { type: 'disabled' } }
    const out = applyModelOptionMap(body, compiled, { maxOutputTokens: 2048 }) as Record<string, unknown>
    expect(out.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 })
    expect(out.stream).toBe(true)
  })

  test('非固定七档：disabled/enabled 等任意值按原值映射', () => {
    const compiled = compileOptionSpecs(
      specs({ reasoningLevel: { values: ['disabled', 'enabled'], map: '{"reasoning_effort": reasoningLevel}' } }),
    )!
    const out = applyModelOptionMap({ model: 'x' }, compiled, { reasoningLevel: 'enabled' }) as Record<string, unknown>
    expect(out.reasoning_effort).toBe('enabled')
  })

  test('两层 values/map 独立覆盖，且不产生重复 reasoning/输出字段', () => {
    const compiled = compileOptionSpecs(
      specs({
        reasoningLevel: { values: ['none', 'high', 'max'], map: '{"reasoning_effort": reasoningLevel}' },
        maxOutputTokens: { max: 8192, map: '{"max_tokens": maxOutputTokens}' },
      }),
    )!
    const body = { reasoning: 'x', reasoning_effort: 'x', max_completion_tokens: 1, max_output_tokens: 1 }
    const out = applyModelOptionMap(body, compiled, { reasoningLevel: 'max', maxOutputTokens: 8192 }) as Record<string, unknown>
    expect(out.reasoning_effort).toBe('max')
    expect(out.max_tokens).toBe(8192)
    expect('reasoning' in out).toBe(false)
    expect('max_completion_tokens' in out).toBe(false)
    expect('max_output_tokens' in out).toBe(false)
  })

  test('非法表达式在编译期被拒绝，错误信息安全（无路径/凭据/源码）', () => {
    let error: Error | undefined
    try {
      compileOptionSpecs(specs({ reasoningLevel: { map: 'reasoningLevel.unsupportedMember' } }))
    } catch (caught) {
      error = caught as Error
    }
    expect(error).toBeInstanceOf(Error)
    expect(error!.message).not.toMatch(/[A-Za-z]:\\|\/home\/|api[_-]?key/i)
  })

  test('未知字段被保留（只清理对应参数的旧字段）', () => {
    const compiled = compileOptionSpecs(
      specs({ reasoningLevel: { map: '{"reasoning_effort": reasoningLevel}' } }),
    )!
    const out = applyModelOptionMap(
      { model: 'x', custom_field: 'keep', metadata: { a: 1 } },
      compiled,
      { reasoningLevel: 'high' },
    ) as Record<string, unknown>
    expect(out.custom_field).toBe('keep')
    expect(out.metadata).toEqual({ a: 1 })
  })
})
