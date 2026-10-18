import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '../src/components/ui/Button.js'
import { useControllableState } from '../src/components/ui/floating/Primitives.js'
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

  test('button and control primitives do not trim text-box metrics to avoid clipping CJK glyphs', async () => {
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')

    const buttonHtml = renderToStaticMarkup(<Button>确认</Button>)
    expect(buttonHtml).not.toContain('tw:text-trim')

    const buttonCss = await readFile(resolve(import.meta.dir, '../src/styles/primitives/button.css'), 'utf8')
    expect(buttonCss).not.toContain('text-box-trim')
    expect(buttonCss).not.toContain('text-box:')

    const chipCss = await readFile(resolve(import.meta.dir, '../src/styles/components/chip.css'), 'utf8')
    // Ensure .chip-button does not apply to child > span which causes nested double padding
    expect(chipCss).not.toMatch(/\.chip-button\s*,\s*\.chip-button\s*>\s*span/)
    expect(chipCss).not.toContain('text-box-trim')
    expect(chipCss).not.toContain('text-box:')

    const interactiveRowCss = await readFile(resolve(import.meta.dir, '../src/styles/components/interactive-row.css'), 'utf8')
    expect(interactiveRowCss).not.toContain('text-box-trim')
    expect(interactiveRowCss).not.toContain('text-box:')

    const sidebarCss = await readFile(resolve(import.meta.dir, '../src/styles/primitives/sidebar.css'), 'utf8')
    expect(sidebarCss).not.toContain('text-box-trim')
    expect(sidebarCss).not.toContain('text-box:')

    const menuItemCss = await readFile(resolve(import.meta.dir, '../src/styles/components/menu-item.css'), 'utf8')
    expect(menuItemCss).not.toContain('text-box-trim')
    expect(menuItemCss).not.toContain('text-box:')

    const inputCss = await readFile(resolve(import.meta.dir, '../src/styles/components/input.css'), 'utf8')
    expect(inputCss).not.toContain('text-box-trim')
    expect(inputCss).not.toContain('text-box:')

    const popoverCss = await readFile(resolve(import.meta.dir, '../src/styles/popover.css'), 'utf8')
    expect(popoverCss).not.toContain('text-box-trim')
    expect(popoverCss).not.toContain('text-box:')

    const tailwindCss = await readFile(resolve(import.meta.dir, '../src/styles/tailwind.css'), 'utf8')
    expect(tailwindCss).not.toContain('text-box-trim')
    expect(tailwindCss).not.toContain('text-box:')
    expect(tailwindCss).not.toContain('text-trim')
  })
})

describe('controlled interaction state', () => {
  test('keeps a close request after opening before the owner renders again', () => {
    const changes: boolean[] = []
    let setOpen!: (open: boolean) => void
    function Controlled() {
      const [, update] = useControllableState(false, false, (open) => changes.push(open))
      setOpen = update
      return null
    }
    renderToStaticMarkup(<Controlled />)

    setOpen(true)
    setOpen(true)
    setOpen(false)
    setOpen(false)

    expect(changes).toEqual([true, false])
  })
})
