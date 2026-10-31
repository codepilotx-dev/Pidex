import { describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import {
  ContextThinkingSignalIcon,
  getContextCapacityTier,
  resolveSignalActiveBars,
  CONTEXT_TIER_TEXT_CLASSES,
} from '../src/features/session/composer/ContextThinkingSignalIcon.js'

describe('ContextThinkingSignalIcon', () => {
  describe('getContextCapacityTier', () => {
    test('正确将不同有效上下文上限映射至四档 Radix 容量色阶', () => {
      // <= 128K -> cyan
      expect(getContextCapacityTier(64_000)).toBe('cyan')
      expect(getContextCapacityTier(128_000)).toBe('cyan')

      // <= 256K (含 200K) -> jade
      expect(getContextCapacityTier(200_000)).toBe('jade')
      expect(getContextCapacityTier(256_000)).toBe('jade')

      // <= 500K -> amber
      expect(getContextCapacityTier(400_000)).toBe('amber')
      expect(getContextCapacityTier(500_000)).toBe('amber')

      // > 500K -> violet
      expect(getContextCapacityTier(1_000_000)).toBe('violet')
      expect(getContextCapacityTier(2_000_000)).toBe('violet')
    })

    test('当未设置 maxContextTokens 时使用物理窗口', () => {
      expect(getContextCapacityTier(null, 128_000)).toBe('cyan')
      expect(getContextCapacityTier(null, 200_000)).toBe('jade')
      expect(getContextCapacityTier(null, 500_000)).toBe('amber')
      expect(getContextCapacityTier(null, 1_000_000)).toBe('violet')
    })

    test('当 maxContextTokens 超出物理窗口时以物理窗口为准夹紧', () => {
      expect(getContextCapacityTier(1_000_000, 200_000)).toBe('jade')
      expect(getContextCapacityTier(500_000, 128_000)).toBe('cyan')
    })

    test('容量色阶 class 映射正确', () => {
      expect(CONTEXT_TIER_TEXT_CLASSES.cyan).toBe('tw:text-app-context-cyan')
      expect(CONTEXT_TIER_TEXT_CLASSES.jade).toBe('tw:text-app-context-jade')
      expect(CONTEXT_TIER_TEXT_CLASSES.amber).toBe('tw:text-app-context-amber')
      expect(CONTEXT_TIER_TEXT_CLASSES.violet).toBe('tw:text-app-context-violet')
    })
  })

  describe('resolveSignalActiveBars', () => {
    test('不支持思考时返回 0 根柱子（off）', () => {
      expect(resolveSignalActiveBars(false, 'default', [])).toBe(0)
    })

    test('思考关闭选项返回 0 根柱子', () => {
      expect(resolveSignalActiveBars(true, 'disabled', [{ value: 'disabled' }, { value: 'enabled' }])).toBe(0)
      expect(resolveSignalActiveBars(true, 'off', [])).toBe(0)
      expect(resolveSignalActiveBars(true, 'none', [])).toBe(0)
    })

    test('根据可选 options 比例计算激活柱数', () => {
      const options = [
        { value: 'disabled' },
        { value: 'low' },
        { value: 'medium' },
        { value: 'high' },
      ]
      // 激活选项共 3 项：low -> 1/3 -> 2 bars, medium -> 2/3 -> 3 bars, high -> 3/3 -> 5 bars
      expect(resolveSignalActiveBars(true, 'low', options)).toBe(2)
      expect(resolveSignalActiveBars(true, 'medium', options)).toBe(3)
      expect(resolveSignalActiveBars(true, 'high', options)).toBe(5)
    })

    test('标准思考等级回退命名', () => {
      expect(resolveSignalActiveBars(true, 'minimal', [])).toBe(1)
      expect(resolveSignalActiveBars(true, 'low', [])).toBe(2)
      expect(resolveSignalActiveBars(true, 'medium', [])).toBe(3)
      expect(resolveSignalActiveBars(true, 'high', [])).toBe(4)
      expect(resolveSignalActiveBars(true, 'max', [])).toBe(5)
      expect(resolveSignalActiveBars(true, 'enabled', [])).toBe(5)
    })
  })

  describe('SVG 渲染', () => {
    test('思考开启时渲染所有柱状条且不带斜杠', () => {
      const html = renderToString(
        <ContextThinkingSignalIcon
          maxContextTokens={200_000}
          showThinkingOptions={true}
          thinkingMode="high"
        />,
      )
      expect(html).toContain('tw:text-app-context-jade')
      expect(html).not.toContain('<line')
      expect(html).toContain('<rect')
    })

    test('思考关闭时渲染 5 根柱状条并绘制斜杠', () => {
      const html = renderToString(
        <ContextThinkingSignalIcon
          maxContextTokens={500_000}
          showThinkingOptions={true}
          thinkingMode="disabled"
        />,
      )
      expect(html).toContain('tw:text-app-context-amber')
      expect(html).toContain('<line')
    })

    test('不支持思考的模型同样渲染全柱 + 斜杠', () => {
      const html = renderToString(
        <ContextThinkingSignalIcon
          maxContextTokens={1_000_000}
          showThinkingOptions={false}
        />,
      )
      expect(html).toContain('tw:text-app-context-violet')
      expect(html).toContain('<line')
    })
  })
})
