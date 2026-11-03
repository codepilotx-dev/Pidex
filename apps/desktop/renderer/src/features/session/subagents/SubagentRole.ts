import type { SubagentRole } from '@pidex/shared/thread'

const ROLE_ORDER: readonly SubagentRole[] = [
  'designer',
  'devops',
  'qa',
  'docs',
  'product',
  'frontend',
  'backend',
  'data',
]

/** 英文按非 ASCII 字母数字边界匹配；短词单独列出，避免 build 命中 ui、specification 命中 spec。 */
const KEYWORDS: Readonly<Record<SubagentRole, readonly string[]>> = {
  frontend: [
    'frontend',
    'front-end',
    'react',
    'vue',
    'css',
    'html',
    'web',
    'ui',
    '前端',
    '界面',
    '页面',
    '组件',
  ],
  backend: [
    'backend',
    'back-end',
    'api',
    'server',
    'database',
    'sql',
    '后端',
    '接口',
    '服务端',
    '数据库',
  ],
  devops: [
    'devops',
    'docker',
    'pipeline',
    'deploy',
    'k8s',
    '运维',
    '部署',
    '流水线',
    '发布',
    '构建',
  ],
  qa: ['qa', 'test', 'e2e', 'vitest', 'jest', 'spec', '测试', '质检', '校验', '验证'],
  designer: ['designer', 'design', 'figma', 'ui/ux', 'ux', 'style', '设计', '视觉', '原型'],
  data: ['data', 'analysis', 'analytics', 'etl', '数据', '分析', '统计'],
  docs: ['docs', 'doc', 'documentation', 'readme', 'changelog', 'markdown', '文档', '手册'],
  product: ['product', 'prd', 'requirement', 'feature', '产品', '需求', '规划'],
  general: [],
}

/** `db`、`bi`、`pm`、`ci`、`cd` 这类短词只在独立成词时命中，不做子串匹配。 */
const SHORT_WORD_ROLES: Readonly<Record<string, SubagentRole>> = {
  db: 'backend',
  bi: 'data',
  pm: 'product',
  ci: 'devops',
  cd: 'devops',
}

const HAS_CJK = /[\u3400-\u9fff]/u

function matchesKeyword(text: string, keyword: string): boolean {
  if (HAS_CJK.test(keyword)) return text.includes(keyword)
  // 英文/短语：两侧必须是非字母数字边界，允许下划线、空格、连字符等分隔符。
  const pattern = new RegExp(
    `(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}([^a-z0-9]|$)`,
    'u',
  )
  return pattern.test(text)
}

function matchRole(text: string): SubagentRole | null {
  const normalized = text.toLowerCase()
  if (!normalized.trim()) return null
  const roles = new Set<SubagentRole>()
  for (const role of ROLE_ORDER) {
    if (KEYWORDS[role].some((keyword) => matchesKeyword(normalized, keyword))) roles.add(role)
  }
  for (const [word, role] of Object.entries(SHORT_WORD_ROLES)) {
    if (matchesKeyword(normalized, word)) roles.add(role)
  }
  return ROLE_ORDER.find((role) => roles.has(role)) ?? null
}

/**
 * 展示用角色：显式 role 优先，其次名称关键词，最后原始任务关键词，兜底 general。
 * 纯展示规则，不写回数据库，也不随运行状态或结果摘要变化。
 */
export function resolveSubagentRole(input: {
  role?: SubagentRole | null
  displayName?: string | null
  task?: string | null
}): SubagentRole {
  if (input.role) return input.role
  return matchRole(input.displayName ?? '') ?? matchRole(input.task ?? '') ?? 'general'
}
