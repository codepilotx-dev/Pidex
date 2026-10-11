import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  SegmentedControl,
  segmentedTabIndexAfterKey,
} from '../src/components/ui/SegmentedControl.js'

describe('SegmentedControl tabs', () => {
  test('default variant preserves tab and panel relationships', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        ariaLabel="扩展类型"
        getPanelId={(value) => `${value}-panel`}
        getTabId={(value) => `${value}-tab`}
        onChange={() => {}}
        options={[
          { value: 'plugins', label: '插件' },
          { value: 'skills', label: '技能' },
        ]}
        semantics="tabs"
        value="plugins"
      />,
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('data-variant="default"')
    expect(html).toContain('id="plugins-tab"')
    expect(html).toContain('aria-controls="plugins-panel"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('id="skills-tab"')
    expect(html).toContain('aria-controls="skills-panel"')
    expect(html).toContain('tabindex="-1"')
  })

  test('keeps arrow, Home, and End keyboard movement', () => {
    expect(segmentedTabIndexAfterKey('ArrowRight', 1, 2)).toBe(0)
    expect(segmentedTabIndexAfterKey('ArrowLeft', 0, 2)).toBe(1)
    expect(segmentedTabIndexAfterKey('Home', 1, 2)).toBe(0)
    expect(segmentedTabIndexAfterKey('End', 0, 2)).toBe(1)
    expect(segmentedTabIndexAfterKey('Enter', 0, 2)).toBeNull()
  })
})
