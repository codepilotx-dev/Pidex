import type { LiveEventType } from '@pidex/agent-protocol'

export const AGENT_LIVE_EVENT_FILTERS = {
  canonical: [
    'item/agentMessage/delta',
    'reasoning/textDelta',
    'reasoning/summaryPartAdded',
    'reasoning/summaryTextDelta',
    'plan/delta',
    'tool/outputDelta',
  ],
  provider: ['catalog/updated', 'provider/credential/updated', 'usage/source/updated'],
  /** Health workspace subscription: batch events plus the catalog/credential
   * changes that invalidate existing results. */
  modelHealth: ['model/health/updated', 'catalog/updated', 'provider/credential/updated'],
  skills: ['skill/updated'],
  plugins: ['plugins/updated'],
  minimaxCli: ['minimaxCli/updated'],
  // computer/changed is durable, so it arrives outside the live-only filter and
  // is reconciled by reading computer/state.
  computer: [],
  tooling: ['tooling/updated'],
  mcp: ['mcp/updated'],
  // session-group/changed is durable and arrives outside the live-only filter.
  sessionGroups: [],
  global: [
    'catalog/updated',
    'provider/credential/updated',
    'config/updated',
    'workspace/file/changed',
    'workspace/git/changed',
  ],
} as const satisfies Readonly<
  Record<
    | 'canonical'
    | 'provider'
    | 'modelHealth'
    | 'skills'
    | 'plugins'
    | 'minimaxCli'
    | 'computer'
    | 'tooling'
    | 'mcp'
    | 'sessionGroups'
    | 'global',
    readonly LiveEventType[]
  >
>
