import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsSection } from '../src/features/settings/SettingsSection.js'

describe('SettingsSection surface', () => {
  test('defaults section content to the restrained card surface', () => {
    const html = renderToStaticMarkup(
      <SettingsSection title="常规">
        <div>设置项</div>
      </SettingsSection>,
    )

    expect(html).toContain('settings-section-content settings-card')
    expect(html).toContain('data-surface="card"')
  })

  test('keeps the flat surface available for explicitly continuous content', () => {
    const html = renderToStaticMarkup(
      <SettingsSection>
        <SettingsSection.Content surface="plain">
          <div>连续内容</div>
        </SettingsSection.Content>
      </SettingsSection>,
    )

    expect(html).toContain('settings-section-content')
    expect(html).toContain('data-surface="plain"')
    expect(html).not.toContain('settings-card')
  })

  test('keeps cards available for explicitly independent content', () => {
    const html = renderToStaticMarkup(
      <SettingsSection>
        <SettingsSection.Content surface="card">
          <div>独立内容</div>
        </SettingsSection.Content>
      </SettingsSection>,
    )

    expect(html).toContain('settings-section-content settings-card')
    expect(html).toContain('data-surface="card"')
  })
})
