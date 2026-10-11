import { useEffect, useRef, useState } from 'react'

import { highlightCode, peekHighlightedCode, presentHighlightedCode } from './Highlighter.js'
import { normalizeSyntaxLanguage } from './Language.js'
import type { SyntaxHighlightPresentation, SyntaxHighlightResult } from './Types.js'

export const STREAMING_HIGHLIGHT_INTERVAL_MS = 120

type UseHighlightedCodeOptions = {
  code: string
  language?: string | null
  streaming?: boolean
  theme: string
}

export function useHighlightedCode({
  code,
  language,
  streaming = false,
  theme,
}: UseHighlightedCodeOptions): SyntaxHighlightPresentation {
  const requestedLanguage = normalizeSyntaxLanguage(language)
  const requestedTheme = theme.trim()
  const [result, setResult] = useState<SyntaxHighlightResult | null>(() => {
    return (
      peekHighlightedCode({
        code,
        language: requestedLanguage,
        theme: requestedTheme,
      }) ?? null
    )
  })
  const requestGenerationRef = useRef(0)

  useEffect(() => {
    const requestGeneration = ++requestGenerationRef.current
    const cached = peekHighlightedCode({
      code,
      language: requestedLanguage,
      theme: requestedTheme,
    })
    if (cached) {
      setResult(cached)
      return
    }

    // Streaming updates use a quiet-period debounce: each new chunk cancels the
    // pending request, so continuously growing code stays on the synchronous
    // plain-text presentation until generation pauses. A completed code block
    // skips the delay and receives its final highlight immediately.
    const delay = streaming ? STREAMING_HIGHLIGHT_INTERVAL_MS : 0

    const timeout = window.setTimeout(() => {
      void highlightCode({
        code,
        language: requestedLanguage,
        streaming,
        theme: requestedTheme,
      }).then((nextResult) => {
        if (requestGenerationRef.current === requestGeneration) {
          setResult(nextResult)
        }
      })
    }, delay)

    return () => window.clearTimeout(timeout)
  }, [code, requestedLanguage, requestedTheme, streaming])

  return presentHighlightedCode(result, code, requestedLanguage, requestedTheme)
}
