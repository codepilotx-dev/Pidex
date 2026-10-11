import type { PromptSection } from './Types'

/**
 * Capability summary budget. The model only needs the exact names and a one-line
 * hint to decide what to search for;完整说明与参数按需通过 ToolSearch / Read 加载。
 */
export const CAPABILITY_CATALOG_MAX_CHARS = 8_000
export const CAPABILITY_DESCRIPTION_MAX_CHARS = 160

export interface CapabilityToolSummary {
  /** Canonical model-facing name. */
  name: string
  description: string
  /** Discovery source label, for example `mcp:<server>`. */
  source?: string
}

export const truncateCapabilityText = (value: string, max = CAPABILITY_DESCRIPTION_MAX_CHARS) =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`

const GUIDANCE = [
  '以下能力需要先发现并激活，才会出现在可调用工具中；工具声明里直接出现的普通工具不需要搜索。',
  '用 ToolSearch 发现延迟工具：query 匹配工具名称、描述与 MCP server 名称，query="*" 浏览整个目录，用 offset 分页、max_results 上限 20；命中的工具在下一次请求即可调用，select:<exact-name> 精确激活并获取完整参数 schema。',
  'Skill 目录（名称、描述与来源位置）见同轮上下文的 skills.catalog；需要时用 Read 加载对应 SKILL.md 全文，再按其中步骤执行。这里不预加载 Skill 正文。',
].join('\n')

const toolLine = (tool: CapabilityToolSummary) => {
  const description = truncateCapabilityText(tool.description.trim().replace(/\s+/gu, ' '))
  const source = tool.source ? ` [${tool.source}]` : ''
  return `- ${tool.name}${description ? `: ${description}` : ''}${source}`
}

/**
 * Single generation path shared by the frozen turn composition (main Agent and
 * subagents) and the prompt preview. It only lists what the current mode,
 * profile, allowlist and availability already allow the model to discover.
 */
export const buildCapabilityCatalogSection = (
  tools: readonly CapabilityToolSummary[],
): PromptSection => {
  const lines: string[] = []
  const header = `${GUIDANCE}\n\n可发现能力（延迟工具）：`
  const omission = (count: number) =>
    `目录共 ${tools.length} 项，此处仅列出前 ${count} 项；还有 ${tools.length - count} 项未展示，请用 ToolSearch（可用 offset）分页发现。`
  let used = header.length
  for (const tool of tools) {
    const line = toolLine(tool)
    const nextCount = lines.length + 1
    const suffixLength = nextCount < tools.length ? omission(nextCount).length + 1 : 0
    if (used + line.length + 1 + suffixLength > CAPABILITY_CATALOG_MAX_CHARS) break
    lines.push(line)
    used += line.length + 1
  }
  const omitted = tools.length - lines.length
  const body = [
    ...lines,
    ...(tools.length === 0 ? ['- 当前没有可发现的延迟工具。'] : []),
    ...(omitted > 0 ? [omission(lines.length)] : []),
  ].join('\n')
  return {
    id: 'capabilities.catalog',
    role: 'developer',
    cache: 'session-stable',
    authority: 'builtin',
    source: { type: 'runtime', name: 'capability-catalog' },
    content: `${header}\n${body}`,
  }
}
