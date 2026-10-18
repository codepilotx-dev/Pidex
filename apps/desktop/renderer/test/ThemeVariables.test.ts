import { describe, expect, test } from 'bun:test'
import { expectSourceContains } from './SourceContract.js'
import {
  deriveDesktopSurfaceUnder,
  getDesktopAccentPresetColor,
  type DesktopAccentPreset,
} from '@pidex/shared/desktop-theme'

import {
  DEFAULT_DARK_THEME,
  DEFAULT_DESKTOP_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME,
  DEFAULT_UI_FONT,
  getCodeThemeSelectionForVariant,
  normalizeDesktopThemeSettings,
} from '../shared/Theme.js'
import {
  deriveThemeVariables,
  ensureThemePreviewContrast,
} from '../src/features/theme/ThemeVariables.js'

describe('fixed Codex UI themes', () => {
  test('normalizes all accent presets by variant and preserves legacy or mismatched colors', () => {
    for (const variant of ['light', 'dark'] as const) {
      const monochrome = variant === 'light' ? '#000000' : '#FFFFFF'
      const presets: Array<[DesktopAccentPreset, `#${string}`]> = [
        ['default', monochrome],
        ['blue', '#3566F0'],
        ['green', '#19B79E'],
        ['yellow', '#FDCD54'],
        ['pink', '#FA70AB'],
        ['orange', '#FF8771'],
        ['purple', '#AB5EFF'],
        ['black', monochrome],
      ]
      for (const [preset, accent] of presets) {
        expect(getDesktopAccentPresetColor(preset, variant)).toBe(accent)
        const normalized = normalizeDesktopThemeSettings({
          ...DEFAULT_DESKTOP_THEME_SETTINGS,
          chromeThemes: { [variant]: { accent, accentPreset: preset } },
        }).chromeThemes[variant]
        expect(normalized.accentPreset).toBe(preset)
        expect(normalized.accent.toLowerCase()).toBe(accent.toLowerCase())
      }
      for (const version of [6, 7]) {
        for (const accentPreset of [undefined, null, 'unknown', 'blue', 'default', 'black']) {
          const accent = '#fa70ab'
          const normalized = normalizeDesktopThemeSettings({
            version,
            chromeThemes: { [variant]: { accent, accentPreset } },
          }).chromeThemes[variant]
          expect(normalized.accentPreset).toBe('custom')
          expect(normalized.accent).toBe(accent)
        }
      }
    }
  })
  test('keeps code-theme seed labels readable on light, dark, and custom surfaces', () => {
    const seeds = [
      { accent: '#339cff', ink: '#1a1c1f', surface: '#ffffff' },
      { accent: '#339cff', ink: '#ffffff', surface: '#181818' },
      { accent: '#ffffff', ink: '#ffffff', surface: '#ffffff' },
      { accent: '#000000', ink: '#000000', surface: '#000000' },
    ]

    for (const seed of seeds) {
      expect(contrastRatio(ensureThemePreviewContrast(seed), seed.surface)).toBeGreaterThanOrEqual(
        4.5,
      )
    }
    expect(ensureThemePreviewContrast(seeds[0]!)).not.toBe('#339cff')
    expect(ensureThemePreviewContrast(seeds[1]!)).toBe('#339cff')
  })

  test('uses the Codex system font stack with canonical semantic weights', async () => {
    const variables = deriveThemeVariables(DEFAULT_DARK_THEME)
    const customFont = 'Inter, sans-serif'
    const customVariables = deriveThemeVariables({
      ...DEFAULT_DARK_THEME,
      theme: {
        ...DEFAULT_DARK_THEME.theme,
        fonts: {
          ...DEFAULT_DARK_THEME.theme.fonts,
          ui: customFont,
        },
      },
    })

    expect(variables['--cpx-sys-font-family-sans']).toBe(DEFAULT_UI_FONT)
    expect(customVariables['--cpx-sys-font-family-sans']).toBe(customFont)

    const stylesheet = await Bun.file(
      new URL('../src/styles/design-system/tokens.css', import.meta.url),
    ).text()
    const normalizedStylesheet = stylesheet.replace(/\s+/g, ' ')

    expectSourceContains(stylesheet, `--cpx-sys-font-family-sans: ${DEFAULT_UI_FONT};`)
    expect(normalizedStylesheet).toContain('--cpx-sys-font-weight-regular: 400;')
    expect(normalizedStylesheet).toContain('--cpx-sys-font-weight-body: 400;')
    expect(normalizedStylesheet).toContain('--cpx-sys-font-weight-medium: 500;')
    expect(normalizedStylesheet).toContain('--cpx-sys-font-weight-bold: 600;')
    expect(normalizedStylesheet).toContain('--cpx-sys-line-height-body: 1.5;')
    expect(normalizedStylesheet).toContain('--cpx-sys-line-height-caption: 1.4;')
    expect(normalizedStylesheet).toContain('--cpx-sys-line-height-body-lg: 1.5;')
    expect(normalizedStylesheet).toContain('--cpx-sys-line-height-code: 1.5;')

    const tailwind = await Bun.file(new URL('../src/styles/tailwind.css', import.meta.url)).text()
    const normalizedTailwind = tailwind.replace(/\s+/g, ' ')
    expect(normalizedTailwind).toContain(
      '--text-base--line-height: var(--cpx-sys-line-height-body);',
    )
    expect(normalizedTailwind).toContain(
      '--text-sm--line-height: var(--cpx-sys-line-height-body-sm);',
    )
    expect(normalizedTailwind).toContain('--text-code: var(--cpx-sys-font-size-code);')
    expect(normalizedTailwind).toContain(
      '--text-code--line-height: var(--cpx-sys-line-height-code);',
    )
  })

  test('locks the Codex light and dark semantic surfaces', () => {
    const light = deriveThemeVariables(DEFAULT_LIGHT_THEME)
    const dark = deriveThemeVariables(DEFAULT_DARK_THEME)

    expect(DEFAULT_LIGHT_THEME.codeThemeId).toBe('codex-new-light')
    expect(light['--cpx-sys-color-surface-canvas']).toBe('#ffffff')
    expect(light['--cpx-sys-color-surface-editor']).toBe('var(--cpx-ref-gray-2)')
    expect(light['--cpx-sys-color-accent']).toBe('var(--cpx-ref-blue-9)')
    expect(light['--cpx-sys-color-accent-subtle-bg']).toBe('var(--cpx-ref-blue-a3)')
    expect(light['--cpx-sys-color-surface-recessed']).not.toBe(
      light['--cpx-sys-color-surface-canvas'],
    )
    expect(light['--cpx-sys-color-fg-primary']).toBe('var(--cpx-ref-gray-12)')
    expect(light['--cpx-sys-color-fg-secondary']).toBe('var(--cpx-ref-gray-11)')
    expect(light['--cpx-sys-color-border-subtle']).toBe('var(--cpx-ref-gray-a6)')
    expect(light['--cpx-sys-color-border-default']).toBe('var(--cpx-ref-gray-a7)')
    expect(light['--cpx-sys-color-border-strong']).toBe('var(--cpx-ref-gray-a8)')
    expect(light['--cpx-sys-color-hover']).toBe('var(--cpx-ref-gray-a3)')
    expect(light['--cpx-sys-color-selected']).toBe('var(--cpx-ref-gray-a4)')
    expect(light['--cpx-sys-color-diff-added-line']).not.toBe(
      light['--cpx-sys-color-surface-editor'],
    )
    expect(light['--cpx-sys-color-diff-added-text']).not.toBe(
      light['--cpx-sys-color-diff-added-line'],
    )

    expect(DEFAULT_DARK_THEME.codeThemeId).toBe('codex-new-dark')
    expect(dark['--cpx-sys-color-surface-canvas']).toBe('#111111')
    expect(dark['--cpx-sys-color-surface-editor']).toBe('var(--cpx-ref-gray-2)')
    expect(dark['--cpx-sys-color-surface-panel']).toBe('var(--cpx-ref-gray-2)')
    expect(dark['--cpx-sys-color-surface-raised']).toBe('var(--cpx-ref-gray-2)')
    expect(dark['--cpx-sys-color-accent-fg']).toBe('var(--cpx-ref-blue-11)')
    expect(dark['--cpx-sys-color-accent-subtle-bg']).toBe('var(--cpx-ref-blue-a3)')
    expect(dark['--cpx-sys-color-surface-recessed']).not.toBe(
      dark['--cpx-sys-color-surface-canvas'],
    )
    expect(dark['--cpx-sys-color-fg-primary']).toBe('var(--cpx-ref-gray-12)')
    expect(dark['--cpx-sys-color-surface-panel']).not.toBe(dark['--cpx-sys-color-surface-canvas'])
    expect(dark['--cpx-sys-color-fg-secondary']).toBe('var(--cpx-ref-gray-11)')
    expect(dark['--cpx-sys-color-border-subtle']).toBe('var(--cpx-ref-gray-a6)')
    expect(dark['--cpx-sys-color-border-default']).toBe('var(--cpx-ref-gray-a7)')
    expect(dark['--cpx-sys-color-border-strong']).toBe('var(--cpx-ref-gray-a8)')
    expect(dark['--cpx-sys-color-hover']).toBe('var(--cpx-ref-gray-a3)')
    expect(dark['--cpx-sys-color-selected']).toBe('var(--cpx-ref-gray-a4)')
    expect(dark['--cpx-sys-color-fg-on-accent']).toBe('var(--cpx-ref-blue-contrast)')
  })

  test('keeps control thumbs white in light and dark themes', () => {
    const light = deriveThemeVariables({
      ...DEFAULT_LIGHT_THEME,
      theme: {
        ...DEFAULT_LIGHT_THEME.theme,
        accent: '#d7827e',
        contrast: 40,
        ink: '#575279',
        surface: '#faf4ed',
      },
    })
    const dark = deriveThemeVariables({
      ...DEFAULT_DARK_THEME,
      theme: {
        ...DEFAULT_DARK_THEME.theme,
        accent: '#a7c080',
        contrast: 41,
        ink: '#d3c6aa',
        surface: '#2d353b',
      },
    })

    expect(light['--cpx-comp-switch-thumb-fill']).toBe('#ffffff')
    expect(dark['--cpx-comp-switch-thumb-fill']).toBe('#ffffff')
  })

  test('keeps resting surfaces flat and delegates floating elevation to the theme token', async () => {
    const light = deriveThemeVariables(DEFAULT_LIGHT_THEME)
    const dark = deriveThemeVariables(DEFAULT_DARK_THEME)

    expect(light['--cpx-sys-shadow-resting']).toBe('inset 0 1px 0 rgba(255, 255, 255, 0.7)')
    expect(light['--cpx-sys-shadow-raised']).toBe('inset 0 1px 0 rgba(255, 255, 255, 0.7)')
    expect(dark['--cpx-sys-shadow-resting']).toBe('inset 0 1px 0 rgba(238, 238, 238, 0.04)')
    expect(dark['--cpx-sys-shadow-raised']).toBe('inset 0 1px 0 rgba(238, 238, 238, 0.04)')

    const stylesheet = await Bun.file(
      new URL('../src/styles/design-system/tokens.css', import.meta.url),
    ).text()
    const normalizedStylesheet = stylesheet.replace(/\s+/g, ' ')

    expect(normalizedStylesheet).toContain(
      '--cpx-sys-shadow-raised: inset 0 1px 0 rgba(255, 255, 255, 0.7);',
    )
    expect(normalizedStylesheet).toContain(
      '--cpx-sys-shadow-resting: inset 0 1px 0 rgba(255, 255, 255, 0.7);',
    )
    expect(normalizedStylesheet).toContain('--cpx-sys-shadow-floating')
  })

  test('uses the recovered Codex runtime formulas for Dracula', () => {
    const variables = deriveThemeVariables({
      codeThemeId: 'dracula',
      variant: 'dark',
      theme: {
        ...DEFAULT_DARK_THEME.theme,
        accent: '#ff79c6',
        surface: '#282a36',
        ink: '#f8f8f2',
        semanticColors: {
          diffAdded: '#50fa7b',
          diffRemoved: '#ff5555',
          skill: '#ff79c6',
        },
      },
    })

    expect(variables['--cpx-sys-color-surface-canvas']).toBe('#282a36')
    expect(variables['--cpx-sys-color-surface-recessed']).not.toBe(
      variables['--cpx-sys-color-surface-canvas'],
    )
    expect(variables['--cpx-sys-color-success']).toBe('#50fa7b')
    expect(variables['--cpx-sys-color-danger']).toBe('#ff5555')
    expect(variables['--cpx-sys-color-diff-added-fg']).toBe('#50fa7b')
    expect(variables['--cpx-sys-color-diff-added-indicator']).toBe('#50fa7b')
    expect(variables['--cpx-sys-color-diff-removed-indicator']).toBe('#ff5555')
    expect(variables['--cpx-sys-color-diff-added-line']).not.toBe(
      variables['--cpx-sys-color-success'],
    )
    expect(variables['--cpx-sys-color-diff-removed-line']).not.toBe(
      variables['--cpx-sys-color-danger'],
    )
    expect(variables['--cpx-sys-color-diff-added-line']).toMatch(/^#[\da-f]{6}$/)
    expect(variables['--cpx-sys-color-diff-removed-text']).toMatch(/^#[\da-f]{6}$/)
  })

  test('keeps semantic foregrounds readable against editor surfaces', () => {
    for (const config of [DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME]) {
      const variables = deriveThemeVariables(config)
      for (const tone of ['added', 'removed'] as const) {
        const foreground = variables[`--cpx-sys-color-diff-${tone}-fg`]
        const backgrounds = [
          variables['--cpx-sys-color-surface-editor'],
          variables[`--cpx-sys-color-diff-${tone}-line`],
          variables[`--cpx-sys-color-diff-${tone}-text`],
        ]
        for (const background of backgrounds) {
          expect(contrastRatio(foreground, background, config.variant)).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  test('moves low-contrast semantic foregrounds toward ink', () => {
    const variables = deriveThemeVariables({
      ...DEFAULT_LIGHT_THEME,
      theme: {
        ...DEFAULT_LIGHT_THEME.theme,
        semanticColors: {
          ...DEFAULT_LIGHT_THEME.theme.semanticColors,
          diffAdded: '#ffffff',
          diffRemoved: '#ffffff',
        },
      },
    })
    const editor = variables['--cpx-sys-color-surface-editor']

    expect(variables['--cpx-sys-color-diff-added-indicator']).toBe('#ffffff')
    expect(variables['--cpx-sys-color-diff-added-fg']).not.toBe('#ffffff')
    expect(
      contrastRatio(variables['--cpx-sys-color-diff-added-fg'], editor, 'light'),
    ).toBeGreaterThanOrEqual(4.5)
  })

  test('derives opaque canvas, chrome, panel, editor, and elevated roles', () => {
    for (const config of [DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME]) {
      const variables = deriveThemeVariables(config)
      const roleNames = [
        '--cpx-sys-color-surface-canvas',
        '--cpx-sys-color-surface-recessed',
        '--cpx-sys-color-surface-panel',
        '--cpx-sys-color-surface-control',
        '--cpx-sys-color-surface-raised',
        '--cpx-sys-color-surface-editor',
      ] as const
      for (const role of roleNames.map((name) => variables[name])) {
        expect(role).toBeDefined()
        expect(role).not.toContain('rgba')
      }
    }
  })

  test('preserves the complete surface hierarchy on near-white custom themes', () => {
    const variables = deriveThemeVariables({
      ...DEFAULT_LIGHT_THEME,
      theme: {
        ...DEFAULT_LIGHT_THEME.theme,
        accent: '#5d755d',
        surface: '#f5f3ed',
        ink: '#2f312d',
        contrast: 40,
      },
    })
    const canvas = variables['--cpx-sys-color-surface-canvas']
    const recessed = variables['--cpx-sys-color-surface-recessed']
    const control = variables['--cpx-sys-color-surface-control']
    const raised = variables['--cpx-sys-color-surface-raised']

    expect(variables['--cpx-sys-color-surface-editor']).toBe('#f6f4ef')
    expect(recessed).toBe(deriveDesktopSurfaceUnder('#f5f3ed', '#2f312d', 'light', 40))
    expect(luminance(parseColor(recessed))).toBeLessThan(luminance(parseColor(canvas)))
    expect(luminance(parseColor(control))).toBeGreaterThan(luminance(parseColor(canvas)))
    expect(luminance(parseColor(raised))).toBeGreaterThan(luminance(parseColor(canvas)))
  })

  test('keeps dark chrome recessed while control and raised surfaces lift', () => {
    const variables = deriveThemeVariables({
      ...DEFAULT_DARK_THEME,
      theme: {
        ...DEFAULT_DARK_THEME.theme,
        surface: '#282a36',
        ink: '#f8f8f2',
        contrast: 60,
      },
    })
    const canvasLuminance = luminance(parseColor(variables['--cpx-sys-color-surface-canvas']))

    expect(variables['--cpx-sys-color-surface-recessed']).toBe(
      deriveDesktopSurfaceUnder('#282a36', '#f8f8f2', 'dark', 60),
    )
    expect(luminance(parseColor(variables['--cpx-sys-color-surface-recessed']))).toBeLessThan(
      canvasLuminance,
    )
    expect(luminance(parseColor(variables['--cpx-sys-color-surface-control']))).toBeGreaterThan(
      canvasLuminance,
    )
    expect(luminance(parseColor(variables['--cpx-sys-color-surface-raised']))).toBeGreaterThan(
      canvasLuminance,
    )
  })

  test('keeps every semantic foreground readable on its subtle background', () => {
    for (const config of [DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME]) {
      const variables = deriveThemeVariables(config)
      for (const tone of ['accent', 'danger', 'warning', 'success', 'skill', 'info'] as const) {
        expect(
          contrastRatio(
            variables[`--cpx-sys-color-${tone}-fg`],
            variables[`--cpx-sys-color-${tone}-subtle-bg`],
            config.variant,
          ),
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test('keeps the recovered contrast boundary palette deterministic', () => {
    const expected = [
      [0, 'rgba(31, 31, 31, 0.06)'],
      [40, 'rgba(31, 31, 31, 0.076)'],
      [60, 'rgba(31, 31, 31, 0.1)'],
      [100, 'rgba(31, 31, 31, 0.1)'],
    ] as const

    for (const [contrast, border] of expected) {
      const variables = deriveThemeVariables({
        ...DEFAULT_LIGHT_THEME,
        codeThemeId: 'codex-light',
        theme: {
          ...DEFAULT_LIGHT_THEME.theme,
          contrast,
        },
      })

      expect(variables['--cpx-sys-color-border-default']).toBe(border)
      expect(
        deriveThemeVariables({
          ...DEFAULT_LIGHT_THEME,
          codeThemeId: 'codex-light',
          theme: {
            ...DEFAULT_LIGHT_THEME.theme,
            contrast,
          },
        }),
      ).toEqual(variables)
    }
  })

  test('keeps dark subtle borders near the Codex three-percent baseline', () => {
    const expected = [
      [0, 'rgba(238, 238, 238, 0.03)'],
      [60, 'rgba(238, 238, 238, 0.042)'],
      [100, 'rgba(238, 238, 238, 0.05)'],
    ] as const

    for (const [contrast, border] of expected) {
      const variables = deriveThemeVariables({
        ...DEFAULT_DARK_THEME,
        codeThemeId: 'codex-dark',
        theme: {
          ...DEFAULT_DARK_THEME.theme,
          contrast,
        },
      })

      expect(variables['--cpx-sys-color-border-subtle']).toBe(border)
    }
  })

  test('migrates legacy settings without retaining old theme data', () => {
    const migrated = normalizeDesktopThemeSettings({
      mode: 'dark',
      codeThemeId: 'dracula',
      activeThemeIds: { light: 'light-pidex', dark: 'dark-dracula' },
      customThemes: [{ id: 'custom-theme' }],
      presetOverrides: { 'dark-dracula': {} },
      reduceMotion: 'on',
      pointerCursorEnabled: false,
      fontSizes: { ui: 17, code: 15 },
    })
    expect(migrated).toMatchObject({
      version: 8,
      fonts: { code: null, ui: null, uiFace: null, codeFace: null },
      mode: 'system',
      codeThemeIds: {
        light: 'codex-new-light',
        dark: 'codex-new-dark',
      },
      reduceMotion: 'system',
      pointerCursorEnabled: false,
      fontSizes: { ui: 14, code: 13 },
    })
    expect(migrated.chromeThemes.light).not.toHaveProperty('opaqueWindows')
    expect(migrated.chromeThemes.dark).not.toHaveProperty('opaqueWindows')
  })

  test('uses code size 13 for new settings without migrating a saved size 12', () => {
    expect(DEFAULT_DESKTOP_THEME_SETTINGS.fontSizes.code).toBe(13)
    expect(
      normalizeDesktopThemeSettings({
        ...DEFAULT_DESKTOP_THEME_SETTINGS,
        fontSizes: { ui: 14, code: 12 },
      }).fontSizes,
    ).toEqual({ ui: 14, code: 12 })
  })

  test('keeps separate light and dark selections and rejects mismatches', () => {
    expect(
      normalizeDesktopThemeSettings({
        ...DEFAULT_DESKTOP_THEME_SETTINGS,
        codeThemeIds: {
          light: 'github-light-default',
          dark: 'dracula',
        },
      }).codeThemeIds,
    ).toEqual({
      light: 'github-light-default',
      dark: 'dracula',
    })
    expect(
      normalizeDesktopThemeSettings({
        ...DEFAULT_DESKTOP_THEME_SETTINGS,
        codeThemeIds: {
          light: 'dracula',
          dark: 'github-light',
        },
      }).codeThemeIds,
    ).toEqual({
      light: 'codex-new-light',
      dark: 'codex-new-dark',
    })
  })

  test('resets a previous V2 single selection to V8 defaults', () => {
    expect(
      normalizeDesktopThemeSettings({
        version: 2,
        mode: 'system',
        codeThemeId: 'dracula',
      }).codeThemeIds,
    ).toEqual({
      light: 'codex-new-light',
      dark: 'codex-new-dark',
    })
  })

  test('keeps both System selections and resolves the system variant slot', () => {
    const settings = normalizeDesktopThemeSettings({
      ...DEFAULT_DESKTOP_THEME_SETTINGS,
      mode: 'system',
      codeThemeIds: {
        light: 'proof-light',
        dark: 'dracula',
      },
    })

    expect(getCodeThemeSelectionForVariant(settings, 'light')).toBe('proof-light')
    expect(getCodeThemeSelectionForVariant(settings, 'dark')).toBe('dracula')
  })

  test('derives harmonized multi-hue semantic tones and frosted glass tokens', () => {
    const light = deriveThemeVariables(DEFAULT_LIGHT_THEME)
    const dark = deriveThemeVariables(DEFAULT_DARK_THEME)

    for (const vars of [light, dark]) {
      // Blur & Glass tokens
      expect(vars['--cpx-sys-blur-sm']).toBe('8px')
      expect(vars['--cpx-sys-blur-md']).toBe('16px')
      expect(vars['--cpx-sys-blur-lg']).toBe('24px')
      expect(vars['--cpx-sys-glass-filter']).toBe('blur(16px)')
      expect(vars['--cpx-comp-glass-filter']).toBe('blur(16px)')

      // Multi-hue semantic subtle backgrounds & borders
      expect(vars['--cpx-sys-color-success-subtle-bg']).toBeDefined()
      expect(vars['--cpx-sys-color-success-subtle-border']).toBeDefined()
      expect(vars['--cpx-sys-color-danger-subtle-bg']).toBeDefined()
      expect(vars['--cpx-sys-color-danger-subtle-border']).toBeDefined()
      expect(vars['--cpx-sys-color-warning-subtle-bg']).toBeDefined()
      expect(vars['--cpx-sys-color-warning-subtle-border']).toBeDefined()
      expect(vars['--cpx-sys-color-skill-subtle-bg']).toBeDefined()
      expect(vars['--cpx-sys-color-skill-subtle-border']).toBeDefined()
      expect(vars['--cpx-sys-color-info-subtle-bg']).toBeDefined()
      expect(vars['--cpx-sys-color-info-subtle-border']).toBeDefined()

      expect(vars['--cpx-sys-color-accent-subtle-bg']).toBeDefined()
    }
  })

  test('keeps floating shadows black and derives reference scrims for both variants', () => {
    const light = deriveThemeVariables(DEFAULT_LIGHT_THEME)
    const dark = deriveThemeVariables(DEFAULT_DARK_THEME)

    // Floating shadow must strictly use pure black (rgb(0 0 0 / ...)) and never use ink or white halos
    expect(light['--cpx-sys-shadow-floating']).toContain('rgb(0 0 0 /')
    expect(dark['--cpx-sys-shadow-floating']).toContain('rgb(0 0 0 /')
    expect(dark['--cpx-sys-shadow-floating']).not.toContain('255')

    expect(light['--cpx-sys-color-scrim']).toBe('rgba(0, 0, 0, 0.25)')
    expect(dark['--cpx-sys-color-scrim']).toBe('rgba(0, 0, 0, 0.65)')
  })

  test('derives workbench region surfaces according to UI-Design specifications', () => {
    const light = deriveThemeVariables(DEFAULT_LIGHT_THEME)
    const dark = deriveThemeVariables(DEFAULT_DARK_THEME)

    // In default light: sidebar is gray-2, titlebar follows sidebar, main/panel are canvas
    expect(light['--cpx-sys-color-workbench-sidebar-bg']).toBe('var(--cpx-ref-gray-2)')
    expect(light['--cpx-sys-color-workbench-titlebar-bg']).toBe(
      'var(--cpx-sys-color-workbench-sidebar-bg)',
    )
    expect(light['--cpx-sys-color-workbench-main-bg']).toBe('var(--cpx-sys-color-surface-canvas)')
    expect(light['--cpx-sys-color-workbench-panel-bg']).toBe(
      'var(--cpx-sys-color-workbench-main-bg)',
    )

    // In default dark: sidebar is Deep (surface-recessed = #0f0f0f), titlebar follows sidebar
    expect(dark['--cpx-sys-color-workbench-sidebar-bg']).toBe(
      'var(--cpx-sys-color-surface-recessed)',
    )
    expect(dark['--cpx-sys-color-workbench-titlebar-bg']).toBe(
      'var(--cpx-sys-color-workbench-sidebar-bg)',
    )
    expect(dark['--cpx-sys-color-workbench-main-bg']).toBe('var(--cpx-sys-color-surface-canvas)')
    expect(dark['--cpx-sys-color-workbench-panel-bg']).toBe(
      'var(--cpx-sys-color-workbench-main-bg)',
    )

    // Custom dark theme: sidebar adapts to derived surfaceRecessed
    const customDark = deriveThemeVariables({
      ...DEFAULT_DARK_THEME,
      theme: {
        ...DEFAULT_DARK_THEME.theme,
        surface: '#202020',
        ink: '#e0e0e0',
        contrast: 50,
      },
    })
    expect(customDark['--cpx-sys-color-workbench-sidebar-bg']).toBe(
      deriveDesktopSurfaceUnder('#202020', '#e0e0e0', 'dark', 50),
    )
    expect(customDark['--cpx-sys-color-workbench-titlebar-bg']).toBe(
      'var(--cpx-sys-color-workbench-sidebar-bg)',
    )
  })

  test('normalizes 3-digit and uppercase hex codes in theme detection and color parsing', () => {
    const lightShort = deriveThemeVariables({
      ...DEFAULT_LIGHT_THEME,
      theme: {
        ...DEFAULT_LIGHT_THEME.theme,
        surface: '#fff',
      },
    })
    // 3-digit '#fff' should be recognized as default light surface '#ffffff'
    expect(lightShort['--cpx-sys-color-surface-panel']).toBe('var(--cpx-ref-gray-2)')
    expect(lightShort['--cpx-sys-color-fg-primary']).toBe('var(--cpx-ref-gray-12)')

    const darkShort = deriveThemeVariables({
      ...DEFAULT_DARK_THEME,
      theme: {
        ...DEFAULT_DARK_THEME.theme,
        surface: '#111',
      },
    })
    // 3-digit '#111' should be recognized as default dark surface '#111111'
    expect(darkShort['--cpx-sys-color-surface-panel']).toBe('var(--cpx-ref-gray-2)')
    expect(darkShort['--cpx-sys-color-surface-recessed']).toBe('#0f0f0f')
  })

  test('keeps neutral reference palette when only accent is customized', () => {
    const customAccent = deriveThemeVariables({
      ...DEFAULT_LIGHT_THEME,
      theme: {
        ...DEFAULT_LIGHT_THEME.theme,
        accent: '#e02e2a',
      },
    })

    // Neutral roles stay pinned to CSS reference palettes
    expect(customAccent['--cpx-sys-color-surface-panel']).toBe('var(--cpx-ref-gray-2)')
    expect(customAccent['--cpx-sys-color-fg-primary']).toBe('var(--cpx-ref-gray-12)')
    expect(customAccent['--cpx-sys-color-border-default']).toBe('var(--cpx-ref-gray-a7)')

    // Accent roles diverge to custom derived values
    expect(customAccent['--cpx-sys-color-accent']).toBe('#e02e2a')
    expect(customAccent['--cpx-sys-color-accent-subtle-bg']).not.toBe('var(--cpx-ref-blue-a3)')
  })
})

const LIGHT_REF_COLORS: Record<string, string> = {
  '--cpx-ref-blue-1': '#fcfdff',
  '--cpx-ref-blue-2': '#f5f9ff',
  '--cpx-ref-blue-3': '#eaf3fe',
  '--cpx-ref-blue-4': '#dcecff',
  '--cpx-ref-blue-5': '#cae2ff',
  '--cpx-ref-blue-6': '#b6d5fd',
  '--cpx-ref-blue-7': '#9dc3f5',
  '--cpx-ref-blue-8': '#78abed',
  '--cpx-ref-blue-9': '#0169cc',
  '--cpx-ref-blue-10': '#005abc',
  '--cpx-ref-blue-11': '#086cd0',
  '--cpx-ref-blue-12': '#0d335e',
  '--cpx-ref-blue-a3': '#eaf3fe',
  '--cpx-ref-blue-contrast': '#ffffff',
  '--cpx-ref-gray-1': '#fcfcfc',
  '--cpx-ref-gray-2': '#f9f9f9',
  '--cpx-ref-gray-3': '#f0f0f0',
  '--cpx-ref-gray-4': '#e8e8e8',
  '--cpx-ref-gray-5': '#e1e1e1',
  '--cpx-ref-gray-6': '#d9d9d9',
  '--cpx-ref-gray-7': '#cecece',
  '--cpx-ref-gray-8': '#bbbbbb',
  '--cpx-ref-gray-9': '#8c8c8c',
  '--cpx-ref-gray-10': '#828282',
  '--cpx-ref-gray-11': '#636363',
  '--cpx-ref-gray-12': '#1f1f1f',
  '--cpx-ref-gray-contrast': '#ffffff',
}

const DARK_REF_COLORS: Record<string, string> = {
  '--cpx-ref-blue-1': '#07111f',
  '--cpx-ref-blue-2': '#0c1929',
  '--cpx-ref-blue-3': '#03264f',
  '--cpx-ref-blue-4': '#002f6d',
  '--cpx-ref-blue-5': '#003b81',
  '--cpx-ref-blue-6': '#004994',
  '--cpx-ref-blue-7': '#0458ab',
  '--cpx-ref-blue-8': '#0069cc',
  '--cpx-ref-blue-9': '#0169cc',
  '--cpx-ref-blue-10': '#0d5cb0',
  '--cpx-ref-blue-11': '#74b7ff',
  '--cpx-ref-blue-12': '#c7e3ff',
  '--cpx-ref-blue-a3': '#03264f',
  '--cpx-ref-blue-contrast': '#ffffff',
  '--cpx-ref-gray-1': '#111111',
  '--cpx-ref-gray-2': '#191919',
  '--cpx-ref-gray-3': '#232323',
  '--cpx-ref-gray-4': '#2a2a2a',
  '--cpx-ref-gray-5': '#313131',
  '--cpx-ref-gray-6': '#3a3a3a',
  '--cpx-ref-gray-7': '#484848',
  '--cpx-ref-gray-8': '#616161',
  '--cpx-ref-gray-9': '#6f6f6f',
  '--cpx-ref-gray-10': '#7c7c7c',
  '--cpx-ref-gray-11': '#b4b4b4',
  '--cpx-ref-gray-12': '#eeeeee',
  '--cpx-ref-gray-contrast': '#ffffff',
}

function contrastRatio(
  foreground: string,
  background: string,
  variant: 'light' | 'dark' = 'light',
): number {
  const first = parseColor(foreground, variant)
  const second = parseColor(background, variant)
  const brightest = Math.max(luminance(first), luminance(second))
  const darkest = Math.min(luminance(first), luminance(second))
  return (brightest + 0.05) / (darkest + 0.05)
}

function parseColor(
  value: string,
  variant: 'light' | 'dark' = 'light',
): readonly [number, number, number] {
  if (value.startsWith('var(')) {
    const varName = value.slice(4, -1).split(',')[0]!.trim()
    const palette = variant === 'dark' ? DARK_REF_COLORS : LIGHT_REF_COLORS
    const resolved = palette[varName]
    if (resolved) {
      return parseColor(resolved, variant)
    }
  }
  if (value.startsWith('#')) {
    return [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
    ]
  }
  const channels = value.match(/\d+/g)
  if (!channels || channels.length < 3) {
    throw new Error(`Invalid color: ${value}`)
  }
  return [Number(channels[0]), Number(channels[1]), Number(channels[2])]
}

function luminance(color: readonly [number, number, number]): number {
  const channels = color.map((value) => {
    const normalized = value / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
