import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import {
  permissionRuleMatchKey,
  strongestPermissionRuleEffect,
  type PermissionRule,
  type PermissionRuleEffect,
  type PermissionRuleInput,
  type PermissionRuleMatch,
  type PermissionRuleScope,
  type PermissionRuleSource,
} from '@pidex/shared/thread'
import type { ApprovalRequest } from '@pidex/shared/thread'
import { ConfigServiceError, type ConfigService, type ConfigValue } from '../config/ConfigService'
import { AgentError, type ToolInvocation, type ToolRuleTargets } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { ToolRegistry } from '../tool/ToolRegistry'
import { requestedPermissions } from './PermissionDecisionEngine'

export type ApprovalRule = {
  id: string
  kind: 'command' | 'files' | 'network' | 'mcp' | 'browser'
  scope: 'session' | 'project' | 'origin' | 'all-sites'
  workspace: string
  target: string[]
  cwd?: string
}
type GrantOption = NonNullable<ApprovalRequest['grantOptions']>[number]
const literalCommandVerbs: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries({
    git: 'status diff log show add commit push fetch pull checkout switch restore reset clean branch tag merge rebase rev-parse ls-files reflog',
    bun: 'install add remove update test outdated',
    npm: 'install uninstall update list ls outdated audit info view pack publish version',
    pnpm: 'install add remove update list ls outdated audit info view pack publish',
    yarn: 'install add remove up upgrade list outdated info pack publish',
    cargo: 'build check test bench clean update fetch metadata tree doc fmt clippy publish',
    dotnet: 'build restore test pack publish clean list new',
    go: 'build test clean fmt vet list get mod work version env',
  }).map(([program, verbs]) => [program, new Set(verbs.split(' '))]),
)

const isProjectRule = (value: unknown, workspace: string): value is ApprovalRule => {
  if (!value || typeof value !== 'object') return false
  const rule = value as ApprovalRule
  return (
    typeof rule.id === 'string' &&
    rule.scope === 'project' &&
    rule.workspace === workspace &&
    (rule.kind === 'network' || rule.kind === 'mcp') &&
    Array.isArray(rule.target) &&
    rule.target.length === (rule.kind === 'network' ? 1 : 2) &&
    rule.target.every((part) => typeof part === 'string')
  )
}

/** Deliberately accepts only literal argv; shell syntax and script runners have no prefix grant. */
export function simpleCommandArgv(command: string): string[] | null {
  if (!command.trim() || /[;&|<>$`%!\r\n(){}\[\]*?]/u.test(command)) return null
  const tokens = command.match(/(?:^|\s+)(?:"[^"\\]*"|'[^']*'|[^\s"']+)(?=\s|$)/gu)
  if (!tokens || tokens.join(' ').replace(/\s+/gu, '') !== command.replace(/\s+/gu, '')) return null
  const argv = tokens.map((token) => token.trim().replace(/^(["'])(.*)\1$/u, '$2'))
  const program = argv[0]?.toLowerCase().replace(/\.exe$/u, '') ?? ''
  if (!argv[1] || !literalCommandVerbs[program]?.has(argv[1])) return null
  return argv
}

export function commandPrefixMatches(prefix: readonly string[], argv: readonly string[]): boolean {
  return prefix.length <= argv.length && prefix.every((argument, index) => argument === argv[index])
}

const NETWORK_DOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u

const isRuleMatch = (value: unknown): value is PermissionRuleMatch => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const match = value as Record<string, unknown>
  switch (match.kind) {
    case 'tool':
      return typeof match.tool === 'string' && match.tool.length > 0
    case 'file':
      return (
        (match.access === 'read' || match.access === 'write') &&
        typeof match.path === 'string' &&
        match.path.length > 0
      )
    case 'command':
      return (
        typeof match.command === 'string' &&
        match.command.length > 0 &&
        (match.argv === undefined ||
          (Array.isArray(match.argv) &&
            match.argv.length > 0 &&
            match.argv.every((item) => typeof item === 'string')))
      )
    case 'network':
      return typeof match.domain === 'string' && NETWORK_DOMAIN.test(match.domain.toLowerCase())
    case 'mcp':
      return (
        typeof match.server === 'string' &&
        match.server.length > 0 &&
        (match.tool === undefined || (typeof match.tool === 'string' && match.tool.length > 0))
      )
    default:
      return false
  }
}

const isStoredRule = (
  value: unknown,
): value is {
  id: string
  effect: PermissionRuleEffect
  match: PermissionRuleMatch
  scope?: PermissionRuleScope
  createdAt?: number
} & Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const rule = value as Record<string, unknown>
  return (
    typeof rule.id === 'string' &&
    rule.id.length > 0 &&
    (rule.effect === 'allow' || rule.effect === 'ask' || rule.effect === 'deny') &&
    isRuleMatch(rule.match)
  )
}

const canonicalToolName = (invocation: ToolInvocation) =>
  invocation.toolPolicy?.sdkName ?? invocation.name

const originTargets = (invocation: ToolInvocation) => {
  const origin = invocation.toolPolicy?.origin
  return origin?.kind === 'mcp'
    ? { server: origin.serverName, tool: origin.rawToolName }
    : undefined
}

/**
 * Pure subject matching for a permission rule. Paths and argv must come from
 * host-resolved facts; model arguments never establish a file or command
 * subject on their own.
 */
export function permissionRuleMatches(
  match: PermissionRuleMatch,
  invocation: ToolInvocation,
  targets?: ToolRuleTargets,
): boolean {
  switch (match.kind) {
    case 'tool':
      return canonicalToolName(invocation) === match.tool
    case 'file': {
      const paths =
        match.access === 'read' ? targets?.readPaths : targets?.writePaths
      if (!paths?.length) return false
      const normalizedRule = resolve(match.path)
      // Every observed target must be inside the rule scope. A patch touching
      // several files is never partially covered by a narrower allow rule.
      return paths.every((candidate) => pathContainsNormalized(normalizedRule, candidate))
    }
    case 'command': {
      const command = targets?.command ?? invocation.input.command
      if (typeof command !== 'string') return false
      if (match.argv?.length) {
        // An explicit host `null` means the command is complex; only the exact
        // command form may match, never an argv prefix.
        const argv = targets?.argv !== undefined ? targets.argv : simpleCommandArgv(command)
        return Boolean(argv && commandPrefixMatches(match.argv, argv))
      }
      return command.trim() === match.command.trim()
    }
    case 'network': {
      const domains =
        targets?.networkDomains ??
        requestedPermissions(invocation.input).networkDomains.map((domain) =>
          domain.trim().toLowerCase(),
        )
      return domains.some((domain) => domain.trim().toLowerCase() === match.domain.toLowerCase())
    }
    case 'mcp': {
      const origin = originTargets(invocation)
      if (!origin || origin.server !== match.server) return false
      return match.tool === undefined || match.tool === origin.tool
    }
  }
}

const pathContainsNormalized = (parent: string, candidate: string) => {
  const key = (value: string) => {
    const normalized = resolve(value).replace(/[\\/]+$/u, '')
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }
  const parentKey = key(parent)
  const candidateKey = key(candidate)
  return candidateKey === parentKey || candidateKey.startsWith(`${parentKey}\\`) ||
    candidateKey.startsWith(`${parentKey}/`)
}

export type PermissionRuleFacts = {
  effect: PermissionRuleEffect | null
  ids: string[]
  matches: PermissionRule[]
}

const EMPTY_RULE_FACTS: PermissionRuleFacts = { effect: null, ids: [], matches: [] }

const ruleFromLayer = (
  value: unknown,
  source: PermissionRuleSource,
  scope: PermissionRuleScope,
  version: string,
): PermissionRule | null => {
  if (!isStoredRule(value)) return null
  if (value.scope !== undefined && value.scope !== scope) return null
  return {
    id: value.id,
    effect: value.effect,
    scope,
    source,
    match: value.match,
    editable: true,
    version,
    ...(typeof value.createdAt === 'number' ? { createdAt: value.createdAt } : {}),
  }
}

const layerRules = (
  value: unknown,
  source: PermissionRuleSource,
  scope: PermissionRuleScope,
  version: string,
): PermissionRule[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        const rule = ruleFromLayer(entry, source, scope, version)
        return rule ? [rule] : []
      })
    : []

const legacyGrantMatch = (
  rule: ApprovalRule,
  workspaceRoot: string,
): PermissionRuleMatch | null => {
  switch (rule.kind) {
    case 'command':
      return { kind: 'command', command: rule.target.join(' '), argv: [...rule.target] }
    case 'network':
      return rule.target[0] ? { kind: 'network', domain: rule.target[0].toLowerCase() } : null
    case 'mcp':
      return {
        kind: 'mcp',
        server: rule.target[0] ?? '',
        ...(rule.target[1] ? { tool: rule.target[1] } : {}),
      }
    case 'files':
      return { kind: 'file', access: 'write', path: workspaceRoot }
    case 'browser':
      return null
  }
}

/**
 * Owns the legacy approval-grant candidates, the new Allow/Ask/Deny rule
 * catalog and the host rule facts consumed by the pure decision engine.
 */
export class ApprovalRules {
  constructor(
    private readonly db: AgentDatabase,
    private readonly tools: ToolRegistry,
    private readonly config?: ConfigService,
  ) {}

  workspace(invocation: ToolInvocation): { root: string; project: boolean } | null {
    const descriptor = this.db.threadWorkspace(invocation.threadID)
    if (!descriptor) return null
    if (descriptor.kind === 'projectless')
      return { root: resolve(descriptor.workspaceRoot), project: false }
    const project = this.db.getProject(descriptor.projectID)
    return project?.rootPath ? { root: resolve(project.rootPath), project: true } : null
  }

  private projectRoot(threadID: string): string | null {
    const descriptor = this.db.threadWorkspace(threadID)
    const project = descriptor?.kind === 'project' ? this.db.getProject(descriptor.projectID) : null
    return project?.rootPath ? resolve(project.rootPath) : null
  }

  private async layers(root: string | null): Promise<
    | {
        user?: { config: Record<string, unknown>; version: string }
        project?: {
          config: Record<string, unknown>
          version: string
          trusted: boolean
          root: string
        }
      }
    | null
  > {
    if (!this.config) return null
    const result = await this.config.read({
      ...(root ? { cwd: root } : {}),
      includeLayers: true,
    })
    const user = result.layers?.find((layer) => layer.kind === 'user')
    const projectLayer = result.layers?.find((layer) => layer.kind === 'project')
    const projectRoot = root
    return {
      ...(user
        ? { user: { config: user.config as Record<string, unknown>, version: user.version } }
        : {}),
      ...(projectLayer && projectRoot
        ? {
            project: {
              config: projectLayer.config as Record<string, unknown>,
              version: projectLayer.version,
              trusted: projectLayer.trusted && this.config.isProjectTrusted(projectRoot),
              root: projectRoot,
            },
          }
        : {}),
    }
  }

  /** Legacy session/project grants that can satisfy an ordinary approval. */
  candidates(invocation: ToolInvocation): ApprovalRule[] {
    if (
      invocation.grantsForbidden ||
      invocation.permissionFacts?.hookRequiresApproval ||
      invocation.name === 'request_permissions' ||
      invocation.authorizationScope?.computerApp ||
      invocation.authorizationScope?.browserOrigin
    )
      return []
    const workspace = this.workspace(invocation)
    if (!workspace) return []
    const permissions = requestedPermissions(invocation.input)
    if (
      permissions.readPaths.length ||
      permissions.writePaths.length ||
      permissions.networkDomains.length > 1
    )
      return []
    const tool = invocation.toolPolicy ?? this.tools.get(invocation.name)
    let kind: ApprovalRule['kind'] | undefined
    let target: string[] = []
    let cwd: string | undefined
    if (tool.origin?.kind === 'mcp') {
      kind = 'mcp'
      target = [tool.origin.serverName, tool.origin.rawToolName]
    } else if (typeof invocation.input.command === 'string') {
      const argv = simpleCommandArgv(invocation.input.command)
      if (argv) {
        kind = 'command'
        target = argv.slice(0, 2)
        cwd = resolve(
          typeof invocation.input.cwd === 'string' ? invocation.input.cwd : workspace.root,
        )
      }
    } else if (
      ['Write', 'Edit', 'apply_patch'].includes(invocation.name) &&
      !Object.values(permissions).some((values) => values.length)
    ) {
      kind = 'files'
    } else if (
      !tool.capabilities.process &&
      !tool.capabilities.externalState &&
      permissions.networkDomains.length === 1 &&
      !permissions.readPaths.length &&
      !permissions.writePaths.length
    ) {
      const domain = permissions.networkDomains[0]!.toLowerCase()
      if (!NETWORK_DOMAIN.test(domain)) return []
      kind = 'network'
      target = [domain]
    }
    const subjects: Array<{ kind: ApprovalRule['kind']; target: string[]; cwd?: string }> = kind
      ? [{ kind, target, ...(cwd ? { cwd } : {}) }]
      : []
    if (permissions.networkDomains.length === 1 && kind !== 'mcp' && kind !== 'network') {
      const domain = permissions.networkDomains[0]!.toLowerCase()
      if (NETWORK_DOMAIN.test(domain)) subjects.push({ kind: 'network', target: [domain] })
    }
    return subjects.flatMap((subject) => {
      const scopes: ApprovalRule['scope'][] =
        subject.kind === 'network' || subject.kind === 'mcp'
          ? [
              'session',
              ...(workspace.project && this.config?.isProjectTrusted(workspace.root)
                ? ['project' as const]
                : []),
            ]
          : ['session']
      return scopes.map((scope) => {
        const data = { ...subject, scope, workspace: workspace.root }
        return { ...data, id: createHash('sha256').update(JSON.stringify(data)).digest('hex') }
      })
    })
  }

  options(invocation: ToolInvocation): GrantOption[] {
    return this.candidates(invocation).map((rule) => ({
      id: rule.id,
      kind: rule.kind,
      scope: rule.scope,
      label:
        rule.kind === 'command'
          ? `此聊天允许类似命令：${rule.target.join(' ')}`
          : rule.kind === 'files'
            ? '此聊天允许后续文件修改'
            : `${rule.scope === 'project' ? '此项目始终允许' : '此聊天允许'} ${rule.target.join(' / ')}`,
    }))
  }

  async projectRules(root: string): Promise<unknown[]> {
    if (!this.config) return []
    const result = await this.config.read({ cwd: root, includeLayers: true })
    const project = result.layers?.find((layer) => layer.kind === 'project' && layer.trusted)
    return Array.isArray(project?.config.approval_rules) ? project.config.approval_rules : []
  }

  async matches(invocation: ToolInvocation): Promise<boolean> {
    const candidates = this.candidates(invocation)
    if (!candidates.length) return false
    const session = this.db.repositories.interactions.resolvedApprovalGrantRules(
      invocation.threadID,
    )
    const project = await this.projectRules(candidates[0]!.workspace)
    const matches = (candidate: ApprovalRule) =>
      [...session, ...project].some((value) => {
        if (!value || typeof value !== 'object') return false
        const rule = value as ApprovalRule
        if (
          candidate.kind !== rule.kind ||
          candidate.scope !== rule.scope ||
          candidate.workspace !== rule.workspace
        )
          return false
        if (rule.kind === 'command') {
          const argv = simpleCommandArgv(String(invocation.input.command))
          return (
            rule.cwd === candidate.cwd &&
            !!argv &&
            Array.isArray(rule.target) &&
            commandPrefixMatches(rule.target, argv)
          )
        }
        return (
          candidate.id === rule.id &&
          Array.isArray(rule.target) &&
          candidate.target.length === rule.target.length &&
          candidate.target.every((argument, index) => argument === rule.target[index])
        )
      })
    const kinds = new Set(candidates.map((candidate) => candidate.kind))
    if (
      typeof invocation.input.command === 'string' &&
      requestedPermissions(invocation.input).networkDomains.length
    ) {
      const commandRequired =
        invocation.permissionConfig.approvalPolicy === 'untrusted' ||
        (invocation.toolPolicy ?? this.tools.get(invocation.name)).approvalStrategy ===
          'always-review' ||
        invocation.permissionFacts?.ruleRequiresApproval === true ||
        invocation.permissionFacts?.destructive === true
      if (commandRequired && !kinds.has('command')) return false
      if (!commandRequired) kinds.delete('command')
      if (!kinds.has('network')) return false
    }
    return (
      kinds.size > 0 &&
      [...kinds].every((kind) =>
        candidates.some((candidate) => candidate.kind === kind && matches(candidate)),
      )
    )
  }

  validate(invocation: ToolInvocation, id: string): ApprovalRule {
    const rule = this.candidates(invocation).find((candidate) => candidate.id === id)
    if (!rule) throw new AgentError('INVALID_REQUEST', '此请求不支持所选授权范围', 400)
    return rule
  }

  async persistProject(rule: ApprovalRule): Promise<void> {
    if (rule.scope !== 'project' || !this.config) return
    const result = await this.config.read({ cwd: rule.workspace, includeLayers: true })
    const layer = result.layers?.find((candidate) => candidate.kind === 'project')
    const rules = Array.isArray(layer?.config.approval_rules) ? layer.config.approval_rules : []
    await this.config.batchWrite({
      cwd: rule.workspace,
      target: { kind: 'project' },
      ...(layer ? { expectedVersion: layer.version } : {}),
      edits: [
        {
          keyPath: ['approval_rules'],
          value: [
            ...rules.filter(
              (value) => !isProjectRule(value, rule.workspace) || value.id !== rule.id,
            ),
            rule,
          ] as ConfigValue,
        },
      ],
    })
  }

  /** Full rule catalog shown by every client: user, project, chat and legacy. */
  async list(threadID: string): Promise<{ rules: PermissionRule[] }> {
    const root = this.projectRoot(threadID)
    const layers = await this.layers(root)
    const threadWorkspace = this.workspace({
      threadID,
      permissionConfig: {},
    } as unknown as ToolInvocation)
    const rules: PermissionRule[] = [
      ...layerRules(layers?.user?.config.permission_rules, 'user', 'user', layers?.user?.version ?? ''),
      ...(layers?.project?.trusted
        ? layerRules(
            layers.project.config.permission_rules,
            'project',
            'project',
            layers.project.version,
          )
        : []),
    ]
    const repositories = this.db.repositories.permissionRules
    for (const rule of repositories.listChatRules(threadID)) {
      rules.push({
        id: rule.id,
        effect: rule.effect,
        scope: 'chat',
        source: 'chat',
        match: rule.match,
        editable: true,
        version: String(rule.version),
        createdAt: rule.createdAt,
      })
    }
    if (root && layers?.project?.trusted) {
      for (const value of await this.projectRules(root)) {
        if (!isProjectRule(value, root)) continue
        const match: PermissionRuleMatch | null =
          value.kind === 'network'
            ? value.target[0]
              ? { kind: 'network', domain: value.target[0].toLowerCase() }
              : null
            : {
                kind: 'mcp',
                server: value.target[0] ?? '',
                ...(value.target[1] ? { tool: value.target[1] } : {}),
              }
        if (!match) continue
        rules.push({
          id: value.id,
          effect: 'allow',
          scope: 'project',
          source: 'legacy',
          match,
          editable: true,
        })
      }
    }
    const revoked = repositories.revokedLegacyGrantIDs(threadID)
    for (const value of this.db.repositories.interactions.resolvedApprovalGrantRules(threadID)) {
      if (!value || typeof value !== 'object') continue
      const rule = value as ApprovalRule
      if (revoked.has(rule.id)) continue
      const match = legacyGrantMatch(rule, threadWorkspace?.root ?? '')
      if (!match) continue
      rules.push({
        id: rule.id,
        effect: 'allow',
        scope: 'chat',
        source: 'legacy',
        match,
        editable: true,
      })
    }
    return { rules }
  }

  private normalizeMatch(match: PermissionRuleMatch): PermissionRuleMatch {
    switch (match.kind) {
      case 'tool': {
        let known = false
        try {
          known = Boolean(this.tools.get(match.tool))
        } catch {
          known = false
        }
        if (!known) throw new AgentError('INVALID_REQUEST', `未注册的工具：${match.tool}`, 400)
        return { kind: 'tool', tool: match.tool }
      }
      case 'file': {
        if (!isAbsolute(match.path))
          throw new AgentError('INVALID_REQUEST', '文件规则必须使用宿主解析后的绝对路径', 400)
        return { kind: 'file', access: match.access, path: resolve(match.path) }
      }
      case 'command': {
        const command = match.command.trim()
        if (!command) throw new AgentError('INVALID_REQUEST', '命令规则不能为空', 400)
        const parsed = simpleCommandArgv(command)
        if (match.argv?.length) {
          if (!parsed || !commandPrefixMatches(match.argv, parsed))
            throw new AgentError('INVALID_REQUEST', '命令前缀必须来自安全 argv', 400)
          return { kind: 'command', command, argv: [...match.argv] }
        }
        return { kind: 'command', command }
      }
      case 'network': {
        const domain = match.domain.trim().toLowerCase()
        if (!NETWORK_DOMAIN.test(domain))
          throw new AgentError('INVALID_REQUEST', '网络规则只支持精确域名', 400)
        return { kind: 'network', domain }
      }
      case 'mcp': {
        const servers = this.tools.all().flatMap((tool) =>
          tool.origin?.kind === 'mcp'
            ? [{ server: tool.origin.serverName, tool: tool.origin.rawToolName }]
            : [],
        )
        const serverKnown = servers.some((entry) => entry.server === match.server)
        if (!serverKnown)
          throw new AgentError('INVALID_REQUEST', `未注册的 MCP 服务器：${match.server}`, 400)
        if (match.tool && !servers.some((entry) => entry.server === match.server && entry.tool === match.tool))
          throw new AgentError('INVALID_REQUEST', `未注册的 MCP 工具：${match.tool}`, 400)
        return {
          kind: 'mcp',
          server: match.server,
          ...(match.tool ? { tool: match.tool } : {}),
        }
      }
    }
  }

  async upsert(
    threadID: string,
    input: PermissionRuleInput,
    expectedVersion?: string,
  ): Promise<PermissionRule> {
    const match = this.normalizeMatch(input.match)
    const root = this.projectRoot(threadID)
    if (input.scope === 'chat') {
      const rule = this.db.repositories.permissionRules.upsertChatRule({
        threadID,
        ...(input.id ? { id: input.id } : {}),
        effect: input.effect,
        match,
        ...(expectedVersion ? { expectedVersion } : {}),
      })
      return {
        id: rule.id,
        effect: rule.effect,
        scope: 'chat',
        source: 'chat',
        match: rule.match,
        editable: true,
        version: String(rule.version),
        createdAt: rule.createdAt,
      }
    }
    if (!this.config)
      throw new AgentError('CAPABILITY_REQUIRED', '项目配置服务不可用，无法保存持久规则', 409)
    const layers = await this.layers(root)
    if (input.scope === 'project' && !layers?.project?.trusted)
      throw new AgentError('CONFIG_PROJECT_UNTRUSTED', '项目配置尚未信任，不能保存项目规则', 409)
    const layer = input.scope === 'user' ? layers?.user : layers?.project
    if (!layer)
      throw new AgentError('CAPABILITY_REQUIRED', '配置层不可用，无法保存规则', 409)
    const raw = Array.isArray(layer.config.permission_rules) ? layer.config.permission_rules : []
    const id = input.id ?? `permission-rule:${crypto.randomUUID()}`
    const existingIndex = raw.findIndex((value) => isStoredRule(value) && value.id === id)
    if (input.id && existingIndex < 0)
      throw new AgentError('CONFLICT', '规则已被删除，请刷新后重试', 409)
    if (expectedVersion && expectedVersion !== layer.version)
      throw new AgentError('CONFLICT', '规则版本已变化，请刷新后重试', 409)
    const now = Date.now()
    const createdAt =
      existingIndex >= 0 && typeof (raw[existingIndex] as { createdAt?: unknown }).createdAt === 'number'
        ? ((raw[existingIndex] as { createdAt: number }).createdAt ?? now)
        : now
    const nextValue: ConfigValue = {
      id,
      effect: input.effect,
      scope: input.scope,
      match: match as unknown as ConfigValue,
      createdAt,
    }
    const next =
      existingIndex >= 0
        ? raw.map((value, index) =>
            index === existingIndex
              ? ({ ...(value as Record<string, unknown>), ...(nextValue as Record<string, unknown>) } as ConfigValue)
              : (value as ConfigValue),
          )
        : [...raw, nextValue]
    const result = await this.writeLayer(input.scope, root, next, layer.version)
    return {
      id,
      effect: input.effect,
      scope: input.scope,
      source: input.scope,
      match,
      editable: true,
      version: result.version,
      createdAt,
    }
  }

  private async writeLayer(
    scope: 'user' | 'project',
    root: string | null,
    rules: ConfigValue,
    expectedVersion: string,
  ): Promise<{ version: string }> {
    if (!this.config) throw new AgentError('CAPABILITY_REQUIRED', '配置服务不可用', 409)
    try {
      const result = await this.config.batchWrite({
        ...(scope === 'project' && root ? { cwd: root } : {}),
        target: { kind: scope },
        expectedVersion,
        edits: [{ keyPath: ['permission_rules'], value: rules }],
      })
      return { version: result.version }
    } catch (cause) {
      if (cause instanceof ConfigServiceError) {
        if (cause.code === 'CONFIG_VERSION_CONFLICT')
          throw new AgentError('CONFLICT', '权限规则版本已变化，请刷新后重试', 409)
        throw new AgentError(
          cause.code === 'CONFIG_PROJECT_UNTRUSTED' ? cause.code : 'INVALID_REQUEST',
          cause.message,
          cause.code === 'CONFIG_PROJECT_UNTRUSTED' ? 409 : 400,
        )
      }
      throw cause
    }
  }

  async revoke(
    threadID: string,
    ruleId: string,
    expectedVersion?: string,
  ): Promise<{ revoked: boolean }> {
    const repositories = this.db.repositories.permissionRules
    if (repositories.revokeChatRule(threadID, ruleId, expectedVersion)) return { revoked: true }
    const root = this.projectRoot(threadID)
    const layers = await this.layers(root)
    for (const scope of ['user', 'project'] as const) {
      const layer = scope === 'user' ? layers?.user : layers?.project
      if (!layer) continue
      if (scope === 'project' && !layers?.project?.trusted) continue
      const raw = Array.isArray(layer.config.permission_rules)
        ? layer.config.permission_rules
        : []
      const index = raw.findIndex((value) => isStoredRule(value) && value.id === ruleId)
      if (index < 0) continue
      if (expectedVersion && expectedVersion !== layer.version)
        throw new AgentError('CONFLICT', '规则版本已变化，请刷新后重试', 409)
      await this.writeLayer(
        scope,
        root,
        raw.filter((_, candidate) => candidate !== index) as ConfigValue,
        layer.version,
      )
      return { revoked: true }
    }
    if (root && layers?.project?.trusted) {
      const legacy = await this.projectRules(root)
      const index = legacy.findIndex((value) => isProjectRule(value, root) && value.id === ruleId)
      if (index >= 0) {
        await this.writeLegacyProjectRules(
          root,
          legacy.filter((_, candidate) => candidate !== index) as ConfigValue[],
        )
        return { revoked: true }
      }
    }
    const sessionRule = this.db.repositories.interactions
      .resolvedApprovalGrantRules(threadID)
      .find((value) => value && typeof value === 'object' && (value as ApprovalRule).id === ruleId)
    if (!sessionRule) return { revoked: false }
    if (!repositories.availableTables().revocations)
      throw new AgentError('CAPABILITY_REQUIRED', '当前数据库缺少旧授权撤销存储', 409)
    repositories.revokeLegacyGrant(threadID, ruleId)
    return { revoked: true }
  }

  private async writeLegacyProjectRules(root: string, rules: ConfigValue[]): Promise<void> {
    if (!this.config) throw new AgentError('CAPABILITY_REQUIRED', '配置服务不可用', 409)
    const current = await this.config.read({ cwd: root, includeLayers: true })
    const layer = current.layers?.find((candidate) => candidate.kind === 'project')
    await this.config.batchWrite({
      cwd: root,
      target: { kind: 'project' },
      ...(layer ? { expectedVersion: layer.version } : {}),
      edits: [{ keyPath: ['approval_rules'], value: rules as ConfigValue }],
    })
  }

  /** A newly approved legacy grant supersedes an earlier revocation. */
  restoreLegacyGrant(threadID: string, ruleId: string) {
    this.db.repositories.permissionRules.restoreLegacyGrant(threadID, ruleId)
  }

  /**
   * Host rule facts for the final permission evaluation. Reads the trusted
   * layers, chat rules and the host-resolved targets; the decision engine only
   * interprets the returned effect and never touches storage.
   */
  async evaluate(invocation: ToolInvocation): Promise<PermissionRuleFacts> {
    const workspace = this.workspace(invocation)
    const rules: PermissionRule[] = []
    try {
      const layers = await this.layers(workspace?.root ?? null)
      if (layers?.user)
        rules.push(
          ...layerRules(
            layers.user.config.permission_rules,
            'user',
            'user',
            layers.user.version,
          ),
        )
      if (layers?.project?.trusted)
        rules.push(
          ...layerRules(
            layers.project.config.permission_rules,
            'project',
            'project',
            layers.project.version,
          ),
        )
    } catch {
      // Unreadable configuration cannot grant anything; hard denies still apply.
    }
    if (invocation.threadID) {
      for (const rule of this.db.repositories.permissionRules.listChatRules(invocation.threadID)) {
        rules.push({
          id: rule.id,
          effect: rule.effect,
          scope: 'chat',
          source: 'chat',
          match: rule.match,
          editable: true,
          version: String(rule.version),
        })
      }
    }
    const matches = rules.filter((rule) =>
      permissionRuleMatches(rule.match, invocation, invocation.permissionFacts?.ruleTargets),
    )
    if (!matches.length) return EMPTY_RULE_FACTS
    return {
      effect: strongestPermissionRuleEffect(matches.map((rule) => rule.effect)),
      ids: matches.map((rule) => rule.id),
      matches,
    }
  }
}

export { permissionRuleMatchKey }
