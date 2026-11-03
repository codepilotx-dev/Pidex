import { describe, expect, test } from 'bun:test'
import {
  buildContextUsageBarSegments,
  buildContextUsageDotOwners,
  buildContextUsageBreakdownSegments,
  ensureMinSegmentRatios,
  formatCacheHitRate,
} from '../src/features/session/composer/ContextUsageBreakdown.js'

describe('上下文来源占比', () => {
  test('点阵以最大余数补齐已用点数，空数据与极值始终保留 200 点', () => {
    const segments = buildContextUsageBreakdownSegments([
      { source: 'messages', chars: 1 },
      { source: 'skills', chars: 1 },
      { source: 'memory', chars: 1 },
    ])
    const owners = buildContextUsageDotOwners(segments, 0.14)
    expect(owners).toHaveLength(200)
    expect(owners.filter((owner) => owner !== null)).toHaveLength(28)
    expect(owners.filter((owner) => owner === 'messages')).toHaveLength(10)
    expect(owners.filter((owner) => owner === 'skills')).toHaveLength(9)
    expect(owners.filter((owner) => owner === 'memory')).toHaveLength(9)
    expect(buildContextUsageDotOwners(segments, 0).every((owner) => owner === null)).toBe(true)
    expect(buildContextUsageDotOwners(segments, 1).filter(Boolean)).toHaveLength(200)
    expect(buildContextUsageDotOwners([], 0.5).filter((owner) => owner === 'used')).toHaveLength(
      100,
    )
    expect(buildContextUsageDotOwners([], Number.NaN).filter(Boolean)).toHaveLength(0)
    expect(buildContextUsageDotOwners(segments, 1.5).filter(Boolean)).toHaveLength(200)
  })

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

  test('条形按实际用量缩放，各段之和等于已用占比', () => {
    const segments = buildContextUsageBreakdownSegments([
      { source: 'messages', chars: 90 },
      { source: 'skills', chars: 10 },
    ])
    const bar = buildContextUsageBarSegments(segments, 0.14)

    expect(bar[0]?.windowPercent).toBeCloseTo(0.9 * 0.14, 10)
    expect(bar[1]?.windowPercent).toBeCloseTo(0.1 * 0.14, 10)
    expect(bar.reduce((sum, segment) => sum + segment.windowPercent, 0)).toBeCloseTo(0.14, 10)
    // 相对占比原样保留，供后续换口径展示。
    expect(bar.map((segment) => segment.percent)).toEqual([0.9, 0.1])
  })

  test('条形缩放收敛越界与非法用量', () => {
    const segments = buildContextUsageBreakdownSegments([{ source: 'messages', chars: 10 }])

    expect(buildContextUsageBarSegments(segments, 1.4)[0]?.windowPercent).toBe(1)
    expect(buildContextUsageBarSegments(segments, -1)[0]?.windowPercent).toBe(0)
    expect(buildContextUsageBarSegments(segments, Number.NaN)[0]?.windowPercent).toBe(0)
    expect(buildContextUsageBarSegments([], 0.5)).toEqual([])
  })

  test('为极小占比分段分配保底视觉比例并保持总比例严格守恒', () => {
    const rawSegments = [
      { id: 'messages', ratio: 0.5 },
      { id: 'skills', ratio: 0.3 },
      { id: 'project', ratio: 0.003 }, // 极小用量 0.3%
      { id: 'empty', ratio: 0 },
    ]
    const totalRatio = 0.803
    const adjusted = ensureMinSegmentRatios(rawSegments, totalRatio, 0.024)

    const projectSegment = adjusted.find((s) => s.id === 'project')
    expect(projectSegment?.ratio).toBeGreaterThanOrEqual(0.024)

    const emptySegment = adjusted.find((s) => s.id === 'empty')
    expect(emptySegment?.ratio).toBe(0)

    const sum = adjusted.reduce((acc, cur) => acc + cur.ratio, 0)
    expect(sum).toBeCloseTo(totalRatio, 6)
  })
})
