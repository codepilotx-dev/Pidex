import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SkeletonBlock, SkeletonRegion } from '../src/components/ui/Skeleton.js'
import { expectSourceContains } from './SourceContract.js'

describe('骨架屏扫光', () => {
  test('默认不输出扫光标记，启用时由区域或块声明', () => {
    const plain = renderToStaticMarkup(
      createElement(SkeletonRegion, { label: '加载中' }, createElement(SkeletonBlock)),
    )
    expect(plain).not.toContain('data-shimmer')
    expect(plain).toContain('aria-busy="true"')
    expect(plain).toContain('role="status"')

    const region = renderToStaticMarkup(
      createElement(
        SkeletonRegion,
        { label: '加载中', shimmer: true },
        createElement(SkeletonBlock),
      ),
    )
    expect(region).toContain('data-shimmer="true"')

    const block = renderToStaticMarkup(createElement(SkeletonBlock, { shimmer: true }))
    expect(block).toContain('data-shimmer="true"')
  })

  test('扫光只动画 transform 且周期 1.6s，减少动画三态隐藏高光层', () => {
    const css = readFileSync(
      new URL('../src/components/ui/Skeleton.css', import.meta.url),
      'utf8',
    )
    expectSourceContains(css, 'animation: ui-skeleton-shimmer 1.6s linear infinite')
    expectSourceContains(css, '@keyframes ui-skeleton-shimmer')
    expectSourceContains(css, 'transform: translateX(-100%)')
    // 应用开关显式开启：停用扫光。
    expectSourceContains(css, ":root[data-reduce-motion='on']")
    // 未显式设置时跟随系统减少动画；显式 'off' 不受限。
    expectSourceContains(css, '@media (prefers-reduced-motion: reduce)')
    expectSourceContains(css, ":root:not([data-reduce-motion='off'])")
  })
})
