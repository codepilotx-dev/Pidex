import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThemePickerDropdown, ThemeBadge } from '../src/features/settings/ThemePickerDropdown.js'

const MOCK_THEMES = [
  { slug: 'codex-new-dark', label: 'Codex(new)' },
  { slug: 'codex-dark', label: 'Codex' },
  { slug: 'catppuccin-mocha', label: 'Catppuccin' },
  { slug: 'dracula', label: 'Dracula' },
  { slug: 'github-dark-default', label: 'GitHub' },
]

const MOCK_SEEDS = {
  'codex-new-dark': {
    surface: '#121212',
    ink: '#e0e0e0',
    accent: '#3566f0',
  },
  'codex-dark': {
    surface: '#1e1e1e',
    ink: '#d4d4d4',
    accent: '#007acc',
  },
  'catppuccin-mocha': {
    surface: '#1e1e2e',
    ink: '#cdd6f4',
    accent: '#cba6f7',
  },
  dracula: {
    surface: '#282a36',
    ink: '#f8f8f2',
    accent: '#ff79c6',
  },
  'github-dark-default': {
    surface: '#0d1117',
    ink: '#c9d1d9',
    accent: '#58a6ff',
  },
} as const

describe('ThemePickerDropdown', () => {
  test('renders default theme trigger with Pidex label', () => {
    const html = renderToStaticMarkup(
      <ThemePickerDropdown
        ariaLabel="深色代码主题"
        onChange={() => undefined}
        themeSeeds={MOCK_SEEDS}
        themes={MOCK_THEMES}
        value="codex-new-dark"
        variant="dark"
      />,
    )

    expect(html).toContain('Pidex')
    expect(html).not.toContain('Pidex（默认）')
    expect(html).toContain('aria-label="深色代码主题"')
    expect(html).toContain('appearance-theme-badge')
    expect(html).toContain('appearance-theme-trigger')
  })

  test('renders specific theme label when a non-default theme is active', () => {
    const html = renderToStaticMarkup(
      <ThemePickerDropdown
        ariaLabel="深色代码主题"
        onChange={() => undefined}
        themeSeeds={MOCK_SEEDS}
        themes={MOCK_THEMES}
        value="catppuccin-mocha"
        variant="dark"
      />,
    )

    expect(html).toContain('Catppuccin')
    expect(html).not.toContain('Pidex')
  })

  test('ThemeBadge renders circular badge with contrast-adjusted color', () => {
    const html = renderToStaticMarkup(<ThemeBadge seed={MOCK_SEEDS['catppuccin-mocha']} />)

    expect(html).toContain('appearance-theme-badge')
    expect(html).toContain('tw:rounded-full')
    expect(html).toContain('background-color:#1e1e2e')
    expect(html).toContain('Aa')
  })

  test('ThemeBadge renders fallback style when seed is missing', () => {
    const html = renderToStaticMarkup(<ThemeBadge />)

    expect(html).toContain('appearance-theme-badge')
    expect(html).toContain('tw:rounded-full')
    expect(html).toContain('Aa')
  })
})
