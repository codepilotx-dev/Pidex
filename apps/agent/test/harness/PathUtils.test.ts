import { describe, expect, test } from 'bun:test'
import {
  basenameEnvPath,
  dirnameEnvPath,
  joinEnvPath,
  relativeEnvPath,
  trimLeadingEnvPathSeparators,
  trimTrailingEnvPathSeparators,
} from '../../src/prompt/harness/PathUtils.ts'

describe('linear environment path helpers', () => {
  test('normalizes long attacker-controlled separator runs', () => {
    const separators = '/'.repeat(100_000)

    expect(trimTrailingEnvPathSeparators('/root' + separators)).toBe('/root')
    expect(trimLeadingEnvPathSeparators(separators + 'child')).toBe('child')
    expect(joinEnvPath('/root' + separators, separators + 'child')).toBe('/root/child')
    expect(dirnameEnvPath('/root/child' + separators)).toBe('/root')
    expect(basenameEnvPath('/root/child' + separators)).toBe('child')
    expect(relativeEnvPath('/root' + separators, '/root/child' + separators)).toBe('child')
  })

  test('preserves root and already normalized paths', () => {
    expect(dirnameEnvPath('/child')).toBe('/')
    expect(basenameEnvPath('child')).toBe('child')
    expect(relativeEnvPath('/root', '/root')).toBe('')
  })
})
