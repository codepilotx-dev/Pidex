import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { ApprovalRequest } from '@pidex/shared/thread'
import type { ConfigService, ConfigValue } from '../config/ConfigService'
import { AgentError, type ToolInvocation } from '../Domain'
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
      if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(domain)) return []
      kind = 'network'
      target = [domain]
    }
    const subjects: Array<{ kind: ApprovalRule['kind']; target: string[]; cwd?: string }> = kind
      ? [{ kind, target, ...(cwd ? { cwd } : {}) }]
      : []
    if (permissions.networkDomains.length === 1 && kind !== 'mcp' && kind !== 'network') {
      const domain = permissions.networkDomains[0]!.toLowerCase()
      if (/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(domain))
        subjects.push({ kind: 'network', target: [domain] })
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
        invocation.permissionFacts?.ruleRequiresApproval === true
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
  private projectWorkspace(threadID: string): string {
    const descriptor = this.db.threadWorkspace(threadID)
    const project = descriptor?.kind === 'project' ? this.db.getProject(descriptor.projectID) : null
    if (!project?.rootPath) throw new AgentError('INVALID_REQUEST', '此聊天没有项目授权规则', 400)
    return resolve(project.rootPath)
  }
  async list(threadID: string) {
    const root = this.projectWorkspace(threadID)
    const rules = await this.projectRules(root)
    return {
      rules: rules.flatMap((value) =>
        isProjectRule(value, root)
          ? [{ id: value.id, kind: value.kind as 'network' | 'mcp', target: value.target }]
          : [],
      ),
    }
  }
  async revoke(threadID: string, ruleId: string) {
    const root = this.projectWorkspace(threadID)
    if (!this.config) throw new AgentError('CAPABILITY_REQUIRED', '项目配置服务不可用', 409)
    const current = await this.config.read({ cwd: root, includeLayers: true })
    const project = current.layers?.find((layer) => layer.kind === 'project')
    const rules = Array.isArray(project?.config.approval_rules) ? project.config.approval_rules : []
    const next = rules.filter((value) => !isProjectRule(value, root) || value.id !== ruleId)
    if (rules.length === next.length) return { revoked: false }
    await this.config.batchWrite({
      cwd: root,
      target: { kind: 'project' },
      ...(project ? { expectedVersion: project.version } : {}),
      edits: [{ keyPath: ['approval_rules'], value: next }],
    })
    return { revoked: true }
  }
}
