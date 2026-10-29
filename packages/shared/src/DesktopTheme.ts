export type DesktopThemeVariant = 'light' | 'dark'
export type DesktopThemeMode = DesktopThemeVariant | 'system'
export type DesktopHexColor = `#${string}`

export const DESKTOP_ACCENT_PRESET_COLORS = {
  blue: '#3566F0',
  green: '#19B79E',
  yellow: '#FDCD54',
  pink: '#FA70AB',
  orange: '#FF8771',
  purple: '#AB5EFF',
} as const

export type DesktopAccentPreset =
  keyof typeof DESKTOP_ACCENT_PRESET_COLORS | 'default' | 'black' | 'custom'

export function getDesktopAccentPresetColor(
  preset: DesktopAccentPreset,
  variant: DesktopThemeVariant,
): DesktopHexColor | undefined {
  if (preset === 'custom') return undefined
  if (preset === 'default' || preset === 'black') {
    return variant === 'light' ? '#000000' : '#FFFFFF'
  }
  return DESKTOP_ACCENT_PRESET_COLORS[preset]
}

export function normalizeDesktopAccentPreset(
  value: unknown,
  accent: DesktopHexColor,
  variant: DesktopThemeVariant,
): DesktopAccentPreset {
  const preset = ['default', ...Object.keys(DESKTOP_ACCENT_PRESET_COLORS), 'black'].find(
    (preset) => preset === value,
  ) as Exclude<DesktopAccentPreset, 'custom'> | undefined
  return preset &&
    getDesktopAccentPresetColor(preset, variant)?.toLowerCase() === accent.toLowerCase()
    ? preset
    : 'custom'
}

export function deriveDesktopSurfaceUnder(
  surface: string,
  ink: string,
  variant: DesktopThemeVariant,
  contrast: number,
): string {
  const parseHex = (value: string) => {
    const hex = value.replace('#', '')
    return {
      red: Number.parseInt(hex.slice(0, 2), 16),
      green: Number.parseInt(hex.slice(2, 4), 16),
      blue: Number.parseInt(hex.slice(4, 6), 16),
    }
  }
  const surfaceRgb = parseHex(surface)
  const inkRgb = parseHex(ink)
  const dark = variant === 'dark'
  const target = dark ? { red: 0, green: 0, blue: 0 } : inkRgb
  const amount = Math.max(
    0,
    Math.min(1, (dark ? 0.1 : 0.04) + (contrast - (dark ? 60 : 40)) * (dark ? 0.0015 : 0.0012)),
  )
  const mix = (channel: keyof typeof surfaceRgb) =>
    Math.round(surfaceRgb[channel] + (target[channel] - surfaceRgb[channel]) * amount)
  const toHex = (value: number) => value.toString(16).padStart(2, '0')

  return `#${toHex(mix('red'))}${toHex(mix('green'))}${toHex(mix('blue'))}`
}

/**
 * One locally installed system font face, as returned by the Local Font
 * Access enumeration. Only display metadata crosses the typed bridge; font
 * files, Blobs, and filesystem paths are never exposed to the renderer.
 */
export type DesktopSystemFontFace = {
  family: string
  fullName: string
  postscriptName: string
  style: string
}

/**
 * Persisted font-face selection. The style is intentionally omitted: a
 * non-default style is re-resolved against the live system enumeration, and
 * `null` always means "family only / default face".
 */
export type DesktopThemeFontFace = Pick<
  DesktopSystemFontFace,
  'family' | 'fullName' | 'postscriptName'
>

/**
 * Font selection owned by the appearance as a whole instead of one variant.
 * Light and dark share the same UI and code fonts; `chromeThemes[*].fonts` only
 * remains as the V6/V7 input location that V8 normalization reads from.
 */
export type DesktopThemeFonts = {
  code: string | null
  codeFace?: DesktopThemeFontFace | null
  ui: string | null
  uiFace?: DesktopThemeFontFace | null
}

export const DESKTOP_THEME_SETTINGS_VERSION = 8

export function isNewerDesktopThemeSettingsVersion(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const version = (value as { version?: unknown }).version
  return (
    typeof version === 'number' &&
    Number.isInteger(version) &&
    version > DESKTOP_THEME_SETTINGS_VERSION
  )
}

export function desktopThemeFontFaceMatchesFamily(
  family: string | null | undefined,
  face: DesktopThemeFontFace | null | undefined,
): boolean {
  if (!family || !face) return false
  const firstFamily = family.split(',', 1)[0]?.trim() ?? ''
  const unquoted =
    firstFamily.length >= 2 &&
    ((firstFamily.startsWith('"') && firstFamily.endsWith('"')) ||
      (firstFamily.startsWith("'") && firstFamily.endsWith("'")))
      ? firstFamily.slice(1, -1)
      : firstFamily
  return unquoted.toLowerCase() === face.family.trim().toLowerCase()
}

export type DesktopSystemFontsResult =
  | { ok: true; fonts: DesktopSystemFontFace[] }
  | { ok: false; error: 'unsupported' | 'denied' | 'failed' }

/**
 * Picks the shared font set for a V7 document that still stores fonts per
 * variant. The variant of the current mode owns the value so the visible theme
 * never changes during the upgrade; `system` mode prefers an explicitly
 * configured variant over the untouched default.
 */
export function resolveSharedFontsFromVariants(
  themes: { light: { fonts: DesktopThemeFonts }; dark: { fonts: DesktopThemeFonts } },
  mode: DesktopThemeMode,
): DesktopThemeFonts {
  const preferred =
    mode === 'dark'
      ? ['dark', 'light']
      : mode === 'light'
        ? ['light', 'dark']
        : hasConfiguredFonts(themes.dark.fonts) && !hasConfiguredFonts(themes.light.fonts)
          ? ['dark', 'light']
          : ['light', 'dark']
  for (const variant of preferred as DesktopThemeVariant[]) {
    const fonts = themes[variant].fonts
    if (hasConfiguredFonts(fonts)) return cloneFonts(fonts)
  }
  return cloneFonts(themes[preferred[0] as DesktopThemeVariant].fonts)
}

function hasConfiguredFonts(fonts: DesktopThemeFonts): boolean {
  return Boolean(fonts.ui || fonts.uiFace || fonts.code || fonts.codeFace)
}

function cloneFonts(fonts: DesktopThemeFonts): DesktopThemeFonts {
  return {
    code: fonts.code,
    codeFace: fonts.codeFace ?? null,
    ui: fonts.ui,
    uiFace: fonts.uiFace ?? null,
  }
}

export type DesktopChromeTheme = {
  accent: DesktopHexColor
  accentPreset?: DesktopAccentPreset
  contrast: number
  fonts: {
    code: string | null
    codeFace?: DesktopThemeFontFace | null
    ui: string | null
    uiFace?: DesktopThemeFontFace | null
  }
  ink: DesktopHexColor
  semanticColors: {
    diffAdded: DesktopHexColor
    diffRemoved: DesktopHexColor
    skill: DesktopHexColor
  }
  surface: DesktopHexColor
}

export type DesktopThemeSettingsV6<CodeThemeId extends string = string> = {
  version: 6
  mode: DesktopThemeMode
  chromeThemes: Record<DesktopThemeVariant, DesktopChromeTheme>
  codeThemeIds: Record<DesktopThemeVariant, CodeThemeId>
  pointerCursorEnabled: boolean
  reduceMotion: 'system' | 'on' | 'off'
  fontSmoothingEnabled: boolean
  fontSizes: {
    code: number
    ui: number
  }
}

/**
 * V7 adds nullable `uiFace`/`codeFace` font-face selections next to the
 * existing `fonts.ui`/`fonts.code` families. V6 documents remain valid input
 * for the preserve-style migration and stay type-compatible because the face
 * keys are optional.
 */
export type DesktopThemeSettingsV7<CodeThemeId extends string = string> = Omit<
  DesktopThemeSettingsV6<CodeThemeId>,
  'version'
> & { version: 7 }

/**
 * V8 hoists the fonts to the top-level `fonts` key so both variants share one
 * UI font and one code font. V7 documents stay valid input: their variant
 * `chromeThemes[*].fonts` seed the shared value, the active mode's variant wins
 * when the two disagree, and the shared value is written back to both variants
 * so older readers keep seeing a consistent theme.
 */
export type DesktopThemeSettingsV8<CodeThemeId extends string = string> = Omit<
  DesktopThemeSettingsV7<CodeThemeId>,
  'version'
> & { version: 8; fonts: DesktopThemeFonts }

export const DEFAULT_LIGHT_CHROME_THEME: DesktopChromeTheme = {
  accent: '#0169cc',
  accentPreset: 'custom',
  contrast: 40,
  fonts: { code: null, ui: null, uiFace: null, codeFace: null },
  ink: '#1f1f1f',
  semanticColors: {
    diffAdded: '#00a240',
    diffRemoved: '#e02e2a',
    skill: '#751ed9',
  },
  surface: '#ffffff',
}

export const DEFAULT_DARK_CHROME_THEME: DesktopChromeTheme = {
  accent: '#0169cc',
  accentPreset: 'custom',
  contrast: 60,
  fonts: { code: null, ui: null, uiFace: null, codeFace: null },
  ink: '#eeeeee',
  semanticColors: {
    diffAdded: '#00a240',
    diffRemoved: '#e02e2a',
    skill: '#b06dff',
  },
  surface: '#111111',
}

export const DEFAULT_CHROME_THEMES: Record<DesktopThemeVariant, DesktopChromeTheme> = {
  light: DEFAULT_LIGHT_CHROME_THEME,
  dark: DEFAULT_DARK_CHROME_THEME,
}

export const DEFAULT_APPEARANCE_SETTINGS: DesktopThemeSettingsV8 = {
  version: 8,
  mode: 'system',
  chromeThemes: DEFAULT_CHROME_THEMES,
  codeThemeIds: { light: 'codex-new-light', dark: 'codex-new-dark' },
  fonts: { code: null, ui: null, uiFace: null, codeFace: null },
  pointerCursorEnabled: false,
  reduceMotion: 'system',
  fontSmoothingEnabled: true,
  fontSizes: { ui: 14, code: 12 },
}

export type AppearanceMigrationBackup = {
  chromeThemes: {
    light: DesktopChromeTheme
    dark: DesktopChromeTheme
  }
  fontSizes: {
    ui: number
  }
}

export type AppearanceMigrationRecord = {
  version: 1
  migrationId: 'ui-design-visual-theme'
  state: 'pending' | 'completed'
  backup?: AppearanceMigrationBackup | null
}
