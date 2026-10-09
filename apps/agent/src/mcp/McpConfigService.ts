import type { McpScope, McpServerDeclaration, McpServerListItem } from '@pidex/agent-protocol'
import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { ConfigServiceError, type ConfigService, type ConfigValue } from '../config/ConfigService'
import {
  McpSettingsConflictError,
  McpSettingsRepository,
  type McpSettingsState,
} from '../storage/repositories/McpSettingsRepository'
import { isRecord } from '@pidex/shared/guards'

const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const SENSITIVE_NAME =
  /(?:^|[_-])(authorization|cookie|password|secret|token|api[_-]?key)(?:$|[_-])/i
const STATIC_SECRET_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
])
const LOCAL_TRUST_MESSAGE =
  '项目 MCP 配置尚未信任，请前往“设置 → 配置”信任项目，或将作用域改为 user'

export type McpWorkspaceIdentity = {
  root: string
  hash: string
}

export class McpConfigError extends Error {
  constructor(
    readonly code: 'MCP_CONFIG_INVALID' | 'MCP_SERVER_NOT_FOUND' | 'PATH_DENIED' | 'CONFLICT',
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const stableFingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

const workspaceHash = (root: string) =>
  createHash('sha256').update(root.toLowerCase()).digest('hex')

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

const normalizedStrings = (values: readonly string[] | undefined) => {
  if (!values) return undefined
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

const normalizedToolPolicies = (tools: McpServerDeclaration['tools']) => {
  if (!tools) return undefined
  const normalized = Object.fromEntries(
    Object.entries(tools)
      .map(([name, policy]) => [name.trim(), policy] as const)
      .filter(([name]) => Boolean(name)),
  )
  return Object.keys(normalized).length ? normalized : undefined
}

const configLeaves = (
  value: Record<string, unknown>,
  prefix: string[],
): Array<{ keyPath: string[]; value: ConfigValue }> =>
  Object.entries(value).flatMap(([key, child]) =>
    isRecord(child)
      ? configLeaves(child, [...prefix, key])
      : [{ keyPath: [...prefix, key], value: child as ConfigValue }],
  )

export class McpConfigService {
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly repository: McpSettingsRepository,
    private readonly configService?: ConfigService,
  ) {}

  async workspace(value?: string): Promise<McpWorkspaceIdentity | null> {
    if (!value) return null
    const root = await realpath(value).catch(() => {
      throw new McpConfigError('PATH_DENIED', 'MCP 工作区不存在或无法访问', 403)
    })
    return { root, hash: workspaceHash(root) }
  }

  async list(workspace?: string): Promise<{ servers: McpServerListItem[]; generation: number }> {
    const identity = await this.workspace(workspace)
    return this.listState(await this.effectiveState(identity), identity)
  }

  async save(input: {
    workspace?: string
    originalName?: string
    server: McpServerDeclaration
    operationId: string
  }) {
    const identity = await this.workspace(input.workspace)
    const server = this.validate(input.server, identity)
    const originalName = input.originalName?.trim()
    const fingerprint = stableFingerprint({
      action: 'save',
      workspace: identity?.hash,
      originalName,
      server,
    })
    return this.enqueueMutation(async () => {
      await this.requireProjectTrustWhenLocal(server.scope, identity)
      const prepared = this.repository.prepare({
        operationId: input.operationId,
        fingerprint,
        apply: (draft) => {
          const collection = this.collection(draft, server.scope, identity, true)
          if (originalName && originalName !== server.name) delete collection[originalName]
          const changed = !same(collection[server.name], server)
          collection[server.name] = server
          return changed || Boolean(originalName && originalName !== server.name)
        },
      })
      if (!prepared.commitRequired) {
        return { ...this.listState(prepared.state, identity), changed: prepared.changed }
      }
      await this.persistServer(server, identity, originalName)
      const result = this.repository.commit(prepared)
      return { ...this.listState(result.state, identity), changed: result.changed }
    })
  }

  async remove(input: { workspace?: string; scope: McpScope; name: string; operationId: string }) {
    const identity = await this.workspace(input.workspace)
    const name = this.validateName(input.name)
    const fingerprint = stableFingerprint({
      action: 'remove',
      workspace: identity?.hash,
      scope: input.scope,
      name,
    })
    return this.enqueueMutation(async () => {
      await this.requireProjectTrustWhenLocal(input.scope, identity)
      const prepared = this.repository.prepare({
        operationId: input.operationId,
        fingerprint,
        apply: (draft) => {
          const collection = this.collection(draft, input.scope, identity, false)
          if (!collection[name])
            throw new McpConfigError('MCP_SERVER_NOT_FOUND', 'MCP server 不存在', 404)
          delete collection[name]
          return true
        },
      })
      if (!prepared.commitRequired) {
        return { ...this.listState(prepared.state, identity), changed: prepared.changed }
      }
      const before = await this.effectiveState(identity)
      const existing = this.collection(before, input.scope, identity, false)[name]
      if (!existing) throw new McpConfigError('MCP_SERVER_NOT_FOUND', 'MCP server 不存在', 404)
      await this.deleteServer(existing, identity)
      const result = this.repository.commit(prepared)
      return { ...this.listState(result.state, identity), changed: result.changed }
    })
  }

  async setEnabled(input: {
    workspace?: string
    scope: McpScope
    name: string
    enabled: boolean
    operationId: string
  }) {
    const identity = await this.workspace(input.workspace)
    const name = this.validateName(input.name)
    const fingerprint = stableFingerprint({
      action: 'setEnabled',
      workspace: identity?.hash,
      scope: input.scope,
      name,
      enabled: input.enabled,
    })
    return this.enqueueMutation(async () => {
      await this.requireProjectTrustWhenLocal(input.scope, identity)
      const prepared = this.repository.prepare({
        operationId: input.operationId,
        fingerprint,
        apply: (draft) => {
          const collection = this.collection(draft, input.scope, identity, false)
          const server = collection[name]
          if (!server) throw new McpConfigError('MCP_SERVER_NOT_FOUND', 'MCP server 不存在', 404)
          if (server.enabled === input.enabled) return false
          collection[name] = { ...server, enabled: input.enabled }
          return true
        },
      })
      if (!prepared.commitRequired) {
        return { ...this.listState(prepared.state, identity), changed: prepared.changed }
      }
      if (prepared.changed) {
        const before = await this.effectiveState(identity)
        const existing = this.collection(before, input.scope, identity, false)[name]
        if (!existing) throw new McpConfigError('MCP_SERVER_NOT_FOUND', 'MCP server 不存在', 404)
        await this.persistServer({ ...existing, enabled: input.enabled }, identity)
      }
      const result = this.repository.commit(prepared)
      return { ...this.listState(result.state, identity), changed: result.changed }
    })
  }

  generation() {
    return this.repository.state().generation
  }

  private async effectiveState(identity: McpWorkspaceIdentity | null): Promise<McpSettingsState> {
    const state = this.repository.state()
    if (!this.configService) return state
    const read = await this.configOperation(() =>
      this.configService!.read(identity ? { cwd: identity.root } : {}),
    )
    if (!isRecord(read.config.mcp_servers)) return state
    const user: Record<string, McpServerDeclaration> = {}
    const local: Record<string, McpServerDeclaration> = {}
    for (const [name, raw] of Object.entries(read.config.mcp_servers)) {
      if (!isRecord(raw)) continue
      const projectScoped = Object.entries(read.origins).some(
        ([path, origin]) => path.startsWith(`mcp_servers.${name}.`) && origin === 'project',
      )
      try {
        const declaration = this.validate(
          {
            ...raw,
            name,
            scope: projectScoped ? 'local' : 'user',
          } as McpServerDeclaration,
          identity,
        )
        ;(projectScoped ? local : user)[name] = declaration
      } catch {
        // Invalid external declarations remain diagnostics-only and are not activated.
      }
    }
    return {
      ...state,
      user,
      local: identity ? { [identity.hash]: local } : {},
    }
  }

  private target(identity: McpWorkspaceIdentity | null, scope: McpScope) {
    return scope === 'local' && identity
      ? {
          filePath: join(identity.root, '.pidex', 'config.json'),
          cwd: identity.root,
        }
      : {}
  }

  private async persistServer(
    server: McpServerDeclaration,
    identity: McpWorkspaceIdentity | null,
    originalName?: string,
  ) {
    if (!this.configService) return
    const edits = configLeaves(server as unknown as Record<string, unknown>, [
      'mcp_servers',
      server.name,
    ])
    if (originalName && originalName !== server.name) {
      const state = await this.effectiveState(identity)
      const old =
        state.user[originalName] ??
        (identity ? state.local[identity.hash]?.[originalName] : undefined)
      if (old) {
        edits.unshift(
          ...configLeaves(old as unknown as Record<string, unknown>, [
            'mcp_servers',
            originalName,
          ]).map((edit) => ({ ...edit, value: null as ConfigValue })),
        )
      }
    }
    await this.configOperation(() =>
      this.configService!.batchWrite({
        edits,
        ...this.target(identity, server.scope),
      }),
    )
  }

  private async deleteServer(server: McpServerDeclaration, identity: McpWorkspaceIdentity | null) {
    if (!this.configService) return
    await this.configOperation(() =>
      this.configService!.batchWrite({
        edits: configLeaves(server as unknown as Record<string, unknown>, [
          'mcp_servers',
          server.name,
        ]).map((edit) => ({ ...edit, value: null })),
        ...this.target(identity, server.scope),
      }),
    )
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.mutationQueue.catch(() => undefined).then(operation)
    this.mutationQueue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  private async requireProjectTrustWhenLocal(
    scope: McpScope,
    identity: McpWorkspaceIdentity | null,
  ) {
    if (scope !== 'local') return
    if (!identity) {
      throw new McpConfigError('MCP_CONFIG_INVALID', '工作区 MCP 配置需要当前工作区', 400)
    }
    if (!this.configService) return
    const trust = await this.configOperation(() => this.configService!.trustRead(identity.root))
    if (trust.trustLevel !== 'trusted') {
      throw new McpConfigError('PATH_DENIED', LOCAL_TRUST_MESSAGE, 403)
    }
  }

  private async configOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (cause) {
      if (!(cause instanceof ConfigServiceError)) throw cause
      switch (cause.code) {
        case 'CONFIG_PROJECT_UNTRUSTED':
          throw new McpConfigError('PATH_DENIED', LOCAL_TRUST_MESSAGE, 403)
        case 'CONFIG_LAYER_READONLY':
        case 'CONFIG_PATH_NOT_FOUND':
          throw new McpConfigError(
            'PATH_DENIED',
            'MCP 配置路径不可写，请检查工作区或将作用域改为 user',
            403,
          )
        case 'CONFIG_VERSION_CONFLICT':
          throw new McpConfigError('CONFLICT', 'MCP 配置已被其他操作更新，请重试', 409)
        case 'CONFIG_VALIDATION_ERROR':
        case 'CONFIG_PROFILE_INVALID':
          throw new McpConfigError('MCP_CONFIG_INVALID', 'MCP 配置无效，请检查设置后重试', 400)
        case 'CONFIG_PROFILE_NOT_FOUND':
          throw new McpConfigError('PATH_DENIED', 'Profile 配置不存在', 404)
      }
    }
  }

  private listState(state: McpSettingsState, workspace: McpWorkspaceIdentity | null) {
    const user = Object.values(state.user).sort((left, right) =>
      left.name.localeCompare(right.name),
    )
    const local = workspace
      ? Object.values(state.local[workspace.hash] ?? {}).sort((left, right) =>
          left.name.localeCompare(right.name),
        )
      : []
    const localNames = new Set(local.map((server) => server.name))
    return {
      servers: [
        ...user.map((server): McpServerListItem =>
          localNames.has(server.name)
            ? { server, effective: false, shadowedByScope: 'local' }
            : { server, effective: true },
        ),
        ...local.map((server): McpServerListItem => ({ server, effective: true })),
      ],
      generation: state.generation,
    }
  }

  private collection(
    state: McpSettingsState,
    scope: McpScope,
    workspace: McpWorkspaceIdentity | null,
    create: boolean,
  ): Record<string, McpServerDeclaration> {
    if (scope === 'user') return state.user
    if (!workspace)
      throw new McpConfigError('MCP_CONFIG_INVALID', '工作区 MCP 配置需要当前工作区', 400)
    if (!state.local[workspace.hash] && create) state.local[workspace.hash] = {}
    return state.local[workspace.hash] ?? {}
  }

  private validate(
    server: McpServerDeclaration,
    workspace: McpWorkspaceIdentity | null,
  ): McpServerDeclaration {
    const name = this.validateName(server.name)
    if (server.scope === 'local' && !workspace) {
      throw new McpConfigError('MCP_CONFIG_INVALID', '工作区 MCP 配置需要当前工作区', 400)
    }
    const startupTimeoutMs = this.timeout(server.startupTimeoutMs, '启动')
    const toolTimeoutMs = this.timeout(server.toolTimeoutMs, '工具调用')
    const enabledTools = normalizedStrings(server.enabledTools)
    const disabledTools = normalizedStrings(server.disabledTools)
    const tools = normalizedToolPolicies(server.tools)
    const policy = {
      ...(server.required !== undefined ? { required: server.required } : {}),
      ...(enabledTools !== undefined ? { enabledTools } : {}),
      ...(disabledTools?.length ? { disabledTools } : {}),
      ...(server.defaultToolsApprovalMode
        ? { defaultToolsApprovalMode: server.defaultToolsApprovalMode }
        : {}),
      ...(tools ? { tools } : {}),
    }
    if (server.transport.type === 'stdio') {
      const command = server.transport.command.trim()
      if (!command || command.length > 4_096)
        throw new McpConfigError('MCP_CONFIG_INVALID', 'stdio command 无效', 400)
      if (server.transport.cwd && !isAbsolute(server.transport.cwd)) {
        throw new McpConfigError('MCP_CONFIG_INVALID', 'stdio cwd 必须是绝对路径', 400)
      }
      this.validateEnvironment(server.transport.env, 'env')
      this.validateReferences(server.transport.envFromHost, 'envFromHost')
      return {
        name,
        scope: server.scope,
        enabled: server.enabled,
        ...(server.diagnosticContext ? { diagnosticContext: true } : {}),
        ...policy,
        transport: {
          type: 'stdio',
          command,
          ...(server.transport.args?.length
            ? { args: server.transport.args.map((arg) => String(arg)) }
            : {}),
          ...(server.transport.cwd ? { cwd: server.transport.cwd } : {}),
          ...(server.transport.env && Object.keys(server.transport.env).length
            ? { env: { ...server.transport.env } }
            : {}),
          ...(server.transport.envFromHost && Object.keys(server.transport.envFromHost).length
            ? { envFromHost: { ...server.transport.envFromHost } }
            : {}),
        },
        ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
        ...(toolTimeoutMs ? { toolTimeoutMs } : {}),
      }
    }

    let url: URL
    try {
      url = new URL(server.transport.url)
    } catch {
      throw new McpConfigError('MCP_CONFIG_INVALID', 'HTTP MCP URL 无效', 400)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new McpConfigError('MCP_CONFIG_INVALID', 'HTTP MCP URL 只支持 http 或 https', 400)
    }
    if (server.diagnosticContext) {
      throw new McpConfigError('MCP_CONFIG_INVALID', '会话诊断上下文仅支持 stdio MCP server', 400)
    }
    for (const name of Object.keys(server.transport.headers ?? {})) {
      if (STATIC_SECRET_HEADERS.has(name.toLowerCase())) {
        throw new McpConfigError('MCP_CONFIG_INVALID', `${name} 必须通过环境变量引用`, 400)
      }
    }
    this.validateReferences(server.transport.headerFromEnv, 'headerFromEnv')
    if (server.transport.bearerTokenEnvVar && !ENV_NAME.test(server.transport.bearerTokenEnvVar)) {
      throw new McpConfigError('MCP_CONFIG_INVALID', 'Bearer token 环境变量名无效', 400)
    }
    const scopes = normalizedStrings(server.transport.scopes)
    const oauthResource = server.transport.oauthResource?.trim()
    if (scopes && (scopes.length > 32 || scopes.some((scope) => scope.length > 256))) {
      throw new McpConfigError(
        'MCP_CONFIG_INVALID',
        'OAuth scopes 最多 32 项且每项不能超过 256 字符',
        400,
      )
    }
    if (server.transport.auth === 'none' && ((scopes?.length ?? 0) > 0 || oauthResource)) {
      throw new McpConfigError(
        'MCP_CONFIG_INVALID',
        'OAuth scopes 和 resource 只能用于 OAuth 认证',
        400,
      )
    }
    if (oauthResource) {
      try {
        const resource = new URL(oauthResource)
        if (!resource.protocol) throw new Error('missing protocol')
      } catch {
        throw new McpConfigError('MCP_CONFIG_INVALID', 'OAuth resource 必须是有效绝对 URI', 400)
      }
    }
    return {
      name,
      scope: server.scope,
      enabled: server.enabled,
      ...policy,
      transport: {
        type: 'http',
        url: url.toString(),
        ...(server.transport.auth ? { auth: server.transport.auth } : {}),
        ...(scopes?.length ? { scopes } : {}),
        ...(oauthResource ? { oauthResource } : {}),
        ...(server.transport.headers && Object.keys(server.transport.headers).length
          ? { headers: { ...server.transport.headers } }
          : {}),
        ...(server.transport.headerFromEnv && Object.keys(server.transport.headerFromEnv).length
          ? { headerFromEnv: { ...server.transport.headerFromEnv } }
          : {}),
        ...(server.transport.bearerTokenEnvVar
          ? { bearerTokenEnvVar: server.transport.bearerTokenEnvVar }
          : {}),
      },
      ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
      ...(toolTimeoutMs ? { toolTimeoutMs } : {}),
    }
  }

  private validateName(value: string) {
    const name = value.trim()
    if (!SERVER_NAME.test(name)) {
      throw new McpConfigError(
        'MCP_CONFIG_INVALID',
        'MCP server 名称必须为 1-64 位字母、数字、点、下划线或连字符',
        400,
      )
    }
    return name
  }

  private timeout(value: number | undefined, label: string) {
    if (value === undefined) return undefined
    if (!Number.isInteger(value) || value < 100 || value > 600_000) {
      throw new McpConfigError('MCP_CONFIG_INVALID', `${label}超时必须在 100-600000ms 之间`, 400)
    }
    return value
  }

  private validateEnvironment(value: Record<string, string> | undefined, label: string) {
    for (const [name] of Object.entries(value ?? {})) {
      if (!ENV_NAME.test(name))
        throw new McpConfigError('MCP_CONFIG_INVALID', `${label} 环境变量名无效`, 400)
      if (SENSITIVE_NAME.test(name)) {
        throw new McpConfigError(
          'MCP_CONFIG_INVALID',
          `${name} 看起来包含凭据，请改用 envFromHost`,
          400,
        )
      }
    }
  }

  private validateReferences(value: Record<string, string> | undefined, label: string) {
    for (const [target, source] of Object.entries(value ?? {})) {
      if (!target.trim() || !ENV_NAME.test(source)) {
        throw new McpConfigError('MCP_CONFIG_INVALID', `${label} 环境变量引用无效`, 400)
      }
    }
  }
}

export const isMcpSettingsConflict = (cause: unknown) => cause instanceof McpSettingsConflictError
