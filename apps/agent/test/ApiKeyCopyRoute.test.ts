import { describe, expect, test } from 'bun:test'
import type { AgentConfig } from '../src/config/Config'
import type { AgentLogger } from '../src/observability/AgentLogger'
import type { ApiKeyService } from '../src/provider/ApiKeyService'
import { createApp, type TransportDependencies } from '../src/transport/Server'

const credentialID = 'cred_00000000-0000-4000-8000-000000000001'

const appWithCopyMaterial = (copyMaterial: (id: string) => Promise<string>) =>
  createApp({
    config: { authToken: 'desktop-token' } as AgentConfig,
    apiKeys: { copyMaterial } as ApiKeyService,
    logger: {
      request: () => undefined,
      error: () => undefined,
    } as unknown as AgentLogger,
    db: {},
    hub: {},
    threads: {},
    history: {},
    approvals: {},
    questions: {},
    subagents: {},
    attachments: {},
    providers: {},
    integrations: {},
    memory: {},
    hooks: {},
    review: {},
    github: {},
  } as unknown as TransportDependencies)

describe('API Key 安全复制路由', () => {
  test('拒绝仅 Cookie 请求，只允许桌面主进程 Bearer Token', async () => {
    let reads = 0
    const app = appWithCopyMaterial(async (id) => {
      reads += 1
      expect(id).toBe(credentialID)
      return 'secret-copy-material'
    })
    const path = `/api/desktop/api-keys/${credentialID}/copy-material`

    const cookieOnly = await app.request(path, {
      method: 'POST',
      headers: { Cookie: 'pidex_session=desktop-token' },
    })
    expect(cookieOnly.status).toBe(403)
    expect(reads).toBe(0)

    const bearer = await app.request(path, {
      method: 'POST',
      headers: { Authorization: 'Bearer desktop-token' },
    })
    expect(bearer.status).toBe(200)
    expect(bearer.headers.get('Cache-Control')).toContain('no-store')
    expect(await bearer.json()).toEqual({ key: 'secret-copy-material' })
    expect(reads).toBe(1)
  })
})
