import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import {
  EncryptedCredentialRepository,
  type MasterKeyStore,
} from '../src/auth/EncryptedCredentialRepository'
import { McpClientFactory } from '../src/mcp/McpClientFactory'
import { McpOAuthCoordinator } from '../src/mcp/McpOAuthCoordinator'
import { McpOAuthCredentialRepository } from '../src/mcp/McpOAuthCredentialRepository'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { MCP_DIAGNOSTIC_CONTEXT_KEY } from '../src/mcp/McpDiagnosticContextProvider'

const connections: Array<{ close: () => Promise<void> }> = []
const processes: Bun.Subprocess[] = []
const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()))
  const children = processes.splice(0)
  for (const process of children) process.kill()
  await Promise.all(children.map((process) => process.exited))
  await removeFixturePaths(temporaryPaths.splice(0))
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

const waitForPort = async (path: string) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await readFile(path, 'utf8').catch(() => '')
    if (/^\d+$/.test(value)) return Number(value)
    await Bun.sleep(50)
  }
  throw new Error('MCP debug OAuth server did not publish its port')
}

describe('MCP debug server', () => {
  test('captures calls and runs a deterministic scripted conversation over stdio', async () => {
    let catalogChanges = 0
    const connection = await new McpClientFactory().connect(
      {
        name: 'pidex-debug',
        scope: 'user',
        enabled: true,
        transport: {
          type: 'stdio',
          command: process.execPath,
          args: [resolve(import.meta.dir, '../scripts/McpDebugServer.ts'), '--transport=stdio'],
        },
        startupTimeoutMs: 20_000,
      },
      () => {
        catalogChanges += 1
      },
    )
    connections.push(connection)

    expect(connection.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'capture',
        'assert_value',
        'conversation_configure',
        'conversation_send',
        'conversation_history',
        'large_result',
        'change_tools',
        'disconnect',
      ]),
    )
    expect(connection.instructions).toContain('MCP 对话调试实验室')

    await connection.callTool('conversation_configure', {
      channel: 'review',
      replies: ['ask-details', 'done'],
      loop: false,
    })
    const first = await connection.callTool('conversation_send', {
      channel: 'review',
      message: 'start',
    })
    expect(first.content).toMatchObject([
      { type: 'text', text: expect.stringContaining('ask-details') },
    ])

    const history = await connection.callTool('conversation_history', {
      channel: 'review',
      cursor: 0,
      limit: 20,
    })
    expect(history.content).toMatchObject([
      { type: 'text', text: expect.stringContaining('"role":"client"') },
    ])

    const capture = await connection.callTool(
      'capture',
      {
        label: 'checkpoint',
        message: 'conversation reached the first reply',
      },
      undefined,
      { [MCP_DIAGNOSTIC_CONTEXT_KEY]: { version: 1, marker: 'host-context' } },
    )
    expect(capture.structuredContent).toMatchObject({
      captured: true,
      callId: expect.stringMatching(/^call-\d+$/),
    })
    expect((await connection.readResource('debug://context/latest')).contents).toMatchObject([
      { text: expect.stringContaining('host-context') },
    ])

    const calls = await connection.readResource('debug://calls')
    expect(calls.contents).toMatchObject([
      {
        uri: 'debug://calls',
        text: expect.stringContaining('"tool": "capture"'),
      },
    ])

    await connection.callTool('change_tools', { enabled: true })
    const dynamic = await connection.callTool('dynamic_echo', { value: 'dynamic-ok' })
    expect(dynamic.content).toMatchObject([{ type: 'text', text: 'dynamic-ok' }])
    expect(catalogChanges).toBeGreaterThan(0)
  }, 30_000)

  test.each([false, true])(
    'completes PKCE OAuth and refreshes existing encrypted tokens (resource override: %s)',
    async (override) => {
      const root = await mkdtemp(join(tmpdir(), 'pidex-mcp-oauth-'))
      temporaryPaths.push(root)
      const portFile = join(root, 'port.txt')
      const child = Bun.spawn(
        [
          process.execPath,
          resolve(import.meta.dir, '../scripts/McpDebugServer.ts'),
          '--transport=http',
          '--port=0',
          `--port-file=${portFile}`,
          '--oauth',
        ],
        { stdout: 'ignore', stderr: 'ignore' },
      )
      processes.push(child)
      const port = await waitForPort(portFile)
      const server = {
        name: 'pidex-debug-oauth',
        scope: 'user' as const,
        enabled: true,
        transport: {
          type: 'http' as const,
          url: `http://127.0.0.1:${port}/mcp`,
          auth: 'oauth' as const,
          scopes: ['mcp:tools', 'mcp:resources'],
          ...(override ? { oauthResource: 'https://api.example.com/explicit-resource' } : {}),
        },
        startupTimeoutMs: 20_000,
      }
      const db = new AgentDatabase(join(root, 'agent.sqlite'))
      const encrypted = new EncryptedCredentialRepository(db, memoryKeyStore())
      const repository = new McpOAuthCredentialRepository(encrypted)
      const coordinator = new McpOAuthCoordinator(
        repository,
        'http://127.0.0.1:43210/auth/mcp/callback',
      )
      const start = await coordinator.start(server)
      expect(new URL(start.authorizationUrl).searchParams.get('resource')).toBe(
        override ? server.transport.oauthResource! : server.transport.url,
      )
      expect(new URL(start.authorizationUrl).searchParams.get('code_challenge_method')).toBe('S256')
      const authorization = await fetch(start.authorizationUrl, { redirect: 'manual' })
      const callback = new URL(authorization.headers.get('location')!)
      const callbackInput = {
        code: callback.searchParams.get('code')!,
        state: callback.searchParams.get('state')!,
      }
      expect(
        (await coordinator.handleCallback({ ...callbackInput, state: 'wrong-state' })).completed,
      ).toBe(false)
      expect((await coordinator.handleCallback(callbackInput)).completed).toBe(true)
      expect((await coordinator.handleCallback(callbackInput)).completed).toBe(false)
      expect(coordinator.status(start.attemptId).state).toBe('completed')

      const identity = repository.identity({
        scope: 'user',
        serverName: server.name,
        serverUrl: server.transport.url,
      })
      const existing = (await repository.get(identity))!
      expect(existing.version).toBe(1)
      await repository.set(identity, {
        ...existing,
        tokens: { ...existing.tokens!, access_token: 'expired-access-token' },
      })
      const reopened = new McpOAuthCoordinator(
        repository,
        'http://127.0.0.1:43210/auth/mcp/callback',
      )
      const connection = await new McpClientFactory(reopened).connect(server, () => undefined)
      connections.push(connection)
      expect((await connection.callTool('echo', { text: 'oauth-ok' })).content).toMatchObject([
        { type: 'text', text: 'oauth-ok' },
      ])
      expect((await repository.get(identity))?.tokens?.access_token).not.toBe(
        existing.tokens!.access_token,
      )
      expect((await repository.get(identity))?.tokens?.refresh_token).not.toBe(
        existing.tokens!.refresh_token,
      )
      expect(db.encryptedCredential(identity.integrationID)?.ciphertext).not.toContain(
        'debug-access',
      )
      const movedIdentity = new McpOAuthCredentialRepository(encrypted).identity({
        scope: 'user',
        serverName: server.name,
        serverUrl: `http://127.0.0.1:${port}/moved`,
      })
      expect(await new McpOAuthCredentialRepository(encrypted).get(movedIdentity)).toBeNull()
      expect(db.encryptedCredential(identity.integrationID)).toBeNull()
      db.close()
    },
    45_000,
  )
})
