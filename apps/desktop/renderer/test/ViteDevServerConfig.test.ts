import { describe, expect, test } from 'bun:test'

import {
  normalizeRendererAgentOrigin,
  resolveRendererDevServer,
  resolveRendererServerOverrides,
} from '../vite.config'

const agentEnvironment = {
  PIDEX_AGENT_URL: 'http://127.0.0.1:43120',
  PIDEX_AUTH_TOKEN: 'local_development_token_1234567890',
  PIDEX_RENDERER_PORT: '49152',
}

describe('Renderer Vite development server configuration', () => {
  test('uses the injected port for HTTP and HMR', () => {
    const server = resolveRendererDevServer('development', agentEnvironment)

    expect(server.port).toBe(49152)
    expect(server.hmr).toEqual({
      protocol: 'ws',
      host: '127.0.0.1',
      port: 49152,
      clientPort: 49152,
    })
  })

  test('proxies RPC, event streams and API requests to the shared Agent', () => {
    const server = resolveRendererDevServer('development', agentEnvironment)

    expect(Object.keys(server.proxy ?? {})).toEqual(['/rpc', '/api'])
    expect(server.proxy?.['/rpc']?.target).toBe(agentEnvironment.PIDEX_AGENT_URL)
    expect(server.proxy?.['/api']?.target).toBe(agentEnvironment.PIDEX_AGENT_URL)
  })

  test('adds Agent authentication on the proxy server without exposing it in client config', () => {
    const server = resolveRendererDevServer('development', agentEnvironment)
    const rpcProxy = server.proxy?.['/rpc']
    let proxyRequestListener:
      ((request: { setHeader(name: string, value: string): void }) => void) | undefined
    const proxyServer = {
      on(event: string, listener: unknown) {
        if (event === 'proxyReq') {
          proxyRequestListener = listener as typeof proxyRequestListener
        }
        return this
      },
    }
    rpcProxy?.configure?.(proxyServer as never, rpcProxy)

    const headers = new Map<string, string>()
    proxyRequestListener?.({
      setHeader(name, value) {
        headers.set(name, value)
      },
    })

    expect(headers.get('Authorization')).toBe(`Bearer ${agentEnvironment.PIDEX_AUTH_TOKEN}`)
    expect(JSON.stringify({ port: server.port, hmr: server.hmr })).not.toContain(
      agentEnvironment.PIDEX_AUTH_TOKEN,
    )
  })

  test('rejects invalid Renderer ports without including provided secrets', () => {
    const secret = 'local_development_token_should_not_be_logged'
    let message = ''
    try {
      resolveRendererDevServer('development', {
        ...agentEnvironment,
        PIDEX_AUTH_TOKEN: secret,
        PIDEX_RENDERER_PORT: '70000',
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('PIDEX_RENDERER_PORT')
    expect(message).not.toContain(secret)
  })

  test('accepts only an exact loopback HTTP Agent origin with an explicit port', () => {
    expect(normalizeRendererAgentOrigin('http://127.0.0.1:43120')).toBe('http://127.0.0.1:43120')
    for (const origin of [
      'https://127.0.0.1:43120',
      'http://localhost:43120',
      'http://127.0.0.1',
      'http://127.0.0.1:43120/api',
      'http://user@127.0.0.1:43120',
    ]) {
      expect(() => normalizeRendererAgentOrigin(origin)).toThrow()
    }
  })

  test('requires Agent origin and token together and rejects malformed tokens', () => {
    expect(() =>
      resolveRendererDevServer('development', {
        PIDEX_AGENT_URL: agentEnvironment.PIDEX_AGENT_URL,
      }),
    ).toThrow()
    expect(() =>
      resolveRendererDevServer('development', {
        PIDEX_AGENT_URL: agentEnvironment.PIDEX_AGENT_URL,
        PIDEX_AUTH_TOKEN: 'contains spaces and is invalid',
      }),
    ).toThrow()
  })

  test('supports standalone development without creating an Agent proxy', () => {
    const server = resolveRendererDevServer('development', {})

    expect(server.port).toBeUndefined()
    expect(server.proxy).toBeUndefined()
    expect(server.hmr).toEqual({ protocol: 'ws', host: '127.0.0.1' })
  })

  test('does not read credentials or create a proxy for production builds', () => {
    expect(
      resolveRendererServerOverrides('build', 'production', {
        PIDEX_AGENT_URL: 'https://not-a-development-agent.example',
        PIDEX_AUTH_TOKEN: 'a secret that production must not inspect',
      }),
    ).toEqual({})
  })
})
