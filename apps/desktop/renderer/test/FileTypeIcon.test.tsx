import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveFileIconName } from '@pidex/material-icon-theme'
import { FileTypeIcon } from '../src/features/layout/FileTypeIcon.js'

describe('FileTypeIcon', () => {
  test('renders a material file icon and consumes Lucide-only stroke props', () => {
    const html = renderToStaticMarkup(
      <FileTypeIcon
        aria-hidden="true"
        className="fixture-icon"
        path="C:\\repo\\src\\Component.tsx"
        size={14}
        strokeWidth={9}
      />,
    )

    expect(html).toContain('<svg')
    expect(html).toContain('fixture-icon')
    expect(html).toContain('height="14"')
    expect(html).toContain('width="14"')
    expect(html).not.toContain('stroke-width="9"')
    expect(html).not.toContain('absoluteStrokeWidth')
  })

  test('selects material icons from the complete file path', () => {
    expect(resolveFileIconName('/repo/src/Component.tsx')).toBe('react_ts')
    expect(resolveFileIconName('/repo/docs/README.md')).toBe('readme')
  })

  test('renders a fallback material icon when the path is absent', () => {
    const html = renderToStaticMarkup(<FileTypeIcon path={null} />)

    expect(html).toContain('<svg')
  })
})
