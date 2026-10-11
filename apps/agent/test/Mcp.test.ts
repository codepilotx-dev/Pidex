import { afterEach, describe, expect, test } from 'bun:test'
import type { McpServerDeclaration } from '@pidex/agent-protocol'
import { McpAbortError, McpTimeoutError } from '@earendil-works/pi-mcp'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { ConfigService, ConfigServiceError } from '../src/config/ConfigService'
import {
  MAX_MCP_SERVER_INSTRUCTIONS_BYTES,
  McpClientFactory,
  McpConnectionError,
  sanitizeMcpServerInstructions,
} from '../src/mcp/McpClientFactory'
import { McpConnectionManager } from '../src/mcp/McpConnectionManager'
import { McpConfigError, McpConfigService } from '../src/mcp/McpConfigService'
import { createMcpInstructionSections } from '../src/mcp/McpPromptSections'
import { McpToolAdapter } from '../src/mcp/McpToolAdapter'
import {
  MCP_DIAGNOSTIC_CONTEXT_KEY,
  McpDiagnosticContextProvider,
} from '../src/mcp/McpDiagnosticContextProvider'
import {
  McpSettingsConflictError,
  McpSettingsRepository,
} from '../src/storage/repositories/McpSettingsRepository'
import { ToolCatalog } from '../src/tool/ToolRegistry'

class MemorySettings {
  readonly values = new Map<string, unknown>()
  getSetting<T>(key: string) {
    return (this.values.get(key) as T | undefined) ?? null
  }
  setSetting(key: string, value: unknown) {
    this.values.set(key, structuredClone(value))
  }
}

const temporaryDirectories: string[] = []
const fixtureProcesses: Bun.Subprocess[] = []

afterEach(async () => {
  for (const process of fixtureProcesses.splice(0)) {
    process.kill()
    await process.exited
  }
  await removeFixturePaths(temporaryDirectories.splice(0))
})

describe('MCP configuration', () => {
  test('seeds Context7 as an ordinary enabled server and keeps its removal persisted', async () => {
    const database = new MemorySettings()
    database.values.set('mcp.settings.v1', { sentinel: 'preserved' })
    const configs = new McpConfigService(new McpSettingsRepository(database))

    expect((await configs.list()).servers).toEqual([
      {
        server: {
          name: 'context7',
          scope: 'user',
          enabled: true,
          transport: {
            type: 'http',
            url: 'https://mcp.context7.com/mcp',
            headerFromEnv: {
              CONTEXT7_API_KEY: 'CONTEXT7_API_KEY',
            },
          },
          startupTimeoutMs: 20_000,
        },
        effective: true,
      },
    ])

    await configs.setEnabled({
      scope: 'user',
      name: 'context7',
      enabled: false,
      operationId: 'disable-context7',
    })
    expect((await configs.list()).servers[0]?.server.enabled).toBe(false)

    await configs.save({
      originalName: 'context7',
      server: {
        name: 'context7-docs',
        scope: 'user',
        enabled: true,
        transport: {
          type: 'http',
          url: 'https://mcp.context7.com/mcp',
          headerFromEnv: {
            CONTEXT7_API_KEY: 'CONTEXT7_API_KEY',
          },
        },
      },
      operationId: 'rename-context7',
    })
    expect((await configs.list()).servers.map((item) => item.server.name)).toEqual([
      'context7-docs',
    ])

    await configs.remove({
      scope: 'user',
      name: 'context7-docs',
      operationId: 'remove-context7',
    })
    const restarted = new McpConfigService(new McpSettingsRepository(database))
    expect((await restarted.list()).servers).toEqual([])
    expect(database.values.get('mcp.settings.v1')).toEqual({ sentinel: 'preserved' })
  })

  test('keeps user and local declarations while local remains the effective veto', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pidex-mcp-config-'))
    temporaryDirectories.push(workspace)
    const database = new MemorySettings()
    const configs = new McpConfigService(new McpSettingsRepository(database))

    await configs.save({ server: server('fixture', 'user', true), operationId: 'save-user' })
    await configs.save({
      workspace,
      server: server('fixture', 'local', false),
      operationId: 'save-local',
    })
    const result = await configs.list(workspace)

    expect(result.servers).toHaveLength(3)
    expect(
      result.servers.find((item) => item.server.name === 'fixture' && item.server.scope === 'user'),
    ).toMatchObject({
      server: { scope: 'user', enabled: true },
      effective: false,
      shadowedByScope: 'local',
    })
    expect(
      result.servers.find(
        (item) => item.server.name === 'fixture' && item.server.scope === 'local',
      ),
    ).toMatchObject({
      server: { scope: 'local', enabled: false },
      effective: true,
    })
    expect(JSON.stringify([...database.values.values()])).not.toContain(workspace)
  })

  test('rejects static credentials and conflicting operation IDs', async () => {
    const configs = new McpConfigService(new McpSettingsRepository(new MemorySettings()))
    await expect(
      configs.save({
        server: {
          name: 'unsafe',
          scope: 'user',
          enabled: true,
          transport: {
            type: 'http',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'secret' },
          },
        },
        operationId: 'unsafe',
      }),
    ).rejects.toBeInstanceOf(McpConfigError)

    await configs.save({ server: server('one', 'user', true), operationId: 'same-operation' })
    await expect(
      configs.save({
        server: server('two', 'user', true),
        operationId: 'same-operation',
      }),
    ).rejects.toBeInstanceOf(McpSettingsConflictError)
  })

  test('keeps diagnostic context for stdio and rejects it for HTTP', async () => {
    const configs = new McpConfigService(new McpSettingsRepository(new MemorySettings()))
    await configs.save({
      server: {
        ...server('diagnostic', 'user', true),
        diagnosticContext: true,
      },
      operationId: 'diagnostic-stdio',
    })
    expect(
      (await configs.list()).servers.find((item) => item.server.name === 'diagnostic')?.server,
    ).toMatchObject({
      name: 'diagnostic',
      diagnosticContext: true,
      transport: { type: 'stdio' },
    })

    await expect(
      configs.save({
        server: {
          name: 'diagnostic-http',
          scope: 'user',
          enabled: true,
          diagnosticContext: true,
          transport: {
            type: 'http',
            url: 'https://example.com/mcp',
          },
        },
        operationId: 'diagnostic-http',
      }),
    ).rejects.toMatchObject({
      code: 'MCP_CONFIG_INVALID',
    } satisfies Partial<McpConfigError>)
  })

  test('normalizes and persists OAuth and tool policy declarations in settings v2', async () => {
    const database = new MemorySettings()
    const configs = new McpConfigService(new McpSettingsRepository(database))
    await configs.save({
      server: {
        name: ' policies ',
        scope: 'user',
        enabled: true,
        required: true,
        enabledTools: [' read ', '', 'read', 'write'],
        disabledTools: [' write ', 'write', ''],
        defaultToolsApprovalMode: 'writes',
        tools: {
          ' read ': { approvalMode: 'approve' },
          write: { approvalMode: 'prompt' },
        },
        transport: {
          type: 'http',
          url: 'https://example.com/mcp',
          auth: 'oauth',
          scopes: [' profile ', '', 'profile', 'email'],
          oauthResource: ' https://example.com/resource ',
        },
      },
      operationId: 'save-policy',
    })

    const restarted = new McpConfigService(new McpSettingsRepository(database))
    expect(
      (await restarted.list()).servers.find(({ server }) => server.name === 'policies')?.server,
    ).toEqual({
      name: 'policies',
      scope: 'user',
      enabled: true,
      required: true,
      enabledTools: ['read', 'write'],
      disabledTools: ['write'],
      defaultToolsApprovalMode: 'writes',
      tools: {
        read: { approvalMode: 'approve' },
        write: { approvalMode: 'prompt' },
      },
      transport: {
        type: 'http',
        url: 'https://example.com/mcp',
        auth: 'oauth',
        scopes: ['profile', 'email'],
        oauthResource: 'https://example.com/resource',
      },
    })
    expect(database.values.has('mcp.runtime.v1')).toBe(true)
  })

  test('normalizes valid policy data already stored in settings v2', async () => {
    const database = new MemorySettings()
    database.values.set('mcp.runtime.v1', {
      version: 2,
      generation: 7,
      user: {
        stored: {
          name: 'stored',
          scope: 'user',
          enabled: true,
          enabledTools: [' read ', 'read', ''],
          disabledTools: [' read ', ''],
          tools: {
            ' read ': { approvalMode: 'prompt' },
          },
          transport: {
            type: 'http',
            url: 'https://example.com/mcp',
            auth: 'oauth',
            scopes: [' profile ', 'profile', ''],
            oauthResource: ' https://example.com/resource ',
          },
        },
      },
      local: {},
      operations: [],
    })

    expect(
      (await new McpConfigService(new McpSettingsRepository(database)).list()).servers[0]?.server,
    ).toMatchObject({
      enabledTools: ['read'],
      disabledTools: ['read'],
      tools: {
        read: { approvalMode: 'prompt' },
      },
      transport: {
        scopes: ['profile'],
        oauthResource: 'https://example.com/resource',
      },
    })
  })

  test('serializes MCP mutations and commits each prepared state only after its config write', async () => {
    const database = new MemorySettings()
    const repository = new McpSettingsRepository(database)
    const writes: string[] = []
    let releaseFirstWrite!: () => void
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    const configService = {
      batchWrite: async (input: { edits: Array<{ keyPath: readonly string[] }> }) => {
        const name = String(input.edits[0]?.keyPath[1])
        writes.push(name)
        if (name === 'one') await firstWrite
        return {} as never
      },
    } as unknown as ConfigService
    const configs = new McpConfigService(repository, configService)

    const one = configs.save({
      server: server('one', 'user', true),
      operationId: 'save-one',
    })
    const two = configs.save({
      server: server('two', 'user', true),
      operationId: 'save-two',
    })
    for (let attempt = 0; attempt < 20 && writes.length === 0; attempt += 1) {
      await Bun.sleep(0)
    }

    expect(writes).toEqual(['one'])
    expect(repository.state().user).not.toHaveProperty('one')
    expect(repository.state().user).not.toHaveProperty('two')

    releaseFirstWrite()
    await Promise.all([one, two])

    expect(writes).toEqual(['one', 'two'])
    expect(repository.state()).toMatchObject({
      generation: 3,
      user: {
        one: { name: 'one' },
        two: { name: 'two' },
      },
      operations: [
        { operationId: 'save-one', generation: 2 },
        { operationId: 'save-two', generation: 3 },
      ],
    })
  })

  test('requires explicit project trust before saving a local MCP declaration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-mcp-trust-'))
    temporaryDirectories.push(root)
    const workspace = await mkdtemp(join(root, 'workspace-'))
    const configService = new ConfigService(join(root, '.pidex', 'config.json'))
    await configService.initialize()
    try {
      const database = new MemorySettings()
      const repository = new McpSettingsRepository(database)
      const before = repository.state()
      const configs = new McpConfigService(repository, configService)
      const declaration = {
        name: 'pidex-debug',
        scope: 'local',
        enabled: true,
        transport: {
          type: 'http',
          url: 'http://127.0.0.1:43123/mcp',
        },
      } satisfies McpServerDeclaration
      const projectConfig = join(workspace, '.pidex', 'config.json')

      await expect(
        configs.save({
          workspace,
          server: declaration,
          operationId: 'save-local-debug',
        }),
      ).rejects.toMatchObject({
        code: 'PATH_DENIED',
        status: 403,
        message: expect.stringContaining('设置 → 配置'),
      } satisfies Partial<McpConfigError>)
      expect(repository.state()).toEqual(before)
      expect(await Bun.file(projectConfig).exists()).toBe(false)

      await configService.trustUpdate(workspace, 'trusted')
      const saved = await configs.save({
        workspace,
        server: declaration,
        operationId: 'save-local-debug',
      })

      expect(saved).toMatchObject({
        changed: true,
        generation: 2,
      })
      expect(saved.servers.filter(({ server }) => server.name === 'pidex-debug')).toHaveLength(1)
      expect(repository.state().operations).toEqual([
        expect.objectContaining({ operationId: 'save-local-debug', generation: 2 }),
      ])
      expect(await readFile(projectConfig, 'utf8')).toContain('"pidex-debug"')
      expect((await configService.read({ cwd: workspace })).config).toMatchObject({
        mcp_servers: {
          'pidex-debug': {
            name: 'pidex-debug',
            scope: 'local',
            enabled: true,
            transport: {
              type: 'http',
              url: 'http://127.0.0.1:43123/mcp',
            },
          },
        },
      })
    } finally {
      await configService.dispose()
    }
  })

  test('maps config write failures safely and leaves prepared MCP state uncommitted', async () => {
    const cases = [
      {
        cause: new ConfigServiceError(
          'CONFIG_PROJECT_UNTRUSTED',
          'secret C:\\private\\config.json',
        ),
        expected: { code: 'PATH_DENIED', status: 403 },
      },
      {
        cause: new ConfigServiceError('CONFIG_LAYER_READONLY', 'secret C:\\private\\config.json'),
        expected: { code: 'PATH_DENIED', status: 403 },
      },
      {
        cause: new ConfigServiceError('CONFIG_PATH_NOT_FOUND', 'secret C:\\private\\config.json'),
        expected: { code: 'PATH_DENIED', status: 403 },
      },
      {
        cause: new ConfigServiceError('CONFIG_VERSION_CONFLICT', 'secret C:\\private\\config.json'),
        expected: { code: 'CONFLICT', status: 409 },
      },
      {
        cause: new ConfigServiceError('CONFIG_VALIDATION_ERROR', 'secret C:\\private\\config.json'),
        expected: { code: 'MCP_CONFIG_INVALID', status: 400 },
      },
    ] as const

    for (const [index, fixture] of cases.entries()) {
      const repository = new McpSettingsRepository(new MemorySettings())
      const before = repository.state()
      const configs = new McpConfigService(repository, {
        batchWrite: async () => {
          throw fixture.cause
        },
      } as unknown as ConfigService)

      let failure: unknown
      try {
        await configs.save({
          server: server(`failed-${index}`, 'user', true),
          operationId: `failed-${index}`,
        })
      } catch (cause) {
        failure = cause
      }
      expect(failure).toMatchObject(fixture.expected)
      expect((failure as Error).message).not.toContain('C:\\private')
      expect((failure as Error).message).not.toContain('secret')
      expect(repository.state()).toEqual(before)
    }
  })

  test('does not commit remove or enable mutations when config persistence fails', async () => {
    for (const action of ['remove', 'setEnabled'] as const) {
      const database = new MemorySettings()
      const repository = new McpSettingsRepository(database)
      repository.mutate({
        operationId: `seed-${action}`,
        fingerprint: `seed-${action}`,
        apply: (draft) => {
          draft.user.fixture = server('fixture', 'user', true)
          return true
        },
      })
      const before = repository.state()
      const configs = new McpConfigService(repository, {
        read: async () => ({
          config: {
            mcp_servers: {
              fixture: server('fixture', 'user', true),
            },
          },
          origins: {
            'mcp_servers.fixture.name': 'user',
          },
          diagnostics: [],
          profileState: {
            activeProfile: null,
            selectedProfile: null,
            restartRequired: false,
          },
        }),
        batchWrite: async () => {
          throw new ConfigServiceError('CONFIG_VALIDATION_ERROR', 'invalid')
        },
      } as unknown as ConfigService)

      const operation =
        action === 'remove'
          ? configs.remove({
              scope: 'user',
              name: 'fixture',
              operationId: 'remove-fixture',
            })
          : configs.setEnabled({
              scope: 'user',
              name: 'fixture',
              enabled: false,
              operationId: 'disable-fixture',
            })
      await expect(operation).rejects.toMatchObject({
        code: 'MCP_CONFIG_INVALID',
      } satisfies Partial<McpConfigError>)
      expect(repository.state()).toEqual(before)
    }
  })

  test('persists Context7 credential references as environment variable names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-mcp-context7-'))
    temporaryDirectories.push(root)
    const userConfig = join(root, 'data', 'config.json')
    const configService = new ConfigService(userConfig)
    await configService.initialize()
    try {
      const configs = new McpConfigService(
        new McpSettingsRepository(new MemorySettings()),
        configService,
      )
      await configs.save({
        server: {
          name: 'context7',
          scope: 'user',
          enabled: true,
          transport: {
            type: 'http',
            url: 'https://mcp.context7.com/mcp',
            headerFromEnv: {
              CONTEXT7_API_KEY: 'CONTEXT7_API_KEY',
            },
          },
          startupTimeoutMs: 20_000,
        },
        operationId: 'persist-context7',
      })

      expect((await configService.read()).config).toMatchObject({
        mcp_servers: {
          context7: {
            transport: {
              headerFromEnv: {
                CONTEXT7_API_KEY: 'CONTEXT7_API_KEY',
              },
            },
          },
        },
      })
      const source = await readFile(userConfig, 'utf8')
      expect(source).toContain('"CONTEXT7_API_KEY": "CONTEXT7_API_KEY"')
      expect(source).not.toContain('headers')
    } finally {
      await configService.dispose()
    }
  })
})

describe('MCP transports', () => {
  test('connects to the shared fixture over stdio and exposes tools/resources/prompts', async () => {
    const connection = await new McpClientFactory().connect(
      {
        name: 'stdio-fixture',
        scope: 'user',
        enabled: true,
        transport: {
          type: 'stdio',
          command: process.execPath,
          args: [fixturePath(), '--transport=stdio'],
        },
        startupTimeoutMs: 20_000,
      },
      () => undefined,
    )
    try {
      expect(connection.transport).toBe('stdio')
      expect(connection.tools.map((tool) => tool.name)).toContain('echo')
      expect(connection.resources.map((resource) => resource.uri)).toContain(
        'fixture://resources/readme',
      )
      expect(connection.prompts.map((prompt) => prompt.name)).toContain('fixture-greeting')
      expect(connection.instructions).toContain('Pidex MCP 对话调试实验室')
      const result = await connection.callTool('echo', { text: 'hello' })
      expect(result.structuredContent).toEqual({ echoed: 'hello' })
      const resources = await connection.listResources()
      expect(resources.resources.map((resource) => resource.uri)).toContain(
        'fixture://resources/readme',
      )
      const resource = await connection.readResource('fixture://resources/readme')
      expect(resource.contents).toMatchObject([
        { uri: 'fixture://resources/readme', text: expect.stringContaining('fixture') },
      ])
    } finally {
      await connection.close()
    }
  }, 30_000)

  test('connects over Streamable HTTP and classifies auth', async () => {
    const modern = await startHttpFixture(['--auth-token=fixture-token'])
    const factory = new McpClientFactory()
    await expect(
      factory.connect(
        {
          name: 'auth-required',
          scope: 'user',
          enabled: true,
          transport: { type: 'http', url: modern.url },
        },
        () => undefined,
      ),
    ).rejects.toMatchObject({
      needsAuth: true,
    } satisfies Partial<McpConnectionError>)

    process.env.PIDEX_MCP_FIXTURE_TOKEN = 'fixture-token'
    const authenticated = await factory.connect(
      {
        name: 'http-fixture',
        scope: 'user',
        enabled: true,
        transport: {
          type: 'http',
          url: modern.url,
          bearerTokenEnvVar: 'PIDEX_MCP_FIXTURE_TOKEN',
        },
      },
      () => undefined,
    )
    try {
      expect(authenticated.transport).toBe('http')
      expect(authenticated.tools.map((tool) => tool.name)).toContain('echo')
    } finally {
      delete process.env.PIDEX_MCP_FIXTURE_TOKEN
      await authenticated.close()
    }
  }, 30_000)

  test('rejects legacy SSE endpoints without a GET fallback', async () => {
    for (const status of [404, 405, 406, 415, 501]) {
      const methods: string[] = []
      const endpoint = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
          methods.push(request.method)
          return request.method === 'POST'
            ? new Response('legacy endpoint', { status })
            : new Response('event: endpoint\ndata: /messages\n\n', {
                headers: { 'content-type': 'text/event-stream' },
              })
        },
      })
      try {
        await expect(
          new McpClientFactory().connect(
            {
              name: 'legacy-fixture',
              scope: 'user',
              enabled: true,
              transport: { type: 'http', url: `${endpoint.url}mcp` },
            },
            () => undefined,
          ),
        ).rejects.toMatchObject({
          safe: { code: 'MCP_CONNECTION_FAILED', message: 'MCP server 连接失败' },
        })
        expect(methods).toEqual(['POST'])
      } finally {
        await endpoint.stop(true)
      }
    }
  })

  test('times out a stalled HTTP initialized notification and deletes the session', async () => {
    const initialized = Promise.withResolvers<void>()
    let deleted = false
    const endpoint = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (request.method === 'DELETE') {
          deleted = true
          return new Response(null, { status: 202 })
        }
        const message = (await request.json()) as { id?: number; method: string }
        if (message.method === 'initialize') {
          return Response.json(
            {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                protocolVersion: '2025-11-25',
                capabilities: {},
                serverInfo: { name: 'stalled', version: '1' },
              },
            },
            { headers: { 'mcp-session-id': 'stalled-session' } },
          )
        }
        await initialized.promise
        return new Response(null, { status: 202 })
      },
    })
    try {
      await expect(
        new McpClientFactory().connect(
          {
            name: 'stalled-http',
            scope: 'user',
            enabled: true,
            transport: { type: 'http', url: `${endpoint.url}mcp` },
            startupTimeoutMs: 200,
          },
          () => undefined,
        ),
      ).rejects.toMatchObject({ safe: { code: 'MCP_TIMEOUT' } })
      expect(deleted).toBe(true)
    } finally {
      initialized.resolve()
      await endpoint.stop(true)
    }
  })

  test('cleans up a stalled stdio process after the startup timeout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-mcp-timeout-'))
    temporaryDirectories.push(root)
    const pidFile = join(root, 'pid.txt')
    await expect(
      new McpClientFactory().connect(
        {
          name: 'stalled-fixture',
          scope: 'user',
          enabled: true,
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [
              '-e',
              'require("node:fs").writeFileSync(process.env.MCP_PID_FILE, String(process.pid)); process.stdin.resume()',
            ],
            env: { MCP_PID_FILE: pidFile },
          },
          startupTimeoutMs: 500,
        },
        () => undefined,
      ),
    ).rejects.toMatchObject({ safe: { code: 'MCP_TIMEOUT' } })
    const pid = Number(await readFile(pidFile, 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  }, 10_000)

  test('stdio 表单提问绑定当前调用，取消排队调用不取消正在回答的表单', async () => {
    const serverModule = Bun.resolveSync(
      '@modelcontextprotocol/sdk/server/index.js',
      import.meta.dir,
    )
    const transportModule = Bun.resolveSync(
      '@modelcontextprotocol/sdk/server/stdio.js',
      import.meta.dir,
    )
    const typesModule = Bun.resolveSync('@modelcontextprotocol/sdk/types.js', import.meta.dir)
    const source = `
      const { Server } = await import(${JSON.stringify(serverModule)});
      const { StdioServerTransport } = await import(${JSON.stringify(transportModule)});
      const { ListToolsRequestSchema, CallToolRequestSchema } = await import(${JSON.stringify(typesModule)});
      const server = new Server({ name: 'forms', version: '1' }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [{ name: 'ask', inputSchema: { type: 'object' } }] }));
      server.setRequestHandler(CallToolRequestSchema, async () => {
        const result = await server.elicitInput({ mode: 'form', message: '填写名称', requestedSchema: {
          type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      });
      await server.connect(new StdioServerTransport());
    `
    const entered = Promise.withResolvers<void>()
    const answer = Promise.withResolvers<unknown>()
    const identity = { threadID: 'thread', turnID: 'turn', agentID: 'agent', toolCallID: 'call' }
    let receivedSignal: AbortSignal | undefined
    const connection = await new McpClientFactory(
      undefined,
      async (_connection, serverName, tool, actualIdentity, params, signal) => {
        expect({ serverName, tool, actualIdentity }).toEqual({
          serverName: 'forms',
          tool: 'ask',
          actualIdentity: identity,
        })
        expect(params).toMatchObject({ message: '填写名称' })
        receivedSignal = signal
        entered.resolve()
        return answer.promise
      },
    ).connect(
      {
        name: 'forms',
        scope: 'user',
        enabled: true,
        transport: { type: 'stdio', command: process.execPath, args: ['--eval', source] },
        startupTimeoutMs: 20_000,
      },
      () => undefined,
    )
    try {
      const current = connection.callTool('ask', {}, undefined, undefined, identity)
      await entered.promise
      const abort = new AbortController()
      const queued = connection.callTool('ask', {}, abort.signal, undefined, {
        ...identity,
        toolCallID: 'queued',
      })
      abort.abort()
      await expect(queued).rejects.toBeInstanceOf(McpAbortError)
      expect(receivedSignal?.aborted).toBe(false)
      answer.resolve({ action: 'accept', content: { name: 'fixture' } })
      expect((await current).content).toEqual([
        { type: 'text', text: JSON.stringify({ action: 'accept', content: { name: 'fixture' } }) },
      ])
    } finally {
      answer.resolve({ action: 'cancel' })
      await connection.close()
    }
  }, 30_000)

  test('cancels and times out calls while keeping the connection usable and closable', async () => {
    let closes = 0
    const connection = await new McpClientFactory().connect(
      {
        name: 'cancel-fixture',
        scope: 'user',
        enabled: true,
        transport: {
          type: 'stdio',
          command: process.execPath,
          args: [fixturePath(), '--transport=stdio'],
        },
        startupTimeoutMs: 20_000,
        toolTimeoutMs: 100,
      },
      () => undefined,
      () => {
        closes += 1
      },
    )
    try {
      const controller = new AbortController()
      const cancelled = connection.callTool('delay', { milliseconds: 1_000 }, controller.signal)
      controller.abort()
      await expect(cancelled).rejects.toBeInstanceOf(McpAbortError)
      await expect(connection.callTool('delay', { milliseconds: 1_000 })).rejects.toBeInstanceOf(
        McpTimeoutError,
      )
      expect(
        (await connection.callTool('echo', { text: 'still-ready' })).structuredContent,
      ).toEqual({ echoed: 'still-ready' })
    } finally {
      await connection.close()
    }
    expect(closes).toBe(1)
  }, 30_000)
})

describe('MCP turn catalog', () => {
  test('scrubs and bounds server instructions before exposing them as external context', () => {
    const instructions = sanitizeMcpServerInstructions(
      `api_key=super-secret\n${'工具说明🙂'.repeat(8_000)}`,
    )

    expect(instructions).toBeDefined()
    expect(instructions).toContain('<redacted>')
    expect(instructions).not.toContain('super-secret')
    expect(instructions).not.toContain('�')
    expect(Buffer.byteLength(instructions!, 'utf8')).toBeLessThanOrEqual(
      MAX_MCP_SERVER_INSTRUCTIONS_BYTES,
    )

    expect(
      createMcpInstructionSections([
        {
          serverName: 'fixture',
          content: instructions!,
        },
      ])[0],
    ).toMatchObject({
      role: 'contextual-user',
      cache: 'session-stable',
      authority: 'external-data',
      source: { type: 'runtime', name: 'mcp:fixture' },
    })
  })

  test('filters tools and maps per-server approval modes without trusting annotations', () => {
    const handle = {
      server: {
        ...server('policy', 'user', true),
        enabledTools: ['read', 'write', 'prompt', 'auto', 'danger', 'blocked'],
        disabledTools: ['blocked'],
        defaultToolsApprovalMode: 'writes',
        tools: {
          write: { approvalMode: 'approve' },
          prompt: { approvalMode: 'prompt' },
          auto: { approvalMode: 'auto' },
        },
      } satisfies McpServerDeclaration,
      fingerprint: 'policy',
      state: 'connected',
      owners: 1,
      connected: {
        transport: 'stdio',
        tools: [
          {
            name: 'read',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
          {
            name: 'write',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: false },
          },
          {
            name: 'blocked',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true },
          },
          {
            name: 'prompt',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true },
          },
          {
            name: 'auto',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: false },
          },
          {
            name: 'danger',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true, destructiveHint: true },
          },
          {
            name: 'not-allowed',
            inputSchema: { type: 'object' },
          },
        ],
        resources: [],
        resourceTemplates: [],
        prompts: [],
        callTool: async () => ({ content: [] }),
        listResources: async () => ({ resources: [] }),
        readResource: async () => ({ contents: [] }),
        close: async () => undefined,
      },
    }

    const tools = new McpToolAdapter(1, new Map([['policy', handle]]) as never)
      .definitions()
      .filter((definition) => definition.origin?.kind === 'mcp')
    const byRawName = new Map(
      tools.map((definition) => [
        definition.origin!.kind === 'mcp' ? definition.origin!.rawToolName : '',
        definition,
      ]),
    )

    expect([...byRawName.keys()].sort()).toEqual(['auto', 'danger', 'prompt', 'read', 'write'])
    expect(byRawName.get('read')).toMatchObject({
      approvalStrategy: 'policy',
      executionMode: 'parallel',
      capabilities: { externalState: false },
    })
    expect(byRawName.get('write')).toMatchObject({
      approvalStrategy: 'never-review',
      executionMode: 'sequential',
      capabilities: { externalState: true },
    })
    expect(byRawName.get('prompt')?.approvalStrategy).toBe('always-review')
    expect(byRawName.get('auto')?.approvalStrategy).toBe('policy')
    expect(byRawName.get('danger')).toMatchObject({
      approvalStrategy: 'always-review',
      executionMode: 'sequential',
      capabilities: { externalState: true },
    })
    expect((handle as typeof handle & { validToolCount?: number }).validToolCount).toBe(5)
  })

  test('bounds generation instructions and blocks turns when a required server is unavailable', async () => {
    const declarations = ['one', 'two', 'three', 'four', 'five'].map((name) => ({
      server: {
        ...server(name, 'user', true),
      },
      effective: true,
    }))
    const configs = {
      workspace: async () => undefined,
      list: async () => ({ generation: 1, servers: declarations }),
    }
    const factory = {
      connect: async (declaration: McpServerDeclaration) => {
        return {
          transport: 'stdio',
          tools: [],
          resources: [{ uri: `debug://${declaration.name}`, name: declaration.name }],
          resourceTemplates: [],
          prompts: [],
          instructions: `${declaration.name}:${'说明🙂'.repeat(1_600)}`,
          callTool: async () => ({ content: [] }),
          listResources: async () => ({ resources: [] }),
          readResource: async () => ({ contents: [] }),
          close: async () => undefined,
        }
      },
    }
    const manager = new McpConnectionManager(configs as never, new ToolCatalog(), factory as never)

    const lease = await manager.acquire()
    expect(lease.serverInstructions).not.toHaveLength(0)
    expect(
      lease.serverInstructions.every(
        (item) => Buffer.byteLength(item.content, 'utf8') <= MAX_MCP_SERVER_INSTRUCTIONS_BYTES,
      ),
    ).toBe(true)
    expect(
      Buffer.byteLength(lease.serverInstructions.map((item) => item.content).join(''), 'utf8'),
    ).toBeLessThanOrEqual(64 * 1024)
    await lease.release()
    await manager.dispose()

    const requiredManager = new McpConnectionManager(
      {
        workspace: async () => undefined,
        list: async () => ({
          generation: 1,
          servers: [
            {
              server: {
                ...server('required', 'user', true),
                required: true,
              },
              effective: true,
            },
          ],
        }),
      } as never,
      new ToolCatalog(),
      {
        connect: async () => {
          throw new McpConnectionError({
            code: 'MCP_CONNECTION_FAILED',
            message: 'MCP server 连接失败',
            retryable: true,
          })
        },
      } as never,
    )
    expect((await requiredManager.reload()).failed.map((failure) => failure.name)).toEqual([
      'required',
    ])
    await expect(requiredManager.acquire()).rejects.toMatchObject({
      code: 'MCP_REQUIRED_SERVER_UNAVAILABLE',
    })
    await requiredManager.dispose()
  })

  test('keeps the active turn on its leased generation and retires connections after release', async () => {
    const configs = new McpConfigService(new McpSettingsRepository(new MemorySettings()))
    await configs.remove({
      scope: 'user',
      name: 'context7',
      operationId: 'remove-context7-for-isolated-runtime',
    })
    const baseCatalog = new ToolCatalog([])
    const closed: string[] = []
    let connectionNumber = 0
    const factory = {
      connect: async () => {
        const id = `connection-${++connectionNumber}`
        return {
          transport: 'stdio',
          tools: [
            {
              name: 'echo',
              description: 'Echo a value',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            },
          ],
          resources: [],
          resourceTemplates: [],
          prompts: [],
          callTool: async () => ({ content: [{ type: 'text', text: id }] }),
          listResources: async () => ({ resources: [] }),
          readResource: async () => ({ contents: [] }),
          close: async () => {
            closed.push(id)
          },
        }
      },
    }
    const manager = new McpConnectionManager(
      configs,
      baseCatalog,
      factory as unknown as McpClientFactory,
    )
    await configs.save({
      server: server('fixture', 'user', true),
      operationId: 'initial',
    })

    const firstTurn = await manager.acquire()
    expect(firstTurn.generation).toBe(1)
    expect(firstTurn.catalog.all().map((tool) => tool.sdkName)).toContain('mcp__fixture__echo')
    expect(baseCatalog.all()).toHaveLength(0)

    await configs.save({
      server: {
        ...server('fixture', 'user', true),
        transport: {
          type: 'stdio',
          command: process.execPath,
          args: [fixturePath(), '--transport=stdio', '--changed'],
        },
      },
      operationId: 'replace',
    })
    const reload = await manager.reload()
    expect(reload.replaced).toEqual(['fixture'])
    expect(closed).toEqual([])

    const secondTurn = await manager.acquire()
    expect(secondTurn.generation).toBeGreaterThan(firstTurn.generation)
    await firstTurn.release()
    expect(closed).toEqual(['connection-1'])
    await secondTurn.release()
    await manager.dispose()
    expect(closed).toEqual(['connection-1', 'connection-2'])
  })

  test('injects only bounded and scrubbed host-owned diagnostic metadata', async () => {
    const workspaceRoot = 'C:\\private\\workspace'
    const inputs = Array.from({ length: 25 }, (_, index) => ({
      id: `input-${index}`,
      threadId: 'thread-1',
      turnId: `turn-${index}`,
      content:
        index === 24
          ? `inspect ${workspaceRoot}\\secret.txt api_key=super-secret`
          : `user-${index}`,
      strategy: 'enqueue',
      mode: 'chat',
      model: { providerID: 'openai', id: 'gpt-5' },
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      state: 'completed',
      createdAt: index,
    }))
    const toolItems = Array.from({ length: 55 }, (_, index) => ({
      id: `tool-${index}`,
      messageID: 'message',
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'tool',
      callID: `call-${index}`,
      tool: `tool-${index}`,
      title: 'tool',
      state: 'completed',
      input: { command: 'must-not-leak' },
      command: 'must-not-leak',
      output: 'must-not-leak',
      error: null,
      startedAt: index,
      finishedAt: index + 1,
      durationMs: 1,
      createdAt: index + 100,
    }))
    const provider = new McpDiagnosticContextProvider({
      snapshot: () =>
        ({
          thread: {
            id: 'thread-1',
            title: `Thread in ${workspaceRoot}`,
            projectID: null,
            gitBranch: null,
            settings: {
              taskMode: 'chat',
              permissionConfig: {
                sandboxMode: 'workspace-write',
                approvalPolicy: 'on-request',
                approvalsReviewer: 'user',
              },
            },
            createdAt: 0,
            updatedAt: 1,
          },
          turns: [],
          agents: [],
          subagents: [],
          inputs,
          messages: [],
          items: [
            {
              id: 'reasoning',
              messageID: 'message',
              turnId: 'turn-1',
              agentId: 'agent-1',
              type: 'reasoning',
              text: 'private reasoning must-not-leak',
              status: 'completed',
              createdAt: 99,
            },
            {
              id: 'assistant',
              messageID: 'message',
              turnId: 'turn-1',
              agentId: 'agent-1',
              type: 'text',
              placement: 'result',
              text: 'visible assistant',
              status: 'completed',
              createdAt: 100,
            },
            ...toolItems,
          ],
          approvals: [],
        }) as never,
    })
    let requestMeta: Record<string, unknown> | undefined
    const handle = {
      server: {
        ...server('diagnostic', 'user', true),
        diagnosticContext: true,
      },
      fingerprint: 'diagnostic',
      state: 'connected',
      owners: 1,
      connected: {
        transport: 'stdio',
        tools: [
          {
            name: 'echo',
            inputSchema: { type: 'object', additionalProperties: true },
          },
        ],
        resources: [],
        resourceTemplates: [],
        prompts: [],
        callTool: async (
          _name: string,
          _args: unknown,
          _signal: unknown,
          meta: Record<string, unknown>,
        ) => {
          requestMeta = meta
          return { content: [] }
        },
        listResources: async () => ({ resources: [] }),
        readResource: async () => ({ contents: [] }),
        close: async () => undefined,
      },
    }
    const definition = new McpToolAdapter(1, new Map([['diagnostic', handle]]) as never, provider)
      .definitions()
      .find((candidate) => candidate.origin?.kind === 'mcp')!

    await definition.execute(
      {},
      {
        signal: new AbortController().signal,
        taskMode: 'chat',
        profile: 'main',
        workspace: { rootPath: workspaceRoot } as never,
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
        model: { providerID: 'openai', id: 'gpt-5' } as never,
        invocation: {
          threadID: 'thread-1',
          turnID: 'turn-1',
          agentID: 'agent-1',
          toolCallID: 'tool-call-1',
        },
      },
    )

    const context = requestMeta?.[MCP_DIAGNOSTIC_CONTEXT_KEY] as {
      entries: unknown[]
      tools: unknown[]
      truncated: boolean
    }
    expect(context.entries).toHaveLength(20)
    expect(context.tools).toHaveLength(50)
    expect(context.truncated).toBe(true)
    const serialized = JSON.stringify(context)
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(64 * 1024)
    expect(serialized).toContain('<workspace>')
    expect(serialized).toContain('<redacted>')
    expect(serialized).not.toContain(workspaceRoot)
    expect(serialized).not.toContain('must-not-leak')
    expect(serialized).not.toContain('private reasoning')
  })

  test('omits diagnostic metadata by default and degrades snapshot failures safely', async () => {
    const metadata: unknown[] = []
    const makeHandle = (diagnosticContext: boolean) => ({
      server: {
        ...server(diagnosticContext ? 'enabled' : 'disabled', 'user', true),
        ...(diagnosticContext ? { diagnosticContext: true } : {}),
      },
      fingerprint: 'fixture',
      state: 'connected',
      owners: 1,
      connected: {
        transport: 'stdio',
        tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
        resources: [],
        resourceTemplates: [],
        prompts: [],
        callTool: async (_name: string, _args: unknown, _signal: unknown, meta?: unknown) => {
          metadata.push(meta)
          return { content: [] }
        },
        listResources: async () => ({ resources: [] }),
        readResource: async () => ({ contents: [] }),
        close: async () => undefined,
      },
    })
    const provider = new McpDiagnosticContextProvider({ snapshot: () => null })
    const handles = new Map([
      ['disabled', makeHandle(false)],
      ['enabled', makeHandle(true)],
    ])
    const definitions = new McpToolAdapter(1, handles as never, provider).definitions()
    const context = {
      signal: new AbortController().signal,
      taskMode: 'chat' as const,
      profile: 'main' as const,
      workspace: { rootPath: 'C:\\workspace' } as never,
      permissionConfig: {
        sandboxMode: 'workspace-write' as const,
        approvalPolicy: 'on-request' as const,
        approvalsReviewer: 'user' as const,
      },
      model: { providerID: 'openai', id: 'gpt-5' } as never,
      invocation: {
        threadID: 'thread-1',
        turnID: 'turn-1',
        agentID: 'agent-1',
        toolCallID: 'call-1',
      },
    }
    await definitions
      .find((item) => item.origin?.kind === 'mcp' && item.origin.serverName === 'disabled')!
      .execute({}, context)
    await definitions
      .find((item) => item.origin?.kind === 'mcp' && item.origin.serverName === 'enabled')!
      .execute({}, context)
    expect(metadata[0]).toBeUndefined()
    expect(metadata[1]).toEqual({
      [MCP_DIAGNOSTIC_CONTEXT_KEY]: {
        version: 1,
        status: 'DIAGNOSTIC_CONTEXT_UNAVAILABLE',
      },
    })
  })

  test('sanitizes tool names, skips invalid schemas, bounds output, and gates resource URIs', async () => {
    const reads: string[] = []
    const handle = {
      server: server('fixture', 'user', true),
      fingerprint: 'fixture',
      state: 'connected',
      owners: 1,
      connected: {
        transport: 'stdio',
        tools: [
          {
            name: 'echo tool',
            inputSchema: { type: 'object', additionalProperties: true },
          },
          {
            name: 'echo@tool',
            inputSchema: { type: 'object', additionalProperties: true },
          },
          {
            name: 'invalid',
            inputSchema: { type: 'not-a-json-schema-type' },
          },
        ],
        resources: [{ uri: 'fixture://resources/readme', name: 'readme' }],
        resourceTemplates: [
          {
            uriTemplate: 'fixture://items/{id}',
            name: 'item',
          },
        ],
        prompts: [],
        callTool: async () => ({ content: [] }),
        listResources: async () => ({ resources: [] }),
        readResource: async (uri: string) => {
          reads.push(uri)
          return { contents: [{ uri, text: 'ok' }] }
        },
        close: async () => undefined,
      },
    }
    const definitions = new McpToolAdapter(7, new Map([['fixture', handle]]) as never).definitions()
    const toolNames = definitions
      .filter(
        (definition) =>
          definition.origin?.kind === 'mcp' && definition.origin.rawToolName.includes('echo'),
      )
      .map((definition) => definition.sdkName)
    expect(toolNames).toHaveLength(2)
    expect(new Set(toolNames).size).toBe(2)
    expect(toolNames.every((name) => name.length <= 64)).toBe(true)
    expect(
      definitions.some(
        (definition) =>
          definition.origin?.kind === 'mcp' && definition.origin.rawToolName === 'invalid',
      ),
    ).toBe(false)
    expect(handle).toMatchObject({
      validToolCount: 2,
      error: { code: 'MCP_TOOL_SCHEMA_INVALID' },
    })

    const formatted = definitions.find(
      (definition) =>
        definition.origin?.kind === 'mcp' && definition.origin.rawToolName === 'echo tool',
    )!.formatResult!({ content: [{ type: 'text', text: 'x'.repeat(150_000) }] }, {} as never)
    expect(Buffer.byteLength(formatted.content, 'utf8')).toBeLessThanOrEqual(128 * 1024)
    expect(formatted.details).toEqual({ truncated: true })

    const readResource = definitions.find(
      (definition) => definition.sdkName === 'mcp_read_resource',
    )!
    await readResource.execute(
      {
        server: 'fixture',
        uri: 'fixture://items/42',
      },
      {} as never,
    )
    expect(reads).toEqual(['fixture://items/42'])
    await expect(
      readResource.execute(
        {
          server: 'fixture',
          uri: 'https://example.com/not-announced',
        },
        {} as never,
      ),
    ).rejects.toMatchObject({ code: 'PATH_DENIED' })
  })
})

function server(name: string, scope: 'user' | 'local', enabled: boolean): McpServerDeclaration {
  return {
    name,
    scope,
    enabled,
    transport: {
      type: 'stdio',
      command: process.execPath,
      args: [fixturePath(), '--transport=stdio'],
    },
  }
}

function fixturePath() {
  return resolve(import.meta.dir, 'fixtures', 'McpServer.ts')
}

async function startHttpFixture(extraArguments: string[]) {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-mcp-http-'))
  temporaryDirectories.push(directory)
  const portFile = join(directory, 'port.txt')
  const child = Bun.spawn(
    [
      process.execPath,
      fixturePath(),
      '--transport=http',
      '--port=0',
      `--port-file=${portFile}`,
      ...extraArguments,
    ],
    {
      stdout: 'ignore',
      stderr: 'ignore',
    },
  )
  fixtureProcesses.push(child)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await Bun.file(portFile).exists()) {
      const port = (await Bun.file(portFile).text()).trim()
      return { url: `http://127.0.0.1:${port}/mcp` }
    }
    if (await Promise.race([child.exited.then(() => true), Bun.sleep(25).then(() => false)]))
      throw new Error('MCP HTTP fixture exited before reporting its port')
  }
  throw new Error('MCP HTTP fixture did not report its port')
}
