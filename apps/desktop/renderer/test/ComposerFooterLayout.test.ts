import { describe, expect, test } from 'bun:test'
import {
  COMPOSER_FOOTER_RING_WIDTH,
  resolveComposerFooterFit,
  type ComposerFooterMetrics,
} from '../src/features/session/composer/ComposerFooterLayout.js'

/*
 * 默认度量（left 300、toolbar 8、gap 6、发送 28、文字 180、图标 52）下四级阶梯
 * 所需的最小底栏宽度：文字+圆环 540、图标+圆环 412、图标 394、仅发送 336。
 */
function metrics(overrides: Partial<ComposerFooterMetrics> = {}): ComposerFooterMetrics {
  return {
    footerWidth: 700,
    leftWidth: 300,
    toolbarGap: 8,
    rightGap: 6,
    sendWidth: 28,
    modelTextWidth: 180,
    modelIconWidth: 52,
    ...overrides,
  }
}

const base = { hasRing: true, holdModel: false, holdRing: false }

describe('composer footer space allocator', () => {
  test('没有测量结果时保留完整文字状态', () => {
    expect(resolveComposerFooterFit(null, base)).toEqual({ modelMode: 'text', showRing: true })
  })

  test('空间刚好放得下完整状态时不折叠', () => {
    const fit = resolveComposerFooterFit(metrics({ footerWidth: 540 }), base)
    expect(fit.modelMode).toBe('text')
    expect(fit.showRing).toBe(true)
  })

  test('模型文字放不下时整体切换为图标而不是隐藏', () => {
    expect(resolveComposerFooterFit(metrics({ footerWidth: 520 }), base)).toEqual({
      modelMode: 'icon',
      showRing: true,
    })
  })

  test('图标放不下时先隐藏上下文圆环', () => {
    expect(resolveComposerFooterFit(metrics({ footerWidth: 400 }), base)).toEqual({
      modelMode: 'icon',
      showRing: false,
    })
  })

  test('圆环隐藏后仍放不下时隐藏模型快捷入口', () => {
    expect(resolveComposerFooterFit(metrics({ footerWidth: 380 }), base)).toEqual({
      modelMode: 'hidden',
      showRing: false,
    })
  })

  test('宽度恢复后逐级回到完整文字状态', () => {
    expect(resolveComposerFooterFit(metrics({ footerWidth: 300 }), base).modelMode).toBe('hidden')
    expect(resolveComposerFooterFit(metrics({ footerWidth: 900 }), base)).toEqual({
      modelMode: 'text',
      showRing: true,
    })
  })

  test('长模型名只抬高文字阈值，不跳过图标阶段', () => {
    const fit = resolveComposerFooterFit(metrics({ footerWidth: 600, modelTextWidth: 420 }), base)
    expect(fit.modelMode).toBe('icon')
    expect(fit.showRing).toBe(true)
  })

  test('圆环缺席时跳过圆环阶段：图标放不下直接进入隐藏', () => {
    const fit = resolveComposerFooterFit(metrics({ footerWidth: 360 }), {
      ...base,
      hasRing: false,
    })
    expect(fit.modelMode).toBe('hidden')
  })

  test('已打开或聚焦的模型入口暂不隐藏，关闭后重新分配', () => {
    // 380 正常选择 hidden；模型持有时回退一级到图标。
    expect(resolveComposerFooterFit(metrics({ footerWidth: 380 }), base).modelMode).toBe('hidden')
    expect(
      resolveComposerFooterFit(metrics({ footerWidth: 380 }), { ...base, holdModel: true })
        .modelMode,
    ).toBe('icon')
    // 释放后同一宽度重新分配回 hidden。
    expect(
      resolveComposerFooterFit(metrics({ footerWidth: 380 }), { ...base, holdModel: false })
        .modelMode,
    ).toBe('hidden')
  })

  test('持有焦点的圆环暂不隐藏', () => {
    // 400 正常先隐藏圆环；持有时保留圆环（模型已是图标）。
    expect(resolveComposerFooterFit(metrics({ footerWidth: 400 }), base).showRing).toBe(false)
    expect(
      resolveComposerFooterFit(metrics({ footerWidth: 400 }), { ...base, holdRing: true }),
    ).toEqual({ modelMode: 'icon', showRing: true })
  })

  test('两个入口同时持有时只回退需要的阶段', () => {
    // 200 低于全部阶段：模型+圆环同时持有 → 图标+圆环。
    const fit = resolveComposerFooterFit(metrics({ footerWidth: 200 }), {
      ...base,
      holdModel: true,
      holdRing: true,
    })
    expect(fit).toEqual({ modelMode: 'icon', showRing: true })
  })

  test('极窄空间也不隐藏持有焦点的圆环', () => {
    expect(
      resolveComposerFooterFit(metrics({ footerWidth: 200 }), { ...base, holdRing: true }),
    ).toEqual({ modelMode: 'icon', showRing: true })
  })

  test('模型或推理菜单持有文字入口时不切换 DOM 形态', () => {
    expect(
      resolveComposerFooterFit(metrics({ footerWidth: 200 }), {
        ...base,
        holdModel: true,
        heldModelMode: 'text',
      }),
    ).toEqual({ modelMode: 'text', showRing: false })
  })

  test('圆环槽位常量与绘制尺寸一致', () => {
    expect(COMPOSER_FOOTER_RING_WIDTH).toBe(12)
  })
})
