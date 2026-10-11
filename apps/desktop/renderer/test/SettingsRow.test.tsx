import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsRow } from '../src/features/settings/SettingsRow.js'
import { SettingsSection } from '../src/features/settings/SettingsSection.js'
import { ToggleSwitch } from '../src/components/ui/ToggleSwitch.js'

describe('SettingsRow variants', () => {
  test('keeps the default two-column layout as the implicit variant', () => {
    const html = renderToStaticMarkup(
      <SettingsRow title="主题" description="选择浅色、深色或跟随系统" />,
    )

    expect(html).toContain('data-variant="default"')
    expect(html).toContain('tw:grid-cols-[minmax(0,1fr)_auto]')
    expect(html).not.toContain('data-variant="nested"')
  })

  test('stacked variant moves the control below the copy and left-aligns it', () => {
    const html = renderToStaticMarkup(
      <SettingsRow title="主题" control={<span>控件</span>} variant="stacked" />,
    )

    expect(html).toContain('data-variant="stacked"')
    expect(html).not.toContain('tw:grid-cols-[minmax(0,1fr)_auto]')
    expect(html).toContain('tw:justify-start')
  })

  test('nested variant keeps two columns on a compact rhythm', () => {
    const html = renderToStaticMarkup(
      <SettingsRow title="子项" control={<span>控件</span>} variant="nested" />,
    )

    expect(html).toContain('data-variant="nested"')
    expect(html).toContain('tw:grid-cols-[minmax(0,1fr)_auto]')
    expect(html).toContain('tw:py-2')
  })
})

describe('SettingsRow control aria binding', () => {
  test('function controls receive ids that resolve to the title and description', () => {
    const html = renderToStaticMarkup(
      <SettingsRow
        title="默认权限"
        description="写入文件、运行命令、联网和 MCP 请求需要你授权。"
        control={(aria) => (
          <ToggleSwitch
            checked
            disabled
            onChange={() => {}}
            ariaLabelledby={aria.labelledby}
            ariaDescribedby={aria.describedby}
          />
        )}
      />,
    )

    const titleId = /id="[^"]+-label"/.exec(html)?.[0]?.slice(4, -1)
    const descriptionId = /id="[^"]+-description"/.exec(html)?.[0]?.slice(4, -1)
    expect(titleId).toBeTruthy()
    expect(descriptionId).toBeTruthy()
    expect(html).toContain(`aria-labelledby="${titleId}"`)
    expect(html).toContain(`aria-describedby="${descriptionId}"`)
  })

  test('function controls get a null describedby when the row has no description', () => {
    let describedby: string | null = 'unset'
    renderToStaticMarkup(
      <SettingsRow
        title="自动审核"
        control={(aria) => {
          describedby = aria.describedby
          return <span>控件</span>
        }}
      />,
    )

    expect(describedby).toBeNull()
  })

  test('plain node controls keep the existing markup without injected ids', () => {
    const html = renderToStaticMarkup(<SettingsRow title="语言" control={<span>控件</span>} />)

    expect(html).not.toContain('-label"')
    expect(html).not.toContain('-description"')
    expect(html).not.toContain('aria-labelledby')
  })
})

describe('SettingsSection flat surface', () => {
  test('renders the flat surface as hairline-bounded continuous content', () => {
    const html = renderToStaticMarkup(
      <SettingsSection>
        <SettingsSection.Content surface="flat">
          <div>连续内容</div>
        </SettingsSection.Content>
      </SettingsSection>,
    )

    expect(html).toContain('settings-section-content settings-flat')
    expect(html).toContain('data-surface="flat"')
    expect(html).not.toContain('settings-card')
    expect(html).not.toContain('tw:rounded-container')
  })
})
