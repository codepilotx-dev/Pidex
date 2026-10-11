import { describe, expect, test } from 'bun:test'

import {
  normalizeLiveResizeSize,
  resolveLiveResizeTarget,
} from '../src/features/layout/UseLiveResizeValue.js'

describe('live resize value', () => {
  test('deduplicates preview sizes at the current physical pixel boundary', () => {
    expect(normalizeLiveResizeSize(320.24, 1.75)).toBe(normalizeLiveResizeSize(320.28, 1.75))
    expect(normalizeLiveResizeSize(320.7, 1.75)).not.toBe(normalizeLiveResizeSize(320.28, 1.75))
  })

  test('normalizes fractional CSS pixels without accepting an invalid pixel ratio', () => {
    expect(normalizeLiveResizeSize(600.4, Number.NaN)).toBe(600)
    expect(normalizeLiveResizeSize(600.4, 0)).toBe(600)
    expect(normalizeLiveResizeSize(600.4, 2)).toBe(600.5)
  })

  test('折叠的面板宿主收敛到 0 宽度，而不是上一次提交的分屏宽度', () => {
    expect(resolveLiveResizeTarget(893, true)).toBe(0)
    expect(resolveLiveResizeTarget(893, false)).toBe(893)
    expect(resolveLiveResizeTarget(893.14, true)).toBe(0)
  })
})
