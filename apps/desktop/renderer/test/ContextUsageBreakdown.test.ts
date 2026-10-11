import { describe, expect, test } from 'bun:test'
import {
  buildContextUsageBreakdownSegments,
  formatCacheHitRate,
} from '../src/features/session/composer/ContextUsageBreakdown.js'

describe('上下文来源占比', () => {
  test('按字符总量归一、降序排列并合并重复来源', () => {
    const segments = buildContextUsageBreakdownSegments([
      { source: 'system_prompt', chars: 30 },
      { source: 'messages', chars: 60 },
      { source: 'messages', chars: 10 },
      { source: 'skills', chars: 0 },
    ])

    expect(segments).toEqual([
      { source: 'messages', chars: 70, percent: 0.7 },
      { source: 'system_prompt', chars: 30, percent: 0.3 },
    ])
  })

  test('占比相同时按固定分类顺序排列，非法字符量被丢弃', () => {
    const segments = buildContextUsageBreakdownSegments([
      { source: 'mcp_tools', chars: 10 },
      { source: 'messages', chars: 10 },
      { source: 'other', chars: -5 },
    ])

    expect(segments.map((segment) => segment.source)).toEqual(['messages', 'mcp_tools'])
    expect(buildContextUsageBreakdownSegments(undefined)).toEqual([])
    expect(buildContextUsageBreakdownSegments([{ source: 'other', chars: 0 }])).toEqual([])
  })

  test('缓存命中率缺失时不展示，越界值收敛到 0-100%', () => {
    expect(formatCacheHitRate(undefined)).toBeNull()
    expect(formatCacheHitRate(null)).toBeNull()
    expect(formatCacheHitRate(Number.NaN)).toBeNull()
    expect(formatCacheHitRate(0.995)).toBe('99.5%')
    expect(formatCacheHitRate(1.4)).toBe('100.0%')
  })
})
