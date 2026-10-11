import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '../src/components/ui/Button.js'
import { Spinner } from '../src/components/ui/Spinner.js'

describe('loading interaction primitives', () => {
  test('keeps an unlabeled spinner decorative', () => {
    const html = renderToStaticMarkup(<Spinner />)

    // Appearance lives in Tailwind utilities, so assert the semantic class token
    // instead of the whole class attribute.
    expect(html).toMatch(/class="[^"]*\bui-spinner\b/)
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('role="status"')
  })

  test('button loading exposes busy and disabled state once', () => {
    const html = renderToStaticMarkup(<Button loading>保存</Button>)

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('ui-button-spinner')
    expect((html.match(/ui-spinner/g) ?? []).length).toBe(1)
  })

  test('button variant="text" adheres to UI-design plain text specifications', () => {
    const textButtonHtml = renderToStaticMarkup(
      <Button variant="text" size="md">
        纯文本操作
      </Button>,
    )

    // Data attributes
    expect(textButtonHtml).toContain('data-variant="text"')
    expect(textButtonHtml).toContain('data-color="text"')

    // Color & background: resting secondary text, transparent fill & border
    expect(textButtonHtml).toContain('tw:bg-transparent')
    expect(textButtonHtml).toContain('tw:border-transparent')
    expect(textButtonHtml).toContain('tw:text-app-text-soft')

    // Hover & active text ink darkening
    expect(textButtonHtml).toMatch(/tw:\[&(?:amp;)?:enabled:hover\]:text-app-text/)
    expect(textButtonHtml).toMatch(/tw:\[&(?:amp;)?:active:not\(:disabled\)\]:text-app-text/)

    // Excludes active scale micro-shrink
    expect(textButtonHtml).not.toContain('tw:active:scale-[0.98]')

    // Preserves standard sizing and padding by default
    expect(textButtonHtml).toContain('tw:h-9')
    expect(textButtonHtml).toContain('tw:px-3.5')

    // Contrast with primary button which retains active scale
    const primaryHtml = renderToStaticMarkup(<Button variant="primary">保存</Button>)
    expect(primaryHtml).toContain('tw:active:scale-[0.98]')
  })

  test('button color="text" resolves to variant="text" and allows padding overrides', () => {
    const textButtonHtml = renderToStaticMarkup(
      <Button color="text" className="tw:px-0">
        无内边距文本
      </Button>,
    )

    expect(textButtonHtml).toContain('data-variant="text"')
    expect(textButtonHtml).toContain('data-color="text"')
    expect(textButtonHtml).toContain('tw:px-0')
    expect(textButtonHtml).not.toContain('tw:px-2')
  })
})
