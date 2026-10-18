import type {
  DesktopChromeTheme,
  DesktopThemeConfigV1,
  DesktopThemeFontFace,
  DesktopThemeFonts,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from './Types.js'
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_CHROME_THEMES,
  DEFAULT_DARK_CHROME_THEME,
  DEFAULT_LIGHT_CHROME_THEME,
  desktopThemeFontFaceMatchesFamily,
  isNewerDesktopThemeSettingsVersion,
  normalizeDesktopAccentPreset,
  resolveSharedFontsFromVariants,
} from '@pidex/shared/desktop-theme'
import {
  HIGHLIGHT_THEMES,
  type HighlightThemeSlug,
  isHighlightThemeSlug,
} from './themes/Manifest.js'
import { isRecord } from '@pidex/shared/guards'

export const DEFAULT_LIGHT_THEME_ID = 'light-codex'
export const DEFAULT_DARK_THEME_ID = 'dark-codex'
export const DEFAULT_UI_FONT =
  'MiSans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'
export const DEFAULT_CODE_FONT =
  '"JetBrains Mono", "SF Mono", "Geist Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'

export { DEFAULT_LIGHT_CHROME_THEME, DEFAULT_DARK_CHROME_THEME }

export const DEFAULT_LIGHT_THEME: DesktopThemeConfigV1 = {
  codeThemeId: 'codex-new-light',
  theme: DEFAULT_LIGHT_CHROME_THEME,
  variant: 'light',
}

export const DEFAULT_DARK_THEME: DesktopThemeConfigV1 = {
  codeThemeId: 'codex-new-dark',
  theme: DEFAULT_DARK_CHROME_THEME,
  variant: 'dark',
}

export const DEFAULT_DESKTOP_THEME_SETTINGS: DesktopThemeSettings =
  DEFAULT_APPEARANCE_SETTINGS as DesktopThemeSettings

export function resetAdvancedDesktopThemeSettings(
  settings: DesktopThemeSettings,
): DesktopThemeSettings {
  const defaults = DEFAULT_DESKTOP_THEME_SETTINGS
  // Advanced reset clears the code font, every face selection, and the
  // contrast; it deliberately keeps the chosen UI font family and the light and
  // dark palettes, which live in the visual section.
  const fonts: DesktopThemeFonts = {
    ...settings.fonts,
    code: defaults.fonts.code,
    codeFace: defaults.fonts.codeFace ?? null,
    uiFace: defaults.fonts.uiFace ?? null,
  }
  const resetTheme = (variant: DesktopThemeVariant): DesktopChromeTheme => {
    const theme = settings.chromeThemes[variant]
    return {
      ...theme,
      contrast: defaults.chromeThemes[variant].contrast,
      fonts: { ...fonts },
    }
  }
  return {
    ...settings,
    fonts,
    chromeThemes: { light: resetTheme('light'), dark: resetTheme('dark') },
    fontSizes: { ...defaults.fontSizes },
    reduceMotion: defaults.reduceMotion,
    pointerCursorEnabled: defaults.pointerCursorEnabled,
    fontSmoothingEnabled: defaults.fontSmoothingEnabled,
  }
}

/**
 * Builds the per-variant theme a component consumes. V8 stores fonts once for
 * the whole appearance, so both variants resolve to the same font set while
 * every color stays variant-specific.
 */
export function getDesktopThemeForSelection(
  settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): DesktopThemeConfigV1 {
  return {
    codeThemeId: settings.codeThemeIds[variant],
    theme: {
      ...settings.chromeThemes[variant],
      fonts: {
        code: settings.fonts.code,
        codeFace: settings.fonts.codeFace ?? null,
        ui: settings.fonts.ui,
        uiFace: settings.fonts.uiFace ?? null,
      },
    },
    variant,
  }
}

export function getDesktopThemeIdForVariant(
  _settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): string {
  return variant === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID
}

export function getCodeThemeSelectionForVariant(
  settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): HighlightThemeSlug {
  return settings.codeThemeIds[variant]
}

export function normalizeDesktopThemeSettings(value: unknown): DesktopThemeSettings {
  const record = isRecord(value) ? value : {}
  if (record.version !== 6 && record.version !== 7 && record.version !== 8) {
    return cloneDefaultDesktopThemeSettings()
  }
  const chromeThemes = isRecord(record.chromeThemes) ? record.chromeThemes : {}
  const mode = normalizeMode(record.mode)
  const normalizedThemes = {
    light: normalizeChromeTheme(chromeThemes.light, DEFAULT_LIGHT_CHROME_THEME, 'light'),
    dark: normalizeChromeTheme(chromeThemes.dark, DEFAULT_DARK_CHROME_THEME, 'dark'),
  }
  const fonts = normalizeThemeFonts(record.fonts, mode, normalizedThemes)

  return {
    version: 8,
    mode,
    chromeThemes: withSharedVariantFonts(normalizedThemes, fonts),
    codeThemeIds: normalizeCodeThemeIds(record),
    fonts,
    pointerCursorEnabled:
      typeof record.pointerCursorEnabled === 'boolean'
        ? record.pointerCursorEnabled
        : DEFAULT_DESKTOP_THEME_SETTINGS.pointerCursorEnabled,
    reduceMotion: normalizeReducedMotion(record.reduceMotion),
    fontSmoothingEnabled:
      typeof record.fontSmoothingEnabled === 'boolean'
        ? record.fontSmoothingEnabled
        : DEFAULT_DESKTOP_THEME_SETTINGS.fontSmoothingEnabled,
    fontSizes: normalizeFontSizes(record.fontSizes),
  }
}

export { isNewerDesktopThemeSettingsVersion }

function cloneDefaultDesktopThemeSettings(): DesktopThemeSettings {
  return {
    ...DEFAULT_DESKTOP_THEME_SETTINGS,
    chromeThemes: {
      light: {
        ...DEFAULT_LIGHT_CHROME_THEME,
        fonts: { ...DEFAULT_LIGHT_CHROME_THEME.fonts },
        semanticColors: { ...DEFAULT_LIGHT_CHROME_THEME.semanticColors },
      },
      dark: {
        ...DEFAULT_DARK_CHROME_THEME,
        fonts: { ...DEFAULT_DARK_CHROME_THEME.fonts },
        semanticColors: { ...DEFAULT_DARK_CHROME_THEME.semanticColors },
      },
    },
    codeThemeIds: { ...DEFAULT_DESKTOP_THEME_SETTINGS.codeThemeIds },
    fonts: { ...DEFAULT_DESKTOP_THEME_SETTINGS.fonts },
    fontSizes: { ...DEFAULT_DESKTOP_THEME_SETTINGS.fontSizes },
  }
}

export function applySharedDesktopThemeFonts(
  settings: DesktopThemeSettings,
  patch: Partial<DesktopThemeFonts>,
): DesktopThemeSettings {
  const fonts: DesktopThemeFonts = {
    code: settings.fonts.code,
    codeFace: settings.fonts.codeFace ?? null,
    ui: settings.fonts.ui,
    uiFace: settings.fonts.uiFace ?? null,
    ...patch,
  }
  return normalizeDesktopThemeSettings({
    ...settings,
    fonts,
    chromeThemes: withSharedVariantFonts(settings.chromeThemes, fonts),
  })
}

function normalizeMode(value: unknown): DesktopThemeSettings['mode'] {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : DEFAULT_DESKTOP_THEME_SETTINGS.mode
}

function normalizeThemeFonts(
  value: unknown,
  mode: DesktopThemeSettings['mode'],
  themes: Record<DesktopThemeVariant, DesktopChromeTheme>,
): DesktopThemeFonts {
  if (!isRecord(value)) {
    // V6/V7 documents keep their fonts on the variants; the active mode's
    // variant owns the value so the visible theme survives the upgrade.
    return resolveSharedFontsFromVariants(themes, mode)
  }
  const code = normalizeOptionalFont(value.code)
  const ui = normalizeOptionalFont(value.ui)
  const codeFace = normalizeOptionalFontFace(value.codeFace)
  const uiFace = normalizeOptionalFontFace(value.uiFace)
  return {
    code,
    codeFace: desktopThemeFontFaceMatchesFamily(code, codeFace) ? codeFace : null,
    ui,
    uiFace: desktopThemeFontFaceMatchesFamily(ui, uiFace) ? uiFace : null,
  }
}

/**
 * Mirrors the shared fonts onto both variants. Older readers and the
 * `DesktopThemeConfigV1` shape still read variant fonts, so the written value
 * must never disagree with the shared setting.
 */
function withSharedVariantFonts(
  themes: Record<DesktopThemeVariant, DesktopChromeTheme>,
  fonts: DesktopThemeFonts,
): Record<DesktopThemeVariant, DesktopChromeTheme> {
  // Both variants point at one shared object so the two copies cannot drift
  // apart; the face keys are always explicit so a stale subkey cannot survive.
  const shared: DesktopThemeFonts = {
    ...fonts,
    codeFace: fonts.codeFace ?? null,
    uiFace: fonts.uiFace ?? null,
  }
  return {
    light: { ...themes.light, fonts: shared },
    dark: { ...themes.dark, fonts: shared },
  }
}

function normalizeReducedMotion(value: unknown): DesktopThemeSettings['reduceMotion'] {
  return value === 'on' || value === 'off' || value === 'system'
    ? value
    : DEFAULT_DESKTOP_THEME_SETTINGS.reduceMotion
}

function normalizeChromeTheme(
  value: unknown,
  fallback: DesktopChromeTheme,
  variant: DesktopThemeVariant,
): DesktopChromeTheme {
  const record = isRecord(value) ? value : {}
  const fonts = isRecord(record.fonts) ? record.fonts : {}
  const semanticColors = isRecord(record.semanticColors) ? record.semanticColors : {}
  const code = normalizeOptionalFont(fonts.code)
  const ui = normalizeOptionalFont(fonts.ui)
  const codeFace = normalizeOptionalFontFace(fonts.codeFace)
  const uiFace = normalizeOptionalFontFace(fonts.uiFace)
  const accent = normalizeHex(record.accent, fallback.accent)
  return {
    accent,
    accentPreset: normalizeDesktopAccentPreset(record.accentPreset, accent, variant),
    contrast: clampNumber(record.contrast, 0, 100, fallback.contrast),
    fonts: {
      code,
      codeFace: desktopThemeFontFaceMatchesFamily(code, codeFace) ? codeFace : null,
      ui,
      uiFace: desktopThemeFontFaceMatchesFamily(ui, uiFace) ? uiFace : null,
    },
    ink: normalizeHex(record.ink, fallback.ink),
    semanticColors: {
      diffAdded: normalizeHex(semanticColors.diffAdded, fallback.semanticColors.diffAdded),
      diffRemoved: normalizeHex(semanticColors.diffRemoved, fallback.semanticColors.diffRemoved),
      skill: normalizeHex(semanticColors.skill, fallback.semanticColors.skill),
    },
    surface: normalizeHex(record.surface, fallback.surface),
  }
}

function normalizeCodeThemeIds(
  value: Record<string, unknown>,
): DesktopThemeSettings['codeThemeIds'] {
  const selections = isRecord(value.codeThemeIds) ? value.codeThemeIds : {}
  const legacyTheme = isHighlightThemeSlug(value.codeThemeId)
    ? HIGHLIGHT_THEMES.find((theme) => theme.slug === value.codeThemeId)
    : undefined

  return {
    light: normalizeCodeThemeIdForVariant(
      selections.light ?? (legacyTheme?.variant === 'light' ? legacyTheme.slug : undefined),
      'light',
    ),
    dark: normalizeCodeThemeIdForVariant(
      selections.dark ?? (legacyTheme?.variant === 'dark' ? legacyTheme.slug : undefined),
      'dark',
    ),
  }
}

function normalizeCodeThemeIdForVariant(
  value: unknown,
  variant: DesktopThemeVariant,
): HighlightThemeSlug {
  if (value === 'auto' || !isHighlightThemeSlug(value)) {
    return variant === 'light' ? 'codex-new-light' : 'codex-new-dark'
  }
  return HIGHLIGHT_THEMES.some((theme) => theme.slug === value && theme.variant === variant)
    ? value
    : variant === 'light'
      ? 'codex-new-light'
      : 'codex-new-dark'
}

function normalizeFontSizes(value: unknown): DesktopThemeSettings['fontSizes'] {
  const record = isRecord(value) ? value : {}
  return {
    code: clampNumber(record.code, 8, 24, DEFAULT_DESKTOP_THEME_SETTINGS.fontSizes.code),
    ui: clampNumber(record.ui, 11, 16, DEFAULT_DESKTOP_THEME_SETTINGS.fontSizes.ui),
  }
}

function normalizeHex(value: unknown, fallback: `#${string}`): `#${string}` {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? (value.toLowerCase() as `#${string}`)
    : fallback
}

function normalizeOptionalFont(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 512) : null
}

function normalizeOptionalFontFace(value: unknown): DesktopThemeFontFace | null {
  if (value === null) return null
  if (!isRecord(value)) return null
  const family = normalizeFontFaceField(value.family)
  const fullName = normalizeFontFaceField(value.fullName)
  const postscriptName = normalizeFontFaceField(value.postscriptName)
  if (!family || !fullName || !postscriptName) return null
  return { family, fullName, postscriptName }
}

function normalizeFontFaceField(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback
}
