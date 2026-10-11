import { describe, expect, test } from 'bun:test'
import {
  parseMcpServerJson,
  parseMcpTransportJson,
} from '../src/features/settings/plugins/McpEditorDialog.js'

describe('MCP editor transport schema', () => {
  test('accepts strict stdio and HTTP environment-reference configurations', () => {
    expect(
      parseMcpTransportJson(
        JSON.stringify({
          type: 'stdio',
          command: 'bun',
          args: ['server.ts'],
          env: { LOG_LEVEL: 'info' },
          envFromHost: { SERVICE_TOKEN: 'MCP_SERVICE_TOKEN' },
        }),
      ),
    ).toEqual({
      type: 'stdio',
      command: 'bun',
      args: ['server.ts'],
      env: { LOG_LEVEL: 'info' },
      envFromHost: { SERVICE_TOKEN: 'MCP_SERVICE_TOKEN' },
    })
    expect(
      parseMcpTransportJson(
        JSON.stringify({
          type: 'http',
          url: 'https://example.com/mcp',
          headerFromEnv: { 'X-API-Key': 'MCP_API_KEY' },
          bearerTokenEnvVar: 'MCP_ACCESS_TOKEN',
        }),
      ),
    ).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      auth: 'oauth',
      headerFromEnv: { 'X-API-Key': 'MCP_API_KEY' },
      bearerTokenEnvVar: 'MCP_ACCESS_TOKEN',
    })
  })

  test('rejects unknown fields and persisted static credentials', () => {
    expect(() =>
      parseMcpTransportJson(
        JSON.stringify({
          type: 'http',
          url: 'https://example.com/mcp',
          transport: 'sse',
        }),
      ),
    ).toThrow('未知字段')
    expect(() =>
      parseMcpTransportJson(
        JSON.stringify({
          type: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer secret' },
        }),
      ),
    ).toThrow('环境变量')
    expect(() =>
      parseMcpTransportJson(
        JSON.stringify({
          type: 'stdio',
          command: 'bun',
          env: { ACCESS_TOKEN: 'secret' },
        }),
      ),
    ).toThrow('宿主环境变量')
  })

  test('round-trips stdio diagnostic context in the full server JSON', () => {
    expect(
      parseMcpServerJson(
        JSON.stringify({
          name: 'pidex-debug',
          scope: 'local',
          enabled: true,
          diagnosticContext: true,
          transport: {
            type: 'stdio',
            command: 'bun',
            args: ['McpDebugServer.ts', '--transport=stdio'],
          },
          startupTimeoutMs: 10_000,
        }),
      ),
    ).toEqual({
      name: 'pidex-debug',
      scope: 'local',
      enabled: true,
      diagnosticContext: true,
      transport: {
        type: 'stdio',
        command: 'bun',
        args: ['McpDebugServer.ts', '--transport=stdio'],
      },
      startupTimeoutMs: 10_000,
    })
  })

  test('rejects diagnostic context for HTTP configurations', () => {
    expect(() =>
      parseMcpServerJson(
        JSON.stringify({
          name: 'remote-debug',
          scope: 'user',
          enabled: true,
          diagnosticContext: true,
          transport: {
            type: 'http',
            url: 'http://127.0.0.1:43121/mcp',
          },
        }),
      ),
    ).toThrow('只支持 stdio')
  })

  test('round-trips OAuth and structured tool policy fields', () => {
    const config = {
      name: 'oauth-server',
      scope: 'user',
      enabled: true,
      required: true,
      enabledTools: ['read'],
      disabledTools: ['delete'],
      defaultToolsApprovalMode: 'writes',
      tools: {
        publish: { approvalMode: 'prompt' },
      },
      transport: {
        type: 'http',
        url: 'https://example.com/mcp',
        auth: 'oauth',
        scopes: ['mcp.read', 'mcp.write'],
        oauthResource: 'https://example.com',
      },
    }

    expect(parseMcpServerJson(JSON.stringify(config))).toEqual({
      ...config,
      diagnosticContext: false,
    })
  })

  test('rejects OAuth-only fields without OAuth and preserves deny-list precedence data', () => {
    expect(() =>
      parseMcpTransportJson(
        JSON.stringify({
          type: 'http',
          url: 'https://example.com/mcp',
          auth: 'none',
          scopes: ['mcp.read'],
        }),
      ),
    ).toThrow('仅能用于 OAuth')
    expect(
      parseMcpServerJson(
        JSON.stringify({
          name: 'conflict',
          scope: 'user',
          enabled: true,
          enabledTools: ['echo'],
          disabledTools: ['echo'],
          transport: {
            type: 'stdio',
            command: 'bun',
          },
        }),
      ),
    ).toMatchObject({
      enabledTools: ['echo'],
      disabledTools: ['echo'],
    })
  })
})
