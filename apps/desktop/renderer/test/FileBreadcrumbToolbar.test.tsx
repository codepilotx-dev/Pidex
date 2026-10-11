import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileBreadcrumbToolbar } from '../src/features/layout/panels/FileBreadcrumbToolbar.js'

function renderMarkdownToolbar(switching: boolean): string {
  return renderToStaticMarkup(
    <FileBreadcrumbToolbar
      markdownViewMode="rich"
      path="README.md"
      switching={switching}
      treeAvailable
      treeVisible
      workspace={null}
      workspacePath="C:\\workspace"
      onToggleMarkdownViewMode={() => undefined}
      onToggleTree={() => undefined}
    />,
  )
}

describe('FileBreadcrumbToolbar', () => {
  test('使用分段控件展示 Markdown 模式并在切换时禁用两个选项', () => {
    const ready = renderMarkdownToolbar(false)
    const switching = renderMarkdownToolbar(true)

    expect(ready).toContain('aria-label="Markdown 查看模式"')
    expect(ready).toContain('>预览</button>')
    expect(ready).toContain('>源码</button>')
    expect(ready).not.toContain('查看源代码')
    expect(switching).toMatch(/<button[^>]*disabled=""[^>]*>预览<\/button>/)
    expect(switching).toMatch(/<button[^>]*disabled=""[^>]*>源码<\/button>/)
  })
})
