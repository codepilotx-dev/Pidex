import { createHash, randomUUID } from 'node:crypto'
import { Effect, Schema } from 'effect'
import {
  ComputerPermissionSchema,
  type ComputerState,
  type ComputerWindow,
  type ComputerCommand,
  type ComputerResult,
  type ComputerAction,
} from '@pidex/agent-protocol'
import { AgentError } from '../Domain'
import type { ConfigService } from '../config/ConfigService'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'
import { ComputerPolicyService } from './ComputerPolicyService'
import type { PermissionConfig } from '@pidex/shared/thread'
import type { PluginManagementService } from '../plugin/PluginManagementService'

type Identity = { threadID: string; turnID: string; agentID?: string; toolCallID?: string }
/**
 * Must outlast one `host/next` long-poll plus a slow round trip: a shorter
 * window would retire a healthy host and drop the chat's grants between polls.
 */
const HOST_STALE_MS = 45_000
const HOST_POLL_MS = 20_000
type Host = { instanceId: string; connectionId: string; available: boolean; seenAt: number }
type Pending = {
  command: ComputerCommand
  dispatched: boolean
  finish: (result?: ComputerResult, error?: Error) => void
}
type Observation = {
  ref: string
  turnID: string
  generation: string
  at: number
  captureId?: string
  tokens: readonly string[]
}
export class ComputerUseService {
  private host: Host | undefined
  private generation = randomUUID()
  private readonly windows = new Map<string, ComputerWindow>()
  private readonly discoveredApps = new Map<string, ComputerWindow>()
  /** threadID -> appId -> display name, so settings can offer to make it permanent. */
  private readonly grants = new Map<string, Map<string, string>>()
  private readonly observations = new Map<string, Observation>()
  private readonly pending = new Map<string, Pending>()
  private readonly stoppedTurns = new Set<string>()
  private wake: (() => void) | undefined
  private owner: Identity | undefined
  private targetName: string | null = null
  private readonly unsubscribe: () => void
  private readonly heartbeat: ReturnType<typeof setInterval>
  private readonly policy: ComputerPolicyService
  private readonly unsubscribePolicy: () => void
  private readonly unsubscribeConfig: () => void
  private readonly unsubscribePlugins: () => void
  constructor(
    private readonly config: ConfigService,
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly plugins: PluginManagementService,
    policy?: ComputerPolicyService,
  ) {
    this.policy = policy ?? new ComputerPolicyService(config)
    this.unsubscribePolicy = this.policy.subscribe(() => this.stop())
    this.unsubscribePlugins = plugins.subscribe((pluginId) => {
      if (pluginId !== 'computer-use') return
      if (!this.enabled()) this.stop()
      else this.changed()
    })
    let previousPermissions = this.permissions()
    this.unsubscribeConfig = config.subscribe((event) => {
      if (
        event.scope === 'user' &&
        event.changedKeyPaths.some(
          (path) =>
            path[0] === 'desktop' &&
            (!path[1] || ['computerAppPermissions', 'computerAppApprovalsV2'].includes(path[1])),
        )
      ) {
        const next = this.permissions()
        const revoked = previousPermissions.filter(
          (entry) =>
            entry.decision === 'allow' &&
            !entry.needsConfirmation &&
            !next.some(
              (item) =>
                item.appId === entry.appId && item.decision === 'allow' && !item.needsConfirmation,
            ),
        )
        const denied = next.filter(
          (entry) =>
            entry.decision === 'deny' &&
            !previousPermissions.some(
              (item) => item.appId === entry.appId && item.decision === 'deny',
            ),
        )
        for (const granted of this.grants.values())
          for (const entry of [...revoked, ...denied]) granted.delete(entry.appId)
        if (revoked.length || denied.length) this.stop()
        previousPermissions = next
        this.changed()
      }
    })
    this.unsubscribe = hub.listen(({ event }) => {
      if (
        ['turn/completed', 'turn/interrupted', 'turn/failed'].includes(event.method) &&
        event.turnId
      ) {
        this.stoppedTurns.delete(event.turnId)
        if (this.owner?.turnID === event.turnId) this.reset('电脑控制回合已结束')
      }
    })
    this.heartbeat = setInterval(() => {
      if (this.host && Date.now() - this.host.seenAt > HOST_STALE_MS)
        this.release(this.host.instanceId)
    }, 5_000)
    this.heartbeat.unref()
  }
  initialize() {
    return this.policy.initialize()
  }
  private desktop() {
    return this.config.snapshotLayers().find((layer) => layer.kind === 'user')?.config.desktop as
      Record<string, unknown> | undefined
  }
  /** Persisted decisions only; `applications()` adds the chat-scoped grants. */
  private permissions(): ComputerState['permissions'] {
    const decode = Schema.decodeUnknownSync(ComputerPermissionSchema)
    return ['computerAppPermissions', 'computerAppApprovalsV2'].flatMap((key) => {
      const raw = this.desktop()?.[key]
      return (Array.isArray(raw) ? raw : []).flatMap((value) => {
        try {
          const entry = decode(value)
          return [
            {
              ...entry,
              ...(key === 'computerAppPermissions' && entry.decision === 'allow'
                ? { needsConfirmation: true }
                : {}),
            },
          ]
        } catch {
          return []
        }
      })
    })
  }
  private applications(): ComputerState['permissions'] {
    const entries = new Map<string, ComputerState['permissions'][number]>()
    for (const entry of this.permissions()) entries.set(entry.appId, entry)
    for (const [threadId, granted] of this.grants)
      for (const [appId, name] of granted) {
        const entry = entries.get(appId) ?? { appId, name, decision: 'session' as const }
        entries.set(appId, { ...entry, chatThreadIds: [...(entry.chatThreadIds ?? []), threadId] })
      }
    return [...entries.values()].map((entry) => {
      const known =
        this.discoveredApps.get(entry.appId) ??
        [...this.windows.values()].find((window) => window.appId === entry.appId)
      return { ...entry, ...(known ? { policy: this.appPolicy(known) } : {}) }
    })
  }
  private appPolicy(window: ComputerWindow) {
    const policy = this.policy.evaluate(window.identity)
    if (
      policy.access === 'allow' &&
      this.permissions().some(
        (entry) => entry.decision === 'deny' && entry.appId === window.identity?.legacyAppId,
      )
    )
      return {
        access: 'deny' as const,
        source: 'user' as const,
        reason: '旧路径授权已拒绝此应用，请先撤销该拒绝记录',
      }
    return policy
  }
  enabled = () => this.plugins.isEnabled('computer-use')
  available = () =>
    Boolean(this.enabled() && this.host?.available && Date.now() - this.host.seenAt < HOST_STALE_MS)
  state(): ComputerState {
    return {
      enabled: this.enabled(),
      available: Boolean(this.host?.available),
      ownerThreadId: this.owner?.threadID ?? null,
      ownerTurnId: this.owner?.turnID ?? null,
      targetName: this.targetName,
      busy: this.pending.size > 0,
      permissions: this.applications(),
      policy: this.policy.state(),
      applications: [...this.discoveredApps.values()].map((window) => ({
        appId: window.appId,
        name: window.name,
        policy: this.appPolicy(window),
      })),
    }
  }
  private changed() {
    this.wake?.()
    const event = this.db.insertEvent(null, null, 'computer/changed', this.state())
    void Effect.runPromise(this.hub.publish(event))
  }
  async configure(input: {
    enabled?: boolean
    appId?: string
    threadId?: string
    decision?: 'allow' | 'deny' | 'remove' | 'session'
  }) {
    const edits: Array<{ keyPath: string[]; value: any }> = []
    if (input.decision) {
      if (!input.appId) throw new AgentError('INVALID_REQUEST', '缺少应用身份', 400)
      const known =
        this.applications().find((entry) => entry.appId === input.appId) ??
        this.discoveredApps.get(input.appId)
      if (!known) throw new AgentError('INVALID_REQUEST', '请先发现此应用', 400)
      if (input.decision === 'allow' || input.decision === 'session') {
        const window =
          this.discoveredApps.get(input.appId) ??
          [...this.windows.values()].find((entry) => entry.appId === input.appId)
        const decision = window ? this.appPolicy(window) : this.policy.evaluate()
        if (decision.access === 'deny')
          throw new AgentError('PERMISSION_DENIED', decision.reason, 403)
        if (input.decision === 'allow' && !this.policy.state().allowPersistentApproval)
          throw new AgentError(
            'PERMISSION_DENIED',
            '策略禁止保存永久应用授权，请仅授权当前聊天',
            403,
          )
        if (input.decision === 'session') {
          if (
            this.permissions().some(
              (entry) => entry.appId === input.appId && entry.decision === 'deny',
            )
          )
            throw new AgentError('PERMISSION_DENIED', '请先撤销此应用的永久拒绝记录', 403)
          if (!input.threadId || !this.db.getThread(input.threadId))
            throw new AgentError('INVALID_REQUEST', '请选择有效的当前聊天', 400)
          if (input.enabled !== undefined)
            await this.plugins.setEnabled({
              pluginId: 'computer-use',
              enabled: input.enabled,
              operationId: randomUUID(),
            })
          const granted = this.grants.get(input.threadId) ?? new Map<string, string>()
          granted.set(input.appId, known.name)
          this.grants.set(input.threadId, granted)
          this.changed()
          return this.state()
        }
      }
      // Preserve unknown entries in user configuration.
      const legacyEntries = this.desktop()?.computerAppPermissions
      const legacy =
        Array.isArray(legacyEntries) && legacyEntries.some((entry) => entry?.appId === input.appId)
      const key =
        legacy && input.decision === 'remove' ? 'computerAppPermissions' : 'computerAppApprovalsV2'
      const raw = this.desktop()?.[key]
      const next = (Array.isArray(raw) ? raw : []).filter((entry) => entry?.appId !== input.appId)
      if (input.decision !== 'remove')
        next.push({ appId: input.appId, name: known.name, decision: input.decision })
      edits.push({ keyPath: ['desktop', key], value: next })
      if (input.decision !== 'allow')
        for (const granted of this.grants.values()) granted.delete(input.appId)
    }
    if (edits.length) await this.config.batchWrite({ target: { kind: 'user' }, edits })
    if (input.enabled !== undefined)
      await this.plugins.setEnabled({
        pluginId: 'computer-use',
        enabled: input.enabled,
        operationId: randomUUID(),
      })
    if (input.enabled === false || input.decision === 'remove' || input.decision === 'deny')
      this.stop()
    this.changed()
    return this.state()
  }
  register(instanceId: string, connectionId: string, available: boolean, identitySupport = false) {
    available = available && identitySupport
    if (
      this.host &&
      (this.host.instanceId !== instanceId || this.host.connectionId !== connectionId)
    ) {
      this.grants.clear()
      this.discoveredApps.clear()
      this.reset('电脑宿主已重新连接')
    }
    const previous = this.host?.available
    this.host = { instanceId, connectionId, available, seenAt: Date.now() }
    if (previous !== available) this.changed()
    return this.state()
  }
  requireHost(instanceId: string, connectionId: string) {
    if (
      !this.host ||
      this.host.instanceId !== instanceId ||
      this.host.connectionId !== connectionId
    )
      throw new AgentError('PERMISSION_DENIED', '电脑宿主连接已失效', 403)
    this.host.seenAt = Date.now()
  }
  async next(generation?: string) {
    const take = () => [...this.pending.values()].find((entry) => !entry.dispatched)
    let command = take()
    if (!command && (!generation || generation === this.generation)) {
      // Long-poll: the desktop host holds one request instead of spinning.
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer)
          if (this.wake === finish) this.wake = undefined
          resolve()
        }
        const timer = setTimeout(finish, HOST_POLL_MS)
        // A pending long-poll must never keep the process alive on its own.
        timer.unref?.()
        this.wake?.()
        this.wake = finish
      })
      command = take()
    }
    if (command) command.dispatched = true
    return {
      command: command?.command ?? null,
      enabled: this.state().enabled,
      generation: this.generation,
    }
  }
  complete(requestId: string, generation: string, result: ComputerResult) {
    const pending = this.pending.get(requestId)
    if (generation !== this.generation || !pending || !pending.dispatched) return
    pending.finish(result)
  }
  release(instanceId: string) {
    if (this.host?.instanceId !== instanceId) return
    this.host = undefined
    this.grants.clear()
    this.discoveredApps.clear()
    this.reset('电脑宿主已断开；操作不会重放')
  }
  private requireAvailable(identity: Identity) {
    if (!this.available())
      throw new AgentError(
        'CAPABILITY_REQUIRED',
        '请开启电脑控制，并确认 Windows 原生运行时已就绪',
        409,
      )
    if (this.stoppedTurns.has(identity.turnID))
      throw new AgentError('RUN_ABORTED', '本回合电脑控制已停止，请在新回合继续', 499)
    if (
      this.owner &&
      (this.owner.threadID !== identity.threadID || this.owner.turnID !== identity.turnID)
    )
      throw new AgentError('PERMISSION_DENIED', '电脑正由另一个聊天回合控制', 409)
  }
  private window(ref: string) {
    const window = this.windows.get(ref)
    if (!window) throw new AgentError('INVALID_REQUEST', '窗口引用已失效，请重新发现应用', 409)
    return window
  }
  inspect(
    identity: Identity,
    ref: string,
    plan: boolean,
    operation?: ComputerAction,
    _permissionConfig?: PermissionConfig,
  ) {
    this.requireAvailable(identity)
    const window = this.window(ref)
    const permission = this.permissions().find((entry) => entry.appId === window.appId)
    const policy = this.appPolicy(window)
    if (policy.access === 'deny') throw new AgentError('PERMISSION_DENIED', policy.reason, 403)
    if (
      this.permissions().some(
        (entry) =>
          entry.decision === 'deny' &&
          (entry.appId === window.appId || entry.appId === window.identity?.legacyAppId),
      )
    )
      throw new AgentError('PERMISSION_DENIED', '此应用的电脑控制权限已拒绝', 403)
    const granted =
      (permission?.decision === 'allow' &&
        !permission.needsConfirmation &&
        this.policy.state().allowPersistentApproval) ||
      this.grants.get(identity.threadID)?.has(window.appId)
    if (plan && !granted)
      throw new AgentError('TOOL_NOT_ALLOWED_IN_MODE', 'Plan 模式只能读取已授权应用', 403)
    if (operation && !granted)
      throw new AgentError('PERMISSION_DENIED', '请先通过 ComputerRead 授权并读取此应用', 403)
    return {
      affectedPaths: [],
      computerApp: {
        name: window.name,
        allowPersistentApproval: this.policy.state().allowPersistentApproval,
      },
      ruleRequiresApproval: !granted,
      fingerprint: createHash('sha256')
        .update(JSON.stringify({ identity, window, generation: this.generation, operation }))
        .digest('hex'),
    }
  }
  validateGrant(
    identity: Identity,
    ref: string,
    fingerprint: string,
    persistent: boolean,
    plan: boolean,
    permissions: PermissionConfig,
  ) {
    const scope = this.inspect(identity, ref, plan, undefined, permissions)
    if (scope.fingerprint !== fingerprint)
      throw new AgentError('APPROVAL_SCOPE_CHANGED', '应用引用或身份已变化，请重新读取', 409)
    if (persistent && !scope.computerApp.allowPersistentApproval)
      throw new AgentError('PERMISSION_DENIED', '策略禁止保存永久应用授权', 403)
  }
  private async request(
    identity: Identity,
    kind: ComputerCommand['kind'],
    signal: AbortSignal,
    window?: ComputerWindow,
    operation?: ComputerAction,
    observation?: Observation,
  ): Promise<ComputerResult> {
    this.requireAvailable(identity)
    if (this.pending.size)
      throw new AgentError('PERMISSION_DENIED', '电脑正在执行操作，请等待当前操作完成', 409)
    this.owner = identity
    this.targetName = window?.name ?? null
    const command: ComputerCommand = {
      requestId: randomUUID(),
      generation: this.generation,
      kind,
      session: `cpx-${identity.turnID}`,
      ...(window ? { window } : {}),
      ...(operation ? { operation } : {}),
      ...(observation?.captureId ? { captureId: observation.captureId } : {}),
    }
    return new Promise((resolve, reject) => {
      const abort = () => this.stop()
      const finish = (result?: ComputerResult, error?: Error) => {
        if (!this.pending.delete(command.requestId)) return
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.changed()
        if (error) reject(error)
        else resolve(result!)
      }
      const timer = setTimeout(() => {
        this.stoppedTurns.add(identity.turnID)
        this.reset('电脑操作超时；结果不确定，不会自动重放')
      }, 30_000)
      this.pending.set(command.requestId, { command, dispatched: false, finish })
      signal.addEventListener('abort', abort, { once: true })
      this.changed()
      if (signal.aborted) abort()
    })
  }
  async list(identity: Identity, signal: AbortSignal) {
    const result = await this.request(identity, 'list', signal)
    if (result.isError) return result
    // The host mints window references and only accepts them back unchanged, so
    // they are never re-issued here.
    const windows = result.windows ?? []
    this.windows.clear()
    this.observations.clear()
    for (const window of windows) this.windows.set(window.ref, window)
    for (const window of windows) this.discoveredApps.set(window.appId, window)
    return { text: JSON.stringify(windows.map(({ ref, name }) => ({ ref, name }))) }
  }
  /** User settings discovery reads identification only and never grants access. */
  async discoverApplications() {
    const identity = { threadID: 'computer-settings', turnID: randomUUID() }
    try {
      const result = await this.request(identity, 'list', new AbortController().signal)
      if (result.isError)
        throw new AgentError('CAPABILITY_REQUIRED', '应用发现失败，请确认原生运行时已就绪', 409)
      this.discoveredApps.clear()
      for (const window of result.windows ?? []) this.discoveredApps.set(window.appId, window)
      return {
        apps: [...this.discoveredApps.values()].map((window) => ({
          appId: window.appId,
          name: window.name,
          policy: this.appPolicy(window),
        })),
      }
    } finally {
      if (this.owner?.turnID === identity.turnID) {
        this.reset('应用发现已完成')
      }
      this.stoppedTurns.delete(identity.turnID)
    }
  }
  async read(
    identity: Identity,
    ref: string,
    signal: AbortSignal,
    plan = false,
    permissionConfig?: PermissionConfig,
    computerGrant?: 'chat' | 'persistent',
  ) {
    const scope = this.inspect(identity, ref, plan, undefined, permissionConfig)
    if (scope.ruleRequiresApproval && !computerGrant)
      throw new AgentError('PERMISSION_DENIED', '请先在聊天中确认此应用的授权', 403)
    if (computerGrant === 'persistent' && !scope.computerApp.allowPersistentApproval)
      throw new AgentError('PERMISSION_DENIED', '策略禁止保存永久应用授权', 403)
    const result = await this.request(identity, 'read', signal, this.window(ref))
    if (!result.isError) {
      // Only a human-approved, fingerprint-checked resume creates a chat grant.
      const window = this.window(ref)
      if (computerGrant) {
        const granted = this.grants.get(identity.threadID) ?? new Map<string, string>()
        granted.set(window.appId, window.name)
        this.grants.set(identity.threadID, granted)
        if (computerGrant === 'persistent') {
          await this.configure({ appId: window.appId, decision: 'allow' })
          this.inspect(identity, ref, plan, undefined, permissionConfig)
        }
        this.changed()
      }
      const observationId = randomUUID()
      this.observations.set(ref, {
        ref: observationId,
        turnID: identity.turnID,
        generation: this.generation,
        at: Date.now(),
        ...(result.snapshotId ? { snapshotId: result.snapshotId } : {}),
        ...(result.captureId ? { captureId: result.captureId } : {}),
        tokens: result.elementTokens ?? [],
      })
      return { ...result, text: `observationId: ${observationId}\n${result.text}` }
    }
    return result
  }
  async action(
    identity: Identity,
    ref: string,
    observationId: string,
    operation: ComputerAction,
    signal: AbortSignal,
    permissionConfig?: PermissionConfig,
  ) {
    this.inspect(identity, ref, false, operation, permissionConfig)
    const observation = this.observations.get(ref)
    if (
      !observation ||
      observation.ref !== observationId ||
      observation.turnID !== identity.turnID ||
      observation.generation !== this.generation ||
      Date.now() - observation.at > 30_000
    )
      throw new AgentError('INVALID_REQUEST', '观察已失效，请重新读取窗口', 409)
    if (operation.elementToken && !observation.tokens.includes(operation.elementToken))
      throw new AgentError('INVALID_REQUEST', '元素不属于当前窗口观察', 400)
    if (!operation.elementToken && !observation.captureId)
      throw new AgentError('INVALID_REQUEST', '坐标操作需要有效截图', 400)
    this.observations.delete(ref)
    return this.request(identity, 'action', signal, this.window(ref), operation, observation)
  }
  stop() {
    if (this.owner) this.stoppedTurns.add(this.owner.turnID)
    this.reset('电脑控制已停止')
  }
  private reset(reason: string) {
    this.generation = randomUUID()
    this.windows.clear()
    this.observations.clear()
    for (const pending of [...this.pending.values()])
      pending.finish(undefined, new AgentError('RUN_ABORTED', reason, 499))
    this.owner = undefined
    this.targetName = null
    this.changed()
  }
  dispose() {
    this.unsubscribePlugins()
    this.unsubscribe()
    this.unsubscribeConfig()
    this.unsubscribePolicy()
    this.policy.dispose()
    clearInterval(this.heartbeat)
    this.stop()
    this.wake?.()
    this.host = undefined
  }
}
