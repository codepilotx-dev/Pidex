import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, ButtonGroup } from '../src/components/ui/Button.js'
import { useControllableState } from '../src/components/ui/floating/Primitives.js'
import { cn } from '../src/utils/Cn.js'
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
    expect(html).toContain('aria-hidden="true"')
    expect((html.match(/aria-hidden="true"/g) ?? []).length).toBe(1)
  })

  /*
   * The completion contract: a Button or ButtonGroup without an explicit
   * `className` must not render a `class` attribute at all. Everything the
   * stylesheet needs is selected from the emitted attributes.
   */
  const buttonFixtures: Array<[string, React.ReactElement]> = [
    ['plain', <Button>确认</Button>],
    [
      'icon only',
      <Button isIconOnly size="md" aria-label="搜索">
        <span />
      </Button>,
    ],
    [
      'sidebar',
      <Button data-position="sidebar" variant="ghost" size="md" isIconOnly aria-label="首页">
        <span />
      </Button>,
    ],
    ['primary', <Button variant="primary">保存</Button>],
    ['danger', <Button variant="danger">删除</Button>],
    ['pill', <Button shape="pill">圆角</Button>],
    ['balanced', <Button contentLayout="balanced">居中</Button>],
    ['full width', <Button fullWidth>撑满</Button>],
    ['loading', <Button loading>加载中</Button>],
    ['disabled', <Button disabled>禁用</Button>],
    [
      'grouped',
      <ButtonGroup>
        <Button>确认</Button>
      </ButtonGroup>,
    ],
  ]

  for (const [name, element] of buttonFixtures) {
    test(`button fixture "${name}" renders a host without a class attribute`, () => {
      const html = renderToStaticMarkup(element)
      // 只看宿主标签：加载态内部的 Spinner 仍拥有自己的表现类。
      const hostTag = html.match(/^<(?:button|div)[^>]*>/)?.[0] ?? ''

      expect(hostTag).not.toMatch(/\sclass=/)
      expect(html).not.toMatch(/ui-button|icon-button|ui-button-group|data-ui=/)
    })
  }

  test('a plain button emits only size, shape and variant attributes', () => {
    const html = renderToStaticMarkup(<Button>确认</Button>)

    expect(html).toBe(
      '<button data-shape="round" data-size="default" data-variant="secondary" type="button">确认</button>',
    )
  })

  test('fixed size and padding come from the shared stylesheet, not inline style', () => {
    for (const [name, element] of buttonFixtures) {
      if (name === 'grouped') continue
      expect(renderToStaticMarkup(element)).not.toContain('style=')
    }
  })

  test('shape normalizes legacy default to round and keeps pill', () => {
    expect(renderToStaticMarkup(<Button>确认</Button>)).toContain('data-shape="round"')
    expect(renderToStaticMarkup(<Button shape="default">确认</Button>)).toContain(
      'data-shape="round"',
    )
    expect(renderToStaticMarkup(<Button radius="large">确认</Button>)).toContain(
      'data-shape="pill"',
    )
  })

  test('the sidebar position preset is authored, typed and container independent', () => {
    const html = renderToStaticMarkup(
      <section data-dock="right">
        <Button data-position="sidebar" variant="ghost" size="md" isIconOnly aria-label="首页">
          <span />
        </Button>
      </section>,
    )

    expect(html).toContain('data-position="sidebar"')
    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('data-size="md"')
    expect(html).toContain('data-icon-only="true"')
    expect(renderToStaticMarkup(<Button>确认</Button>)).not.toContain('data-position=')
  })

  test('sidebar preset styles are mounted once and keyed on native tags', async () => {
    const { ButtonStyles } = await import('../src/components/ui/Button.js')
    const markup = renderToStaticMarkup(
      <div>
        <ButtonStyles />
        <ButtonStyles />
      </div>,
    )
    const stylesheet = markup.replaceAll('&quot;', '"')

    expect((stylesheet.match(/<style/g) ?? []).length).toBe(2)
    expect(stylesheet).toContain("a)[data-size][data-variant][data-position='sidebar']")
    expect(stylesheet).toContain('@layer primitives')
    expect(stylesheet).toContain('forced-colors: active')
    expect(stylesheet).not.toContain('.ui-button')
  })

  test('button variant="text" adheres to UI-design plain text specifications', () => {
    const textButtonHtml = renderToStaticMarkup(
      <Button variant="text" size="md">
        纯文本操作
      </Button>,
    )

    expect(textButtonHtml).toContain('data-variant="text"')
    expect(textButtonHtml).toContain('data-size="md"')
    expect(textButtonHtml).not.toContain('class=')
    // 默认形状显式输出为 round；其余非真实差异的属性一律不出现。
    expect(textButtonHtml).toContain('data-shape="round"')
    for (const attribute of ['color', 'radius', 'uniform', 'loading', 'content-layout']) {
      expect(textButtonHtml).not.toContain(`data-${attribute}=`)
    }
  })

  test('ghost aliases keep their ink through data-color instead of a class', () => {
    for (const color of ['ghost', 'ghostTertiary'] as const) {
      const html = renderToStaticMarkup(<Button color={color}>操作</Button>)
      expect(html).toContain('data-variant="ghost"')
      expect(html).toContain(`data-color="${color}"`)
      expect(html).not.toContain('class=')
    }
    for (const color of ['ghostSecondary', 'ghostActive'] as const) {
      const html = renderToStaticMarkup(<Button color={color}>操作</Button>)
      expect(html).toContain('data-variant="ghost"')
      expect(html).not.toContain('data-color=')
    }
    // 显式 variant 优先于 color：primary 不会因为 ghost 别名退回 secondary。
    const html = renderToStaticMarkup(
      <Button variant="primary" color="ghostSecondary">
        操作
      </Button>,
    )
    expect(html).toContain('data-variant="primary"')
    expect(html).not.toContain('data-color=')
  })

  test('only the caller class is emitted and it stays the whole class attribute', () => {
    const html = renderToStaticMarkup(
      <Button
        variant="ghost"
        size="md"
        className="tw:h-8 tw:px-0 tw:rounded-full tw:type-caption tw:text-app-text-meta tw:hover:bg-app-selected"
      >
        操作
      </Button>,
    )
    const classAttribute = html.match(/class="([^"]*)"/)?.[1]
    const classes = classAttribute?.split(' ') ?? []

    for (const value of [
      'tw:h-8',
      'tw:px-0',
      'tw:rounded-full',
      'tw:type-caption',
      'tw:text-app-text-meta',
      'tw:hover:bg-app-selected',
    ]) {
      expect(classes).toContain(value)
    }
    // 共享默认样式不再以 utility 下发，覆盖只与共享样式在级联层上竞争。
    for (const value of ['tw:h-9', 'tw:px-3.5', 'tw:rounded-md', 'tw:type-control']) {
      expect(classes).not.toContain(value)
    }
    expect(classes).toHaveLength(6)
  })

  test('custom utilities merge without treating typography as text color', () => {
    expect(cn('tw:type-control tw:text-app-text', 'tw:type-caption')).toBe(
      'tw:text-app-text tw:type-caption',
    )
    expect(cn('tw:type-control', 'tw:[font:inherit]')).toBe('tw:[font:inherit]')
    expect(cn('tw:[font:inherit]', 'tw:type-control')).toBe('tw:type-control')
    expect(cn('tw:[&>svg]:size-icon', 'tw:[&>svg]:size-6')).toBe('tw:[&>svg]:size-6')
    expect(cn('tw:[&>svg]:size-6', 'tw:[&>svg]:size-icon-lg')).toBe('tw:[&>svg]:size-icon-lg')
    expect(cn('tw:w-6 tw:h-6', 'tw:size-icon-md')).toBe('tw:size-icon-md')
    expect(cn('marker tw:p-2 tw:hover:bg-app-hover', 'tw:px-0 tw:hover:bg-app-selected')).toBe(
      'marker tw:p-2 tw:px-0 tw:hover:bg-app-selected',
    )
  })

  test('button asChild propagates visual and interactive data attributes to custom child element', () => {
    const asChildHtml = renderToStaticMarkup(
      <Button asChild variant="primary" size="sm" active>
        <a href="#test" className="custom-link tw:h-8 tw:rounded-full">
          链接按钮
        </a>
      </Button>,
    )

    expect(asChildHtml).toContain('href="#test"')
    // 子节点 class 继续参与合并，但 Button 自身不再追加任何 utility。
    expect(asChildHtml).toContain('class="custom-link tw:h-8 tw:rounded-full"')
    expect(asChildHtml).toContain('data-variant="primary"')
    expect(asChildHtml).toContain('data-size="sm"')
    expect(asChildHtml).toContain('data-shape="round"')
    expect(asChildHtml).toContain('data-active="true"')
    expect(asChildHtml).not.toContain('style=')
  })

  test('button asChild without a child class leaves the class attribute out', () => {
    const html = renderToStaticMarkup(
      <Button asChild>
        <a href="#plain">链接</a>
      </Button>,
    )

    expect(html).toBe(
      '<a href="#plain" data-shape="round" data-size="default" data-variant="secondary">链接</a>',
    )
  })

  test('button groups retain inherited variants, shapes and disabled state', () => {
    const html = renderToStaticMarkup(
      <ButtonGroup orientation="vertical" variant="primary" shape="pill" disabled>
        <Button size="sm">保存</Button>
        <Button asChild size="sm">
          <a href="#cancel">取消</a>
        </Button>
      </ButtonGroup>,
    )
    expect(html).toContain('data-orientation="vertical"')
    expect(html).toContain('data-attached=""')
    expect(html.match(/data-variant="primary"/g)).toHaveLength(2)
    expect(html.match(/data-shape="pill"/g)).toHaveLength(2)
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toContain('data-uniform=')
    expect(html).not.toContain('class=')
  })

  test('allowShrink is an attribute, not an inline size', () => {
    const html = renderToStaticMarkup(<Button allowShrink>收缩</Button>)

    expect(html).toContain('data-shrink="true"')
    expect(html).not.toMatch(/\sclass=/)
    expect(html).not.toContain('style=')
  })

  test('button and control primitives do not trim text-box metrics to avoid clipping CJK glyphs', async () => {
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')

    const buttonHtml = renderToStaticMarkup(<Button>确认</Button>)
    expect(buttonHtml).not.toContain('tw:text-trim')

    const chipCss = await readFile(
      resolve(import.meta.dir, '../src/components/ui/Chip.css'),
      'utf8',
    )
    // Ensure .chip-button does not apply to child > span which causes nested double padding
    expect(chipCss).not.toMatch(/\.chip-button\s*,\s*\.chip-button\s*>\s*span/)
    expect(chipCss).not.toContain('text-box-trim')
    expect(chipCss).not.toContain('text-box:')

    const interactiveRowCss = await readFile(
      resolve(import.meta.dir, '../src/styles/components/interactive-row.css'),
      'utf8',
    )
    expect(interactiveRowCss).not.toContain('text-box-trim')
    expect(interactiveRowCss).not.toContain('text-box:')

    const sidebarCss = await readFile(
      resolve(import.meta.dir, '../src/styles/primitives/sidebar.css'),
      'utf8',
    )
    expect(sidebarCss).not.toContain('text-box-trim')
    expect(sidebarCss).not.toContain('text-box:')

    const menuItemCss = await readFile(
      resolve(import.meta.dir, '../src/styles/components/menu-item.css'),
      'utf8',
    )
    expect(menuItemCss).not.toContain('text-box-trim')
    expect(menuItemCss).not.toContain('text-box:')

    const inputCss = await readFile(
      resolve(import.meta.dir, '../src/components/ui/Input.css'),
      'utf8',
    )
    expect(inputCss).not.toContain('text-box-trim')
    expect(inputCss).not.toContain('text-box:')

    const popoverCss = await readFile(resolve(import.meta.dir, '../src/styles/popover.css'), 'utf8')
    expect(popoverCss).not.toContain('text-box-trim')
    expect(popoverCss).not.toContain('text-box:')

    const tailwindCss = await readFile(
      resolve(import.meta.dir, '../src/styles/tailwind.css'),
      'utf8',
    )
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
