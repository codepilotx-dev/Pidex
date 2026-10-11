export type SyntaxToken = {
  content: string
  color?: string
  backgroundColor?: string
  fontStyle?: number
}

export type SyntaxHighlightResult = {
  code: string
  foreground?: string
  background?: string
  language: string
  requestedLanguage: string
  requestedTheme: string
  theme: string
  tokens: SyntaxToken[][]
}

export type HighlightCodeOptions = {
  code: string
  language?: string | null
  streaming?: boolean
  theme: string
}

export type SyntaxHighlightPresentation = {
  highlighted: SyntaxHighlightResult | null
  plainText: string
}
