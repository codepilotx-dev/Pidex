import { watchFile, unwatchFile } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import { z } from 'zod'
import type { ComputerIdentity, ComputerPolicyDecision } from '@pidex/agent-protocol'
import type { ConfigService } from '../config/ConfigService'

const access = z.enum(['allow', 'deny'])
const policySchema = z
  .object({
    default_app_access: access.default('allow'),
    allow_persistent_approval: z.boolean().default(true),
    windows: z
      .object({
        aumids: z.record(z.string(), access).default({}),
        exes: z
          .array(
            z
              .object({
                publisher_name: z.string().min(1),
                product_name: z.string().min(1),
                binary_name: z.string().min(1).optional(),
                access,
              })
              .passthrough(),
          )
          .default([]),
      })
      .passthrough()
      .default({ aumids: {}, exes: [] }),
  })
  .passthrough()
type Policy = z.infer<typeof policySchema>
const defaults = () => policySchema.parse({})

/** Machine restrictions are read-only; user grants never enter this service. */
export class ComputerPolicyService {
  private managed = defaults()
  private user = defaults()
  private managedPresent = false
  private valid = false
  private reason = '电脑应用策略正在加载'
  private listeners = new Set<() => void>()
  private unsubscribe?: () => void
  private reloadQueue = Promise.resolve()
  private disposed = false
  private signature = ''
  private readonly onMachineChanged = () => {
    void this.refresh()
  }
  readonly machinePath: string
  constructor(
    private readonly config: ConfigService,
    machinePath?: string,
  ) {
    this.machinePath =
      machinePath ??
      // 机器策略由管理员预置在 ProgramData 下。品牌清零后只读取新产品目录，
      // 已按旧目录部署的机器需由管理员把 requirements.toml 迁移到此处。
      join(process.env.ProgramData || 'C:\\ProgramData', 'Pidex', 'requirements.toml')
  }
  async initialize() {
    await this.refresh()
    this.unsubscribe = this.config.subscribe(() => this.refresh())
    watchFile(this.machinePath, { persistent: false, interval: 1000 }, this.onMachineChanged)
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  state() {
    return {
      allowPersistentApproval:
        this.valid && this.managed.allow_persistent_approval && this.user.allow_persistent_approval,
      managed: this.managedPresent,
      valid: this.valid,
      reason: this.reason,
      managedDefaultAccess: this.managed.default_app_access,
      userDefaultAccess: this.user.default_app_access,
    }
  }
  refresh(): Promise<void> {
    this.reloadQueue = this.reloadQueue.then(async () => {
      if (this.disposed) return
      let managed = defaults(),
        user = defaults(),
        valid = true,
        present = false,
        reason = ''
      try {
        const text = await readFile(this.machinePath, 'utf8')
        present = true
        managed = policySchema.parse(parse(text).computer_use ?? {})
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          present = true
          valid = false
          reason = '管理员电脑应用策略无法读取或格式无效'
        }
      }
      try {
        const result = await this.config.read()
        if (result.diagnostics?.some((item) => item.severity === 'error'))
          throw new Error('Invalid configuration')
        const raw = result.layers?.find((layer) => layer.kind === 'user')?.config ?? {}
        user = policySchema.parse(raw.computer_use ?? {})
      } catch {
        valid = false
        reason ||= '用户电脑应用策略无法读取或格式无效'
      }
      const signature = JSON.stringify({ managed, user, valid, present, reason })
      this.managed = managed
      this.user = user
      this.valid = valid
      this.managedPresent = present
      this.reason = reason
      if (signature !== this.signature) {
        this.signature = signature
        for (const listener of this.listeners) listener()
      }
    })
    return this.reloadQueue
  }
  evaluate(identity?: ComputerIdentity): ComputerPolicyDecision {
    if (!this.valid)
      return {
        access: 'deny',
        source: this.managedPresent ? 'managed' : 'user',
        reason: this.reason,
      }
    if (
      !identity ||
      identity.kind === 'invalid' ||
      !/^[a-f0-9]{64}$/.test(identity.fingerprint) ||
      (identity.kind === 'packaged' && !identity.aumid) ||
      (identity.kind === 'signed' && (!identity.publisher || !identity.product)) ||
      (identity.kind === 'unsigned' && identity.sha256 !== identity.fingerprint)
    )
      return { access: 'deny', source: 'identity', reason: '应用身份核验失败，请重新发现应用' }
    for (const [source, policy] of [
      ['managed', this.managed],
      ['user', this.user],
    ] as const) {
      let matches: Array<'allow' | 'deny'> = []
      if (identity.kind === 'packaged' && identity.aumid && policy.windows.aumids[identity.aumid])
        matches = [policy.windows.aumids[identity.aumid]!]
      if (identity.kind === 'signed')
        matches = policy.windows.exes
          .filter(
            (rule) =>
              rule.publisher_name === identity.publisher &&
              rule.product_name === identity.product &&
              (!rule.binary_name ||
                rule.binary_name.toLowerCase() === identity.binary?.toLowerCase()),
          )
          .map((rule) => rule.access)
      const allowed = matches.length
        ? !matches.includes('deny')
        : policy.default_app_access === 'allow'
      if (!allowed)
        return {
          access: 'deny',
          source,
          reason: source === 'managed' ? '管理员策略禁止访问此应用' : '用户访问策略禁止访问此应用',
        }
    }
    return { access: 'allow', source: 'default', reason: '访问策略允许；仍需应用授权及任务权限' }
  }
  dispose() {
    this.disposed = true
    this.unsubscribe?.()
    unwatchFile(this.machinePath, this.onMachineChanged)
    this.listeners.clear()
  }
}
