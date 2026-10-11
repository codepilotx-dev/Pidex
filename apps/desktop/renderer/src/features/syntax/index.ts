export { CodeBlock, syntaxTokenStyle } from './CodeBlock.js'
export type { CodeBlockProps } from './CodeBlock.js'
export {
  clearSyntaxHighlightCache,
  highlightCode,
  peekHighlightedCode,
  presentHighlightedCode,
  SYNTAX_HIGHLIGHT_CACHE_CAPACITY,
  SYNTAX_HIGHLIGHT_CACHE_MAX_WEIGHT,
} from './Highlighter.js'
export {
  formatSyntaxLanguageLabel,
  normalizeSyntaxLanguage,
  resolveLanguageFromPath,
} from './Language.js'
export { SyntaxHighlighterService, syntaxHighlighter, syntaxHighlighterService } from './Service.js'
export {
  HIGHLIGHT_THEMES,
  DEFAULT_SYNTAX_THEMES,
  getThemesForVariant,
  isThemeCompatibleWithVariant,
  normalizeThemeIdForVariant,
  resolveThemeId,
} from './Theme.js'
export type { HighlightThemeSlug, SyntaxThemeVariant } from './Theme.js'
export type {
  HighlightCodeOptions,
  SyntaxHighlightPresentation,
  SyntaxHighlightResult,
  SyntaxToken,
} from './Types.js'
export { STREAMING_HIGHLIGHT_INTERVAL_MS, useHighlightedCode } from './UseHighlightedCode.js'
export {
  CODE_WRAP_STORAGE_KEY,
  readCodeWrapPreference,
  setCodeWrapPreference,
  useCodeWrapPreference,
} from './WrapPreference.js'
