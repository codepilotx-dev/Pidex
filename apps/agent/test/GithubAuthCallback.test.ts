import { describe, expect, test } from 'bun:test'
import type { AgentConfig } from '../src/config/Config'
import type { GithubService } from '../src/github/GithubService'
import type { AgentLogger } from '../src/observability/AgentLogger'
import { createApp, type TransportDependencies } from '../src/transport/Server'

const callbackApp = (handleOAuthCallback: GithubService['handleOAuthCallback']) =>
  createApp({
    config: { authToken: 'desktop-token' } as AgentConfig,
    github: { handleOAuthCallback } as GithubService,
    logger: {
      request: () => undefined,
      error: () => undefined,
      warn: () => undefined,
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
    apiKeys: {},
    memory: {},
    hooks: {},
    review: {},
  } as unknown as TransportDependencies)

describe('GitHub OAuth callback route', () => {
  test('无需桌面 cookie，返回 no-store CSP 静态成功页', async () => {
    let callback: unknown
    const app = callbackApp(async (input) => {
      callback = input
      return { state: 'completed' } as Awaited<ReturnType<GithubService['handleOAuthCallback']>>
    })
    const response = await app.request('/auth/github/callback?code=secret-code&state=secret-state')
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect(html).toContain('GitHub 登录成功')
    expect(html).not.toContain('secret-code')
    expect(html).not.toContain('secret-state')
    expect(callback).toEqual({ code: 'secret-code', state: 'secret-state' })
  })

  test('拒绝外部 Origin，且失败页不泄露回调参数', async () => {
    let called = false
    const app = callbackApp(async () => {
      called = true
      throw new Error('secret-code')
    })
    const denied = await app.request(
      'http://127.0.0.1:41234/auth/github/callback?code=secret-code',
      {
        headers: { Origin: 'https://evil.example' },
      },
    )
    expect(denied.status).toBe(403)
    expect(called).toBe(false)

    const failed = await app.request('/auth/github/callback?code=secret-code')
    const html = await failed.text()
    expect(failed.status).toBe(200)
    expect(html).toContain('GitHub 登录未完成')
    expect(html).not.toContain('secret-code')
  })
})
