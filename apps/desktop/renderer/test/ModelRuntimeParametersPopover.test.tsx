import { describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import {
  ModelRuntimeParametersPopover,
  ModelRuntimeParametersContent,
  CONTEXT_LIMIT_PRESETS,
  parseContextLimitK,
} from '../src/features/session/composer/ModelRuntimeParametersPopover.js'

describe('ModelRuntimeParametersPopover', () => {
  test('根据模型物理上下文窗口自适应过滤超出档位的预设', () => {
    // 物理窗口为 128K
    const presets128K = CONTEXT_LIMIT_PRESETS.filter(
      (p) => p.tokens === null || p.tokens <= 128_000,
    )
    expect(presets128K.map((p) => p.label)).toEqual(['模型默认', '64K', '128K'])

    // 物理窗口为 200K
    const presets200K = CONTEXT_LIMIT_PRESETS.filter(
      (p) => p.tokens === null || p.tokens <= 200_000,
    )
    expect(presets200K.map((p) => p.label)).toEqual(['模型默认', '64K', '128K', '200K'])

    // 物理窗口为 1M
    const presets1M = CONTEXT_LIMIT_PRESETS.filter(
      (p) => p.tokens === null || p.tokens <= 1_000_000,
    )
    expect(presets1M.map((p) => p.label)).toEqual([
      '模型默认',
      '64K',
      '128K',
      '200K',
      '256K',
      '500K',
      '1M',
    ])
  })

  test('弹出层渲染默认触发按钮', () => {
    const html = renderToString(
      <ModelRuntimeParametersPopover
        modelName="claude-3-7-sonnet"
        physicalWindow={200_000}
        maxContextTokens={128_000}
        onMaxContextTokensChange={() => {}}
      />,
    )
    expect(html).toContain('composer-signal-trigger-btn')
    expect(html).toContain('模型运行时参数设置：claude-3-7-sonnet')
  })

  test('当受控 open=true 时渲染推理与最大上下文限制设置内容', () => {
    const html = renderToString(
      <ModelRuntimeParametersContent
        modelName="claude-3-7-sonnet"
        physicalWindow={200_000}
        maxContextTokens={128_000}
        onMaxContextTokensChange={() => {}}
        showThinkingOptions={true}
        thinkingMode="high"
        thinkingOptions={[
          { value: 'disabled', label: '关闭' },
          { value: 'low', label: '低' },
          { value: 'high', label: '高' },
        ]}
        onThinkingChange={() => {}}
      />,
    )
    expect(html).toContain('推理思考强度')
    expect(html).toContain('最大上下文限制')
    expect(html).toContain('自定义 (K):')
    // 应该展示过滤后的预设
    expect(html).toContain('模型默认')
    expect(html).toContain('64K')
    expect(html).toContain('128K')
    expect(html).toContain('200K')
    // 超出 200K 的预设不应该在 html 中出现
    expect(html).not.toContain('256K')
    expect(html).not.toContain('500K')
    expect(html).not.toContain('1M')
  })

  test('预设与自定义输入按物理输入上界过滤，而不是按标称窗口过滤', () => {
    const html = renderToString(
      <ModelRuntimeParametersContent
        physicalWindow={1_000_000}
        physicalInputLimit={900_000}
        maxContextTokens={null}
        onMaxContextTokensChange={() => {}}
      />,
    )
    expect(html).toContain('500K')
    // 标称 1M 的模型扣除输出预留后 1M 档不可选。
    expect(html).not.toContain('1M')
    expect(html).toContain('最大 900')
  })

  test('自定义额度用文本输入，非法内容才能留下并给出可见校验', () => {
    const html = renderToString(
      <ModelRuntimeParametersContent
        physicalWindow={200_000}
        maxContextTokens={null}
        onMaxContextTokensChange={() => {}}
      />,
    )
    // type=number 会把 0/-5/abc 静默清空，校验文案永远不会出现。
    expect(html).toContain('type="text"')
    expect(html).toContain('inputMode="decimal"')
    expect(html).not.toContain('type="number"')
  })

  test('不支持思考的模型展示相应提示文案', () => {
    const html = renderToString(
      <ModelRuntimeParametersContent
        modelName="gpt-4o"
        physicalWindow={128_000}
        maxContextTokens={null}
        onMaxContextTokensChange={() => {}}
        showThinkingOptions={false}
      />,
    )
    expect(html).toContain('当前模型不支持配置推理思考强度')
  })
})

test('custom K preserves fractional tokens and validates invalid values', () => {
  expect(parseContextLimitK('96.5', 1_000_000)).toBe(96_500)
  expect(parseContextLimitK('0.001', 1_000_000)).toBe(1)
  for (const value of ['0', '-5', 'abc', '', 'Infinity', '1.0001'])
    expect(parseContextLimitK(value, 1_000_000)).toBeNull()
  expect(parseContextLimitK('5000', 1_000_000)).toBe(1_000_000)
})
