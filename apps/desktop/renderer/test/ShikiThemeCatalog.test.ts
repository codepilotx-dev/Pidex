import { describe, expect, test } from 'bun:test'
import { bundledLanguages, getSingletonHighlighter } from 'shiki'

import {
  HIGHLIGHT_THEME_FAMILIES,
  HIGHLIGHT_THEMES,
  loadHighlightTheme,
} from '../shared/themes/Manifest.js'

describe('Codex Shiki theme catalog', () => {
  test('matches the 29 selector families and 45 registered variants', () => {
    expect(HIGHLIGHT_THEME_FAMILIES).toHaveLength(29)
    expect(HIGHLIGHT_THEMES).toHaveLength(45)
    expect(new Set(HIGHLIGHT_THEMES.map((theme) => theme.slug)).size).toBe(45)
    expect(
      new Set(
        HIGHLIGHT_THEME_FAMILIES.flatMap((family) =>
          [family.themes.light, family.themes.dark].filter(Boolean),
        ),
      ).size,
    ).toBe(45)
    expect(HIGHLIGHT_THEMES.map((theme) => theme.slug)).toContain('codex-light')
    expect(HIGHLIGHT_THEMES.map((theme) => theme.slug)).toContain('codex-dark')
    expect(HIGHLIGHT_THEME_FAMILIES.find((family) => family.id === 'github')?.themes).toEqual({
      light: 'github-light-default',
      dark: 'github-dark-default',
    })
    expect(HIGHLIGHT_THEME_FAMILIES.find((family) => family.id === 'proof')?.themes).toEqual({
      light: 'proof-light',
      dark: null,
    })
  })

  test('loads and highlights with every registered selector theme', async () => {
    const highlighter = await getSingletonHighlighter({
      langs: [bundledLanguages.typescript],
      themes: [],
    })

    for (const metadata of HIGHLIGHT_THEMES) {
      const theme = await loadHighlightTheme(metadata.slug)
      expect(theme.name).toBe(metadata.slug)
      await highlighter.loadTheme(theme)
      const result = highlighter.codeToTokens('const answer = 42', {
        lang: 'typescript',
        theme: metadata.slug,
      })
      expect(result.tokens.flat().some((token) => Boolean(token.color))).toBeTrue()
    }
  })
})
