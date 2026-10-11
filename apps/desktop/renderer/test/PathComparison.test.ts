import { describe, expect, test } from 'bun:test'
import { arePathsEqual, normalizePathForComparison } from '../src/utils/PathUtils'

describe('pathUtils', () => {
  test('normalizePathForComparison handles backslashes, trailing slashes, and casing', () => {
    expect(normalizePathForComparison('C:\\Users\\Project\\')).toBe('c:/users/project')
    expect(normalizePathForComparison('c:/users/project')).toBe('c:/users/project')
    expect(normalizePathForComparison('C:\\USERS\\PROJECT///')).toBe('c:/users/project')
  })

  test('arePathsEqual correctly compares Windows and POSIX path variants', () => {
    expect(arePathsEqual('C:\\Code\\Repo', 'c:/code/repo/')).toBe(true)
    expect(arePathsEqual('d:\\project\\file.ts', 'D:/project/file.ts')).toBe(true)
    expect(arePathsEqual('d:\\project\\a', 'd:\\project\\b')).toBe(false)
    expect(arePathsEqual(null, null)).toBe(true)
    expect(arePathsEqual('a', null)).toBe(false)
  })
})
