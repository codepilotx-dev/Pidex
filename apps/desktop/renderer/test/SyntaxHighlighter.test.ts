import { describe, expect, test } from 'bun:test'
import {
  clearSyntaxHighlightCache,
  highlightCode,
  peekHighlightedCode,
  resolveThemeId,
} from '../src/features/syntax/index.js'
import { deriveThemeVariables } from '../src/features/theme/ThemeVariables.js'
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '../shared/Theme.js'

function contrastRatio(first: string, second: string): number {
  const luminance = (value: string): number => {
    const channels = value
      .slice(1)
      .match(/.{2}/g)!
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe('Shiki highlighter', () => {
  test('lazily loads representative Codex themes and returns token colors', async () => {
    clearSyntaxHighlightCache()
    const themes = [
      resolveThemeId('auto', 'light'),
      resolveThemeId('auto', 'dark'),
      resolveThemeId('absolutely-dark', 'dark'),
      resolveThemeId('dracula', 'dark'),
      resolveThemeId('tokyo-night', 'dark'),
    ]

    for (const theme of themes) {
      const result = await highlightCode({
        code: 'const answer = 42',
        language: 'typescript',
        theme,
      })
      expect(result.theme).toBe(theme)
      expect(result.tokens.flat().some((token) => Boolean(token.color))).toBeTrue()
    }
  })

  test('uses plaintext tokens for an unknown language', async () => {
    const result = await highlightCode({
      code: 'plain content',
      language: 'not-a-real-language',
      theme: 'codex-dark',
    })

    expect(result.language).toBe('text')
    expect(result.tokens[0]?.[0]?.content).toBe('plain content')
  })

  test('returns fresh colors when the selected theme changes', async () => {
    clearSyntaxHighlightCache()
    const code = 'const codexTheme = "ready"'
    const darkTheme = await highlightCode({
      code,
      language: 'typescript',
      theme: 'codex-dark',
    })
    const dracula = await highlightCode({
      code,
      language: 'typescript',
      theme: 'dracula',
    })

    expect(darkTheme.theme).toBe('codex-dark')
    expect(dracula.theme).toBe('dracula')
    expect(dracula.background).not.toBe(darkTheme.background)
    expect(dracula.tokens.flat().map((token) => token.color)).not.toEqual(
      darkTheme.tokens.flat().map((token) => token.color),
    )
  })

  test('keeps syntax token colors readable against their code background', async () => {
    for (const theme of ['codex-light', 'codex-dark', 'dracula'] as const) {
      const result = await highlightCode({
        code: 'const answer = condition ? "yes" : 42',
        language: 'typescript',
        theme,
      })

      for (const token of result.tokens.flat()) {
        if (!token.color) continue
        expect(
          contrastRatio(token.color, token.backgroundColor ?? result.background),
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test('keeps Codex syntax token colors readable against diff backgrounds', async () => {
    for (const [theme, config] of [
      ['codex-light', DEFAULT_LIGHT_THEME],
      ['codex-dark', DEFAULT_DARK_THEME],
    ] as const) {
      const result = await highlightCode({
        code: 'const answer = condition ? "yes" : 42',
        language: 'typescript',
        theme,
      })
      const variables = deriveThemeVariables(config)
      const backgrounds = [
        variables['--cpx-sys-color-diff-added-line'],
        variables['--cpx-sys-color-diff-added-text'],
        variables['--cpx-sys-color-diff-removed-line'],
        variables['--cpx-sys-color-diff-removed-text'],
      ]

      for (const token of result.tokens.flat()) {
        if (!token.color) continue
        for (const background of backgrounds) {
          expect(contrastRatio(token.color, background)).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  test('does not retain intermediate streaming highlights', async () => {
    clearSyntaxHighlightCache()
    const request = {
      code: 'const streaming = true',
      language: 'typescript',
      theme: 'codex-dark',
    }

    await highlightCode({ ...request, streaming: true })
    expect(peekHighlightedCode(request)).toBeUndefined()

    await highlightCode(request)
    expect(peekHighlightedCode(request)).toBeDefined()
  })
})
