import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsDropdown } from '../src/features/settings/SettingsDropdown.js'
import { ThemeFontPicker } from '../src/features/settings/ThemeFontPicker.js'

describe('settings dropdown trigger contract', () => {
  test('style-only font picker disables enumeration fallback without exposing a family editor', () => {
    const html = renderToStaticMarkup(
      <ThemeFontPicker
        ariaLabel="深色界面字体"
        placeholder="系统默认"
        family="Inter"
        face={{ family: 'Inter', fullName: 'Inter Bold', postscriptName: 'Inter-Bold' }}
        kind="ui"
        controls="style"
        onCommit={() => undefined}
      />,
    )
    expect(html).toContain('aria-label="深色界面字体字体样式"')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('<input')
  })

  test('renders a focusable UI-Design Dropdown trigger with its selected label', () => {
    const html = renderToStaticMarkup(
      <SettingsDropdown
        ariaLabel="示例选择"
        options={[
          { value: 'first', label: '第一项' },
          { value: 'second', label: '第二项' },
        ]}
        value="second"
        size="sm"
        onChange={() => {}}
      />,
    )

    const trigger = html.match(/<button\b[^>]*aria-label="示例选择"[^>]*>/)?.[0]

    expect(html).toContain('aria-label="示例选择"')
    expect(html).toContain('第二项')
    expect(trigger).toBeDefined()
    expect(trigger).not.toContain('tabindex="-1"')
  })

  test('keeps the searchable trigger in the default tab order', () => {
    const html = renderToStaticMarkup(
      <SettingsDropdown
        ariaLabel="搜索选择"
        options={[{ value: 'item', label: '可搜索项' }]}
        searchable
        value="item"
        size="md"
        onChange={() => {}}
      />,
    )

    const trigger = html.match(/<button\b[^>]*aria-label="搜索选择"[^>]*>/)?.[0]

    expect(html).toContain('aria-label="搜索选择"')
    expect(html).toContain('可搜索项')
    expect(trigger).toBeDefined()
    expect(trigger).not.toContain('tabindex="-1"')
  })

  test('renders an empty-value option without exposing the internal sentinel', () => {
    const html = renderToStaticMarkup(
      <SettingsDropdown
        ariaLabel="空值选择"
        options={[{ value: '', label: '继承默认值' }]}
        value=""
        size="sm"
        onChange={() => {}}
      />,
    )

    expect(html).toContain('继承默认值')
    expect(html).not.toContain('__radix_empty_value__')
  })
})
