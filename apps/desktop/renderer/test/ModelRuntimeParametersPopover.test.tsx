import { describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import {
  ModelRuntimeParametersPopover,
  ModelRuntimeParametersSummary,
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

  test('入口用思考文字与上下文 chip 展示当前值和默认状态', () => {
    const html = renderToString(
      <ModelRuntimeParametersSummary
        thinkingMode="high"
        thinkingOptions={[{ value: 'high', label: '高' }]}
        maxContextTokens={200_000}
      />,
    )
    expect(html).toContain('>高</span>')
    expect(html).toMatch(/class="chip-semantic[^"]*">200K<\/span>/)
    expect(html).not.toContain('<svg')
    const defaults = renderToString(<ModelRuntimeParametersSummary />)
    expect(defaults.match(/>默认<\/span>/g)).toHaveLength(1)
    expect(defaults).not.toContain('chip-semantic')
    const defaultContext = renderToString(
      <ModelRuntimeParametersSummary
        thinkingMode="high"
        thinkingOptions={[{ value: 'high', label: '高' }]}
        maxContextTokens={null}
      />,
    )
    expect(defaultContext).toContain('>高</span>')
    expect(defaultContext).not.toContain('chip-semantic')
    expect(defaultContext).not.toContain('默认')
    const noThinking = renderToString(<ModelRuntimeParametersSummary showThinkingOptions={false} />)
    expect(noThinking).toContain('<svg')
    expect(noThinking).not.toContain('chip-semantic')
    const unsupported = renderToString(
      <ModelRuntimeParametersSummary showThinkingOptions={false} maxContextTokens={64_000} />,
    )
    expect(unsupported).toContain('>64K</span>')
    expect(unsupported).not.toContain('默认')
  })

  test('当前值未匹配且只有高这一档时，入口和面板都显示高', () => {
    const props = {
      thinkingMode: 'default',
      thinkingOptions: [{ value: 'high', label: '高' }],
      onMaxContextTokensChange: () => {},
    }
    const trigger = renderToString(
      <ModelRuntimeParametersPopover modelName="single-effort-model" {...props} />,
    )
    expect(trigger).toContain('思考：高')
    expect(trigger).toContain('>高</span>')
    expect(trigger).not.toContain('>默认</span>')
    const panel = renderToString(<ModelRuntimeParametersContent {...props} />)
    expect(panel).toContain('>高</span>')
    const multiple = renderToString(
      <ModelRuntimeParametersSummary
        thinkingMode="default"
        thinkingOptions={[
          { value: 'low', label: '低' },
          { value: 'high', label: '高' },
        ]}
      />,
    )
    expect(multiple).toContain('>低</span>')
    expect(multiple).not.toContain('>默认</span>')
  })

  test('当受控 open=true 时渲染推理与上下文预算设置内容', () => {
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
    expect(html).toContain('上下文预算')
    expect(html).toContain('自定义 (K):')
    // 应该展示过滤后的预设档位，并以开关替代「模型默认」档
    expect(html).toContain('role="switch"')
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

  test('单档保留滑块并禁用，多档可以调节', () => {
    const html = renderToString(
      <ModelRuntimeParametersContent
        physicalWindow={200_000}
        maxContextTokens={128_000}
        onMaxContextTokensChange={() => {}}
        thinkingMode="high"
        thinkingOptions={[
          { value: 'disabled', label: '关闭' },
          { value: 'low', label: '低' },
          { value: 'high', label: '高' },
        ]}
        onThinkingChange={() => {}}
      />,
    )
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-valuetext="高"')
    expect(html).toContain('aria-valuetext="128K"')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')

    // 单档保留相同结构，但不允许调档。
    const single = renderToString(
      <ModelRuntimeParametersContent
        physicalWindow={200_000}
        maxContextTokens={128_000}
        onMaxContextTokensChange={() => {}}
        thinkingMode="high"
        thinkingOptions={[{ value: 'high', label: '高' }]}
        onThinkingChange={() => {}}
      />,
    )
    expect(single).toMatch(/aria-disabled="true"[^>]*class="stop-slider"/)
    expect(single).toMatch(/role="slider"[^>]*aria-label="推理思考强度"[^>]*aria-valuetext="高"/)
    expect(single.match(/class="stop-slider-track"/g)).toHaveLength(2)
    expect(single.match(/class="stop-slider-thumb"/g)).toHaveLength(2)
    expect(single).toMatch(/role="slider"[^>]*aria-valuemax="0"[^>]*aria-valuetext="高"/)
    expect(single).not.toContain('NaN')
    expect(single).toContain('aria-valuetext="128K"')
  })

  test('关闭开关即模型默认，自定义额度让滑块置灰', () => {
    const off = renderToString(
      <ModelRuntimeParametersContent
        physicalWindow={200_000}
        maxContextTokens={null}
        onMaxContextTokensChange={() => {}}
      />,
    )
    expect(off).toContain('aria-checked="false"')
    expect(off).toContain('aria-disabled="true"')

    const custom = renderToString(
      <ModelRuntimeParametersContent
        physicalWindow={200_000}
        maxContextTokens={96_000}
        onMaxContextTokensChange={() => {}}
      />,
    )
    expect(custom).toContain('aria-valuetext="96K"')
    expect(custom).toContain('当前为自定义额度，拖动滑块可切回档位。')
  })
})

test('custom K preserves fractional tokens and validates invalid values', () => {
  expect(parseContextLimitK('96.5', 1_000_000)).toBe(96_500)
  expect(parseContextLimitK('0.001', 1_000_000)).toBe(1)
  for (const value of ['0', '-5', 'abc', '', 'Infinity', '1.0001'])
    expect(parseContextLimitK(value, 1_000_000)).toBeNull()
  expect(parseContextLimitK('5000', 1_000_000)).toBe(1_000_000)
})

test('预算低于必要开销下限时不可保存，并隐藏不可用预设', () => {
  expect(parseContextLimitK('1', 200_000, 100_000)).toBeNull()
  expect(parseContextLimitK('100', 200_000, 100_000)).toBe(100_000)
  const html = renderToString(
    <ModelRuntimeParametersContent
      physicalWindow={200_000}
      minimumContextTokens={100_000}
      maxContextTokens={1_000}
      onMaxContextTokensChange={() => {}}
    />,
  )
  expect(html).toContain('role="alert"')
  expect(html).toContain('至少 100K')
  expect(html).not.toContain('64K')
  expect(html).toContain('128K')
  expect(html).toContain('value="1"')
})
