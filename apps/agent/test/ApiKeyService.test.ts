import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { Model, Provider } from '@pidex/model-schema'
import { Effect } from 'effect'
import {
  EncryptedCredentialRepository,
  type MasterKeyStore,
} from '../src/auth/EncryptedCredentialRepository'
import { ApiKeyService } from '../src/provider/ApiKeyService'
import { ModelHealthService } from '../src/provider/ModelHealthService'
import type { PiModelService } from '../src/provider/pi'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'

const paths: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await removeFixturePaths(paths.splice(0))
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

const setup = async (
  completeSimple: () => Promise<unknown>,
  options: { modelAvailable?: boolean } = {},
) => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-api-key-service-'))
  paths.push(root)
  const database = new AgentDatabase(join(root, 'agent.sqlite'))
  databases.push(database)
  const credentials = new EncryptedCredentialRepository(database, memoryKeyStore())
  const key = 'test-key-with-unusual.characters'
  const summary = await Effect.runPromise(
    credentials.createApiKey({
      integrationID: 'openai',
      label: '测试 Key',
      key,
    }),
  )
  const providerID = Provider.ID.make('openai')
  const providers = {
    list: async () => [{ id: providerID, integrationID: 'openai' }],
    models: async () =>
      options.modelAvailable === false
        ? []
        : [
            {
              providerID,
              id: Model.ID.make('test-model'),
              enabled: true,
            },
          ],
    getPiModel: async () => ({ provider: 'openai', id: 'test-model' }),
    pi: { completeSimple },
  } as unknown as PiModelService
  const service = new ApiKeyService(
    providers,
    credentials,
    new ModelHealthService(providers, () => {}),
  )
  return { credentials, key, service, credentialID: String(summary.id) }
}

describe('API Key 测试', () => {
  test('鉴权失败作为普通结果返回并使用安全固定文案', async () => {
    let currentKey = ''
    const fixture = await setup(async () => ({
      stopReason: 'error',
      errorMessage: `401 unauthorized: invalid API key ${currentKey}`,
    }))
    currentKey = fixture.key

    const result = await fixture.service.test(fixture.credentialID)

    expect(result.ok).toBeFalse()
    expect(result.message).toBe('凭据鉴权失败')
    expect(result.credential.health).toMatchObject({
      status: 'auth-failed',
      errorCategory: 'authentication',
    })
    expect(result.message).not.toContain(fixture.key)
  })

  test('限流失败只记录显式测试结果，不建立自动冷却', async () => {
    const fixture = await setup(async () => {
      throw Object.assign(new Error('429 rate limit exceeded'), { status: 429 })
    })

    const result = await fixture.service.test(fixture.credentialID)

    expect(result.ok).toBeFalse()
    expect(result.message).toBe('请求受到限流')
    expect(result.credential.health).toMatchObject({
      status: 'rate-limited',
      errorCategory: 'rate-limit',
    })
    expect(result.credential.health).not.toHaveProperty('cooldownUntil')
  })

  test('aborted 超时响应不会被标记为健康', async () => {
    const fixture = await setup(async () => ({
      stopReason: 'aborted',
      errorMessage: 'request timeout',
    }))

    const result = await fixture.service.test(fixture.credentialID)

    expect(result.ok).toBeFalse()
    expect(result.message).toBe('请求在 15 秒内未完成')
    expect(result.credential.health).toMatchObject({
      status: 'error',
      errorCategory: 'unknown',
    })
  })

  test('成功响应返回可用结果并更新健康状态', async () => {
    const fixture = await setup(async () => ({ stopReason: 'stop' }))

    const result = await fixture.service.test(fixture.credentialID)

    expect(result.ok).toBeTrue()
    expect(result.message).toBe('API Key 可用。')
    expect(result.credential.health).toMatchObject({ status: 'healthy' })
    expect(result.credential.health).not.toHaveProperty('lastUsedAt')
  })

  test('没有可用模型时返回配置失败而不发起请求', async () => {
    let requests = 0
    const fixture = await setup(
      async () => {
        requests += 1
        return { stopReason: 'stop' }
      },
      { modelAvailable: false },
    )

    const result = await fixture.service.test(fixture.credentialID)

    expect(result.ok).toBeFalse()
    expect(result.message).toBe('配置不可用：Provider openai 没有可用模型')
    expect(requests).toBe(0)
  })
})
