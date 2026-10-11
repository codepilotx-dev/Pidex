import { describe, expect, test } from 'bun:test'
import {
  buildContextUsageBreakdown,
  contextItemsChars,
  type ContextUsageToolDefinition,
} from '../src/context/ContextUsageBreakdown'
import type { PromptContextItem, PromptSectionDiagnostic } from '../src/prompt/Types'

const diagnostic = (
  id: string,
  chars: number,
  options: { included?: boolean; role?: PromptSectionDiagnostic['role'] } = {},
): PromptSectionDiagnostic => ({
  id,
  role: options.role ?? 'developer',
  cache: 'session-stable',
  authority: 'builtin',
  source: { type: 'runtime', name: id },
  hash: id,
  bytes: chars,
  chars,
  estimatedTokens: Math.ceil(chars / 4),
  included: options.included ?? true,
})

const tool = (
  name: string,
  description: string,
  parameters: unknown = {},
): ContextUsageToolDefinition => ({
  name,
  description,
  parameters,
})

describe('上下文来源拆解', () => {
  test('按 section 来源分桶，技能/记忆/项目指令不再落在系统提示词里', () => {
    const breakdown = buildContextUsageBreakdown({
      diagnostics: [
        diagnostic('builtin.identity-security', 100),
        diagnostic('skills.catalog', 40),
        diagnostic('memory.0', 30, { role: 'contextual-user' }),
        diagnostic('project-instruction.0', 20, { role: 'contextual-user' }),
        diagnostic('context.environment', 10, { role: 'contextual-user' }),
      ],
      tools: [],
      injectedContextChars: 0,
      messagesChars: 0,
    })

    expect(breakdown).toEqual([
      { source: 'system_prompt', chars: 100 },
      { source: 'skills', chars: 40 },
      { source: 'memory', chars: 30 },
      { source: 'project', chars: 20 },
      { source: 'other', chars: 10 },
    ])
  })

  test('排除未进入请求的 section，并按 mcp__ 前缀拆分工具 schema', () => {
    const breakdown = buildContextUsageBreakdown({
      diagnostics: [
        diagnostic('mode.chat', 50, { included: false }),
        diagnostic('builtin.execution', 10),
      ],
      tools: [tool('Read', 'read', {}), tool('mcp__fs__read', 'mcp read', { type: 'object' })],
      injectedContextChars: 0,
      messagesChars: 0,
    })

    expect(breakdown).toEqual([
      { source: 'system_prompt', chars: 10 },
      {
        source: 'system_tools',
        chars: 'read'.length + JSON.stringify({}).length,
      },
      {
        source: 'mcp_tools',
        chars: 'mcp read'.length + JSON.stringify({ type: 'object' }).length,
      },
    ])
  })

  test('消息量扣除注入的 context_data 区块，扣成负数时该分类消失', () => {
    const items: PromptContextItem[] = [
      { role: 'user', content: [{ type: 'input_text', text: 'x'.repeat(60) }] },
    ]
    expect(contextItemsChars(items)).toBe(60)

    const withMessages = buildContextUsageBreakdown({
      diagnostics: [],
      tools: [],
      injectedContextChars: contextItemsChars(items),
      messagesChars: 100,
    })
    expect(withMessages).toEqual([{ source: 'messages', chars: 40 }])

    const overSubtracted = buildContextUsageBreakdown({
      diagnostics: [],
      tools: [],
      injectedContextChars: 200,
      messagesChars: 100,
    })
    expect(overSubtracted).toEqual([])
  })
})
