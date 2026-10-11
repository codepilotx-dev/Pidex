import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { Effect } from 'effect'
import { AuthJsonCredentialRepository } from '../src/auth/AuthJsonCredentialRepository'
import {
  EncryptedCredentialRepository,
  type MasterKeyStore,
} from '../src/auth/EncryptedCredentialRepository'
import { ProviderCredentialStoreManager } from '../src/auth/ProviderCredentialStoreManager'
import type { ProviderCredentialStoreKind } from '../src/auth/ProviderCredentialRepository'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EncryptedCredentialStore } from '../src/provider/pi/EncryptedCredentialStore'

const roots: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await removeFixturePaths(roots.splice(0))
})

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
  const root = await mkdtemp(join(tmpdir(), 'pidex-provider-store-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'profile.sqlite'))
  databases.push(db)
  const encrypted = new EncryptedCredentialRepository(db, memoryKeyStore())
  const authJson = new AuthJsonCredentialRepository(join(root, 'auth.json'))
  return { root, db, encrypted, authJson }
}

describe('Provider 凭据双仓库', () => {
  test('ChatGPT 登录和重新授权保留已有活动 API Key，允许手动切换 OAuth', async () => {
    const { encrypted, authJson } = await setup()
    await Effect.runPromise(authJson.initialize())
    for (const repository of [encrypted, authJson]) {
      const key = await Effect.runPromise(
        repository.createApiKey({
          integrationID: 'openai',
          label: '已有 API Key',
          key: 'fixture-key',
        }),
      )
      const store = new EncryptedCredentialStore(repository)
      const credential = {
        type: 'oauth' as const,
        access: 'fixture-access',
        refresh: 'fixture-refresh',
        expires: Date.now() + 60_000,
        clientId: 'fixture-client',
        scopes: ['offline_access'],
      }
      await store.modify('openai', async () => credential)
      await store.modify('openai', async () => ({ ...credential, access: 'fixture-reauthorized' }))
      expect((await Effect.runPromise(repository.activeCredential('openai')))?.id).toBe(key.id)
      const oauth = repository
        .listProviderCredentials('openai')
        .find((item) => item.kind === 'oauth')!
      expect(oauth.active).toBe(false)
      await Effect.runPromise(repository.setProviderCredentialActive('openai', oauth.id))
      expect(await store.read('openai')).toMatchObject({
        ...credential,
        access: 'fixture-reauthorized',
      })
    }
  })

  test('ChatGPT OAuth metadata 在双仓库写入和刷新后完整往返', async () => {
    const { encrypted, authJson } = await setup()
    await Effect.runPromise(authJson.initialize())
    for (const repository of [encrypted, authJson]) {
      const store = new EncryptedCredentialStore(repository)
      const credential = {
        type: 'oauth' as const,
        access: 'fixture-access',
        refresh: 'fixture-refresh',
        expires: Date.now() + 60_000,
        clientId: 'fixture-issued-client',
        scopes: ['chatgpt.tokens.use.direct', 'offline_access'],
      }
      await store.modify('openai', async () => credential)
      expect(await store.read('openai')).toMatchObject(credential)
      await store.modify('openai', async (current) => ({
        ...current!,
        type: 'oauth',
        access: 'fixture-refreshed-access',
        refresh: 'fixture-refreshed-refresh',
        expires: credential.expires + 60_000,
      }))
      expect(await new EncryptedCredentialStore(repository).read('openai')).toMatchObject({
        clientId: credential.clientId,
        scopes: credential.scopes,
        access: 'fixture-refreshed-access',
        refresh: 'fixture-refreshed-refresh',
      })
      expect(JSON.stringify(await store.list())).not.toContain(credential.clientId)
      expect(JSON.stringify(await store.list())).not.toContain('fixture-refreshed-access')
    }
  })

  test('auth.json 拒绝覆盖非 Pidex 文件', async () => {
    const { root } = await setup()
    const path = join(root, 'auth.json')
    await writeFile(path, JSON.stringify({ openai: { type: 'api', key: 'foreign' } }))
    const repository = new AuthJsonCredentialRepository(path)

    await expect(Effect.runPromise(repository.initialize())).rejects.toMatchObject({
      code: 'CREDENTIAL_STORE_UNAVAILABLE',
    })
    expect(await readFile(path, 'utf8')).toContain('foreign')
  })

  test('auth.json 使用精确内存快照拒绝覆盖外部修改', async () => {
    const { root, authJson } = await setup()
    const path = join(root, 'auth.json')
    await Effect.runPromise(authJson.initialize())
    const created = await Effect.runPromise(
      authJson.createApiKey({
        integrationID: 'openai',
        label: 'primary',
        key: 'sk-original',
      }),
    )
    const externallyModified = `${await readFile(path, 'utf8')}\n`
    await writeFile(path, externallyModified, 'utf8')

    await expect(
      Effect.runPromise(authJson.replaceApiKey(created.id, 'sk-replacement')),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(path, 'utf8')).toBe(externallyModified)
  })

  test('切换只迁移 Provider 凭据并保留加密的 GitHub、MCP 与 usage 凭据', async () => {
    const { root, db, encrypted, authJson } = await setup()
    await Effect.runPromise(
      encrypted.createApiKey({
        integrationID: 'openai',
        label: '主账号',
        key: 'sk-provider',
      }),
    )
    await Effect.runPromise(
      encrypted.set({
        integrationID: 'github',
        label: 'GitHub',
        value: { type: 'oauth', access: 'gh-secret' },
      }),
    )
    await Effect.runPromise(
      encrypted.set({
        integrationID: 'mcp-oauth:fixture',
        label: 'MCP',
        value: { type: 'oauth', access: 'mcp-secret' },
      }),
    )
    await Effect.runPromise(
      encrypted.set({
        integrationID: 'usage.openai.admin',
        label: 'usage',
        value: { type: 'key', key: 'usage-secret' },
      }),
    )

    let selected: ProviderCredentialStoreKind | null = 'encrypted'
    const manager = new ProviderCredentialStoreManager(db, encrypted, authJson, {
      read: () => selected,
      write: async (store) => {
        selected = store
      },
    })
    await Effect.runPromise(manager.initialize())
    const result = await manager.updateStore('auth-json', 'operation:switch-auth-json')

    expect(result).toMatchObject({
      store: 'auth-json',
      portable: true,
      migratedCredentials: 1,
    })
    expect((await Effect.runPromise(manager.get<{ key: string }>('openai')))?.value.key).toBe(
      'sk-provider',
    )
    expect(encrypted.listProviderCredentials()).toHaveLength(0)
    expect(await Effect.runPromise(encrypted.get('github'))).not.toBeNull()
    expect(await Effect.runPromise(encrypted.get('mcp-oauth:fixture'))).not.toBeNull()
    expect(await Effect.runPromise(encrypted.get('usage.openai.admin'))).not.toBeNull()

    const text = await readFile(join(root, 'auth.json'), 'utf8')
    expect(text).toContain('sk-provider')
    expect(text).not.toContain('gh-secret')
    expect(text).not.toContain('mcp-secret')
    expect(text).not.toContain('usage-secret')
    expect(db.getSetting('provider.credentials.store-migration.v1')).toBeNull()

    const restored = await manager.updateStore('encrypted', 'operation:switch-encrypted')
    expect(restored).toMatchObject({
      store: 'encrypted',
      portable: false,
      migratedCredentials: 1,
    })
    expect((await Effect.runPromise(encrypted.get<{ key: string }>('openai')))?.value.key).toBe(
      'sk-provider',
    )
    expect(await Effect.runPromise(encrypted.get('github'))).not.toBeNull()
    expect(authJson.listProviderCredentials()).toHaveLength(0)
  })

  test('已有加密 Provider 凭据且未配置选项时保持加密并提示迁移', async () => {
    const { db, encrypted, authJson } = await setup()
    await Effect.runPromise(
      encrypted.createApiKey({
        integrationID: 'anthropic',
        label: '旧账号',
        key: 'sk-existing',
      }),
    )
    const manager = new ProviderCredentialStoreManager(db, encrypted, authJson, {
      read: () => null,
      write: async () => {},
    })

    await Effect.runPromise(manager.initialize())

    expect(manager.status()).toMatchObject({
      store: 'encrypted',
      portable: false,
      credentialCount: 1,
      migrationRequired: true,
    })
  })
})
