import { DEFAULT_CODE_FONT, DEFAULT_UI_FONT } from '../../../shared/Theme.js'
import { deriveDesktopSurfaceUnder } from '@pidex/shared/desktop-theme'
import type { DesktopThemeConfigV1 } from '../../../shared/Types.js'
import { fontFamilyWithFace } from './ThemeFontFaces.js'

export type ThemeVariableName = `--${string}`
export type ThemeVariableMap = Record<ThemeVariableName, string>

type Roles = {
  surfaceRecessed: string
  panel: string
  control: string
  raised: string
  editorBackground: string
  borderLight: string
  border: string
  borderHeavy: string
  borderFocus: string
  textSecondary: string
  textTertiary: string
  textDisabled: string
  accentSubtle: string
  accentForeground: string
  accentHover: string
  accentActive: string
  buttonPrimaryBg: string
  buttonPrimaryFg: string
  buttonPrimaryHover: string
  buttonPrimaryActive: string
  buttonSecondaryBg: string
  buttonSecondaryFg: string
  buttonSecondaryHover: string
  buttonSecondaryActive: string
  simpleScrim: string
}

type DerivedSemanticTone = {
  foreground: string
  indicator: string
  lineBackground: string
  textBackground: string
}

export function ensureThemePreviewContrast({
  accent,
  ink,
  surface,
}: {
  accent: string
  ink: string
  surface: string
}): string {
  return ensureContrast(parseColor(accent), parseColor(ink), parseColor(surface), 4.5)
}

const LIGHT_SYNTAX = {
  keyword: '#cf222e',
  property: '#0550ae',
  string: '#0a3069',
  number: '#098658',
  comment: '#6e7781',
  variable: '#953800',
  punctuation: '#24292f',
}

const DARK_SYNTAX = {
  keyword: '#ff7b72',
  property: '#79c0ff',
  string: '#a5d6ff',
  number: '#79c0ff',
  comment: '#8b949e',
  variable: '#ffa657',
  punctuation: '#c9d1d9',
}

const DEFAULT_LIGHT_SURFACE = '#ffffff'
const DEFAULT_LIGHT_INK = '#1f1f1f'
const DEFAULT_LIGHT_CONTRAST = 40
const DEFAULT_LIGHT_ACCENT = '#0169cc'

const DEFAULT_DARK_SURFACE = '#111111'
const DEFAULT_DARK_INK = '#eeeeee'
const DEFAULT_DARK_CONTRAST = 60
const DEFAULT_DARK_ACCENT = '#0169cc'

function normalizeHex(value: string): string {
  const hex = value.trim().toLowerCase().replace('#', '')
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
  }
  return `#${hex}`
}

export function deriveThemeVariables(config: DesktopThemeConfigV1): ThemeVariableMap {
  const { theme, variant } = config
  const dark = variant === 'dark'
  const isNewThemeFamily =
    config.codeThemeId === 'codex-new-light' ||
    config.codeThemeId === 'codex-new-dark' ||
    config.codeThemeId === 'codex-new'

  const defaultSurface = dark ? DEFAULT_DARK_SURFACE : DEFAULT_LIGHT_SURFACE
  const defaultInk = dark ? DEFAULT_DARK_INK : DEFAULT_LIGHT_INK
  const defaultContrast = dark ? DEFAULT_DARK_CONTRAST : DEFAULT_LIGHT_CONTRAST
  const defaultAccent = dark ? DEFAULT_DARK_ACCENT : DEFAULT_LIGHT_ACCENT

  const isNeutralDefault =
    isNewThemeFamily &&
    normalizeHex(theme.surface) === defaultSurface &&
    normalizeHex(theme.ink) === defaultInk &&
    theme.contrast === defaultContrast

  const isAccentDefault = isNeutralDefault && normalizeHex(theme.accent) === defaultAccent

  const interactionInk = parseHex(theme.ink)
  const interactionHover = rgba(interactionInk, dark ? 0.08 : 0.05)
  const interactionSelected = rgba(interactionInk, 0.05)
  const roles = deriveRoles(theme.surface, theme.ink, theme.accent, dark, theme.contrast)

  const mathEditorBackground = isNeutralDefault
    ? dark
      ? '#191919'
      : '#f9f9f9'
    : roles.editorBackground
  const mathInk = theme.ink

  const added = deriveSemanticTone({
    hue: theme.semanticColors.diffAdded,
    editorBackground: mathEditorBackground,
    ink: mathInk,
  })
  const removed = deriveSemanticTone({
    hue: theme.semanticColors.diffRemoved,
    editorBackground: mathEditorBackground,
    ink: mathInk,
  })
  const warningHue = isNeutralDefault ? '#fb6a22' : dark ? '#f0a33b' : '#a05a00'
  const warningTone = deriveSemanticTone({
    hue: warningHue,
    editorBackground: mathEditorBackground,
    ink: mathInk,
  })
  const skillTone = deriveSemanticTone({
    hue: theme.semanticColors.skill,
    editorBackground: mathEditorBackground,
    ink: mathInk,
  })
  const infoHue = dark ? '#38bdf8' : '#0284c7'
  const infoTone = deriveSemanticTone({
    hue: infoHue,
    editorBackground: mathEditorBackground,
    ink: mathInk,
  })
  const accentForeground = [theme.surface, mathEditorBackground, roles.accentSubtle].reduce(
    (candidate, background) =>
      ensureContrast(parseColor(candidate), interactionInk, parseColor(background), 4.5),
    roles.accentForeground,
  )
  const syntax = dark ? DARK_SYNTAX : LIGHT_SYNTAX
  const shadowResting = dark ? '0 1px 2px rgb(0 0 0 / 20%)' : '0 1px 2px rgb(0 0 0 / 2%)'
  const shadowRaised = dark
    ? '0 2px 8px rgb(0 0 0 / 40%)'
    : '0 2px 8px rgb(0 0 0 / 4%), 0 1px 2px rgb(0 0 0 / 2%)'
  const shadowFloating = '0 16px 48px rgb(0 0 0 / 24%)'
  const shadowControl = dark ? '0 1px 2px rgb(0 0 0 / 20%)' : '0 1px 2px rgb(0 0 0 / 2%)'

  return {
    // System Layer: Foundation & Contrast
    '--cpx-sys-contrast': String(theme.contrast),
    '--cpx-sys-color-accent': isAccentDefault ? 'var(--cpx-ref-blue-9)' : theme.accent,
    '--cpx-sys-color-fg-on-accent': isAccentDefault
      ? 'var(--cpx-ref-blue-contrast)'
      : textOnAccent(theme.accent),
    '--cpx-sys-color-fg-primary': isNeutralDefault ? 'var(--cpx-ref-gray-12)' : theme.ink,
    '--cpx-sys-color-surface-canvas': theme.surface,
    '--cpx-sys-color-surface-recessed': isNeutralDefault
      ? dark
        ? '#0f0f0f'
        : 'var(--cpx-ref-gray-3)'
      : roles.surfaceRecessed,
    '--cpx-sys-color-surface-panel': isNeutralDefault ? 'var(--cpx-ref-gray-2)' : roles.panel,
    '--cpx-sys-color-surface-control': isNeutralDefault ? 'var(--cpx-ref-gray-2)' : roles.control,
    '--cpx-sys-color-surface-raised': isNeutralDefault ? 'var(--cpx-ref-gray-2)' : roles.raised,
    '--cpx-sys-color-surface-editor': isNeutralDefault
      ? 'var(--cpx-ref-gray-2)'
      : roles.editorBackground,
    '--cpx-sys-color-surface-secondary': isNeutralDefault ? 'var(--cpx-ref-gray-4)' : roles.control,
    '--cpx-sys-color-surface-active': isNeutralDefault ? 'var(--cpx-ref-gray-5)' : roles.raised,

    // Workbench region surfaces
    '--cpx-sys-color-workbench-sidebar-bg': dark
      ? isNeutralDefault
        ? 'var(--cpx-sys-color-surface-recessed)'
        : roles.surfaceRecessed
      : isNeutralDefault
        ? 'var(--cpx-ref-gray-2)'
        : roles.panel,
    '--cpx-sys-color-workbench-titlebar-bg': 'var(--cpx-sys-color-workbench-sidebar-bg)',
    '--cpx-sys-color-workbench-main-bg': 'var(--cpx-sys-color-surface-canvas)',
    '--cpx-sys-color-workbench-panel-bg': 'var(--cpx-sys-color-workbench-main-bg)',

    // System Layer: Foreground / text
    '--cpx-sys-color-fg-secondary': isNeutralDefault
      ? 'var(--cpx-ref-gray-11)'
      : roles.textSecondary,
    '--cpx-sys-color-fg-tertiary': isNeutralDefault
      ? 'color-mix(in srgb, var(--cpx-sys-color-fg-primary) 68%, transparent)'
      : roles.textTertiary,
    '--cpx-sys-color-fg-disabled': isNeutralDefault
      ? 'color-mix(in srgb, var(--cpx-sys-color-fg-primary) 48%, transparent)'
      : roles.textDisabled,

    // System Layer: Borders
    '--cpx-sys-color-border-subtle': isNeutralDefault
      ? 'var(--cpx-ref-gray-a5)'
      : roles.borderLight,
    '--cpx-sys-color-border-default': isNeutralDefault ? 'var(--cpx-ref-gray-a6)' : roles.border,
    '--cpx-sys-color-border-strong': isNeutralDefault
      ? 'var(--cpx-ref-gray-a7)'
      : roles.borderHeavy,
    '--cpx-sys-color-border-focus': isNeutralDefault
      ? 'color-mix(in srgb, var(--cpx-sys-color-accent) 50%, transparent)'
      : roles.borderFocus,

    // System Layer: Accent & semantic multi-hues
    '--cpx-sys-color-accent-subtle-bg': isAccentDefault
      ? 'var(--cpx-ref-blue-a3)'
      : roles.accentSubtle,
    '--cpx-sys-color-accent-subtle-hover-bg': isAccentDefault
      ? 'var(--cpx-ref-blue-a4)'
      : roles.accentHover,
    '--cpx-sys-color-accent-subtle-active-bg': isAccentDefault
      ? 'var(--cpx-ref-blue-a5)'
      : roles.accentActive,
    '--cpx-sys-color-accent-subtle-border': isAccentDefault
      ? 'var(--cpx-ref-blue-a7)'
      : rgba(parseHex(theme.accent), 0.22),
    '--cpx-sys-color-accent-fg': isAccentDefault ? 'var(--cpx-ref-blue-11)' : accentForeground,
    '--cpx-sys-color-accent-hover': isAccentDefault ? 'var(--cpx-ref-blue-10)' : roles.accentHover,
    '--cpx-sys-color-accent-active': isAccentDefault
      ? dark
        ? 'var(--cpx-ref-blue-8)'
        : 'var(--cpx-ref-blue-10)'
      : roles.accentActive,
    '--cpx-sys-color-danger': theme.semanticColors.diffRemoved,
    '--cpx-sys-color-danger-subtle-bg': removed.lineBackground,
    '--cpx-sys-color-danger-subtle-border': rgba(parseHex(theme.semanticColors.diffRemoved), 0.22),
    '--cpx-sys-color-danger-fg': removed.foreground,
    '--cpx-sys-color-warning': warningHue,
    '--cpx-sys-color-warning-subtle-bg': warningTone.lineBackground,
    '--cpx-sys-color-warning-subtle-border': rgba(parseHex(warningHue), 0.22),
    '--cpx-sys-color-warning-fg': warningTone.foreground,
    '--cpx-sys-color-success': theme.semanticColors.diffAdded,
    '--cpx-sys-color-success-subtle-bg': added.lineBackground,
    '--cpx-sys-color-success-subtle-border': rgba(parseHex(theme.semanticColors.diffAdded), 0.22),
    '--cpx-sys-color-success-fg': added.foreground,
    '--cpx-sys-color-skill': theme.semanticColors.skill,
    '--cpx-sys-color-skill-subtle-bg': skillTone.lineBackground,
    '--cpx-sys-color-skill-subtle-border': rgba(parseHex(theme.semanticColors.skill), 0.22),
    '--cpx-sys-color-skill-fg': skillTone.foreground,
    '--cpx-sys-color-info': infoHue,
    '--cpx-sys-color-info-subtle-bg': infoTone.lineBackground,
    '--cpx-sys-color-info-subtle-border': rgba(parseHex(infoHue), 0.22),
    '--cpx-sys-color-info-fg': infoTone.foreground,
    '--cpx-sys-color-scrim': isNeutralDefault
      ? dark
        ? 'rgba(0, 0, 0, 0.65)'
        : 'rgba(0, 0, 0, 0.25)'
      : roles.simpleScrim,

    // System Charts Colors
    '--cpx-sys-color-charts-red': theme.semanticColors.diffRemoved,
    '--cpx-sys-color-charts-orange': dark ? '#fb923c' : '#ea580c',
    '--cpx-sys-color-charts-yellow': warningHue,
    '--cpx-sys-color-charts-green': theme.semanticColors.diffAdded,
    '--cpx-sys-color-charts-blue': isAccentDefault ? 'var(--cpx-ref-blue-9)' : theme.accent,
    '--cpx-sys-color-charts-purple': theme.semanticColors.skill,
    '--cpx-sys-color-charts-cyan': infoHue,

    // System Blur & Glass
    '--cpx-sys-blur-sm': '8px',
    '--cpx-sys-blur-md': '16px',
    '--cpx-sys-blur-lg': '24px',
    '--cpx-sys-glass-filter': 'blur(16px)',
    '--cpx-sys-glass-bg': isNeutralDefault
      ? 'var(--cpx-ref-gray-surface)'
      : `color-mix(in srgb, ${roles.raised} 85%, transparent)`,
    '--cpx-sys-glass-border': isNeutralDefault ? 'var(--cpx-ref-gray-a5)' : roles.borderLight,
    '--cpx-sys-glass-shadow': shadowFloating,

    // System Layer: Interactive states
    '--cpx-sys-color-hover': isNeutralDefault ? 'var(--cpx-ref-gray-a2)' : interactionHover,
    '--cpx-sys-color-active': isNeutralDefault ? 'var(--cpx-ref-gray-a2)' : interactionHover,
    '--cpx-sys-color-selected': isNeutralDefault ? 'var(--cpx-ref-gray-a3)' : interactionSelected,

    // System Layer: Diff semantic tones
    '--cpx-sys-color-diff-added-fg': added.foreground,
    '--cpx-sys-color-diff-added-indicator': added.indicator,
    '--cpx-sys-color-diff-added-line': added.lineBackground,
    '--cpx-sys-color-diff-added-text': added.textBackground,
    '--cpx-sys-color-diff-removed-fg': removed.foreground,
    '--cpx-sys-color-diff-removed-indicator': removed.indicator,
    '--cpx-sys-color-diff-removed-line': removed.lineBackground,
    '--cpx-sys-color-diff-removed-text': removed.textBackground,

    // System Layer: Shadows
    '--cpx-sys-shadow-resting': isNeutralDefault
      ? dark
        ? 'inset 0 1px 0 rgba(238, 238, 238, 0.04)'
        : 'inset 0 1px 0 rgba(255, 255, 255, 0.7)'
      : shadowResting,
    '--cpx-sys-shadow-raised': isNeutralDefault
      ? dark
        ? 'inset 0 1px 0 rgba(238, 238, 238, 0.04)'
        : 'inset 0 1px 0 rgba(255, 255, 255, 0.7)'
      : shadowRaised,
    '--cpx-sys-shadow-prominent': shadowFloating,
    '--cpx-sys-shadow-floating': shadowFloating,
    '--cpx-sys-shadow-control': isNeutralDefault ? 'none' : shadowControl,

    // System Layer: Fonts
    '--cpx-sys-font-family-sans': fontFamilyWithFace(
      theme.fonts.uiFace,
      theme.fonts.ui ?? DEFAULT_UI_FONT,
      'ui',
    ),
    '--cpx-sys-font-family-mono': fontFamilyWithFace(
      theme.fonts.codeFace,
      theme.fonts.code ?? DEFAULT_CODE_FONT,
      'code',
    ),

    // System Layer: Syntax
    '--cpx-sys-color-syntax-keyword': syntax.keyword,
    '--cpx-sys-color-syntax-property': syntax.property,
    '--cpx-sys-color-syntax-string': syntax.string,
    '--cpx-sys-color-syntax-number': syntax.number,
    '--cpx-sys-color-syntax-comment': syntax.comment,
    '--cpx-sys-color-syntax-variable': syntax.variable,
    '--cpx-sys-color-syntax-punctuation': syntax.punctuation,

    // Component Layer: genuinely component-specific runtime overrides
    '--cpx-comp-switch-thumb-fill': '#ffffff',
    '--cpx-comp-scrollbar-slider-bg': isNeutralDefault ? 'var(--cpx-ref-gray-a6)' : roles.border,
    '--cpx-comp-scrollbar-slider-hover-bg': isNeutralDefault
      ? 'var(--cpx-ref-gray-a7)'
      : roles.borderHeavy,
    '--cpx-comp-scrollbar-slider-active-bg': isNeutralDefault
      ? 'var(--cpx-ref-gray-a7)'
      : roles.borderHeavy,
    '--cpx-comp-glass-filter': 'blur(16px)',
  }
}

function deriveRoles(
  surface: string,
  ink: string,
  accent: string,
  dark: boolean,
  contrast: number,
): Roles {
  const variant = dark ? 'dark' : 'light'
  const surfaceRgb = parseHex(surface)
  const inkRgb = parseHex(ink)
  const accentRgb = parseHex(accent)
  const normalizedContrast = normalizeContrast(contrast, variant)
  const white = { red: 255, green: 255, blue: 255 }
  const panel = mixHex(
    surfaceRgb,
    dark ? inkRgb : white,
    dark ? 0.03 + normalizedContrast * 0.03 : 0.18 + normalizedContrast * 0.008,
  )
  const editorBackground = mixHex(surfaceRgb, dark ? inkRgb : white, dark ? 0.07 : 0.12)
  const palette = dark
    ? deriveDarkPalette(surfaceRgb, inkRgb, accentRgb, normalizedContrast)
    : deriveLightPalette(surfaceRgb, inkRgb, accentRgb, normalizedContrast)

  return {
    surfaceRecessed: deriveDesktopSurfaceUnder(surface, ink, variant, contrast),
    panel,
    control: palette.controlBackgroundOpaque,
    raised: palette.elevatedPrimaryOpaque,
    editorBackground,
    borderLight: palette.borderLight,
    border: palette.border,
    borderHeavy: palette.borderHeavy,
    borderFocus: palette.borderFocus,
    textSecondary: rgba(inkRgb, 0.65),
    textTertiary: palette.textForegroundTertiary,
    textDisabled: palette.buttonPrimaryBackgroundInactive,
    accentSubtle: palette.accentBackground,
    accentForeground: palette.textAccent,
    accentHover: palette.accentBackgroundHover,
    accentActive: palette.accentBackgroundActive,
    buttonPrimaryBg: palette.buttonPrimaryBackground,
    buttonPrimaryFg: palette.textButtonPrimary,
    buttonPrimaryHover: palette.buttonPrimaryBackgroundHover,
    buttonPrimaryActive: palette.buttonPrimaryBackgroundActive,
    buttonSecondaryBg: palette.buttonSecondaryBackground,
    buttonSecondaryFg: palette.textButtonSecondary,
    buttonSecondaryHover: palette.buttonSecondaryBackgroundHover,
    buttonSecondaryActive: palette.buttonSecondaryBackgroundActive,
    simpleScrim: palette.simpleScrim,
  }
}

function deriveSemanticTone({
  hue,
  editorBackground,
  ink,
}: {
  hue: string
  editorBackground: string
  ink: string
}): DerivedSemanticTone {
  const hueRgb = parseHex(hue)
  const editorRgb = parseColor(editorBackground)
  const inkRgb = parseHex(ink)
  const dark = relativeLuminance(editorRgb) < 0.3
  const lineBackground = mixHex(editorRgb, hueRgb, 0.02)
  const textBackground = mixHex(editorRgb, hueRgb, dark ? 0.04 : 0.035)
  const backgrounds = [editorBackground, lineBackground, textBackground]
  const foreground = backgrounds.reduce(
    (candidate, background) =>
      ensureContrast(parseHex(candidate), inkRgb, parseColor(background), 4.5),
    hue,
  )

  return {
    foreground,
    indicator: hue,
    lineBackground,
    textBackground,
  }
}

type Rgb = { red: number; green: number; blue: number }

type VariantPalette = {
  accentBackground: string
  accentBackgroundActive: string
  accentBackgroundHover: string
  border: string
  borderFocus: string
  borderHeavy: string
  borderLight: string
  buttonPrimaryBackground: string
  buttonPrimaryBackgroundActive: string
  buttonPrimaryBackgroundHover: string
  buttonPrimaryBackgroundInactive: string
  buttonSecondaryBackground: string
  buttonSecondaryBackgroundActive: string
  buttonSecondaryBackgroundHover: string
  buttonSecondaryBackgroundInactive: string
  buttonTertiaryBackground: string
  buttonTertiaryBackgroundActive: string
  buttonTertiaryBackgroundHover: string
  controlBackground: string
  controlBackgroundOpaque: string
  elevatedPrimary: string
  elevatedPrimaryOpaque: string
  elevatedSecondary: string
  elevatedSecondaryOpaque: string
  iconAccent: string
  iconPrimary: string
  iconSecondary: string
  iconTertiary: string
  simpleScrim: string
  textAccent: string
  textButtonPrimary: string
  textButtonSecondary: string
  textButtonTertiary: string
  textForeground: string
  textForegroundSecondary: string
  textForegroundTertiary: string
}

function deriveLightPalette(surface: Rgb, ink: Rgb, accent: Rgb, contrast: number): VariantPalette {
  const white = { red: 255, green: 255, blue: 255 }
  const black = { red: 0, green: 0, blue: 0 }
  const control = mixRgb(surface, white, 0.09 + contrast * 0.04)
  const elevatedSecondary = mixRgb(surface, white, 0.08 + contrast * 0.08)
  const elevatedPrimary = mixRgb(surface, white, 0.16 + contrast * 0.12)
  return {
    accentBackground: mixHex(surface, accent, 0.11 + contrast * 0.04),
    accentBackgroundActive: mixHex(surface, accent, 0.13 + contrast * 0.05),
    accentBackgroundHover: mixHex(surface, accent, 0.12 + contrast * 0.045),
    border: rgba(ink, 0.06 + contrast * 0.04),
    borderFocus: hexString(accent),
    borderHeavy: rgba(ink, 0.09 + contrast * 0.06),
    borderLight: rgba(ink, 0.04 + contrast * 0.02),
    buttonPrimaryBackground: hexString(ink),
    buttonPrimaryBackgroundActive: rgba(ink, 0.1 + contrast * 0.12),
    buttonPrimaryBackgroundHover: rgba(ink, 0.05 + contrast * 0.06),
    buttonPrimaryBackgroundInactive: mixHex(surface, ink, 0.25 + contrast * 0.2),
    buttonSecondaryBackground: rgba(ink, 0.04 + contrast * 0.02),
    buttonSecondaryBackgroundActive: rgba(ink, 0.03 + contrast * 0.02),
    buttonSecondaryBackgroundHover: rgba(ink, 0.04 + contrast * 0.03),
    buttonSecondaryBackgroundInactive: rgba(ink, 0.01 + contrast * 0.02),
    buttonTertiaryBackground: rgba(ink, 0),
    buttonTertiaryBackgroundActive: rgba(ink, 0.16 + contrast * 0.08),
    buttonTertiaryBackgroundHover: rgba(ink, 0.08 + contrast * 0.04),
    controlBackground: rgba(control, 0.96),
    controlBackgroundOpaque: rgbString(control),
    elevatedPrimary: rgba(elevatedPrimary, 0.96),
    elevatedPrimaryOpaque: rgbString(elevatedPrimary),
    elevatedSecondary: rgba(elevatedSecondary, 0.96),
    elevatedSecondaryOpaque: rgbString(elevatedSecondary),
    iconAccent: hexString(accent),
    iconPrimary: hexString(ink),
    iconSecondary: rgba(ink, 0.65 + contrast * 0.1),
    iconTertiary: rgba(ink, 0.45 + contrast * 0.1),
    simpleScrim: rgba(black, 0.08 + contrast * 0.04),
    textAccent: hexString(accent),
    textButtonPrimary: hexString(surface),
    textButtonSecondary: hexString(ink),
    textButtonTertiary: mixHex(surface, ink, 0.45 + contrast * 0.1),
    textForeground: hexString(ink),
    textForegroundSecondary: rgba(ink, 0.65 + contrast * 0.1),
    textForegroundTertiary: rgba(ink, 0.65 + contrast * 0.05),
  }
}

function deriveDarkPalette(surface: Rgb, ink: Rgb, accent: Rgb, contrast: number): VariantPalette {
  const white = { red: 255, green: 255, blue: 255 }
  const black = { red: 0, green: 0, blue: 0 }
  const control = mixRgb(surface, ink, 0.06 + contrast * 0.05)
  const accentOnDark = mixRgb(accent, white, 0.3 + contrast * 0.15)
  const primaryText = mixRgb(surface, black, 0.38 + contrast * 0.12)
  const elevatedPrimary = mixRgb(surface, ink, 0.08 + contrast * 0.08)
  return {
    accentBackground: mixHex(black, accent, 0.2 + contrast * 0.08),
    accentBackgroundActive: mixHex(black, accent, 0.22 + contrast * 0.12),
    accentBackgroundHover: mixHex(black, accent, 0.21 + contrast * 0.1),
    border: rgba(ink, 0.06 + contrast * 0.04),
    borderFocus: rgba(accentOnDark, 0.7 + contrast * 0.1),
    borderHeavy: rgba(ink, 0.12 + contrast * 0.06),
    borderLight: rgba(ink, 0.03 + contrast * 0.02),
    buttonPrimaryBackground: rgbString(primaryText),
    buttonPrimaryBackgroundActive: rgba(ink, 0.07 + contrast * 0.05),
    buttonPrimaryBackgroundHover: rgba(ink, 0.04 + contrast * 0.03),
    buttonPrimaryBackgroundInactive: mixHex(surface, ink, 0.25 + contrast * 0.15),
    buttonSecondaryBackground: rgba(ink, 0.04 + contrast * 0.02),
    buttonSecondaryBackgroundActive: rgba(ink, 0.09 + contrast * 0.05),
    buttonSecondaryBackgroundHover: rgba(ink, 0.06 + contrast * 0.03),
    buttonSecondaryBackgroundInactive: rgba(ink, 0.02 + contrast * 0.03),
    buttonTertiaryBackground: rgba(ink, 0.02 + contrast * 0.015),
    buttonTertiaryBackgroundActive: rgba(ink, 0.07 + contrast * 0.05),
    buttonTertiaryBackgroundHover: rgba(ink, 0.05 + contrast * 0.03),
    controlBackground: rgba(control, 0.96),
    controlBackgroundOpaque: rgbString(control),
    elevatedPrimary: rgba(elevatedPrimary, 0.96),
    elevatedPrimaryOpaque: rgbString(elevatedPrimary),
    elevatedSecondary: rgba(ink, 0.02 + contrast * 0.02),
    elevatedSecondaryOpaque: mixHex(surface, ink, 0.04 + contrast * 0.05),
    iconAccent: rgbString(accentOnDark),
    iconPrimary: rgba(ink, 0.82 + contrast * 0.14),
    iconSecondary: rgba(ink, 0.65 + contrast * 0.1),
    iconTertiary: rgba(ink, 0.45 + contrast * 0.1),
    simpleScrim: rgba(ink, 0.08 + contrast * 0.04),
    textAccent: rgbString(accentOnDark),
    textButtonPrimary: rgbString(primaryText),
    textButtonSecondary: mixHex(ink, surface, 0.7 + contrast * 0.1),
    textButtonTertiary: mixHex(surface, ink, 0.45 + contrast * 0.1),
    textForeground: hexString(ink),
    textForegroundSecondary: rgba(ink, 0.65 + contrast * 0.1),
    textForegroundTertiary: rgba(ink, 0.42 + contrast * 0.13),
  }
}

function normalizeContrast(value: number, variant: 'light' | 'dark'): number {
  const base = variant === 'dark' ? 60 : 40
  const baseRatio = base / 100
  const adjusted = value / 100 + ((value - base) / 60) * 0.7
  const normalized = value <= base ? adjusted : baseRatio + (adjusted - baseRatio) * 2
  return Math.min(1, Math.max(0, normalized))
}

function parseHex(value: string): Rgb {
  const hex = normalizeHex(value).slice(1)
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  }
}

function parseColor(value: string): Rgb {
  if (value.startsWith('#')) return parseHex(value)
  const channels = value.match(/\d+/g)
  if (!channels || channels.length < 3) {
    throw new Error(`Unsupported theme color: ${value}`)
  }
  return {
    red: Number(channels[0]),
    green: Number(channels[1]),
    blue: Number(channels[2]),
  }
}

function ensureContrast(color: Rgb, ink: Rgb, background: Rgb, minimumRatio: number): string {
  if (contrastRatio(color, background) >= minimumRatio) {
    return hexString(color)
  }

  if (contrastRatio(ink, background) >= minimumRatio) {
    let low = 0
    let high = 1
    for (let iteration = 0; iteration < 16; iteration += 1) {
      const amount = (low + high) / 2
      if (contrastRatio(mixRgb(color, ink, amount), background) >= minimumRatio) {
        high = amount
      } else {
        low = amount
      }
    }
    return mixHex(color, ink, high)
  }

  const black = { red: 0, green: 0, blue: 0 }
  const white = { red: 255, green: 255, blue: 255 }
  return contrastRatio(black, background) >= contrastRatio(white, background)
    ? hexString(black)
    : hexString(white)
}

function contrastRatio(first: Rgb, second: Rgb): number {
  const brightest = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darkest = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (brightest + 0.05) / (darkest + 0.05)
}

function relativeLuminance(color: Rgb): number {
  const channel = (value: number): number => {
    const normalized = value / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return channel(color.red) * 0.2126 + channel(color.green) * 0.7152 + channel(color.blue) * 0.0722
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  const ratio = Math.min(1, Math.max(0, amount))
  return {
    red: Math.round(from.red + (to.red - from.red) * ratio),
    green: Math.round(from.green + (to.green - from.green) * ratio),
    blue: Math.round(from.blue + (to.blue - from.blue) * ratio),
  }
}

function mixHex(from: Rgb, to: Rgb, amount: number): string {
  return hexString(mixRgb(from, to, amount))
}

function rgba(color: Rgb, alpha: number): string {
  const normalized = Math.min(1, Math.max(0, alpha))
    .toFixed(3)
    .replace(/0+$/, '')
    .replace(/\.$/, '')
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${normalized})`
}

function rgbString(color: Rgb): string {
  return `rgb(${color.red}, ${color.green}, ${color.blue})`
}

function hexString(color: Rgb): string {
  return `#${[color.red, color.green, color.blue]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

function textOnAccent(accent: string): string {
  if (accent.toLowerCase() === '#339cff') return '#ffffff'
  const color = parseHex(accent)
  const channel = (value: number): number => {
    const normalized = value / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  const luminance =
    channel(color.red) * 0.2126 + channel(color.green) * 0.7152 + channel(color.blue) * 0.0722
  return luminance > 0.179 ? '#000000' : '#ffffff'
}
