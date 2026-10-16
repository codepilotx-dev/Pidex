import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderSafeHtml } from '../src/features/markdown/SafeHtml.js'
import { MarkdownMessage } from '../src/features/markdown/MarkdownMessage.js'

const actions = {
  openExternal: () => undefined,
  openFile: () => undefined,
}

describe('basic Markdown HTML safety', () => {
  test('keeps only the basic formatting allowlist and strips attributes', () => {
    const html = renderToStaticMarkup(
      renderSafeHtml(
        '<strong onclick="alert(1)" style="color:red">safe</strong><a href="https://example.com">link</a>',
        'test',
        actions,
      ),
    )

    expect(html).toBe('<strong>safe</strong>link')
  })

  test('drops executable element bodies', () => {
    const html = renderToStaticMarkup(
      renderSafeHtml(
        '<script>alert(1)</script><style>body{display:none}</style><em>ok</em>',
        'test',
        actions,
      ),
    )

    expect(html).toBe('<em>ok</em>')
  })

  test('drops nested executable bodies without reconstructing active tags', () => {
    const nested = renderToStaticMarkup(
      renderSafeHtml(
        '<script><script>nested</script>tail</script><strong>safe</strong>',
        'test',
        actions,
      ),
    )
    const overlapping = renderToStaticMarkup(
      renderSafeHtml('<scr<script>ipt>alert(1)</scr</script>ipt><em>ok</em>', 'test', actions),
    )

    expect(nested).toBe('<strong>safe</strong>')
    expect(overlapping).toContain('<em>ok</em>')
    expect(overlapping).not.toContain('<script')
  })
})

describe('Markdown code comments', () => {
  test('renders a file-target button instead of an unknown directive block', () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage
        text={
          '::code-comment{title="空值处理" body="建议提前返回" file="src/main.ts" start=12 priority=2}\n'
        }
        onOpenFileReference={() => undefined}
      />,
    )

    expect(html).toContain('data-md-directive="code-comment"')
    expect(html).toContain('<button')
    expect(html).toContain('src/main.ts:12')
    expect(html).not.toContain('md-directive-unknown')
  })
})

describe('Markdown file references', () => {
  test('renders inline file paths as accessible file references instead of code pills', () => {
    const html = renderToStaticMarkup(<MarkdownMessage cwd="C:\\repo" text={'`src/main.ts`'} />)

    expect(html).toContain('data-file-reference=""')
    expect(html).toContain('type="button"')
    expect(html).not.toContain('role="button"')
    expect(html).toContain('md-file-reference__icon')
    expect(html).toContain('md-file-reference__label')
    expect(html).toContain('src/main.ts')
    expect(html).not.toContain('<code>')
  })

  test('keeps Windows workspace routes as code without hiding real file references', () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage
        cwd="C:\\repo"
        text={'`/new` `/settings/models` `../../components/ui/Tooltip.js` `src/main.ts:12`'}
      />,
    )

    expect(html).toContain('<code>/new</code>')
    expect(html).toContain('<code>/settings/models</code>')
    expect(html.match(/data-file-reference=""/gu)).toHaveLength(2)
    expect(html).toContain('../../components/ui/Tooltip.js')
    expect(html).toContain('src/main.ts:12')
  })

  test('preserves extensionless absolute file references in Unix workspaces', () => {
    const html = renderToStaticMarkup(<MarkdownMessage cwd="/home/pidex" text={'`/etc/hosts`'} />)

    expect(html).toContain('data-file-reference=""')
    expect(html).toContain('/etc/hosts')
    expect(html).not.toContain('<code>')
  })
})

describe('Markdown tables and accessibility', () => {
  test('renders tables with keyboard focusable scroll container and scope="col" header cells', () => {
    const markdown = '| Col A | Col B |\n| :--- | :--- |\n| Val 1 | Val 2 |\n'
    const html = renderToStaticMarkup(<MarkdownMessage text={markdown} />)

    expect(html).toContain('class="md-table-block tw:group/table md-wide-block"')
    expect(html).toContain('class="md-table-scroll" tabindex="0"')
    expect(html).toContain('<th scope="col"')
    expect(html).toContain('Val 1')
    expect(html).toContain('aria-label="展开表格"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(
      renderToStaticMarkup(<MarkdownMessage text={markdown} allowWideBlocks={false} />),
    ).not.toContain('aria-label="展开表格"')
  })
})
