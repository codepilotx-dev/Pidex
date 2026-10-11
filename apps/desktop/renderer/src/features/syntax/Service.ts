import { clearSyntaxHighlightCache, highlightCode, peekHighlightedCode } from './Highlighter.js'
import { normalizeSyntaxLanguage, resolveLanguageFromPath } from './Language.js'
import { resolveThemeId } from './Theme.js'
import type { SyntaxThemeVariant } from './Theme.js'
import type { HighlightCodeOptions, SyntaxHighlightResult } from './Types.js'

export class SyntaxHighlighterService {
  clear(): void {
    clearSyntaxHighlightCache()
  }

  highlight(options: HighlightCodeOptions): Promise<SyntaxHighlightResult> {
    return highlightCode(options)
  }

  normalizeLanguage(language?: string | null): string {
    return normalizeSyntaxLanguage(language)
  }

  peek(options: HighlightCodeOptions): SyntaxHighlightResult | undefined {
    return peekHighlightedCode(options)
  }

  resolveLanguageFromPath(path: string): string {
    return resolveLanguageFromPath(path)
  }

  resolveThemeId(codeThemeId: string | null | undefined, variant: SyntaxThemeVariant): string {
    return resolveThemeId(codeThemeId, variant)
  }
}

export const syntaxHighlighterService = new SyntaxHighlighterService()
export const syntaxHighlighter = syntaxHighlighterService
