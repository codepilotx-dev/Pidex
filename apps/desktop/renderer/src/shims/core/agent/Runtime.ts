import type { ContextUsageBreakdownEntry } from '@pidex/shared/thread'

export type { AgentPermissionRequest } from './Permissions.js'

export type AgentWorkspace = {
  id?: string
  name: string
  path: string
  branch?: string | null
  branchName?: string | null
  branches?: string[]
  isGitRepo?: boolean
  isStandalone?: boolean
  lastOpenedAt?: string | null
}

export type AgentSessionStatus =
  'idle' | 'queued' | 'waiting' | 'running' | 'done' | 'error' | 'interrupted' | 'cancelled'

export type AgentThinkingMode = 'default' | 'enabled' | 'adaptive' | 'disabled'

export type AgentContextUsage = {
  provider?: string
  model?: string
  usedTokens: number
  totalTokens?: number
  contextWindow?: number
  remainingTokens?: number
  usedPercent?: number
  remainingPercent?: number
  promptCacheReadTokens?: number
  promptCacheWriteTokens?: number
  promptUncachedTokens?: number
  reasoningTokens?: number
  percentUsed?: number
  /** Agent 按来源实测的上下文字符量；只用于展示占比，不是 token 账本。 */
  breakdown?: readonly ContextUsageBreakdownEntry[]
  /** 会话累计缓存命中率；只有渲染层聚合，不随协议下发。 */
  averageCacheHitRate?: number
}

export type AgentToolLogEntry = {
  id?: string
  kind?: string
  toolName?: string
  summary?: string
  input?: unknown
  output?: unknown
  error?: string
  isError?: boolean
  expanded?: boolean
  createdAt?: string
  [key: string]: any
}

export type AgentSessionMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt?: string
  streaming?: boolean
  metadata?: Record<string, unknown>
}

export type AgentSessionEventType =
  | 'message'
  | 'assistant_delta'
  | 'tool_call'
  | 'tool_result'
  | 'permission_request'
  | 'file_patch'
  | 'checkpoint'
  | 'error'
  | 'proposed_plan'
  | string

export type AgentSessionEvent = any

export type AgentRuntimeEvent = any
