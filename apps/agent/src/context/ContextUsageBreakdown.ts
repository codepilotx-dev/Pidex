import type { ContextUsageBreakdownEntry, ContextUsageBreakdownSource } from '@pidex/shared/thread'
import type { AgentMessage } from '../orchestration/harness/AgentTypes'
import type { PromptContextItem, PromptSectionDiagnostic } from '../prompt/Types'
import { estimateMessageChars } from './harness/Compaction'

/**
 * 上下文来源分类顺序。UI 按此顺序渲染堆叠条与明细行，
 * 新增来源必须同时更新 @pidex/shared 的 ContextUsageBreakdownSourceSchema。
 */
const BREAKDOWN_ORDER: readonly ContextUsageBreakdownSource[] = [
  'messages',
  'system_prompt',
  'system_tools',
  'mcp_tools',
  'skills',
  'memory',
  'project',
  'other',
]

/** MCP 工具的 sdkName 前缀，见 McpToolAdapter。 */
const MCP_TOOL_PREFIX = 'mcp__'

export interface ContextUsageToolDefinition {
  name: string
  description?: string | undefined
  parameters?: unknown
}

export interface ContextUsageBreakdownInput {
  /** PromptComposer 的分段诊断；只有 included 的段真正进入请求。 */
  diagnostics: readonly PromptSectionDiagnostic[]
  /** 本次请求实际暴露的工具定义（含参数 schema）。 */
  tools: readonly ContextUsageToolDefinition[]
  /** 单份注入进首条 user 消息的 context_data 文本量。 */
  injectedContextChars: number
  /** harness 实际发出的消息数组字符量。 */
  messagesChars: number
}

/**
 * 首条 user 消息承载了项目指令、技能目录、记忆等 contextual-user 分段，
 * 若不扣除，它们会同时出现在各自分类和 Messages 里。
 *
 * 只有当前轮注入的那一份被扣除：更早轮次的重复注入确实是消息内容，
 * 应当继续计入 Messages。
 */
export function contextItemsChars(items: readonly PromptContextItem[]): number {
  let chars = 0
  for (const item of items) {
    for (const part of item.content) chars += part.text.length
  }
  return chars
}

export function messagesChars(messages: readonly AgentMessage[]): number {
  let chars = 0
  for (const message of messages) chars += estimateMessageChars(message)
  return chars
}

export function buildContextUsageBreakdown(
  input: ContextUsageBreakdownInput,
): ContextUsageBreakdownEntry[] {
  const charsBySource = new Map<ContextUsageBreakdownSource, number>()
  const add = (source: ContextUsageBreakdownSource, chars: number) => {
    if (!Number.isFinite(chars) || chars <= 0) return
    charsBySource.set(source, (charsBySource.get(source) ?? 0) + chars)
  }

  for (const diagnostic of input.diagnostics) {
    if (!diagnostic.included) continue
    add(sectionSource(diagnostic), diagnostic.chars)
  }
  for (const tool of input.tools) {
    add(
      tool.name.startsWith(MCP_TOOL_PREFIX) ? 'mcp_tools' : 'system_tools',
      toolDefinitionChars(tool),
    )
  }
  add('messages', input.messagesChars - input.injectedContextChars)

  return BREAKDOWN_ORDER.flatMap((source) => {
    const chars = charsBySource.get(source)
    return chars === undefined || chars <= 0 ? [] : [{ source, chars }]
  })
}

function sectionSource(diagnostic: PromptSectionDiagnostic): ContextUsageBreakdownSource {
  if (diagnostic.id.startsWith('skills.')) return 'skills'
  if (diagnostic.id.startsWith('memory.')) return 'memory'
  if (diagnostic.id.startsWith('project-instruction.')) return 'project'
  // 其余 contextual-user 段（环境、外部数据、当前用户消息等）没有独立分类。
  return diagnostic.role === 'contextual-user' ? 'other' : 'system_prompt'
}

/** 工具 schema 的线上形态由 provider 序列化决定，此处按定义近似。 */
function toolDefinitionChars(tool: ContextUsageToolDefinition): number {
  return (tool.description?.length ?? 0) + safeJsonChars(tool.parameters)
}

function safeJsonChars(value: unknown): number {
  if (value === undefined || value === null) return 0
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}
