import type { McpSanitizedError, McpServerDeclaration } from '@pidex/agent-protocol'
import {
  McpClient,
  McpHttpError,
  McpTimeoutError,
  McpAbortError,
  StdioTransport,
  StreamableHttpTransport,
  type CallToolResult,
  type ListResourcesResult,
  type McpTransport,
  type ReadResourceResult,
  type Resource,
  type ResourceTemplate,
  type StreamableHttpTransportOptions,
  type Tool,
} from '@earendil-works/pi-mcp'
import { McpOAuthAuthorizationRequiredError } from '@earendil-works/pi-mcp/oauth'
import { z } from 'zod'
import { secretScrubber } from '../security/SecretScrubber'
import type { McpOAuthCoordinator } from './McpOAuthCoordinator'
import type { McpInvocationIdentity } from './McpElicitationService'

export const MAX_MCP_SERVER_INSTRUCTIONS_BYTES = 16 * 1024

export const truncateMcpInstructionsUtf8 = (value: string, maximumBytes: number) => {
  const encoded = Buffer.from(value, 'utf8')
  if (encoded.byteLength <= maximumBytes) return value
  const marker = '\n…'
  const markerBytes = Buffer.byteLength(marker, 'utf8')
  let end = Math.max(0, maximumBytes - markerBytes)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  while (end > 0) {
    try {
      return `${decoder.decode(encoded.subarray(0, end))}${marker}`
    } catch {
      end -= 1
    }
  }
  return markerBytes <= maximumBytes ? marker : ''
}

export const sanitizeMcpServerInstructions = (value: string | undefined) => {
  const scrubbed = secretScrubber.scrubText(value ?? '').trim()
  if (!scrubbed) return undefined
  return truncateMcpInstructionsUtf8(scrubbed, MAX_MCP_SERVER_INSTRUCTIONS_BYTES)
}

export type McpRawTool = Tool
export type McpToolResult = CallToolResult
export type McpResource = Resource
export type McpResourceTemplate = ResourceTemplate
export type McpReadResourceResult = ReadResourceResult

const promptSchema = z
  .object({
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    arguments: z
      .array(
        z
          .object({
            name: z.string(),
            description: z.string().optional(),
            required: z.boolean().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()
const promptPageSchema = z.object({
  prompts: z.array(promptSchema),
  nextCursor: z.string().optional(),
})
export type McpPrompt = z.infer<typeof promptSchema>

// Generic requests need the result checks performed by pi's native tools/call method.
const toolResultSchema = z
  .object({
    content: z
      .array(
        z.union([
          z.object({ type: z.literal('text'), text: z.string() }).passthrough(),
          z
            .object({ type: z.literal('image'), data: z.string(), mimeType: z.string() })
            .passthrough(),
          z
            .object({ type: z.literal('audio'), data: z.string(), mimeType: z.string() })
            .passthrough(),
          z
            .object({ type: z.literal('resource_link'), uri: z.string(), name: z.string() })
            .passthrough(),
          z
            .object({
              type: z.literal('resource'),
              resource: z.union([
                z.object({ uri: z.string(), text: z.string() }).passthrough(),
                z.object({ uri: z.string(), blob: z.string() }).passthrough(),
              ]),
            })
            .passthrough(),
        ]),
      )
      .default([]),
    structuredContent: z.record(z.string(), z.unknown()).optional(),
    isError: z.boolean().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export type McpConnectedClient = {
  tools: McpRawTool[]
  resources: McpResource[]
  resourceTemplates: McpResourceTemplate[]
  prompts: McpPrompt[]
  instructions?: string
  transport: 'stdio' | 'http'
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    requestMeta?: Record<string, unknown>,
    identity?: McpInvocationIdentity,
  ): Promise<McpToolResult>
  listResources(cursor?: string): Promise<ListResourcesResult>
  readResource(uri: string): Promise<McpReadResourceResult>
  close(): Promise<void>
}

// Cover transport startup and the initialized notification as well as initialize.
export const connectMcpClient = async (
  client: McpClient,
  transport: McpTransport,
  timeoutMs: number,
) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new McpTimeoutError(timeoutMs)), timeoutMs)
      }),
    ])
  } catch (cause) {
    await client.close().catch(() => undefined)
    throw cause
  } finally {
    clearTimeout(timer)
  }
}

// Cancel OAuth discovery/refresh fetches when the transport closes too.
export const createMcpHttpTransport = (options: StreamableHttpTransportOptions) => {
  const controller = new AbortController()
  const transport = new StreamableHttpTransport({
    ...options,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, controller.signal])
          : controller.signal,
      }),
  })
  transport.onClose(() => controller.abort())
  return transport
}

export class McpConnectionError extends Error {
  constructor(
    readonly safe: McpSanitizedError,
    readonly needsAuth = false,
  ) {
    super(safe.message)
  }
}

const isAuthenticationFailure = (cause: unknown) =>
  cause instanceof McpOAuthAuthorizationRequiredError ||
  (cause instanceof McpHttpError && (cause.status === 401 || cause.status === 403))

const safeConnectionError = (cause: unknown): McpConnectionError => {
  if (isAuthenticationFailure(cause)) {
    return new McpConnectionError(
      {
        code: 'MCP_AUTH_REQUIRED',
        message: 'MCP server 需要认证，请使用 OAuth 或配置环境变量凭据',
        retryable: true,
      },
      true,
    )
  }
  const timeout =
    cause instanceof McpTimeoutError ||
    (cause instanceof Error &&
      (cause.name === 'TimeoutError' || /timed?\s*out|timeout/i.test(cause.message)))
  return new McpConnectionError({
    code: timeout ? 'MCP_TIMEOUT' : 'MCP_CONNECTION_FAILED',
    message: timeout ? 'MCP server 连接超时' : 'MCP server 连接失败',
    retryable: true,
  })
}

// Preserve the SDK's restricted environment instead of inheriting host credentials.
const defaultEnvironment = () => {
  const names =
    process.platform === 'win32'
      ? [
          'APPDATA',
          'HOMEDRIVE',
          'HOMEPATH',
          'LOCALAPPDATA',
          'PATH',
          'PROCESSOR_ARCHITECTURE',
          'SYSTEMDRIVE',
          'SYSTEMROOT',
          'TEMP',
          'USERNAME',
          'USERPROFILE',
          'PROGRAMFILES',
        ]
      : ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER']
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = process.env[name]
      return value !== undefined && !value.startsWith('()') ? [[name, value]] : []
    }),
  )
}

const inherited = (references: Record<string, string> | undefined) =>
  Object.fromEntries(
    Object.entries(references ?? {})
      .map(([target, source]) => [target, process.env[source]])
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )

const requestHeaders = (server: McpServerDeclaration) => {
  if (server.transport.type !== 'http') return {}
  const headers: Record<string, string> = {
    ...(server.transport.headers ?? {}),
    ...inherited(server.transport.headerFromEnv),
  }
  const tokenName = server.transport.bearerTokenEnvVar
  const token = tokenName ? process.env[tokenName] : undefined
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

const withoutAuthorization = (headers: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'authorization'),
  )

const hasAuthorization = (headers: Record<string, string>) =>
  Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')

const listPrompts = async (client: McpClient, timeoutMs: number) => {
  const prompts: McpPrompt[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const result = promptPageSchema.parse(
      await client.request('prompts/list', cursor ? { cursor } : undefined, { timeoutMs }),
    )
    prompts.push(...result.prompts)
    if (!result.nextCursor) return prompts
    if (cursors.has(result.nextCursor)) throw new Error('Repeated MCP prompts cursor')
    cursors.add(result.nextCursor)
    cursor = result.nextCursor
  }
  throw new Error('Too many MCP prompts pages')
}

export class McpClientFactory {
  constructor(
    private readonly oauth?: McpOAuthCoordinator,
    private readonly elicit?: (
      connectionId: string,
      server: string,
      tool: string,
      identity: McpInvocationIdentity,
      params: unknown,
      signal: AbortSignal,
    ) => Promise<unknown>,
  ) {}

  async connect(
    server: McpServerDeclaration,
    onCatalogChanged: () => void,
    onClosed: () => void = () => undefined,
    context: {
      workspaceHash?: string
      onAuthenticationRequired?: () => void
    } = {},
  ): Promise<McpConnectedClient> {
    const startupTimeout = server.startupTimeoutMs ?? 10_000
    const connect = async (transport: McpTransport, kind: McpConnectedClient['transport']) => {
      const client = new McpClient({
        name: 'pidex-agent',
        version: '0.2.0',
        capabilities: this.elicit ? { elicitation: { form: {} } } : {},
        requestTimeoutMs: startupTimeout,
      })
      try {
        await connectMcpClient(client, transport, startupTimeout)
        return await this.ready(
          client,
          kind,
          server,
          onCatalogChanged,
          onClosed,
          context.onAuthenticationRequired,
        )
      } catch (cause) {
        await client.close().catch(() => undefined)
        throw cause
      }
    }
    try {
      if (server.transport.type === 'stdio') {
        return await connect(
          new StdioTransport({
            command: server.transport.command,
            ...(server.transport.args ? { args: [...server.transport.args] } : {}),
            ...(server.transport.cwd ? { cwd: server.transport.cwd } : {}),
            env: {
              ...defaultEnvironment(),
              ...(server.transport.env ?? {}),
              ...inherited(server.transport.envFromHost),
            },
            inheritEnv: false,
            stderr: 'pipe',
          }),
          'stdio',
        )
      }

      const headers = requestHeaders(server)
      const authProvider =
        server.transport.auth === 'none'
          ? undefined
          : await this.oauth?.provider(server, context.workspaceHash)
      const options = {
        url: server.transport.url,
        reconnect: { initialDelayMs: 500, maxDelayMs: 5_000, maxRetries: 2 },
      }
      try {
        return await connect(
          createMcpHttpTransport({
            ...options,
            headers,
            ...(!hasAuthorization(headers) && authProvider ? { authProvider } : {}),
          }),
          'http',
        )
      } catch (cause) {
        if (!isAuthenticationFailure(cause) || !hasAuthorization(headers) || !authProvider)
          throw cause
        return await connect(
          createMcpHttpTransport({
            ...options,
            headers: withoutAuthorization(headers),
            authProvider,
          }),
          'http',
        )
      }
    } catch (cause) {
      throw safeConnectionError(cause)
    }
  }

  private async ready(
    client: McpClient,
    transport: McpConnectedClient['transport'],
    server: McpServerDeclaration,
    onCatalogChanged: () => void,
    onClosed: () => void,
    onAuthenticationRequired?: () => void,
  ): Promise<McpConnectedClient> {
    const connectionId = crypto.randomUUID()
    let active: { tool: string; identity: McpInvocationIdentity; signal: AbortSignal } | undefined
    let queue = Promise.resolve()
    if (this.elicit)
      client.setRequestHandler('elicitation/create', (params, context) => {
        if (!active || active.signal.aborted) return { action: 'cancel' }
        return this.elicit!(
          connectionId,
          server.name,
          active.tool,
          active.identity,
          params,
          AbortSignal.any([context.signal, active.signal]),
        )
      })
    client.onClose(onClosed)
    client.onNotification('notifications/tools/list_changed', onCatalogChanged)
    client.onNotification('notifications/resources/list_changed', onCatalogChanged)
    const timeoutMs = server.toolTimeoutMs ?? 60_000
    const capabilities = client.serverCapabilities
    const tools = capabilities?.tools ? await client.listTools({ timeoutMs }) : []
    const resources = capabilities?.resources
      ? await client.listResources({ timeoutMs }).catch(() => [])
      : []
    const resourceTemplates = capabilities?.resources
      ? await client.listResourceTemplates({ timeoutMs }).catch(() => [])
      : []
    const prompts = capabilities?.prompts
      ? await listPrompts(client, timeoutMs).catch(() => [])
      : []
    const instructions = sanitizeMcpServerInstructions(client.instructions)
    return {
      tools,
      resources,
      resourceTemplates,
      prompts,
      ...(instructions ? { instructions } : {}),
      transport,
      callTool: async (name, args, signal, requestMeta, identity) => {
        const prior = queue
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        queue = prior.then(() => gate)
        try {
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              signal?.removeEventListener('abort', abort)
              reject(new McpAbortError())
            }
            signal?.addEventListener('abort', abort, { once: true })
            if (signal?.aborted) abort()
            void prior.then(() => {
              signal?.removeEventListener('abort', abort)
              resolve()
            })
          })
        } catch (cause) {
          release()
          throw cause
        }
        const controller = new AbortController()
        const operationSignal = signal
          ? AbortSignal.any([signal, controller.signal])
          : controller.signal
        try {
          if (operationSignal.aborted) throw new McpAbortError()
          active = identity ? { tool: name, identity, signal: operationSignal } : undefined
          const options = { timeoutMs, signal: operationSignal }
          if (!requestMeta) return await client.callTool(name, args, options)
          return toolResultSchema.parse(
            await client.request(
              'tools/call',
              {
                name,
                arguments: args,
                _meta: requestMeta,
              },
              options,
            ),
          ) as McpToolResult
        } catch (cause) {
          if (isAuthenticationFailure(cause)) {
            onAuthenticationRequired?.()
            throw safeConnectionError(cause)
          }
          throw cause
        } finally {
          active = undefined
          controller.abort()
          release()
        }
      },
      listResources: (cursor) => client.listResourcesPage(cursor, { timeoutMs }),
      readResource: (uri) => client.readResource(uri, { timeoutMs }),
      close: () => client.close(),
    }
  }
}
