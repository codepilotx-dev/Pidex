import { describe, expect, test } from 'bun:test'
import type { ThemeRegistration } from 'shiki'

import {
  deriveChromeThemeSeed,
  loadChromeThemeSeed,
  mergeChromeThemeSeed,
  applyChromeThemeAccentPreset,
} from '../src/features/theme/CodeThemeSeed.js'
import { DEFAULT_DARK_CHROME_THEME, DEFAULT_LIGHT_CHROME_THEME } from '../shared/Theme.js'
import { HIGHLIGHT_THEMES } from '../shared/themes/Manifest.js'

describe('code theme Chrome seed', () => {
  test('derives Codex defaults from VS Code color roles', async () => {
    expect(await loadChromeThemeSeed('codex-light', 'light')).toMatchObject({
      surface: '#ffffff',
      ink: '#0d0d0d',
      accent: '#0169cc',
      semanticColors: {
        diffAdded: '#00a240',
        diffRemoved: '#e02e2a',
        skill: '#751ed9',
      },
    })
  })

  test('Codex(new) uses current default colors and preserves custom fonts', async () => {
    for (const variant of ['light', 'dark'] as const) {
      const defaults = variant === 'light' ? DEFAULT_LIGHT_CHROME_THEME : DEFAULT_DARK_CHROME_THEME
      const seed = await loadChromeThemeSeed(`codex-new-${variant}`, variant)
      expect(seed).toMatchObject({
        accent: defaults.accent,
        surface: defaults.surface,
        ink: defaults.ink,
        contrast: defaults.contrast,
        semanticColors: defaults.semanticColors,
      })
      const fonts = { ui: 'Inter', code: 'Cascadia Code' }
      expect(mergeChromeThemeSeed({ ...defaults, fonts }, seed).fonts).toEqual(fonts)
    }
  })

  test('uses token hue fallbacks and a module chromeTheme override', () => {
    const registration = {
      name: 'fixture',
      type: 'dark',
      colors: { 'editor.background': '#111111' },
      tokenColors: [
        { settings: { foreground: '#45cc67' } },
        { settings: { foreground: '#f05252' } },
        { settings: { foreground: '#a866ee' } },
      ],
      chromeTheme: {
        accent: '#abcdef',
        contrast: 77,
        fonts: { ui: 'Inter', code: null },
      },
    } as unknown as ThemeRegistration
    expect(deriveChromeThemeSeed(registration, 'dark')).toMatchObject({
      accent: '#abcdef',
      contrast: 77,
      fonts: { ui: 'Inter', code: null },
      semanticColors: {
        diffAdded: '#45cc67',
        diffRemoved: '#f05252',
        skill: '#a866ee',
      },
    })
  })

  test('all catalog themes produce complete six-digit seeds', async () => {
    for (const metadata of HIGHLIGHT_THEMES) {
      const seed = await loadChromeThemeSeed(metadata.slug, metadata.variant)
      for (const color of [
        seed.surface,
        seed.ink,
        seed.accent,
        ...Object.values(seed.semanticColors),
      ]) {
        expect(color).toMatch(/^#[\da-f]{6}$/)
      }
    }
  })

  test('merges a code theme seed without resetting user-only Chrome fields', async () => {
    const seed = await loadChromeThemeSeed('dracula', 'dark')
    const merged = mergeChromeThemeSeed(
      {
        ...DEFAULT_DARK_CHROME_THEME,
        accent: '#3566f0',
        accentPreset: 'blue',
        contrast: 73,
        fonts: { ui: 'Inter', code: 'Cascadia Code' },
      },
      seed,
    )

    expect(merged).toMatchObject({
      contrast: 73,
      fonts: { ui: 'Inter', code: 'Cascadia Code' },
      surface: '#282a36',
      ink: '#f8f8f2',
      accent: '#ff79c6',
      accentPreset: 'custom',
    })
  })

  test('custom starts from the selected theme seed and preserves an existing custom value', async () => {
    for (const variant of ['light', 'dark'] as const) {
      const current = variant === 'light' ? DEFAULT_LIGHT_CHROME_THEME : DEFAULT_DARK_CHROME_THEME
      const seed = await loadChromeThemeSeed(`codex-${variant}`, variant)
      const blue = applyChromeThemeAccentPreset(current, 'blue', variant)
      expect(blue).toEqual({ ...current, accent: '#3566F0', accentPreset: 'blue' })
      expect(applyChromeThemeAccentPreset(blue, 'custom', variant)).toBe(blue)
      const custom = applyChromeThemeAccentPreset(blue, 'custom', variant, seed.accent)
      expect(custom).toEqual({ ...current, accent: seed.accent, accentPreset: 'custom' })
      const edited = { ...custom, accent: '#123abc' as const }
      expect(applyChromeThemeAccentPreset(edited, 'custom', variant, seed.accent)).toBe(edited)
      const legacy = { ...edited, accentPreset: undefined }
      expect(applyChromeThemeAccentPreset(legacy, 'custom', variant, seed.accent)).toBe(legacy)
    }
  })
})
