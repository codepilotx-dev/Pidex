import type { BundledLanguage, Highlighter, ThemedToken } from 'shiki'
import { isHighlightThemeSlug, loadHighlightTheme } from '../../../shared/themes/Manifest.js'
import type { HighlightThemeSlug } from '../../../shared/themes/Manifest.js'

import { LruCache } from './LruCache.js'
import { normalizeSyntaxLanguage } from './Language.js'
import type {
  HighlightCodeOptions,
  SyntaxHighlightPresentation,
  SyntaxHighlightResult,
  SyntaxToken,
} from './Types.js'

export const SYNTAX_HIGHLIGHT_CACHE_CAPACITY = 96
export const SYNTAX_HIGHLIGHT_CACHE_MAX_WEIGHT = 8 * 1024 * 1024

const textEncoder = new TextEncoder()

const resultCache = new LruCache<string, SyntaxHighlightResult>(SYNTAX_HIGHLIGHT_CACHE_CAPACITY, {
  maxWeight: SYNTAX_HIGHLIGHT_CACHE_MAX_WEIGHT,
  weigh: syntaxHighlightCacheWeight,
})
const pendingHighlights = new Map<
  string,
  {
    promise: Promise<SyntaxHighlightResult>
    shouldCache: boolean
  }
>()

type ShikiModule = typeof import('shiki')

let shikiModulePromise: Promise<ShikiModule> | null = null
let highlighterPromise: Promise<Highlighter> | null = null

function loadShiki(): Promise<ShikiModule> {
  shikiModulePromise ??= import('shiki')
  return shikiModulePromise
}

async function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise) return highlighterPromise

  highlighterPromise = loadShiki().then((shiki) =>
    shiki.getSingletonHighlighter({
      engine: shiki.createJavaScriptRegexEngine(),
      langs: [],
      themes: [],
    }),
  )
  return highlighterPromise
}

export async function highlightCode(options: HighlightCodeOptions): Promise<SyntaxHighlightResult> {
  const requestedLanguage = normalizeSyntaxLanguage(options.language)
  const requestedTheme = options.theme.trim()
  const cacheKey = highlightCacheKey(options.code, requestedLanguage, requestedTheme)
  const cached = resultCache.get(cacheKey)
  if (cached) return cached

  const pending = pendingHighlights.get(cacheKey)
  if (pending) {
    if (!options.streaming) pending.shouldCache = true
    return pending.promise
  }

  const request = highlightCodeUncached({
    code: options.code,
    requestedLanguage,
    requestedTheme,
  })
  const pendingEntry = {
    promise: request,
    shouldCache: !options.streaming,
  }
  pendingHighlights.set(cacheKey, pendingEntry)

  try {
    const result = await request
    if (pendingEntry.shouldCache) resultCache.set(cacheKey, result)
    return result
  } finally {
    if (pendingHighlights.get(cacheKey) === pendingEntry) {
      pendingHighlights.delete(cacheKey)
    }
  }
}

export function peekHighlightedCode(
  options: HighlightCodeOptions,
): SyntaxHighlightResult | undefined {
  return resultCache.peek(
    highlightCacheKey(
      options.code,
      normalizeSyntaxLanguage(options.language),
      options.theme.trim(),
    ),
  )
}

export function clearSyntaxHighlightCache(): void {
  resultCache.clear()
}

export function presentHighlightedCode(
  result: SyntaxHighlightResult | null,
  currentCode: string,
  requestedLanguage: string,
  requestedTheme: string,
): SyntaxHighlightPresentation {
  const isCompatible =
    result?.requestedLanguage === requestedLanguage && result.requestedTheme === requestedTheme

  if (!result || !isCompatible) {
    return { highlighted: null, plainText: currentCode }
  }
  if (result.code === currentCode) {
    return { highlighted: result, plainText: '' }
  }
  if (currentCode.startsWith(result.code)) {
    return {
      highlighted: result,
      plainText: currentCode.slice(result.code.length),
    }
  }
  return { highlighted: null, plainText: currentCode }
}

async function highlightCodeUncached({
  code,
  requestedLanguage,
  requestedTheme,
}: {
  code: string
  requestedLanguage: string
  requestedTheme: string
}): Promise<SyntaxHighlightResult> {
  const shiki = await loadShiki()
  const language = resolveBundledLanguage(shiki, requestedLanguage)
  const theme = resolveTheme(requestedTheme)

  if (language === 'text') {
    return plainTextResult({
      code,
      requestedLanguage,
      requestedTheme,
      theme,
    })
  }

  try {
    const highlighter = await getHighlighter()
    await Promise.all([
      highlighter.getLoadedLanguages().includes(language)
        ? undefined
        : highlighter.loadLanguage(shiki.bundledLanguages[language]),
      highlighter.getLoadedThemes().includes(theme)
        ? undefined
        : loadHighlightTheme(theme).then((registration) => highlighter.loadTheme(registration)),
    ])
    const highlighted = highlighter.codeToTokens(code, {
      lang: language,
      theme,
    })

    return {
      code,
      foreground: highlighted.fg,
      background: highlighted.bg,
      language,
      requestedLanguage,
      requestedTheme,
      theme: highlighted.themeName ?? theme,
      tokens: highlighted.tokens.map((line) =>
        line.map((token) => toSyntaxToken(token, highlighted.fg, highlighted.bg)),
      ),
    }
  } catch {
    return plainTextResult({
      code,
      requestedLanguage,
      requestedTheme,
      theme,
    })
  }
}

function resolveBundledLanguage(
  shiki: ShikiModule,
  requestedLanguage: string,
): BundledLanguage | 'text' {
  if (requestedLanguage === 'text') return 'text'
  if (Object.hasOwn(shiki.bundledLanguages, requestedLanguage)) {
    return requestedLanguage as BundledLanguage
  }
  return 'text'
}

function resolveTheme(requestedTheme: string): HighlightThemeSlug {
  return isHighlightThemeSlug(requestedTheme) ? requestedTheme : 'codex-dark'
}

function toSyntaxToken(
  token: ThemedToken,
  foreground: string | undefined,
  background: string | undefined,
): SyntaxToken {
  return {
    content: token.content,
    color: ensureSyntaxTokenContrast(token.color, foreground, token.bgColor ?? background),
    backgroundColor: token.bgColor,
    fontStyle: token.fontStyle,
  }
}

function ensureSyntaxTokenContrast(
  color: string | undefined,
  foreground: string | undefined,
  background: string | undefined,
): string | undefined {
  if (!color || !background) return color
  const tokenColor = parseHexColor(color)
  const backgroundColor = parseHexColor(background)
  if (!tokenColor || !backgroundColor) return color

  // Review surfaces can be lighter than a dark syntax theme's own editor
  // background and add a subtle diff tint, so dark themes need more margin
  // above the WCAG AA text threshold.
  const minimumRatio = colorLuminance(backgroundColor) < 0.18 ? 6.5 : 5
  if (colorContrast(tokenColor, backgroundColor) >= minimumRatio) return color

  const fallback =
    (foreground && parseHexColor(foreground)) ?? pickHigherContrastMonochrome(backgroundColor)
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const amount = (low + high) / 2
    if (colorContrast(mixColor(tokenColor, fallback, amount), backgroundColor) >= minimumRatio) {
      high = amount
    } else {
      low = amount
    }
  }
  return colorToHex(mixColor(tokenColor, fallback, high))
}

type RgbColor = { red: number; green: number; blue: number }

function parseHexColor(value: string): RgbColor | null {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim())
  if (!match) return null
  const hex =
    match[1].length === 3
      ? [...match[1]].map((channel) => `${channel}${channel}`).join('')
      : match[1]
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  }
}

function pickHigherContrastMonochrome(background: RgbColor): RgbColor {
  const black = { red: 0, green: 0, blue: 0 }
  const white = { red: 255, green: 255, blue: 255 }
  return colorContrast(black, background) >= colorContrast(white, background) ? black : white
}

function mixColor(from: RgbColor, to: RgbColor, amount: number): RgbColor {
  return {
    red: Math.round(from.red + (to.red - from.red) * amount),
    green: Math.round(from.green + (to.green - from.green) * amount),
    blue: Math.round(from.blue + (to.blue - from.blue) * amount),
  }
}

function colorContrast(first: RgbColor, second: RgbColor): number {
  const brightest = Math.max(colorLuminance(first), colorLuminance(second))
  const darkest = Math.min(colorLuminance(first), colorLuminance(second))
  return (brightest + 0.05) / (darkest + 0.05)
}

function colorLuminance(color: RgbColor): number {
  const channel = (value: number): number => {
    const normalized = value / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return channel(color.red) * 0.2126 + channel(color.green) * 0.7152 + channel(color.blue) * 0.0722
}

function colorToHex(color: RgbColor): string {
  return `#${[color.red, color.green, color.blue]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

function plainTextResult({
  code,
  requestedLanguage,
  requestedTheme,
  theme,
}: {
  code: string
  requestedLanguage: string
  requestedTheme: string
  theme: string
}): SyntaxHighlightResult {
  return {
    code,
    language: 'text',
    requestedLanguage,
    requestedTheme,
    theme,
    tokens: code.split('\n').map((line) => [
      {
        content: line,
      },
    ]),
  }
}

function highlightCacheKey(code: string, language: string, theme: string): string {
  return JSON.stringify([language, theme, code])
}

function syntaxHighlightCacheWeight(key: string, result: SyntaxHighlightResult): number {
  let weight = textEncoder.encode(key).byteLength + textEncoder.encode(result.code).byteLength
  for (const line of result.tokens) {
    for (const token of line) {
      weight += textEncoder.encode(token.content).byteLength
    }
  }
  return weight
}
