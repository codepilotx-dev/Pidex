import type { AdditionalPermissions, ShellInput } from '@pidex/shared/thread'
import { isAbsolute, relative, resolve } from 'node:path'
import { shellCommandSegments, type ShellCommandSegment } from '../tool/Shell/CommandSyntax'

export const RISK_CATEGORIES = [
  'destructive',
  'irreversible_change',
  'system_modification',
  'security_control',
  'credential_access',
  'credential_exfiltration',
  'privilege_escalation',
  'persistence',
  'resource_exhaustion',
  'network_access',
  'scope_escape',
  'prompt_injection',
  'obfuscation',
  'unknown_infrastructure',
] as const

export type RiskCategory = (typeof RISK_CATEGORIES)[number]
export type ShellRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type ShellSecurityLevel = 'strict' | 'balanced' | 'relaxed'

export interface ShellReviewInput extends ShellInput {
  taskSummary?: string
  workspaceRoot?: string
  securityLevel?: ShellSecurityLevel
}

export interface ShellRiskAnalysis {
  hardDenied: boolean
  requiresApproval: boolean
  /** True when the command can destroy state outside the workspace or on a remote host. */
  destructive: boolean
  securityLevel: ShellSecurityLevel
  risk: ShellRiskLevel
  categories: RiskCategory[]
  requestedScopeValid: boolean
  matchedRules: string[]
  reason: string
}

type RulePolicy = 'always-deny' | 'deny-through-balanced' | 'strict-only'

interface RiskRule {
  name: string
  category: RiskCategory
  policy: RulePolicy
  pattern: RegExp
  reason: string
}

const SANDBOX_POLICY_TARGET =
  /(?:\bsrt-sandbox\b|\bsandbox-runtime-users\b|(?:^|[\\/\s"'=])\.git[\\/](?:config|hooks)(?=$|[\\/\s"'`;|&])|(?:^|[\\/\s"'=])\.pidex[\\/](?:config\.toml|hooks\.json|skills)(?=$|[\\/\s"'`;|&])|(?:^|[\\/\s"'=])\.(?:claude|agents)[\\/]skills(?=$|[\\/\s"'`;|&]))/i
const SANDBOX_POLICY_TAMPER_ACTION =
  /\b(?:remove|delete|disable|stop|uninstall|modify|alter|write|rename|set)\b/i
const SANDBOX_POLICY_TAMPER = new RegExp(
  `(?:${SANDBOX_POLICY_TARGET.source})[\\s\\S]*(?:${SANDBOX_POLICY_TAMPER_ACTION.source})|(?:${SANDBOX_POLICY_TAMPER_ACTION.source})[\\s\\S]*(?:${SANDBOX_POLICY_TARGET.source})`,
  'i',
)

const RISK_RULES: readonly RiskRule[] = [
  {
    name: 'disk-or-boot-modification',
    category: 'destructive',
    policy: 'always-deny',
    pattern:
      /\b(?:diskpart(?:\.exe)?|format(?:\.(?:com|exe))?\s+(?:[a-z]:|\/|[a-z]:\\)|format-volume\b|clear-disk\b|clear-volume\b|initialize-disk\b|remove-disk\b|remove-partition\b|remove-volume\b|bcdedit(?:\.exe)?\b|bootrec(?:\.exe)?\b)/i,
    reason: '检测到格式化、初始化、删除磁盘分区或修改启动配置',
  },
  {
    name: 'root-or-user-tree-wipe',
    category: 'destructive',
    policy: 'always-deny',
    pattern:
      /(?:remove-item|remove-directory|rmdir|rd|del|erase|rm)\b[\s\S]*(?:(?:[a-z]:\\(?:users|windows)?\\?)|%systemdrive%|%userprofile%|\\users\\?$|\\windows\\?$|\$env:(?:systemdrive|userprofile|windir)\b)[\s\S]*(?:-recurse|-rf|\/s\b)|(?:remove-item|remove-directory|rmdir|rd|del|erase|rm)\b[\s\S]*(?:-recurse|-rf|\/s\b)[\s\S]*(?:(?:[a-z]:\\(?:users|windows)?\\?)|%systemdrive%|%userprofile%|\\users\\?$|\\windows\\?$|\$env:(?:systemdrive|userprofile|windir)\b)|\brm\s+-rf\s+\/(?:\s|$)/i,
    reason: '检测到递归清空磁盘根目录、Windows 目录或整个用户目录',
  },
  {
    name: 'system-uninstall',
    category: 'system_modification',
    policy: 'strict-only',
    pattern:
      /\b(?:winget|choco(?:latey)?)(?:\.exe)?\s+uninstall\b|\bmsiexec(?:\.exe)?\b[\s\S]*(?:^|\s)\/(?:x|uninstall)\b|\b(?:get-wmiobject|gwmi|wmic)\b[\s\S]*(?:win32_product|product)[\s\S]*(?:\.uninstall|call\s+uninstall)/i,
    reason: '检测到通过系统包管理器或 Windows Installer 卸载程序',
  },
  {
    name: 'security-control-disable',
    category: 'security_control',
    policy: 'deny-through-balanced',
    pattern:
      /\b(?:set|add)-mppreference\b[\s\S]*-(?:disable|exclusion)|\bnetsh\s+advfirewall\b[\s\S]*\bstate\s+off\b|\bset-netfirewallprofile\b[\s\S]*-enabled\s+\$?false\b|\b(?:reg|reg\.exe)\s+add\b[\s\S]*(?:enablelua|disableantispyware|disablerealtimemonitoring)\b|\bset-(?:item|itemproperty|property)\b[\s\S]*(?:enablelua|disableantispyware|disablerealtimemonitoring)\b|\bauditpol(?:\.exe)?\b[\s\S]*\/clear\b|\bremove-netfirewallrule\b[\s\S]*(?:\*|allprofiles)|\bnetsh\b[\s\S]*\bwfp\b[\s\S]*\bdelete\b/i,
    reason: '检测到关闭 Defender、防火墙、UAC、WFP 或添加安全排除',
  },
  {
    name: 'sandbox-policy-tamper',
    category: 'security_control',
    policy: 'always-deny',
    pattern: SANDBOX_POLICY_TAMPER,
    reason: '检测到删除或篡改 Pidex 审核策略、沙箱账户和过滤规则',
  },
  {
    name: 'admin-account-creation',
    category: 'privilege_escalation',
    policy: 'strict-only',
    pattern:
      /\bnet\s+(?:user|localgroup)\b[\s\S]*(?:\/add|administrators)|\b(?:new-localuser|add-localgroupmember)\b[\s\S]*(?:administrator|administrators)|\bnet\s+localgroup\s+administrators\b[\s\S]*\/add\b/i,
    reason: '检测到创建管理员账户或把账户加入管理员组',
  },
  {
    name: 'persistence-creation',
    category: 'persistence',
    policy: 'strict-only',
    pattern:
      /\b(?:sc(?:\.exe)?\s+create|new-service|schtasks(?:\.exe)?\s+\/create|new-scheduledtask|register-scheduledtask)\b|(?:reg(?:\.exe)?\s+add|new-(?:item|itemproperty)|set-itemproperty)[\s\S]*\\software\\microsoft\\windows\\currentversion\\run\b/i,
    reason: '检测到创建服务、计划任务或用户启动项等持久化机制',
  },
  {
    name: 'resource-exhaustion',
    category: 'resource_exhaustion',
    policy: 'always-deny',
    pattern:
      /:\(\)\s*\{[\s\S]*\|[\s\S]*&[\s\S]*\}|\bfor\s+\/l\s+%\w+\s+in\s*\(0\s*,\s*0\s*,\s*0\)|\bwhile\s*\(\s*\$?true\s*\)[\s\S]*(?:start-process|start-job|fork)|\b(?:start-process|start-job)\b[\s\S]*\b(?:while|for)\b[\s\S]*\b(?:true|0\s*,\s*0\s*,\s*0)\b/i,
    reason: '检测到 Fork bomb、无限创建进程或明确资源耗尽操作',
  },
]

const NETWORK_EXECUTABLES = new Set([
  'curl',
  'wget',
  'iwr',
  'invoke-webrequest',
  'invoke-restmethod',
  'bitsadmin',
  'certutil',
  'ftp',
  'ssh',
  'scp',
  'nc',
  'ncat',
  'netcat',
])
const NETWORK_EXFIL_EXECUTABLES = new Set([
  'curl',
  'wget',
  'iwr',
  'invoke-webrequest',
  'invoke-restmethod',
  'bitsadmin',
  'certutil',
  'ftp',
  'nc',
  'ncat',
  'netcat',
])
const DOWNLOAD_EXECUTABLES = new Set(['curl', 'wget', 'iwr', 'invoke-webrequest'])
const SENSITIVE_READ_EXECUTABLES = new Set([
  'cat',
  'type',
  'get-content',
  'gc',
  'more',
  'copy',
  'cp',
])
const SHELL_EXECUTABLES = new Set([
  'bash',
  'sh',
  'zsh',
  'pwsh',
  'powershell',
  'iex',
  'invoke-expression',
])
const CREDENTIAL_TOOL_A_EXECUTABLE = /^m[i]m[i]k[a]tz$/i
const CREDENTIAL_TOOL_B_EXECUTABLE = /^s[e]k[u]rls[a]/i
const CREDENTIAL_DUMP_EXECUTABLE = /^p[r]ocd[u]mp$/i
const SENSITIVE_MARKER =
  /(?:^|[\\/\s"'=:@.-])(?:\.env(?:\.[a-z0-9_.-]+)?|(?:api|access|refresh)[-_]?token|password|secret|credential|api[-_]?key)(?=$|[\\/\s"'`;|&=:@.-])/i
const SENSITIVE_ENV_REFERENCE =
  /(?:\$env:|%|\$\{?)(?:[a-z0-9_]*(?:api[-_]?key|token|password|secret|credential)[a-z0-9_]*)(?:%|\})?/i
const SENSITIVE_UPLOAD_ARGUMENT =
  /(?:--data(?:-binary)?|-d|--form|-f|--upload-file|-t|-infile|-body|-headers)\s+(?:"[^"]*"|'[^']*'|[^\s]*)?(?:\.env|api[-_]?key|token|password|secret|credential)/i
const INFRASTRUCTURE_COMMAND =
  /\b(?:docker|kubectl|helm|terraform|ansible|ssh|sc(?:\.exe)?|netsh|reg(?:\.exe)?|diskpart)\b/i
const PROMPT_INJECTION =
  /ignore\s+(?:all\s+)?(?:previous|prior|earlier)\s+instructions?|忽略(?:之前|先前|上面)的指令|bypass\s+(?:the\s+)?(?:review|approval|sandbox)|绕过(?:审核|审批|沙箱)/i
const OBFUSCATED_COMMAND =
  /\b(?:powershell|pwsh)\b[\s\S]*(?:-enc(?:odedcommand)?\b|-e\s+[a-z0-9+/=]{16,})|\b(?:certutil|mshta|rundll32)\b[\s\S]*(?:javascript:|vbscript:|url\.dll)/i
const IRREVERSIBLE_CHANGE =
  /\bgit\s+(?:reset\s+--hard|clean\s+-[^\n]*f)|\bgit\s+push\b[\s\S]*--force(?:-with-lease)?\b|\b(?:drop\s+database|drop\s+table)\b|\bterraform\s+destroy\b/i
/**
 * Host and remote state that cannot be recovered from a local checkout. These
 * stay out of RISK_RULES so they never hard-deny: deleting a repository or a
 * branch is a legitimate user request, but it always needs an explicit
 * approval instead of running as an ordinary in-scope command.
 */
const EXTERNAL_STATE_DESTRUCTION: readonly RegExp[] = [
  /\bgh\s+repo\s+delete\b/i,
  /\bgh\s+(?:api|release|run|secret|variable|gist|ssh-key|gpg-key)\b[\s\S]*(?:-X|--method)\s+(?:DELETE|PUT)\b/i,
  /\bgh\s+(?:release|secret|variable|gist|cache|ssh-key|gpg-key)\s+delete\b/i,
  /\bgit\s+push\b[\s\S]*(?:--delete\b|:\S)|\bgit\s+remote\s+(?:remove|rm)\b|\bgit\s+tag\s+-d\b|\bgit\s+branch\s+-[dD]\b/i,
  /\bgit\s+(?:lfs\s+)?(?:prune|reflog\s+expire|filter-repo)\b/i,
  /\b(?:aws|az|gcloud|firebase|vercel|netlify|heroku)\b[\s\S]*\b(?:delete|remove|destroy|terminate|rm)\b/i,
  /\b(?:docker|kubectl|helm)\b[\s\S]*\b(?:rm|delete|uninstall|prune|down)\b/i,
  /\b(?:npm|yarn|pnpm|bun)\s+(?:unpublish|deprecate)\b|\b(?:npm|yarn|pnpm)\s+owner\s+rm\b/i,
]
const WINDOWS_ABSOLUTE_PATH = /(?:^|[\s"'=])([a-z]:[\\/][^\s"'|;&<>]*)/gi

const matchesExternalStateDestruction = (command: string) =>
  EXTERNAL_STATE_DESTRUCTION.some((pattern) => pattern.test(command))

export const normalizeShellSecurityLevel = (value: unknown): ShellSecurityLevel =>
  value === 'strict' || value === 'relaxed' ? value : 'balanced'

const pathOutsideWorkspace = (workspaceRoot: string, path: string) => {
  const fromRoot = relative(resolve(workspaceRoot), resolve(path))
  return fromRoot.startsWith('..') || isAbsolute(fromRoot)
}

const referencesWorkspaceExternalPath = (input: ShellReviewInput, command: string) => {
  const workspaceRoot = input.workspaceRoot?.trim()
  if (!workspaceRoot) return false
  if (input.cwd && isAbsolute(input.cwd) && pathOutsideWorkspace(workspaceRoot, input.cwd))
    return true
  WINDOWS_ABSOLUTE_PATH.lastIndex = 0
  for (const match of command.matchAll(WINDOWS_ABSOLUTE_PATH)) {
    if (match[1] && pathOutsideWorkspace(workspaceRoot, match[1])) return true
  }
  return false
}

const pathIsValid = (path: string) => {
  const value = path.trim()
  if (!value || value.includes('\0') || /[*?]/.test(value)) return false
  if (/^(?:[a-z]:[\\/]?|[\\/]{1,2})$/i.test(value)) return false
  return true
}

const domainIsValid = (domain: string) => {
  const value = domain.trim().toLowerCase()
  if (!value || /[*?\s/\\]/.test(value) || value.includes('\0')) return false
  return (
    value === 'localhost' ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) ||
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)
  )
}

const validList = (value: unknown, validator: (item: string) => boolean) =>
  value === undefined ||
  (Array.isArray(value) && value.every((item) => typeof item === 'string' && validator(item)))

const requestedScopeValid = (permissions?: AdditionalPermissions) => {
  if (permissions === undefined) return true
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return false
  const value = permissions as unknown as Record<string, unknown>
  return (
    validList(value.readPaths, pathIsValid) &&
    validList(value.writePaths, pathIsValid) &&
    validList(value.networkDomains, domainIsValid)
  )
}

const addCategory = (categories: RiskCategory[], category: RiskCategory) => {
  if (!categories.includes(category)) categories.push(category)
}

const riskForCategories = (categories: readonly RiskCategory[]): ShellRiskLevel => {
  if (
    categories.includes('credential_exfiltration') ||
    categories.includes('destructive') ||
    categories.includes('resource_exhaustion')
  )
    return 'critical'
  if (
    categories.includes('credential_access') ||
    categories.includes('system_modification') ||
    categories.includes('security_control') ||
    categories.includes('privilege_escalation') ||
    categories.includes('persistence') ||
    categories.includes('irreversible_change') ||
    categories.includes('scope_escape')
  )
    return 'high'
  if (categories.length > 0) return 'medium'
  return 'low'
}

const actionForRule = (policy: RulePolicy, securityLevel: ShellSecurityLevel) => {
  if (policy === 'always-deny') return 'deny' as const
  if (policy === 'deny-through-balanced') {
    return securityLevel === 'relaxed' ? ('review' as const) : ('deny' as const)
  }
  return securityLevel === 'strict' ? ('deny' as const) : ('review' as const)
}

const networkSegments = (segments: readonly ShellCommandSegment[]) =>
  segments.filter(
    (segment) => segment.executable !== null && NETWORK_EXFIL_EXECUTABLES.has(segment.executable),
  )

const readsSensitiveMaterial = (segment: ShellCommandSegment) =>
  segment.executable !== null &&
  SENSITIVE_READ_EXECUTABLES.has(segment.executable) &&
  SENSITIVE_MARKER.test(segment.text)

const hasExplicitCredentialFlow = (
  segments: readonly ShellCommandSegment[],
  sinks: readonly ShellCommandSegment[],
) =>
  sinks.some((sink) => {
    if (SENSITIVE_ENV_REFERENCE.test(sink.text) || SENSITIVE_UPLOAD_ARGUMENT.test(sink.text))
      return true
    const sinkIndex = segments.indexOf(sink)
    return (
      sink.separatorBefore === '|' &&
      sinkIndex > 0 &&
      readsSensitiveMaterial(segments[sinkIndex - 1]!)
    )
  })

const extractsSystemCredential = (segments: readonly ShellCommandSegment[]) =>
  segments.some((segment) => {
    const executable = segment.executable
    if (!executable) return false
    if (
      CREDENTIAL_TOOL_A_EXECUTABLE.test(executable) ||
      CREDENTIAL_TOOL_B_EXECUTABLE.test(executable)
    )
      return true
    if (CREDENTIAL_DUMP_EXECUTABLE.test(executable) && /\bl[s]ass(?:\.exe)?\b/i.test(segment.text))
      return true
    if (executable === 'rundll32' && /\b(?:comsvcs\.dll|keymgr\.dll)\b/i.test(segment.text))
      return true
    if (executable === 'reg' && /\bsave\b[\s\S]*\b(?:sam|security|system)\b/i.test(segment.text))
      return true
    if (executable === 'vaultcmd' && /\blistcreds\b/i.test(segment.text)) return true
    if (
      SENSITIVE_READ_EXECUTABLES.has(executable) &&
      /[\\/](?:login data|cookies|local state)\b/i.test(segment.text)
    )
      return true
    return (
      (executable === 'powershell' || executable === 'pwsh') &&
      /\b(?:m[i]m[i]k[a]tz|s[e]k[u]rls[a]|p[r]ocd[u]mp[\s\S]*l[s]ass|comsvcs\.dll)\b/i.test(
        segment.text,
      )
    )
  })

const createsReverseShell = (segments: readonly ShellCommandSegment[]) =>
  segments.some(
    (segment) =>
      segment.executable !== null &&
      ['nc', 'ncat', 'netcat'].includes(segment.executable) &&
      /(?:^|\s)-e(?:\s|$)/i.test(segment.text),
  )

const downloadsAndExecutes = (
  segments: readonly ShellCommandSegment[],
  network: readonly ShellCommandSegment[],
) =>
  segments.some(
    (segment, index) =>
      segment.separatorBefore === '|' &&
      segment.executable !== null &&
      SHELL_EXECUTABLES.has(segment.executable) &&
      index > 0 &&
      network.includes(segments[index - 1]!) &&
      segments[index - 1]!.executable !== null &&
      DOWNLOAD_EXECUTABLES.has(segments[index - 1]!.executable!),
  ) ||
  segments.some(
    (segment) =>
      (segment.executable === 'iex' || segment.executable === 'invoke-expression') &&
      /\b(?:downloadstring|downloadfile|new-object\s+net\.webclient)\b/i.test(segment.text),
  )

export const analyzeShellRisk = (input: ShellReviewInput): ShellRiskAnalysis => {
  const rawCommand = (input as unknown as { command?: unknown }).command
  const command = typeof rawCommand === 'string' ? rawCommand.trim() : ''
  const invalidCommand = typeof rawCommand !== 'string' || command.length === 0
  const securityLevel = normalizeShellSecurityLevel(input.securityLevel)
  const categories: RiskCategory[] = []
  const matchedRules: string[] = []
  const denyReasons: string[] = []
  const reviewReasons: string[] = []

  const recordRule = (rule: Omit<RiskRule, 'pattern'>) => {
    addCategory(categories, rule.category)
    matchedRules.push(rule.name)
    if (actionForRule(rule.policy, securityLevel) === 'deny') denyReasons.push(rule.reason)
    else reviewReasons.push(rule.reason)
  }
  for (const rule of RISK_RULES.filter((candidate) => candidate.pattern.test(command))) {
    recordRule(rule)
  }

  const segments = shellCommandSegments(command)
  const network = segments.filter(
    (segment) => segment.executable !== null && NETWORK_EXECUTABLES.has(segment.executable),
  )
  const exfilSinks = networkSegments(segments)
  if (network.length > 0) addCategory(categories, 'network_access')

  if (createsReverseShell(segments)) {
    recordRule({
      name: 'reverse-shell',
      category: 'persistence',
      policy: 'always-deny',
      reason: '检测到反向 Shell',
    })
  }
  if (downloadsAndExecutes(segments, network)) {
    recordRule({
      name: 'download-and-execute',
      category: 'persistence',
      policy: 'strict-only',
      reason: '检测到下载后直接执行脚本或载荷',
    })
  }
  if (extractsSystemCredential(segments)) {
    recordRule({
      name: 'credential-extraction',
      category: 'credential_access',
      policy: 'always-deny',
      reason: '检测到从系统进程、注册表或浏览器凭据存储提取秘密',
    })
  }

  if (exfilSinks.length > 0 && SENSITIVE_MARKER.test(command)) {
    addCategory(categories, 'credential_exfiltration')
    const explicit = hasExplicitCredentialFlow(segments, exfilSinks)
    const name = explicit ? 'credential-exfiltration-explicit' : 'credential-exfiltration-suspected'
    matchedRules.push(name)
    const reason = explicit
      ? '检测到普通秘密数据流向网络命令'
      : '命令同时包含敏感内容与网络访问，需要进一步确认'
    const deny = explicit ? securityLevel !== 'relaxed' : securityLevel === 'strict'
    if (deny) denyReasons.push(reason)
    else reviewReasons.push(reason)
  }

  if (INFRASTRUCTURE_COMMAND.test(command)) addCategory(categories, 'unknown_infrastructure')
  if (PROMPT_INJECTION.test(command)) addCategory(categories, 'prompt_injection')
  if (OBFUSCATED_COMMAND.test(command)) addCategory(categories, 'obfuscation')
  if (IRREVERSIBLE_CHANGE.test(command)) addCategory(categories, 'irreversible_change')
  const externalStateDestruction = matchesExternalStateDestruction(command)
  if (externalStateDestruction) {
    addCategory(categories, 'destructive')
    matchedRules.push('external-state-destruction')
    // Never hard-deny: deleting a remote repository or branch is a legitimate
    // request, but the host must always ask before touching state that no
    // local checkout can restore.
    reviewReasons.push('检测到删除远程仓库、分支、发布或其他不可本地恢复的外部状态')
  }
  // Without a workspace root the host cannot tell whether an absolute path is
  // in or out of scope; the caller must pass it so escapes are detectable.
  const workspaceExternal = referencesWorkspaceExternalPath(input, command)
  if (workspaceExternal) {
    addCategory(categories, 'scope_escape')
    reviewReasons.push('命令或 cwd 指向工作区外路径')
  }

  const scopeValid = requestedScopeValid(input.additionalPermissions)
  if (!scopeValid) addCategory(categories, 'scope_escape')

  const hardDenied = invalidCommand || denyReasons.length > 0 || !scopeValid
  const requiresApproval = !hardDenied && reviewReasons.length > 0
  const risk = hardDenied ? 'critical' : riskForCategories(categories)
  const reason = invalidCommand
    ? 'Shell command 缺失或为空，命令已拒绝'
    : (denyReasons[0] ??
      (!scopeValid
        ? '申请的额外权限范围无效或过于宽泛'
        : (reviewReasons[0] ??
          (categories.length > 0
            ? '命令包含需要审核的风险特征'
            : '未发现静态灾难级特征'))))

  return {
    hardDenied,
    requiresApproval,
    destructive:
      externalStateDestruction ||
      workspaceExternal ||
      categories.includes('destructive') ||
      categories.includes('irreversible_change'),
    securityLevel,
    risk,
    categories,
    requestedScopeValid: scopeValid,
    matchedRules,
    reason,
  }
}
