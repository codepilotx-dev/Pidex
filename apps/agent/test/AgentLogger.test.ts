import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentLogger } from '../src/observability/AgentLogger'
import { createApp, type TransportDependencies } from '../src/transport/Server'

const roots: string[] = []
const makeRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-agent-logger-'))
  roots.push(root)
  return root
}
const records = async (root: string) =>
  (await readFile(join(root, 'agent.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)

afterEach(async () => removeFixturePaths(roots.splice(0)))

describe('AgentLogger', () => {
  test('safe 模式写统一 schema、递归脱敏且终端不包含开发详情', async () => {
    const root = await makeRoot()
    const output: string[] = []
    const logger = new AgentLogger(root, {
      consoleLevel: 'debug',
      detailMode: 'safe',
      consoleSink: (line) => output.push(line),
      now: () => new Date('2026-07-25T06:30:00.000Z'),
    })
    const error = new Error('Bearer top-secret')
    logger.error('tool.failed', {
      context: { threadId: 'thread-123456789', turnId: 'turn-123456789' },
      details: { tool: 'PowerShell', error, apiKey: 'sk-secret' },
      development: { command: 'echo sk-secret' },
    })

    const record = (await records(root))[0]!
    expect(record.component).toBe('agent')
    expect(record.event).toBe('tool.failed')
    expect(record).not.toHaveProperty('development')
    expect(JSON.stringify(record)).not.toContain('top-secret')
    expect(JSON.stringify(record)).not.toContain('sk-secret')
    expect(JSON.stringify(record)).not.toContain('stack')
    expect(output.join('')).toContain('thread=thread-1')
    expect(output.join('')).not.toContain('command')
  })

  test('development 模式只在文件加入脱敏开发详情', async () => {
    const root = await makeRoot()
    const output: string[] = []
    const logger = new AgentLogger(root, {
      consoleLevel: 'debug',
      detailMode: 'development',
      consoleSink: (line) => output.push(line),
    })
    logger.info('tool.started', {
      details: { tool: 'PowerShell' },
      development: { command: "curl -H 'Authorization=secret' https://example.com" },
    })

    const record = (await records(root))[0]!
    expect(JSON.stringify(record)).toContain('[REDACTED]')
    expect(JSON.stringify(record)).not.toContain('Authorization=secret')
    expect(output.join('')).not.toContain('curl')
  })

  test('只记录失败请求和慢请求', async () => {
    const root = await makeRoot()
    const logger = new AgentLogger(root)
    logger.request({ method: 'GET', path: '/api/ready', status: 200, durationMs: 1 })
    logger.request({ method: 'POST', path: '/rpc', status: 200, durationMs: 20 })
    logger.request({ method: 'POST', path: '/rpc', status: 404, durationMs: 5 })
    logger.request({ method: 'GET', path: '/api/ready', status: 200, durationMs: 1_100 })

    expect((await records(root)).map((record) => record.event)).toEqual([
      'http.request.failed',
      'http.request.slow',
    ])
  })

  test('RPC 区分正常等待、真实慢请求和协议错误，HTTP 不重复告警', async () => {
    const root = await makeRoot()
    const output: string[] = []
    const logger = new AgentLogger(root, {
      consoleLevel: 'info',
      consoleSink: (line) => output.push(line),
    })
    logger.request({ method: 'POST', path: '/rpc', status: 200, durationMs: 20_000 })
    logger.rpc({ method: 'browser/host/next', durationMs: 20_000, expectedWait: true })
    logger.rpc({ method: 'thread/read', durationMs: 6_000 })
    logger.rpc({ method: 'thread/read', durationMs: 10_000 })
    logger.rpc({
      method: 'computer/host/next',
      durationMs: 20_000,
      expectedWait: true,
      rpcCode: -32000,
      code: 'UNAUTHORIZED',
      retryable: false,
    })
    logger.rpc({ method: 'turn/start', durationMs: 1, rpcCode: -32603 })

    const logged = await records(root)
    expect(logged.map((record) => [record.level, record.event])).toEqual([
      ['debug', 'rpc.wait.completed'],
      ['debug', 'rpc.request.completed'],
      ['warn', 'rpc.request.slow'],
      ['warn', 'rpc.request.failed'],
      ['error', 'rpc.request.failed'],
    ])
    expect(output).toHaveLength(3)
    expect(output[0]).toContain('method=thread/read')
    expect(output[1]).toContain('code=UNAUTHORIZED')
    expect(output.join('')).not.toContain('http.request.slow')
  })

  test('HTTP 200 内的 RPC 错误包含方法与回合关联，不记录请求正文', async () => {
    const root = await makeRoot()
    const logger = new AgentLogger(root)
    const app = createApp({
      config: {},
      db: {},
      hub: {},
      logger,
    } as unknown as TransportDependencies)
    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'request-1',
        method: 'turn/start',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          content: 'private prompt',
          apiKey: 'sk-private',
        },
      }),
    })
    expect(response.status).toBe(200)
    const logged = await records(root)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({
      level: 'warn',
      event: 'rpc.request.failed',
      context: { threadId: 'thread-1', turnId: 'turn-1' },
      details: { method: 'turn/start', code: 'UNAUTHORIZED' },
    })
    expect(JSON.stringify(logged)).not.toContain('private prompt')
    expect(JSON.stringify(logged)).not.toContain('sk-private')
  })

  test('仅保留数值用量，token 字符串及嵌套凭据继续脱敏', async () => {
    const root = await makeRoot()
    const output: string[] = []
    const logger = new AgentLogger(root, {
      consoleLevel: 'info',
      consoleSink: (line) => output.push(line),
    })
    logger.info('provider.completed', {
      context: { threadId: 'sk-private-thread', interactionId: 'sk-private-interaction' },
      details: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        beforeTokens: 100,
        cacheWriteTokens: 'private-token',
        accessToken: 'private-access',
        credential: { inputTokens: 123 },
      },
    })
    const logged = await records(root)
    expect(logged[0]?.details).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      beforeTokens: 100,
      cacheWriteTokens: '[REDACTED]',
      accessToken: '[REDACTED]',
      credential: '[REDACTED]',
    })
    expect(output[0]).toContain('inputTokens=10')
    expect(JSON.stringify(logged)).not.toContain('private-')
    expect(output.join('')).not.toContain('private-')
  })
})
