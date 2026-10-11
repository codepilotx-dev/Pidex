import { describe, expect, test } from 'bun:test'
import type { AuthInteraction, LoginOptions, Models } from '@earendil-works/pi-ai'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiAuthSessionService } from '../src/auth/PiAuthSessionService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'

const waitFor = async (
  service: PiAuthSessionService,
  sessionID: string,
  status: 'waiting' | 'complete' | 'failed' | 'cancelled' | 'expired',
) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const session = service.status(sessionID)
    if (session.status === status) return session
    await Bun.sleep(2)
  }
  throw new Error(`Auth session did not reach ${status}`)
}

const models = (
  login: (interaction: AuthInteraction, options?: LoginOptions) => Promise<void>,
): Models =>
  ({
    getProviders: () => [
      {
        id: 'fixture',
        auth: { oauth: { name: 'Fixture OAuth' } },
      },
    ],
    login: async (
      _providerID: string,
      _type: 'api_key' | 'oauth',
      interaction: AuthInteraction,
      options?: LoginOptions,
    ) => {
      await login(interaction, options)
      return { type: 'oauth', refresh: 'refresh', access: 'access', expires: 1 }
    },
  }) as never

describe('PiAuthSessionService', () => {
  test('按需传入持久化设备 ID，重启复用且授权链接不进入更新事件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-auth-device-'))
    const path = join(root, 'history.sqlite')
    let db = new AgentDatabase(path)
    try {
      expect(db.getSetting('provider-auth.device-id')).toBeNull()
      let deviceId = ''
      const updates: unknown[] = []
      const service = new PiAuthSessionService({
        getDeviceId: () => db.getProviderAuthDeviceId(),
        resolveTarget: () => ({
          models: models(async (interaction, options) => {
            deviceId = options!.getDeviceId!()
            interaction.notify({
              type: 'auth_url',
              url: `https://example.test/auth?ext_agent_host_id=urn%3Auuid%3A${deviceId}`,
            })
          }),
          providerID: 'fixture',
        }),
        onUpdated: (session) => {
          updates.push(session)
        },
      })
      const session = await service.start({ kind: 'provider', providerId: 'fixture' })
      await waitFor(service, session.id, 'complete')
      expect(deviceId).toMatch(/^[0-9a-f-]{36}$/)
      expect(db.getSetting<string>('provider-auth.device-id')).toBe(deviceId)
      expect(JSON.stringify(service.status(session.id))).toContain(deviceId)
      expect(JSON.stringify(updates)).not.toContain(deviceId)
      db.close()
      db = new AgentDatabase(path)
      expect(db.getProviderAuthDeviceId()).toBe(deviceId)
    } finally {
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test('承载四类 prompt 和四类安全通知', async () => {
    const answers: string[] = []
    const updates: unknown[] = []
    const fixture = models(async (interaction) => {
      interaction.notify({ type: 'info', message: '准备认证' })
      interaction.notify({ type: 'auth_url', url: 'https://example.test/auth' })
      interaction.notify({
        type: 'device_code',
        userCode: 'ABCD',
        verificationUri: 'https://example.test/device',
      })
      interaction.notify({ type: 'progress', message: '等待完成' })
      for (const prompt of [
        { type: 'text', message: '账户' },
        { type: 'secret', message: '密码' },
        {
          type: 'select',
          message: '区域',
          options: [{ id: 'cn', label: '中国' }],
        },
        { type: 'manual_code', message: '授权码' },
      ] as const) {
        answers.push(await interaction.prompt(prompt))
      }
    })
    const service = new PiAuthSessionService({
      resolveTarget: () => ({ models: fixture, providerID: 'fixture' }),
      onUpdated: (session) => {
        updates.push(session)
      },
    })
    let session = await service.start({ kind: 'provider', providerId: 'fixture' })
    for (const [type, value] of [
      ['text', 'account'],
      ['secret', 'never-log-this-secret'],
      ['select', 'cn'],
      ['manual_code', 'code'],
    ] as const) {
      session = await waitFor(service, session.id, 'waiting')
      expect(session.prompt?.type).toBe(type)
      session = await service.respond(session.id, session.prompt!.id, value)
    }
    session = await waitFor(service, session.id, 'complete')
    expect(answers).toEqual(['account', 'never-log-this-secret', 'cn', 'code'])
    expect(session.notices.map((notice) => notice.type)).toEqual([
      'info',
      'auth_url',
      'device_code',
      'progress',
    ])
    expect(JSON.stringify(updates)).not.toContain('never-log-this-secret')
  })

  test('取消和过期会中止等待中的 Pi prompt', async () => {
    const fixture = models(async (interaction) => {
      await interaction.prompt({ type: 'manual_code', message: '授权码' })
    })
    const service = new PiAuthSessionService({
      ttlMs: 20,
      resolveTarget: () => ({ models: fixture, providerID: 'fixture' }),
    })
    const cancelled = await service.start({
      kind: 'provider',
      providerId: 'fixture',
    })
    await waitFor(service, cancelled.id, 'waiting')
    expect((await service.cancel(cancelled.id)).status).toBe('cancelled')

    const expired = await service.start({
      kind: 'provider',
      providerId: 'fixture',
    })
    expect((await waitFor(service, expired.id, 'expired')).status).toBe('expired')
  })

  test('完成同步结束后才公开 complete 状态', async () => {
    let finishSync: (() => void) | undefined
    const sync = new Promise<void>((resolve) => {
      finishSync = resolve
    })
    const updates: string[] = []
    const service = new PiAuthSessionService({
      resolveTarget: () => ({ models: models(async () => {}), providerID: 'fixture' }),
      onCompleted: () => sync,
      onUpdated: (session) => {
        updates.push(session.status)
      },
    })

    const session = await service.start({ kind: 'provider', providerId: 'fixture' })
    await Bun.sleep(5)
    expect(service.status(session.id).status).toBe('running')
    expect(updates).not.toContain('complete')

    finishSync?.()
    expect((await waitFor(service, session.id, 'complete')).status).toBe('complete')
    expect(updates.at(-1)).toBe('complete')
  })

  test('完成同步失败时返回经过清理的 failed 状态', async () => {
    const service = new PiAuthSessionService({
      resolveTarget: () => ({ models: models(async () => {}), providerID: 'fixture' }),
      onCompleted: () => {
        throw new Error('同步失败 Authorization: Bearer oauth-access-secret')
      },
    })

    const session = await service.start({ kind: 'provider', providerId: 'fixture' })
    const failed = await waitFor(service, session.id, 'failed')
    expect(failed.error).toContain('同步失败')
    expect(failed.error).not.toContain('oauth-access-secret')
  })
})
