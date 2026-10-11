import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { Effect } from 'effect'
import {
  EncryptedCredentialRepository,
  type MasterKeyStore,
} from '../src/auth/EncryptedCredentialRepository'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)))

const memoryKeyStore = (): MasterKeyStore & { value: string | null } => ({
  value: null,
  async get() {
    return this.value
  },
  async set(value) {
    this.value = value
  },
})

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-credential-'))
  paths.push(root)
  return { db: new AgentDatabase(join(root, 'agent.sqlite')), keys: memoryKeyStore() }
}

describe('加密凭据仓库', () => {
  test('使用 AES-GCM 往返保存 API Key', async () => {
    const { db, keys } = await setup()
    const repository = new EncryptedCredentialRepository(db, keys)
    await Effect.runPromise(
      repository.set({ integrationID: 'openai', value: { type: 'key', key: 'secret' } }),
    )
    const stored = db.encryptedCredential('openai')
    expect(stored?.ciphertext).not.toContain('secret')
    expect(
      (await Effect.runPromise(repository.get<{ type: 'key'; key: string }>('openai')))?.value.key,
    ).toBe('secret')
    db.close()
  })

  test('密文被篡改时拒绝解密', async () => {
    const { db, keys } = await setup()
    const repository = new EncryptedCredentialRepository(db, keys)
    await Effect.runPromise(
      repository.set({ integrationID: 'openai', value: { type: 'key', key: 'secret' } }),
    )
    db.profileSqlite
      .query('UPDATE credentials SET ciphertext = ? WHERE integration_id = ?')
      .run('AAAA', 'openai')
    await expect(Effect.runPromise(repository.get('openai'))).rejects.toMatchObject({
      code: 'CREDENTIAL_READ_FAILED',
    })
    await expect(Effect.runPromise(repository.validateAll())).rejects.toMatchObject({
      code: 'CREDENTIAL_READ_FAILED',
    })
    db.close()
  })

  test('已有密文但主密钥丢失时不生成新密钥', async () => {
    const { db, keys } = await setup()
    await Effect.runPromise(
      new EncryptedCredentialRepository(db, keys).set({
        integrationID: 'openai',
        value: { type: 'key', key: 'secret' },
      }),
    )
    const missing = memoryKeyStore()
    await expect(
      Effect.runPromise(new EncryptedCredentialRepository(db, missing).get('openai')),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_KEY_UNAVAILABLE' })
    expect(missing.value).toBeNull()
    db.close()
  })

  test('同一 Provider 可保存多条 API Key，删除活动项后不自动切换', async () => {
    const { db, keys } = await setup()
    const repository = new EncryptedCredentialRepository(db, keys)
    const first = await Effect.runPromise(
      repository.createApiKey({ integrationID: 'openai', label: '主 Key', key: 'sk-first' }),
    )
    const second = await Effect.runPromise(
      repository.createApiKey({ integrationID: 'openai', label: '备用 Key', key: 'sk-second' }),
    )
    await expect(
      Effect.runPromise(
        repository.createApiKey({
          integrationID: 'openai',
          label: '重复 Key',
          key: 'sk-first',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(
      repository.listApiKeys('openai').map(({ label, active }) => ({ label, active })),
    ).toEqual([
      { label: '主 Key', active: true },
      { label: '备用 Key', active: false },
    ])
    await Effect.runPromise(repository.reorder('openai', [second.id, first.id]))
    expect(repository.listApiKeys('openai').map((item) => item.id)).toEqual([second.id, first.id])
    await Effect.runPromise(repository.setActive('openai', second.id))
    expect(
      await Effect.runPromise(repository.compareAndSetActive('openai', first.id, first.id)),
    ).toBeFalse()
    expect(repository.listApiKeys('openai').find((item) => item.active)?.id).toBe(second.id)
    await Effect.runPromise(repository.deleteApiKey(second.id))
    expect(repository.listApiKeys('openai')).toHaveLength(1)
    expect(repository.listApiKeys('openai')[0]).toMatchObject({ id: first.id, active: false })
    expect(await Effect.runPromise(repository.activeCredential('openai'))).toBeNull()
    db.close()
  })

  test('OAuth 登录保留已有活动 Key，并允许手动切换和切回', async () => {
    const { db, keys } = await setup()
    const repository = new EncryptedCredentialRepository(db, keys)
    const key = await Effect.runPromise(
      repository.createApiKey({
        integrationID: 'anthropic',
        label: 'API Key',
        key: 'sk-existing',
      }),
    )
    const oauth = await Effect.runPromise(
      repository.upsertOAuth({
        providerID: 'anthropic',
        methodID: 'oauth',
        value: {
          type: 'oauth',
          methodID: 'oauth',
          refresh: 'refresh',
          access: 'access',
          expires: Date.now() + 60_000,
        },
      }),
    )
    expect(repository.listProviderCredentials('anthropic')).toHaveLength(2)
    expect(oauth.active).toBeFalse()
    expect(repository.listProviderCredentials('anthropic').find((item) => item.active)?.id).toBe(
      key.id,
    )
    await Effect.runPromise(repository.setProviderCredentialActive('anthropic', oauth.id))
    expect(repository.listProviderCredentials('anthropic').find((item) => item.active)?.id).toBe(
      oauth.id,
    )
    await Effect.runPromise(repository.setProviderCredentialActive('anthropic', key.id))
    expect(repository.listProviderCredentials('anthropic').find((item) => item.active)?.id).toBe(
      key.id,
    )
    db.close()
  })

  test('API Key 摘要不泄露明文且更换时刷新 nonce 和健康状态', async () => {
    const { db, keys } = await setup()
    const repository = new EncryptedCredentialRepository(db, keys)
    const created = await Effect.runPromise(
      repository.createApiKey({ integrationID: 'anthropic', label: '生产', key: 'secret-old' }),
    )
    const before = db.encryptedCredentialByID(created.id)!
    await Effect.runPromise(
      repository.updateHealth(created.id, {
        status: 'auth-failed',
        lastErrorCategory: 'authentication',
      }),
    )
    await expect(
      Effect.runPromise(repository.setActive('anthropic', created.id)),
    ).resolves.toMatchObject({ id: created.id })
    const replaced = await Effect.runPromise(repository.replaceApiKey(created.id, 'secret-new'))
    const after = db.encryptedCredentialByID(created.id)!

    expect(JSON.stringify(replaced)).not.toContain('secret-new')
    expect(replaced.maskedValue).toBe('••••-new')
    expect(replaced.health.status).toBe('untested')
    expect(after.nonce).not.toBe(before.nonce)
    expect(
      (await Effect.runPromise(repository.getById<{ key: string }>(created.id)))?.value.key,
    ).toBe('secret-new')
    db.close()
  })
})
