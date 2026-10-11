import { describe, expect, test } from 'bun:test'

import { presentHighlightedCode } from '../src/features/syntax/Highlighter.js'
import type { SyntaxHighlightResult } from '../src/features/syntax/Types.js'

const RESULT: SyntaxHighlightResult = {
  code: 'const answer = 4',
  language: 'typescript',
  requestedLanguage: 'typescript',
  requestedTheme: 'github-dark',
  theme: 'github-dark',
  tokens: [[{ content: 'const', color: '#ff00ff' }, { content: ' answer = 4' }]],
}

describe('streaming syntax presentation', () => {
  test('keeps old tokens while they remain a prefix of streamed code', () => {
    expect(
      presentHighlightedCode(RESULT, 'const answer = 42', 'typescript', 'github-dark'),
    ).toEqual({
      highlighted: RESULT,
      plainText: '2',
    })
  })

  test('drops stale tokens after non-prefix edits', () => {
    expect(presentHighlightedCode(RESULT, 'let answer = 4', 'typescript', 'github-dark')).toEqual({
      highlighted: null,
      plainText: 'let answer = 4',
    })
  })

  test('does not reuse tokens across language or theme changes', () => {
    expect(
      presentHighlightedCode(RESULT, RESULT.code, 'javascript', 'github-dark').highlighted,
    ).toBeNull()
    expect(presentHighlightedCode(RESULT, RESULT.code, 'typescript', 'nord').highlighted).toBeNull()
  })
})
