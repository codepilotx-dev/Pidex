import { describe, expect, test } from 'bun:test'

import {
  formatSyntaxLanguageLabel,
  normalizeSyntaxLanguage,
  resolveLanguageFromPath,
} from '../src/features/syntax/Language.js'

describe('syntax language normalization', () => {
  test('normalizes common aliases and fence metadata', () => {
    expect(normalizeSyntaxLanguage('language-ts')).toBe('typescript')
    expect(normalizeSyntaxLanguage('c++')).toBe('cpp')
    expect(normalizeSyntaxLanguage('sh title=setup')).toBe('shellscript')
    expect(normalizeSyntaxLanguage('yml,{1,3}')).toBe('yaml')
  })

  test('normalizes missing and plain-text aliases', () => {
    expect(normalizeSyntaxLanguage()).toBe('text')
    expect(normalizeSyntaxLanguage('plaintext')).toBe('text')
    expect(formatSyntaxLanguageLabel('text')).toBe('text')
  })

  test('preserves an unknown normalized language for fallback resolution', () => {
    expect(normalizeSyntaxLanguage('  Custom-Lang  ')).toBe('custom-lang')
  })

  test('resolves common repository file paths', () => {
    expect(resolveLanguageFromPath('src\\features\\Panel.tsx')).toBe('tsx')
    expect(resolveLanguageFromPath('/workspace/Dockerfile')).toBe('dockerfile')
    expect(resolveLanguageFromPath('/workspace/.env.local')).toBe('dotenv')
    expect(resolveLanguageFromPath('/workspace/file.unknown')).toBe('text')
  })
})
