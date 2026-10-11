export type ModelProviderID = string
export type ModelProviderKind = 'builtin' | 'custom' | string
export type ProviderWireApi = 'responses' | 'chat_completions' | 'anthropic_messages'

export type ModelMetadata = {
  id: string
  name?: string
  label?: string
  displayName?: string
  description?: string
  badge?: string
  iconURL?: string
  contextWindow?: number
  outputTokens?: number
  inputCost?: number
  outputCost?: number
  cacheReadCost?: number
  cacheWriteCost?: number
  reasoning?: boolean
  toolCall?: boolean
  structuredOutput?: boolean
  vision?: boolean
  modalities?: {
    input: string[]
    output: string[]
  }
  catalogSources?: Array<'pi' | 'gateway'>
  gatewayModelId?: string
  modelType?: string
  tags?: string[]
  [key: string]: unknown
}

export type ModelProviderSummary = {
  providerID: ModelProviderID
  kind: ModelProviderKind
  displayName: string
  baseURL?: string
  defaultModels: string[]
  modelMetadata?: Record<string, ModelMetadata>
  apiKeyConfigured: boolean
  envVars?: string[]
  docURL?: string
  logoURL?: string
  gatewaySource?: boolean
  requiresBaseURL?: boolean
  wireApi?: ProviderWireApi
}

export type ProviderBalanceInfo = {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export type ProviderTokenPlanUsageInfo = {
  modelName: string
  currentIntervalTotalCount: number | null
  currentIntervalRemainingCount: number | null
  currentIntervalStartTime: number | null
  currentIntervalEndTime: number | null
  currentIntervalRemainingTime: number | null
  currentIntervalStatus: number | null
  currentIntervalRemainingPercent: number | null
  currentWeeklyTotalCount: number | null
  currentWeeklyRemainingCount: number | null
  currentWeeklyStatus: number | null
  currentWeeklyRemainingPercent: number | null
  weeklyStartTime: number | null
  weeklyEndTime: number | null
  weeklyRemainingTime: number | null
  weeklyBoostPermille: number | null
}
