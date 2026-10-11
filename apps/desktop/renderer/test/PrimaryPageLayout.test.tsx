import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrimaryPageLayout } from '../src/features/layout/primary-page/index.js'

describe('PrimaryPageLayout', () => {
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
})
