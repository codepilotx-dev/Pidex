import type { McpServerDeclaration } from '@pidex/agent-protocol'
import Ajv, { type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { AgentError } from '../Domain'
import type { ToolDefinition } from '../tool/ToolRegistry'
import type { ApprovalStrategy } from '../tool/ToolRegistry'
import type { McpConnectionHandle } from './McpConnectionManager'
import {
  MCP_DIAGNOSTIC_CONTEXT_KEY,
  type McpDiagnosticContextProvider,
} from './McpDiagnosticContextProvider'

const MAX_RESULT_BYTES = 128 * 1024
const allModes = ['chat', 'plan'] as const
const allProfiles = ['main', 'default', 'explorer', 'worker'] as const

const toolEnabled = (policy: McpServerDeclaration, name: string) => {
  if (policy.disabledTools?.includes(name)) return false
  return !policy.enabledTools || policy.enabledTools.includes(name)
}

const approvalStrategy = (
  policy: McpServerDeclaration,
  toolName: string,
  readOnly: boolean,
): ApprovalStrategy => {
  const mode = policy.tools?.[toolName]?.approvalMode ?? policy.defaultToolsApprovalMode ?? 'auto'
  if (mode === 'prompt') return 'always-review'
  if (mode === 'approve') return 'never-review'
  if (mode === 'writes') return readOnly ? 'policy' : 'always-review'
  return 'policy'
}

const hashSuffix = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 8)

const segment = (value: string, maximum: number) => {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/[^\x00-\x7F]/g, '_')
  return (normalized || 'unnamed').slice(0, maximum)
}

const uniqueToolName = (server: string, tool: string, used: Set<string>) => {
  const base = `mcp__${segment(server, 20)}__${segment(tool, 28)}`.slice(0, 63)
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  const suffix = `_${hashSuffix(`${server}\0${tool}`)}`
  const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`
  used.add(candidate)
  return candidate
}

const boundedJson = (value: unknown) => {
  const text = JSON.stringify(value, null, 2) ?? 'null'
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= MAX_RESULT_BYTES) return { text, truncated: false }
  const marker = '\n… MCP 结果已截断'
  const maximumBodyBytes = MAX_RESULT_BYTES - Buffer.byteLength(marker, 'utf8')
  let end = Math.min(text.length, maximumBodyBytes)
  while (Buffer.byteLength(text.slice(0, end), 'utf8') > maximumBodyBytes) {
    end = Math.max(0, end - 1_024)
  }
  return {
    text: `${text.slice(0, end)}${marker}`,
    truncated: true,
  }
}

const boundedDetails = (value: unknown, bounded: ReturnType<typeof boundedJson>) =>
  bounded.truncated ? { truncated: true } : value

const uriMatchesTemplate = (uri: string, template: string) => {
  let pattern = '^'
  let cursor = 0
  for (const expression of template.matchAll(/\{[^{}]+\}/g)) {
    const index = expression.index ?? 0
    pattern += template.slice(cursor, index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    pattern += '[^\\s]+'
    cursor = index + expression[0].length
  }
  if (cursor === 0) return uri === template
  pattern += template.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${pattern}$`, 'u').test(uri)
}

export class McpToolAdapter {
  private readonly ajv: Ajv

  constructor(
    private readonly generation: number,
    private readonly handles: ReadonlyMap<string, McpConnectionHandle>,
    private readonly diagnosticContext?: McpDiagnosticContextProvider,
  ) {
    this.ajv = new Ajv({ allErrors: true, strict: false })
    addFormats(this.ajv)
  }

  definitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = []
    const used = new Set<string>(['mcp_list_resources', 'mcp_read_resource'])
    for (const handle of this.handles.values()) {
      if (handle.state !== 'connected' || !handle.connected) continue
      const policy = handle.server
      handle.validToolCount = 0
      for (const tool of handle.connected.tools) {
        if (!toolEnabled(policy, tool.name)) continue
        let validate: ValidateFunction
        try {
          validate = this.ajv.compile(tool.inputSchema)
        } catch {
          handle.error ??= {
            code: 'MCP_TOOL_SCHEMA_INVALID',
            message: '部分 MCP 工具 schema 无效，已安全跳过',
            retryable: false,
          }
          continue
        }
        handle.validToolCount += 1
        const sdkName = uniqueToolName(handle.server.name, tool.name, used)
        const readOnly =
          tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint !== true
        definitions.push({
          sdkName,
          name: sdkName,
          description:
            tool.description || `调用 ${handle.server.name} MCP server 的 ${tool.name} 工具。`,
          schema: z.record(z.string(), z.unknown()).superRefine((value, context) => {
            if (validate(value)) return
            for (const error of validate.errors ?? []) {
              context.addIssue({
                code: 'custom',
                message: `${error.instancePath || '/'} ${error.message || '参数无效'}`,
              })
            }
          }),
          inputSchema: tool.inputSchema,
          origin: {
            kind: 'mcp',
            serverName: handle.server.name,
            rawToolName: tool.name,
            generation: this.generation,
          },
          capabilities: {
            filesystem: 'none',
            network: handle.server.transport.type === 'http' ? 'declared' : 'none',
            process: handle.server.transport.type === 'stdio',
            externalState: !readOnly,
            userInteraction: false,
          },
          allowedModes: allModes,
          allowedProfiles: allProfiles,
          approvalStrategy: approvalStrategy(policy, tool.name, readOnly),
          visibility: 'deferred',
          executionMode: readOnly ? 'parallel' : 'sequential',
          execute: async (input, context) => {
            if (!handle.connected)
              throw new AgentError('MCP_UNAVAILABLE', 'MCP server 当前不可用', 503)
            let requestMeta: Record<string, unknown> | undefined
            if (handle.server.diagnosticContext && handle.server.transport.type === 'stdio') {
              try {
                if (!this.diagnosticContext || !context.invocation)
                  throw new Error('Diagnostic context unavailable')
                requestMeta = {
                  [MCP_DIAGNOSTIC_CONTEXT_KEY]: this.diagnosticContext.build({
                    ...context.invocation,
                    taskMode: context.taskMode,
                    model: context.model,
                    workspaceRoot: context.workspace.rootPath,
                  }),
                }
              } catch {
                requestMeta = {
                  [MCP_DIAGNOSTIC_CONTEXT_KEY]: {
                    version: 1,
                    status: 'DIAGNOSTIC_CONTEXT_UNAVAILABLE',
                  },
                }
              }
            }
            return handle.connected.callTool(
              tool.name,
              input as Record<string, unknown>,
              context.signal,
              requestMeta,
              context.invocation,
            )
          },
          formatResult: (output) => {
            const result = boundedJson(output)
            return {
              content: result.text,
              details: boundedDetails(output, result),
            }
          },
        })
      }
    }

    if (
      [...this.handles.values()].some(
        (handle) =>
          handle.connected &&
          (handle.connected.resources.length > 0 || handle.connected.resourceTemplates.length > 0),
      )
    ) {
      definitions.push(this.listResourcesDefinition(), this.readResourceDefinition())
    }
    return definitions
  }

  private listResourcesDefinition(): ToolDefinition {
    const schema = z
      .object({
        server: z.string().min(1).optional(),
        cursor: z.string().min(1).optional(),
      })
      .strict()
    return {
      sdkName: 'mcp_list_resources',
      name: 'mcp_list_resources',
      description: '列出当前 turn 已连接 MCP server 公布的资源；可按 server 筛选。',
      schema,
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string' },
          cursor: { type: 'string' },
        },
        additionalProperties: false,
      },
      origin: {
        kind: 'mcp',
        serverName: '*',
        rawToolName: 'resources/list',
        generation: this.generation,
      },
      capabilities: {
        filesystem: 'none',
        network: 'declared',
        process: false,
        externalState: false,
        userInteraction: false,
      },
      allowedModes: allModes,
      allowedProfiles: allProfiles,
      approvalStrategy: 'policy',
      visibility: 'deferred',
      executionMode: 'parallel',
      execute: async (input) => {
        const request = input as { server?: string; cursor?: string }
        const selected = [...this.handles.values()].filter(
          (handle) =>
            handle.connected && (!request.server || handle.server.name === request.server),
        )
        if (request.server && selected.length === 0) {
          throw new AgentError('MCP_SERVER_NOT_FOUND', '当前 turn 中没有该 MCP server', 404)
        }
        return Promise.all(
          selected.map(async (handle) => {
            try {
              const result = request.cursor
                ? await handle.connected!.listResources(request.cursor)
                : {
                    resources: handle.connected!.resources,
                    nextCursor: undefined,
                  }
              return {
                server: handle.server.name,
                resources: result.resources,
                ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
                templates: request.cursor ? [] : handle.connected!.resourceTemplates,
              }
            } catch {
              return {
                server: handle.server.name,
                resources: [],
                templates: [],
                error: {
                  code: 'MCP_RESOURCE_LIST_FAILED',
                  message: '资源列表读取失败',
                  retryable: true,
                },
              }
            }
          }),
        )
      },
      formatResult: (output) => {
        const result = boundedJson(output)
        return { content: result.text, details: boundedDetails(output, result) }
      },
    }
  }

  private readResourceDefinition(): ToolDefinition {
    return {
      sdkName: 'mcp_read_resource',
      name: 'mcp_read_resource',
      description: '从指定 MCP server 读取其已公布的资源 URI。',
      schema: z
        .object({
          server: z.string().min(1),
          uri: z.string().min(1),
        })
        .strict(),
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', minLength: 1 },
          uri: { type: 'string', minLength: 1 },
        },
        required: ['server', 'uri'],
        additionalProperties: false,
      },
      origin: {
        kind: 'mcp',
        serverName: '*',
        rawToolName: 'resources/read',
        generation: this.generation,
      },
      capabilities: {
        filesystem: 'none',
        network: 'declared',
        process: false,
        externalState: false,
        userInteraction: false,
      },
      allowedModes: allModes,
      allowedProfiles: allProfiles,
      approvalStrategy: 'policy',
      visibility: 'deferred',
      executionMode: 'parallel',
      execute: async (input) => {
        const request = input as { server: string; uri: string }
        const handle = this.handles.get(request.server)
        if (!handle?.connected)
          throw new AgentError('MCP_SERVER_NOT_FOUND', '当前 turn 中没有该 MCP server', 404)
        const announced =
          handle.connected.resources.some((resource) => resource.uri === request.uri) ||
          handle.connected.resourceTemplates.some((template) =>
            uriMatchesTemplate(request.uri, template.uriTemplate),
          )
        if (!announced) throw new AgentError('PATH_DENIED', '资源 URI 未由该 MCP server 公布', 403)
        return handle.connected.readResource(request.uri)
      },
      formatResult: (output) => {
        const result = boundedJson(output)
        return {
          content: result.text,
          details: boundedDetails(output, result),
        }
      },
    }
  }
}
