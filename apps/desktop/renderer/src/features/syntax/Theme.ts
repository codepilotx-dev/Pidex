import { HIGHLIGHT_THEMES, isHighlightThemeSlug } from '../../../shared/themes/Manifest.js'
import type { HighlightThemeSlug } from '../../../shared/themes/Manifest.js'

export type SyntaxThemeVariant = 'light' | 'dark'

export const DEFAULT_SYNTAX_THEMES: Readonly<Record<SyntaxThemeVariant, HighlightThemeSlug>> = {
  light: 'codex-light',
  dark: 'codex-dark',
}

export { HIGHLIGHT_THEMES }
export type { HighlightThemeSlug }

const THEME_LABEL_COLLATOR = new Intl.Collator()

export function getThemesForVariant(variant: SyntaxThemeVariant) {
  return HIGHLIGHT_THEMES.filter((theme) => theme.variant === variant).toSorted((left, right) =>
    THEME_LABEL_COLLATOR.compare(left.label, right.label),
  )
}

export function isThemeCompatibleWithVariant(
  codeThemeId: string | null | undefined,
  variant: SyntaxThemeVariant,
): codeThemeId is HighlightThemeSlug {
  const normalized = codeThemeId?.trim().toLowerCase()
  if (!normalized || codeThemeId !== normalized || !isHighlightThemeSlug(normalized)) {
    return false
  }
  return getThemesForVariant(variant).some(
    (theme) => theme.slug === normalized && theme.variant === variant,
  )
}

export function normalizeThemeIdForVariant(
  codeThemeId: string | null | undefined,
  variant: SyntaxThemeVariant,
): 'auto' | HighlightThemeSlug {
  if (codeThemeId === 'auto') return 'auto'
  return isThemeCompatibleWithVariant(codeThemeId, variant) ? codeThemeId : 'auto'
}

export function resolveThemeId(
  codeThemeId: string | null | undefined,
  variant: SyntaxThemeVariant,
): HighlightThemeSlug {
  if (isThemeCompatibleWithVariant(codeThemeId, variant)) {
    return codeThemeId
  }
  return DEFAULT_SYNTAX_THEMES[variant]
}
