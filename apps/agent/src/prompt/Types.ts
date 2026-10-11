import type { SubagentProfile, TaskMode } from '../Domain'

export interface PromptContextItem {
  role: 'user'
  content: Array<{ type: 'input_text'; text: string }>
}

export type PromptRole = 'system' | 'developer' | 'contextual-user'
export type PromptCacheClass = 'global-stable' | 'session-stable' | 'dynamic'
export type PromptAuthority = 'builtin' | 'user' | 'project' | 'memory' | 'external-data'
export type PromptSource =
  | { type: 'builtin'; name: string }
  | { type: 'setting'; name: string }
  | { type: 'file'; path: string; scope?: string }
  | { type: 'runtime'; name: string }

export interface PromptSection {
  id: string
  role: PromptRole
  cache: PromptCacheClass
  authority: PromptAuthority
  source: PromptSource
  content: string
  modes?: TaskMode[]
  profiles?: SubagentProfile[]
  requiredTools?: string[]
}

export interface PromptSectionDiagnostic {
  id: string
  role: PromptRole
  cache: PromptCacheClass
  authority: PromptAuthority
  source: PromptSource
  hash: string
  bytes: number
  /** JS 字符串长度；上下文来源占比按它计算，与消息侧保持同一单位。 */
  chars: number
  estimatedTokens: number
  included: boolean
  reason?: 'empty' | 'mode' | 'profile' | 'required-tools'
}

export interface PromptBundle {
  instructions: string
  contextItems: PromptContextItem[]
  stableContextText: string
  diagnostics: PromptSectionDiagnostic[]
  cacheSegments: PromptCacheSegment[]
  cacheBoundaries: PromptCacheBoundary[]
  baseHash: string
  contextHash: string
  cacheHash: string
  cacheKey: string
}

export interface PromptCacheSegment {
  index: number
  cache: PromptCacheClass
  role: 'instructions' | 'context'
  sectionIDs: string[]
  content: string
  hash: string
  start: number
  end: number
  cacheable: boolean
}

export interface PromptCacheBoundary {
  segmentIndex: number
  cache: Exclude<PromptCacheClass, 'dynamic'>
  offset: number
  hash: string
}

export interface PromptComposeInput {
  threadID: string
  mode: TaskMode
  profile: SubagentProfile
  exposedTools: readonly string[]
  sections: readonly PromptSection[]
}
