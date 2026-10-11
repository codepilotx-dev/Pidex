import type { AuthEvent, AuthInteraction, AuthPrompt, Models } from '@earendil-works/pi-ai'
import { AgentError } from '../Domain'
import { secretScrubber } from '../security/SecretScrubber'

const DEFAULT_TTL_MS = 15 * 60_000
const MAX_NOTICES = 20

export type PiAuthTarget =
  { kind: 'provider'; providerId: string } | { kind: 'usage'; sourceId: string }

export type PiAuthPromptView = {
  id: string
  type: 'text' | 'secret' | 'select' | 'manual_code'
  message: string
  placeholder?: string
  options?: readonly {
    id: string
    label: string
    description?: string
  }[]
}

export type PiAuthNoticeView =
  | {
      type: 'info'
      message: string
      links?: readonly { url: string; label?: string }[]
    }
  | { type: 'auth_url'; url: string; instructions?: string }
  | {
      type: 'device_code'
      userCode: string
      verificationUri: string
      intervalSeconds?: number
      expiresInSeconds?: number
    }
  | { type: 'progress'; message: string }

export type PiAuthSessionView = {
  id: string
  target: PiAuthTarget
  status: 'running' | 'waiting' | 'complete' | 'failed' | 'cancelled' | 'expired'
  prompt?: PiAuthPromptView
  notices: readonly PiAuthNoticeView[]
  error?: string
  createdAt: number
  expiresAt: number
}

export type PiAuthLoginTarget = {
  models: Models
  providerID: string
}

type PendingPrompt = {
  id: string
  resolve(value: string): void
  reject(cause: unknown): void
  cleanup(): void
}

type SessionRecord = {
  id: string
  target: PiAuthTarget
  status: PiAuthSessionView['status']
  prompt?: PiAuthPromptView | undefined
  pendingPrompt?: PendingPrompt | undefined
  notices: PiAuthNoticeView[]
  error?: string
  createdAt: number
  expiresAt: number
  controller: AbortController
  running?: Promise<void> | undefined
  timer?: ReturnType<typeof setTimeout> | undefined
}

export interface PiAuthSessionServiceOptions {
  now?: () => number
  ttlMs?: number
  getDeviceId?: () => string
  resolveTarget(target: PiAuthTarget): Promise<PiAuthLoginTarget> | PiAuthLoginTarget
  onUpdated?(session: PiAuthSessionView): void | Promise<void>
  onCompleted?(target: PiAuthTarget): void | Promise<void>
}

/**
 * Adapts Pi's callback-based AuthInteraction to a short-lived RPC session.
 * Prompt responses are never retained after the waiting promise is resolved.
 */
export class PiAuthSessionService {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly now: () => number
  private readonly ttlMs: number

  constructor(private readonly options: PiAuthSessionServiceOptions) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  }

  async start(target: PiAuthTarget): Promise<PiAuthSessionView> {
    this.prune()
    const loginTarget = await this.options.resolveTarget(target)
    const provider = loginTarget.models
      .getProviders()
      .find((candidate) => candidate.id === loginTarget.providerID)
    if (!provider?.auth.oauth) {
      throw new AgentError('PROVIDER_UNAVAILABLE', '目标 Provider 不支持 OAuth', 400)
    }

    const createdAt = this.now()
    const record: SessionRecord = {
      id: `auth_${crypto.randomUUID()}`,
      target,
      status: 'running',
      notices: [],
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      controller: new AbortController(),
    }
    this.sessions.set(record.id, record)
    record.timer = setTimeout(() => this.expire(record), this.ttlMs)
    record.running = this.run(record, loginTarget)
    await this.emit(record)
    return this.view(record)
  }

  status(sessionID: string): PiAuthSessionView {
    const record = this.required(sessionID)
    if (record.expiresAt <= this.now()) this.expire(record)
    return this.view(record)
  }

  async respond(sessionID: string, promptID: string, value: string): Promise<PiAuthSessionView> {
    const record = this.required(sessionID)
    if (record.expiresAt <= this.now()) this.expire(record)
    if (record.status !== 'waiting' || !record.pendingPrompt) {
      throw new AgentError('CONFLICT', '认证会话当前未等待输入', 409)
    }
    if (record.pendingPrompt.id !== promptID) {
      throw new AgentError('CONFLICT', '认证输入已过期，请按当前提示重试', 409)
    }
    const pending = record.pendingPrompt
    record.pendingPrompt = undefined
    record.prompt = undefined
    record.status = 'running'
    pending.cleanup()
    pending.resolve(value)
    await this.emit(record)
    return this.view(record)
  }

  async cancel(sessionID: string): Promise<PiAuthSessionView> {
    const record = this.required(sessionID)
    if (record.status === 'complete' || record.status === 'failed') {
      return this.view(record)
    }
    this.finish(record, 'cancelled')
    record.controller.abort(new Error('认证已取消'))
    record.pendingPrompt?.reject(new Error('认证已取消'))
    record.pendingPrompt?.cleanup()
    record.pendingPrompt = undefined
    record.prompt = undefined
    await this.emit(record)
    return this.view(record)
  }

  private async run(record: SessionRecord, target: PiAuthLoginTarget) {
    const interaction: AuthInteraction = {
      signal: record.controller.signal,
      prompt: (prompt) => this.prompt(record, prompt),
      notify: (event) => {
        if (!this.isActive(record)) return
        record.notices.push(this.notice(event))
        if (record.notices.length > MAX_NOTICES) record.notices.shift()
        void this.emit(record)
      },
    }
    try {
      await target.models.login(
        target.providerID,
        'oauth',
        interaction,
        this.options.getDeviceId ? { getDeviceId: this.options.getDeviceId } : undefined,
      )
      if (!this.isActive(record)) return
      await this.options.onCompleted?.(record.target)
      if (!this.isActive(record)) return
      this.finish(record, 'complete')
      await this.emit(record)
    } catch (cause) {
      if (!this.isActive(record)) return
      const cancelled = record.controller.signal.aborted
      this.finish(record, cancelled ? 'cancelled' : 'failed')
      if (!cancelled) {
        record.error = this.safeError(cause)
      }
      await this.emit(record)
    }
  }

  private prompt(record: SessionRecord, prompt: AuthPrompt): Promise<string> {
    if (!this.isActive(record)) {
      return Promise.reject(new Error('认证会话已结束'))
    }
    record.pendingPrompt?.reject(new Error('认证提示已被替换'))
    record.pendingPrompt?.cleanup()
    const id = `prompt_${crypto.randomUUID()}`
    record.prompt = {
      id,
      type: prompt.type,
      message: prompt.message,
      ...('placeholder' in prompt && prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
      ...(prompt.type === 'select' ? { options: prompt.options } : {}),
    }
    record.status = 'waiting'

    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        if (record.pendingPrompt?.id !== id) return
        record.pendingPrompt = undefined
        record.prompt = undefined
        reject(prompt.signal?.reason ?? new Error('认证提示已取消'))
      }
      prompt.signal?.addEventListener('abort', abort, { once: true })
      record.pendingPrompt = {
        id,
        resolve,
        reject,
        cleanup: () => prompt.signal?.removeEventListener('abort', abort),
      }
      void this.emit(record)
    })
  }

  private notice(event: AuthEvent): PiAuthNoticeView {
    switch (event.type) {
      case 'info':
        return {
          type: 'info',
          message: event.message,
          ...(event.links ? { links: event.links.map((link) => ({ ...link })) } : {}),
        }
      case 'auth_url':
        return {
          type: 'auth_url',
          url: event.url,
          ...(event.instructions ? { instructions: event.instructions } : {}),
        }
      case 'device_code':
        return { ...event }
      case 'progress':
        return { ...event }
    }
  }

  private expire(record: SessionRecord) {
    if (!this.isActive(record)) return
    this.finish(record, 'expired')
    record.controller.abort(new Error('认证会话已过期'))
    record.pendingPrompt?.reject(new Error('认证会话已过期'))
    record.pendingPrompt?.cleanup()
    record.pendingPrompt = undefined
    record.prompt = undefined
    void this.emit(record)
  }

  private finish(record: SessionRecord, status: SessionRecord['status']) {
    record.status = status
    if (record.timer) clearTimeout(record.timer)
    record.timer = undefined
  }

  private required(sessionID: string) {
    const record = this.sessions.get(sessionID)
    if (!record) {
      throw new AgentError('AUTHORIZATION_FAILED', '未找到认证会话', 404)
    }
    return record
  }

  private isActive(record: SessionRecord) {
    return record.status === 'running' || record.status === 'waiting'
  }

  private view(record: SessionRecord): PiAuthSessionView {
    return {
      id: record.id,
      target: { ...record.target },
      status: record.status,
      ...(record.prompt ? { prompt: { ...record.prompt } } : {}),
      notices: record.notices.map((notice) => structuredClone(notice)),
      ...(record.error ? { error: record.error } : {}),
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    }
  }

  private emit(record: SessionRecord) {
    const session = this.view(record)
    // ChatGPT 授权链接包含安装 ID；完整链接只通过认证 RPC 返回，不写入事件。
    session.notices = session.notices.filter(
      (notice) => notice.type !== 'auth_url' || !notice.url.includes('ext_agent_host_id='),
    )
    return Promise.resolve(this.options.onUpdated?.(session))
  }

  private safeError(cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'OAuth 授权失败'
    return (
      secretScrubber.scrubText(message).replace(/\s+/g, ' ').trim().slice(0, 500) ||
      'OAuth 授权失败'
    )
  }

  private prune() {
    const cutoff = this.now() - this.ttlMs
    for (const [id, record] of this.sessions) {
      if (record.expiresAt < cutoff) this.sessions.delete(id)
    }
  }
}
