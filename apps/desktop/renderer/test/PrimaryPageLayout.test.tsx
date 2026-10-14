import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrimaryPageLayout } from '../src/features/layout/primary-page/index.js'
import { SearchInput } from '../src/components/ui/SearchInput.js'

describe('PrimaryPageLayout', () => {
  test('keeps expandable search in the title row and initially out of keyboard navigation', () => {
    const html = renderToStaticMarkup(
      <PrimaryPageLayout
        title="插件"
        description="页面说明"
        expandableSearch
        search={
          <SearchInput
            variant="outlined"
            aria-label="搜索插件"
            placeholder="搜索插件"
            value=""
            onChange={() => undefined}
          />
        }
      >
        内容
      </PrimaryPageLayout>,
    )

    expect(html).toContain('search-heading')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('inert="" aria-hidden="true"')
    expect(html).toContain('清除并关闭搜索')
    expect(html).not.toContain('primary-page-layout__search')
    expect(html.indexOf('search-heading')).toBeLessThan(html.indexOf('页面说明'))
  })
  test('renders title, description, search, navigation, and body in order', () => {
    const html = renderToStaticMarkup(
      <PrimaryPageLayout
        description="页面说明"
        navigation={<div data-slot="navigation">页签</div>}
        search={<div data-slot="search">搜索</div>}
        title="页面标题"
      >
        <div data-slot="body">内容</div>
      </PrimaryPageLayout>,
    )

    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('primary-page-layout__header')
    expect(html).toContain('primary-page-layout__body')
    expect(html.indexOf('页面标题')).toBeLessThan(html.indexOf('页面说明'))
    expect(html.indexOf('页面说明')).toBeLessThan(html.indexOf('data-slot="search"'))
    expect(html.indexOf('data-slot="search"')).toBeLessThan(html.indexOf('data-slot="navigation"'))
    expect(html.indexOf('data-slot="navigation"')).toBeLessThan(html.indexOf('data-slot="body"'))
  })

  test('omits optional search and navigation containers', () => {
    const html = renderToStaticMarkup(
      <PrimaryPageLayout description="页面说明" title="页面标题">
        内容
      </PrimaryPageLayout>,
    )

    expect(html).not.toContain('primary-page-layout__search')
    expect(html).not.toContain('primary-page-layout__navigation')
  })

  test('applies custom headerClassName to header element', () => {
    const html = renderToStaticMarkup(
      <PrimaryPageLayout
        description="页面说明"
        headerClassName="custom-header-class"
        title="页面标题"
      >
        内容
      </PrimaryPageLayout>,
    )

    expect(html).toContain('primary-page-layout__header')
    expect(html).toContain('custom-header-class')
  })
})
