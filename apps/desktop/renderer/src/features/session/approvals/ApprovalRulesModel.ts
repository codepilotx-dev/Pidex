import type {
  PermissionRule,
  PermissionRuleEffect,
  PermissionRuleInput,
  PermissionRuleMatch,
  PermissionRuleScope,
  PermissionRuleSource,
} from '@pidex/shared/thread'

/**
 * Pure state helpers for the approval rules dialog. The dialog renders the
 * server-owned `PermissionRule` catalog; this module owns tab/filter grouping,
 * editor conversion, optimistic list updates and version-conflict detection so
 * each transition can be tested without a DOM.
 */
export const APPROVAL_RULE_EFFECT_TABS: ReadonlyArray<{
  value: PermissionRuleEffect
  label: string
}> = [
  { value: 'allow', label: '允许' },
  { value: 'ask', label: '询问' },
  { value: 'deny', label: '拒绝' },
]

export const APPROVAL_RULE_EFFECT_LABELS: Record<PermissionRuleEffect, string> = {
  allow: '允许',
  ask: '询问',
  deny: '拒绝',
}

export const APPROVAL_RULE_SCOPE_LABELS: Record<PermissionRuleScope, string> = {
  chat: '当前会话与项目',
  user: '用户',
  project: '当前项目',
}

export const APPROVAL_RULE_SOURCE_LABELS: Record<PermissionRuleSource, string> = {
  chat: '聊天',
  user: '用户',
  project: '当前项目',
  legacy: '旧授权',
}

export type ApprovalRuleScopeOption = {
  value: PermissionRuleScope
  label: string
  detail: string
}

/** New rules always start scoped to the current chat; persistent scopes are explicit. */
export function approvalRuleScopeOptions(isProjectChat: boolean): ApprovalRuleScopeOption[] {
  return [
    {
      value: 'chat',
      label: '当前聊天',
      detail: '仅对当前聊天与当前项目的交集生效，恢复聊天后仍有效。',
    },
    {
      value: 'user',
      label: '用户（持久）',
      detail: '写入用户配置，在此电脑上的所有聊天生效。',
    },
    ...(isProjectChat
      ? [
          {
            value: 'project' as const,
            label: '项目（持久）',
            detail: '写入项目配置，仅在已信任的项目聊天生效。',
          },
        ]
      : []),
  ]
}

export const DEFAULT_APPROVAL_RULE_SCOPE: PermissionRuleScope = 'chat'

export function isApprovalRuleScopeAllowed(
  scope: PermissionRuleScope,
  isProjectChat: boolean,
): boolean {
  return scope !== 'project' || isProjectChat
}

export type ApprovalRuleMatchKind = PermissionRuleMatch['kind']

export type ApprovalRuleEditorValues = {
  effect: PermissionRuleEffect
  scope: PermissionRuleScope
  matchKind: ApprovalRuleMatchKind
  tool: string
  fileAccess: 'read' | 'write'
  filePath: string
  commandMode: 'exact' | 'prefix'
  command: string
  commandCwd?: string
  argvText: string
  domain: string
  mcpServer: string
  mcpTool: string
}

export function createApprovalRuleEditorValues(
  effect: PermissionRuleEffect,
  overrides: Partial<ApprovalRuleEditorValues> = {},
): ApprovalRuleEditorValues {
  return {
    effect,
    scope: DEFAULT_APPROVAL_RULE_SCOPE,
    matchKind: 'tool',
    tool: '',
    fileAccess: 'write',
    filePath: '',
    commandMode: 'exact',
    command: '',
    argvText: '',
    domain: '',
    mcpServer: '',
    mcpTool: '',
    ...overrides,
  }
}

export function approvalRuleEditorValuesFromRule(rule: PermissionRule): ApprovalRuleEditorValues {
  const base = createApprovalRuleEditorValues(rule.effect, {
    scope: rule.scope,
    matchKind: rule.match.kind,
  })
  switch (rule.match.kind) {
    case 'tool':
      return { ...base, tool: rule.match.tool }
    case 'file':
      return { ...base, fileAccess: rule.match.access, filePath: rule.match.path }
    case 'command':
      return {
        ...base,
        command: rule.match.command,
        commandCwd: rule.match.cwd,
        commandMode: rule.match.argv?.length ? 'prefix' : 'exact',
        argvText: rule.match.argv?.join('\n') ?? '',
      }
    case 'network':
      return { ...base, domain: rule.match.domain }
    case 'mcp':
      return { ...base, mcpServer: rule.match.server, mcpTool: rule.match.tool ?? '' }
  }
}

// Matches the host's exact-domain rule: lower-case hostname only, no wildcards.
const NETWORK_DOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u
const WINDOWS_ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\)/u
const POSIX_ABSOLUTE_PATH = /^\//u

export function isAbsoluteHostPath(value: string): boolean {
  return WINDOWS_ABSOLUTE_PATH.test(value) || POSIX_ABSOLUTE_PATH.test(value)
}

export type ApprovalRuleInputBuild =
  { input: PermissionRuleInput; error: null } | { input: null; error: string }

/** Converts editor values into the wire input; the host re-validates every subject. */
export function buildApprovalRuleInput(
  values: ApprovalRuleEditorValues,
  options: { id?: string; isProjectChat: boolean },
): ApprovalRuleInputBuild {
  const scope = values.scope
  if (!isApprovalRuleScopeAllowed(scope, options.isProjectChat))
    return { input: null, error: '当前聊天不属于项目，不能创建项目规则。' }
  const effect = values.effect
  const id = options.id
  switch (values.matchKind) {
    case 'tool': {
      const tool = values.tool.trim()
      if (!tool) return { input: null, error: '请输入工具名称。' }
      return {
        input: { ...(id ? { id } : {}), effect, scope, match: { kind: 'tool', tool } },
        error: null,
      }
    }
    case 'file': {
      const path = values.filePath.trim()
      if (!path) return { input: null, error: '请选择文件路径。' }
      if (!isAbsoluteHostPath(path))
        return { input: null, error: '文件规则必须使用宿主解析后的绝对路径。' }
      return {
        input: {
          ...(id ? { id } : {}),
          effect,
          scope,
          match: { kind: 'file', access: values.fileAccess, path },
        },
        error: null,
      }
    }
    case 'command': {
      const command = values.command.trim()
      const cwd = values.commandCwd?.trim()
      if (cwd && !isAbsoluteHostPath(cwd)) return { input: null, error: '执行目录必须是绝对路径。' }
      if (!command) return { input: null, error: '请输入命令。' }
      if (values.commandMode === 'exact')
        return {
          input: {
            ...(id ? { id } : {}),
            effect,
            scope,
            match: { kind: 'command', command, ...(cwd ? { cwd } : {}) },
          },
          error: null,
        }
      const argv = values.argvText
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
      if (!argv.length) return { input: null, error: '参数前缀至少需要一个参数，每行一个。' }
      return {
        input: {
          ...(id ? { id } : {}),
          effect,
          scope,
          match: { kind: 'command', command, argv, ...(cwd ? { cwd } : {}) },
        },
        error: null,
      }
    }
    case 'network': {
      const domain = values.domain.trim().toLowerCase()
      if (!domain) return { input: null, error: '请输入精确域名。' }
      if (!NETWORK_DOMAIN.test(domain) || domain.includes('*'))
        return { input: null, error: '网络规则只支持精确域名，不支持通配符。' }
      return {
        input: { ...(id ? { id } : {}), effect, scope, match: { kind: 'network', domain } },
        error: null,
      }
    }
    case 'mcp': {
      const server = values.mcpServer.trim()
      if (!server) return { input: null, error: '请输入 MCP 服务器名称。' }
      const tool = values.mcpTool.trim()
      return {
        input: {
          ...(id ? { id } : {}),
          effect,
          scope,
          match: { kind: 'mcp', server, ...(tool ? { tool } : {}) },
        },
        error: null,
      }
    }
  }
}

export function approvalRuleMatchSummary(match: PermissionRuleMatch): string {
  switch (match.kind) {
    case 'tool':
      return `工具 · ${match.tool}`
    case 'file':
      return `文件${match.access === 'read' ? '读取' : '写入'} · ${match.path}`
    case 'command':
      return match.argv?.length
        ? `命令前缀 · ${match.argv.join(' ')}`
        : `精确命令 · ${match.command}`
    case 'network':
      return `网络 · ${match.domain}`
    case 'mcp':
      return `MCP · ${match.server}${match.tool ? ` / ${match.tool}` : ' / 全部工具'}`
  }
}

export function approvalRuleSearchText(rule: PermissionRule): string {
  return [
    approvalRuleMatchSummary(rule.match),
    rule.match.kind,
    APPROVAL_RULE_EFFECT_LABELS[rule.effect],
    APPROVAL_RULE_SCOPE_LABELS[rule.scope],
    APPROVAL_RULE_SOURCE_LABELS[rule.source],
    rule.id,
  ].join(' ')
}

/** Filters the catalog to one effect tab and an optional free-text query. */
export function filterApprovalRules(
  rules: readonly PermissionRule[],
  effect: PermissionRuleEffect,
  query: string,
): PermissionRule[] {
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
  return rules.filter((rule) => {
    if (rule.effect !== effect) return false
    if (!terms.length) return true
    const haystack = approvalRuleSearchText(rule).toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

export function countApprovalRulesByEffect(
  rules: readonly PermissionRule[],
): Record<PermissionRuleEffect, number> {
  const counts: Record<PermissionRuleEffect, number> = { allow: 0, ask: 0, deny: 0 }
  for (const rule of rules) counts[rule.effect] += 1
  return counts
}

/** Replaces an edited rule by id or inserts a newly created rule. */
export function applyApprovalRuleUpsert(
  rules: readonly PermissionRule[],
  rule: PermissionRule,
): PermissionRule[] {
  const index = rules.findIndex((entry) => entry.id === rule.id)
  if (index < 0) return [rule, ...rules]
  return rules.map((entry) => (entry.id === rule.id ? rule : entry))
}

export function applyApprovalRuleRevoke(
  rules: readonly PermissionRule[],
  ruleId: string,
): PermissionRule[] {
  return rules.filter((rule) => rule.id !== ruleId)
}

/** Legacy approval grants stay visible as allow/source legacy and are revocable only. */
export function canEditApprovalRule(rule: PermissionRule): boolean {
  return rule.editable && rule.source !== 'legacy'
}

export function approvalRuleScopeDescription(rule: PermissionRule): string {
  const scope = APPROVAL_RULE_SCOPE_LABELS[rule.scope]
  const source = APPROVAL_RULE_SOURCE_LABELS[rule.source]
  if (rule.source === 'legacy') return `来源 ${source} · 范围 ${scope} · 仅可撤销`
  return `来源 ${source} · 范围 ${scope}`
}

type ConflictCarrier = {
  errorCode?: unknown
  code?: unknown
  message?: unknown
  data?: { code?: unknown } | null
}

/** The agent reports optimistic-write conflicts as CONFLICT wire errors. */
export function isApprovalRuleVersionConflict(error: unknown): boolean {
  if (!error) return false
  const carrier = error as ConflictCarrier
  const code =
    typeof carrier.errorCode === 'string'
      ? carrier.errorCode
      : typeof carrier.data?.code === 'string'
        ? carrier.data.code
        : typeof carrier.code === 'string'
          ? carrier.code
          : null
  if (code === 'CONFLICT' || code === 'CONFIG_VERSION_CONFLICT') return true
  const message = error instanceof Error ? error.message : String(error)
  return /CONFLICT|冲突|版本已变化|已被删除|已被修改/u.test(message)
}
