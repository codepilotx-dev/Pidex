import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { loadHighlightTheme } from '../../../shared/themes/Manifest.js'
import type { DesktopThemeVariant } from '../../../shared/Types.js'
import { resolveThemeId } from '../syntax/Theme.js'

export type CodeMirrorThemeOptions = {
  codeThemeId: string
  fontFamily: string
  fontSize: number
  variant: DesktopThemeVariant
}

type TextMateToken = {
  scope?: string | string[]
  settings?: {
    fontStyle?: string
    foreground?: string
  }
}

type EditorThemeRegistration = {
  colors?: Record<string, string>
  semanticTokenColors?: Record<string, unknown>
  settings?: TextMateToken[]
  tokenColors?: TextMateToken[]
}

const themeExtensionCache = new Map<string, Promise<Extension>>()

/**
 * Code editor line box in pixels. The explicit pixel value lets CodeMirror
 * compute cursor, scrolling and syntax-line geometry; the seven-pixel leading
 * matches the shared `--cpx-sys-line-height-code` token.
 */
export function codeEditorLineHeight(fontSize: number): number {
  return fontSize + 7
}

export function loadCodeMirrorTheme(options: CodeMirrorThemeOptions): Promise<Extension> {
  const slug = resolveThemeId(options.codeThemeId, options.variant)
  const fontSize = Math.max(8, Math.min(24, options.fontSize))
  const cacheKey = [slug, options.variant, options.fontFamily, fontSize].join('\u0000')
  const cached = themeExtensionCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const loading = loadThemeRegistrationWithFallback(slug, options.variant).then((registration) =>
    createThemeExtension(registration, {
      ...options,
      fontSize,
    }),
  )
  themeExtensionCache.set(cacheKey, loading)
  void loading.catch(() => {
    if (themeExtensionCache.get(cacheKey) === loading) {
      themeExtensionCache.delete(cacheKey)
    }
  })
  return loading
}

async function loadThemeRegistrationWithFallback(
  slug: Parameters<typeof loadHighlightTheme>[0],
  variant: DesktopThemeVariant,
): Promise<EditorThemeRegistration> {
  try {
    return (await loadHighlightTheme(slug)) as unknown as EditorThemeRegistration
  } catch (error) {
    const fallback = variant === 'dark' ? 'codex-dark' : 'codex-light'
    if (slug === fallback) throw error
    return (await loadHighlightTheme(fallback)) as unknown as EditorThemeRegistration
  }
}

function createThemeExtension(
  theme: EditorThemeRegistration,
  options: CodeMirrorThemeOptions,
): Extension {
  const colors = theme.colors ?? {}
  const dark = options.variant === 'dark'
  const background = themeColor(colors, 'editor.background', dark ? '#111111' : '#ffffff')
  const foreground = themeColor(colors, 'editor.foreground', dark ? '#fcfcfc' : '#1a1c1f')
  const cursor = themeColor(
    colors,
    'editorCursor.foreground',
    themeColor(colors, 'focusBorder', dark ? '#339cff' : '#0169cc'),
  )
  const selection = themeColor(colors, 'editor.selectionBackground', dark ? '#264f78' : '#add6ff')
  const lineHighlight = themeColor(
    colors,
    'editor.lineHighlightBackground',
    dark ? '#ffffff0a' : '#00000008',
  )
  const gutterBackground = themeColor(colors, 'editorGutter.background', background)
  const gutterForeground = themeColor(
    colors,
    'editorLineNumber.foreground',
    dark ? '#858585' : '#6e7681',
  )
  const activeGutterForeground = themeColor(colors, 'editorLineNumber.activeForeground', foreground)
  const widgetBackground = themeColor(
    colors,
    'editorWidget.background',
    themeColor(colors, 'panel.background', background),
  )
  const widgetForeground = themeColor(colors, 'editorWidget.foreground', foreground)
  const widgetBorder = themeColor(
    colors,
    'editorWidget.border',
    themeColor(colors, 'widget.border', dark ? '#3d3d3d' : '#d0d7de'),
  )
  const selectedSuggestion = themeColor(colors, 'editorSuggestWidget.selectedBackground', selection)
  const findMatch = themeColor(colors, 'editor.findMatchBackground', dark ? '#515c6a' : '#a8ac94')
  const findMatchHighlight = themeColor(
    colors,
    'editor.findMatchHighlightBackground',
    dark ? '#ea5c0055' : '#ea5c0066',
  )
  const selectionMatch = themeColor(
    colors,
    'editor.selectionHighlightBackground',
    dark ? '#add6ff26' : '#add6ff66',
  )
  const scrollbarThumb = themeColor(
    colors,
    'scrollbarSlider.background',
    dark ? '#79797966' : '#64646466',
  )
  const scrollbarThumbHover = themeColor(
    colors,
    'scrollbarSlider.hoverBackground',
    dark ? '#646464b3' : '#64646499',
  )
  const scrollbarTrack = themeColor(colors, 'editor.background', background)
  const insertedLine = themeColor(
    colors,
    'diffEditor.insertedLineBackground',
    dark ? '#2ea04326' : '#2da44e26',
  )
  const insertedText = themeColor(
    colors,
    'diffEditor.insertedTextBackground',
    dark ? '#2ea04340' : '#2da44e40',
  )
  const removedLine = themeColor(
    colors,
    'diffEditor.removedLineBackground',
    dark ? '#f8514926' : '#cf222e26',
  )
  const removedText = themeColor(
    colors,
    'diffEditor.removedTextBackground',
    dark ? '#f8514940' : '#cf222e40',
  )
  const insertedGutter = themeColor(
    colors,
    'diffEditorGutter.insertedLineBackground',
    dark ? '#3fb950' : '#1a7f37',
  )
  const removedGutter = themeColor(
    colors,
    'diffEditorGutter.removedLineBackground',
    dark ? '#f85149' : '#cf222e',
  )
  const lineHeight = codeEditorLineHeight(options.fontSize)

  return [
    EditorView.theme(
      {
        '&': {
          height: '100%',
          color: foreground,
          backgroundColor: background,
          fontFamily: options.fontFamily,
          fontSize: `${options.fontSize}px`,
          '--cm-editor-background': background,
          '--cm-editor-foreground': foreground,
        },
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': {
          overflow: 'auto',
          fontFamily: 'inherit',
          lineHeight: `${lineHeight}px`,
          scrollbarColor: `${scrollbarThumb} ${scrollbarTrack}`,
        },
        '.cm-scroller::-webkit-scrollbar-thumb': {
          backgroundColor: scrollbarThumb,
        },
        '.cm-scroller::-webkit-scrollbar-thumb:hover': {
          backgroundColor: scrollbarThumbHover,
        },
        '.cm-scroller::-webkit-scrollbar-track': {
          backgroundColor: scrollbarTrack,
        },
        '.cm-content': {
          minHeight: '100%',
          caretColor: cursor,
          padding: '0 16px 16px 0',
        },
        '.cm-line': { padding: '0' },
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: cursor,
          borderLeftWidth: '2px',
        },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
          backgroundColor: selection,
        },
        '.cm-panels': {
          color: widgetForeground,
          backgroundColor: widgetBackground,
        },
        '.cm-panels.cm-panels-top': {
          borderBottom: `1px solid ${widgetBorder}`,
        },
        '.cm-panels.cm-panels-bottom': {
          borderTop: `1px solid ${widgetBorder}`,
        },
        '.cm-searchMatch': {
          backgroundColor: findMatchHighlight,
          outline: `1px solid ${findMatch}`,
        },
        '.cm-searchMatch.cm-searchMatch-selected': {
          backgroundColor: findMatch,
        },
        '.cm-activeLine': { backgroundColor: lineHighlight },
        '.cm-selectionMatch': { backgroundColor: selectionMatch },
        '.cm-gutters': {
          color: gutterForeground,
          backgroundColor: gutterBackground,
          borderRight: '0',
          paddingLeft: '2ch',
        },
        '.cm-activeLineGutter': {
          color: activeGutterForeground,
          backgroundColor: lineHighlight,
        },
        '.cm-tooltip': {
          color: widgetForeground,
          backgroundColor: widgetBackground,
          border: `1px solid ${widgetBorder}`,
          borderRadius: '0',
          boxShadow: 'none',
        },
        '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
          color: themeColor(colors, 'editorSuggestWidget.selectedForeground', widgetForeground),
          backgroundColor: selectedSuggestion,
        },
        '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
          backgroundColor: removedLine,
        },
        '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
          backgroundColor: insertedLine,
        },
        '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
          backgroundColor: removedText,
        },
        '&.cm-merge-b .cm-changedText': {
          backgroundColor: insertedText,
        },
        '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
          backgroundColor: removedGutter,
        },
        '&.cm-merge-b .cm-changedLineGutter': {
          backgroundColor: insertedGutter,
        },
      },
      { dark },
    ),
    syntaxHighlighting(createHighlightStyle(theme, foreground), {
      fallback: true,
    }),
  ]
}

function createHighlightStyle(theme: EditorThemeRegistration, foreground: string): HighlightStyle {
  const color = (semanticNames: string[], scopes: string[], fallback = foreground) =>
    tokenColor(theme, semanticNames, scopes) ?? fallback

  return HighlightStyle.define([
    {
      tag: [
        tags.keyword,
        tags.controlKeyword,
        tags.definitionKeyword,
        tags.moduleKeyword,
        tags.modifier,
        tags.operatorKeyword,
      ],
      color: color(['keyword'], ['keyword', 'storage', 'modifier']),
    },
    {
      tag: [tags.typeName, tags.className, tags.namespace, tags.tagName],
      color: color(
        ['type', 'class', 'namespace'],
        ['entity.name.type', 'entity.name.class', 'support.type'],
      ),
    },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      color: color(['function', 'method'], ['entity.name.function', 'support.function']),
    },
    {
      tag: [tags.propertyName, tags.attributeName, tags.definition(tags.propertyName)],
      color: color(
        ['property', 'enumMember'],
        ['variable.other.property', 'entity.other.attribute-name'],
      ),
    },
    {
      tag: [tags.string, tags.special(tags.string), tags.character, tags.escape],
      color: color(['string'], ['string']),
    },
    {
      tag: tags.regexp,
      color: color(['regexp'], ['string.regexp', 'regexp']),
    },
    {
      tag: [tags.number, tags.bool, tags.null, tags.atom],
      color: color(['number'], ['constant.numeric', 'constant.language', 'constant']),
    },
    {
      tag: [
        tags.operator,
        tags.arithmeticOperator,
        tags.logicOperator,
        tags.bitwiseOperator,
        tags.compareOperator,
        tags.updateOperator,
      ],
      color: color(['operator'], ['keyword.operator']),
    },
    {
      tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
      color: color(['comment'], ['comment']),
      fontStyle: tokenFontStyle(theme, ['comment']),
    },
    {
      tag: [
        tags.variableName,
        tags.local(tags.variableName),
        tags.definition(tags.variableName),
        tags.labelName,
      ],
      color: color(['variable', 'parameter'], ['variable', 'entity.name.label']),
    },
    {
      tag: tags.special(tags.variableName),
      color: color(['variable.defaultLibrary'], ['variable.language', 'support.variable']),
    },
    {
      tag: [tags.punctuation, tags.separator, tags.brace, tags.paren, tags.squareBracket],
      color: color([], ['punctuation']),
    },
    {
      tag: [tags.meta, tags.annotation, tags.processingInstruction],
      color: color(['macro'], ['meta', 'entity.name.function.preprocessor']),
    },
    {
      tag: tags.heading,
      color: color([], ['markup.heading']),
      fontWeight: 'bold',
    },
    {
      tag: [tags.link, tags.url],
      color: color([], ['markup.underline.link', 'string.other.link']),
      textDecoration: 'underline',
    },
    {
      tag: tags.emphasis,
      color: color([], ['markup.italic']),
      fontStyle: 'italic',
    },
    {
      tag: tags.strong,
      color: color([], ['markup.bold']),
      fontWeight: 'bold',
    },
    {
      tag: tags.strikethrough,
      color: color([], ['markup.strikethrough']),
      textDecoration: 'line-through',
    },
    {
      tag: tags.invalid,
      color: themeColor(theme.colors ?? {}, 'editorError.foreground', '#f14c4c'),
      textDecoration: 'underline wavy',
    },
  ])
}

function tokenColor(
  theme: EditorThemeRegistration,
  semanticNames: string[],
  scopes: string[],
): string | undefined {
  for (const semanticName of semanticNames) {
    const value = theme.semanticTokenColors?.[semanticName]
    const foreground = typeof value === 'string' ? value : readSemanticForeground(value)
    if (foreground) {
      return foreground
    }
  }

  const entries = [
    ...(Array.isArray(theme.tokenColors) ? theme.tokenColors : []),
    ...(Array.isArray(theme.settings) ? theme.settings : []),
  ]
  for (const expectedScope of scopes) {
    for (const entry of entries) {
      if (
        entry.settings?.foreground &&
        tokenScopes(entry).some((scope) =>
          scope.toLowerCase().includes(expectedScope.toLowerCase()),
        )
      ) {
        return entry.settings.foreground
      }
    }
  }
}

function readSemanticForeground(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return
  }
  const foreground = (value as { foreground?: unknown }).foreground
  return typeof foreground === 'string' ? foreground : undefined
}

function tokenFontStyle(theme: EditorThemeRegistration, scopes: string[]): string | undefined {
  const entries = [
    ...(Array.isArray(theme.tokenColors) ? theme.tokenColors : []),
    ...(Array.isArray(theme.settings) ? theme.settings : []),
  ]
  for (const entry of entries) {
    if (
      entry.settings?.fontStyle &&
      scopes.some((expectedScope) =>
        tokenScopes(entry).some((scope) =>
          scope.toLowerCase().includes(expectedScope.toLowerCase()),
        ),
      )
    ) {
      return entry.settings.fontStyle.includes('italic') ? 'italic' : undefined
    }
  }
}

function tokenScopes(entry: TextMateToken): string[] {
  if (Array.isArray(entry.scope)) {
    return entry.scope
  }
  return typeof entry.scope === 'string' ? entry.scope.split(',').map((scope) => scope.trim()) : []
}

function themeColor(colors: Record<string, string>, key: string, fallback: string): string {
  return colors[key] ?? fallback
}
