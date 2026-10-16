import { describe, expect, test } from 'bun:test'
import { EventManifest } from '@pidex/agent-protocol'
import { AGENT_LIVE_EVENT_FILTERS } from '../src/services/desktop-client/EventSubscriptionFilters.js'

describe('desktop live event subscription filters', () => {
  const expected = {
    canonical: [
      'visualization/preview',
      'item/agentMessage/delta',
      'reasoning/textDelta',
      'reasoning/summaryPartAdded',
      'reasoning/summaryTextDelta',
      'plan/delta',
      'tool/outputDelta',
    ],
    provider: ['catalog/updated', 'provider/credential/updated', 'usage/source/updated'],
    modelHealth: ['model/health/updated', 'catalog/updated', 'provider/credential/updated'],
    skills: ['skill/updated'],
    plugins: ['plugins/updated'],
    tooling: ['tooling/updated'],
    mcp: ['mcp/updated'],
    sessionGroups: [],
    global: [
      'catalog/updated',
      'provider/credential/updated',
      'config/updated',
      'workspace/file/changed',
      'workspace/git/changed',
    ],
  } as const

  for (const [scope, eventTypes] of Object.entries(expected)) {
    test(`${scope} uses its exact live event set`, () => {
      expect(AGENT_LIVE_EVENT_FILTERS[scope as keyof typeof AGENT_LIVE_EVENT_FILTERS]).toEqual(
        eventTypes,
      )
    })
  }

  test('可视化预览只进入线程实时订阅，完成结果仍由持久工具事件对账', () => {
    expect(EventManifest['visualization/preview']).toMatchObject({
      durability: 'live',
      stream: 'thread',
      capability: 'visualizations.v1',
      reconcilesWith: 'tool/callCompleted',
    })
    expect(AGENT_LIVE_EVENT_FILTERS.canonical).toContain('visualization/preview')
    expect(AGENT_LIVE_EVENT_FILTERS.global).not.toContain('visualization/preview')
  })

  test('global subscription excludes all streaming token deltas', () => {
    const globalEvents = new Set<string>(AGENT_LIVE_EVENT_FILTERS.global)
    for (const eventType of AGENT_LIVE_EVENT_FILTERS.canonical) {
      expect(globalEvents.has(eventType)).toBe(false)
    }
  })
})
