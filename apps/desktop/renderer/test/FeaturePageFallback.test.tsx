import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ProvidersPageFallback } from '../src/features/models/ModelCenterInitialSkeleton.js'
import { GitBoardPageFallback } from '../src/features/git-board/GitBoardSkeleton.js'

describe('功能区域加载骨架', () => {
  test.each(['/providers', '/providers?provider=openai', '/providers?newProvider=1'])(
    '供应商入口 %s 使用对应布局的骨架',
    (path) => {
      const html = renderToStaticMarkup(
        <MemoryRouter initialEntries={[path]}>
          <ProvidersPageFallback />
        </MemoryRouter>,
      )
      expect(html).toContain('aria-busy="true"')
      expect(html).toContain('data-shimmer="true"')
      expect(html).not.toContain('full-screen-whale-loader')
      expect(html).not.toContain('<button')
      if (path === '/providers') {
        expect(html).toContain('供应商市场')
        expect(html).toContain('model-center-skeleton-provider-grid')
      } else {
        expect(html).toContain('model-center-skeleton-provider-header')
        expect(html).not.toContain('供应商市场')
      }
    },
  )

  test('Git 骨架保留功能页框架和加载语义，不输出整窗遮罩', () => {
    const html = renderToStaticMarkup(<GitBoardPageFallback />)
    expect(html).toContain('Git 看板')
    expect(html).toContain('primary-page-layout')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('data-shimmer="true"')
    expect(html).not.toContain('full-screen-whale-loader')
    expect(html).not.toContain('<button')
  })
})
