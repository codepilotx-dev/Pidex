import { McpServerDeclarationSchema, type McpServerDeclaration } from '@pidex/agent-protocol'
import { Schema } from 'effect'

type SettingsDatabase = {
  getSetting<T>(key: string): T | null
  setSetting(key: string, value: unknown): void
}

type McpOperation = {
  operationId: string
  fingerprint: string
  generation: number
}

export type McpSettingsState = {
  version: 2
  generation: number
  user: Record<string, McpServerDeclaration>
  local: Record<string, Record<string, McpServerDeclaration>>
  operations: McpOperation[]
}

const SETTINGS_KEY = 'mcp.runtime.v1'
const MAX_OPERATIONS = 100

const defaultState = (): McpSettingsState => ({
  version: 2,
  generation: 1,
  user: {
    context7: {
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
  },
  local: {},
  operations: [],
})

const decodeDeclaration = Schema.decodeUnknownSync(McpServerDeclarationSchema, {
  onExcessProperty: 'error',
})

const sanitizeUnknownStrings = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (typeof item !== 'string') return [item]
        const normalized = item.trim()
        return normalized ? [normalized] : []
      })
    : value

const sanitizeStoredDeclarationInput = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const declaration = { ...value } as Record<string, unknown>
  declaration.enabledTools = sanitizeUnknownStrings(declaration.enabledTools)
  declaration.disabledTools = sanitizeUnknownStrings(declaration.disabledTools)
  if (
    declaration.tools &&
    typeof declaration.tools === 'object' &&
    !Array.isArray(declaration.tools)
  ) {
    declaration.tools = Object.fromEntries(
      Object.entries(declaration.tools)
        .map(([name, policy]) => [name.trim(), policy] as const)
        .filter(([name]) => Boolean(name)),
    )
  }
  if (
    declaration.transport &&
    typeof declaration.transport === 'object' &&
    !Array.isArray(declaration.transport)
  ) {
    const transport = { ...declaration.transport } as Record<string, unknown>
    if ('scopes' in transport) {
      transport.scopes = sanitizeUnknownStrings(transport.scopes)
    }
    if ('oauthResource' in transport && typeof transport.oauthResource === 'string') {
      const resource = transport.oauthResource.trim()
      if (resource) transport.oauthResource = resource
      else delete transport.oauthResource
    }
    declaration.transport = transport
  }
  return declaration
}

const normalizedStrings = (values: readonly string[] | undefined) =>
  values ? [...new Set(values.map((value) => value.trim()).filter(Boolean))] : undefined

const normalizeDeclaration = (declaration: McpServerDeclaration): McpServerDeclaration => {
  const enabledTools = normalizedStrings(declaration.enabledTools)
  const disabledTools = normalizedStrings(declaration.disabledTools)
  const tools = declaration.tools
    ? Object.fromEntries(
        Object.entries(declaration.tools)
          .map(([name, policy]) => [name.trim(), policy] as const)
          .filter(([name]) => Boolean(name)),
      )
    : undefined
  const policy = {
    ...(enabledTools !== undefined ? { enabledTools } : {}),
    ...(disabledTools?.length ? { disabledTools } : {}),
    ...(tools && Object.keys(tools).length ? { tools } : {}),
  }
  const {
    enabledTools: _enabledTools,
    disabledTools: _disabledTools,
    tools: _tools,
    ...base
  } = declaration
  if (declaration.transport.type === 'stdio') {
    return { ...base, ...policy }
  }
  const scopes = normalizedStrings(declaration.transport.scopes)
  const { scopes: _scopes, oauthResource: _oauthResource, ...transport } = declaration.transport
  return {
    ...base,
    ...policy,
    transport: {
      ...transport,
      ...(scopes?.length ? { scopes } : {}),
      ...(declaration.transport.oauthResource
        ? { oauthResource: declaration.transport.oauthResource.trim() }
        : {}),
    },
  }
}

const declarationRecord = (value: unknown): Record<string, McpServerDeclaration> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, server]) => {
      try {
        const declaration = normalizeDeclaration(
          decodeDeclaration(sanitizeStoredDeclarationInput(server)),
        )
        return key === declaration.name ? [[key, declaration] as const] : []
      } catch {
        return []
      }
    }),
  )
}

const normalizeState = (value: McpSettingsState | null): McpSettingsState => {
  if (!value || value.version !== 2) return defaultState()
  const local =
    value.local && typeof value.local === 'object' && !Array.isArray(value.local)
      ? Object.fromEntries(
          Object.entries(value.local)
            .filter(([workspaceHash]) => /^[a-f\d]{64}$/i.test(workspaceHash))
            .map(([workspaceHash, servers]) => [workspaceHash, declarationRecord(servers)]),
        )
      : {}
  return {
    version: 2,
    generation:
      Number.isSafeInteger(value.generation) && value.generation >= 1 ? value.generation : 1,
    user: declarationRecord(value.user),
    local,
    operations: Array.isArray(value.operations)
      ? value.operations
          .filter(
            (operation) =>
              operation &&
              typeof operation.operationId === 'string' &&
              typeof operation.fingerprint === 'string' &&
              Number.isSafeInteger(operation.generation) &&
              operation.generation >= 1,
          )
          .slice(-MAX_OPERATIONS)
      : [],
  }
}

export class McpSettingsConflictError extends Error {}

export type McpPreparedMutation = {
  baseState: McpSettingsState
  state: McpSettingsState
  changed: boolean
  commitRequired: boolean
}

export class McpSettingsRepository {
  constructor(private readonly database: SettingsDatabase) {}

  state(): McpSettingsState {
    return normalizeState(this.database.getSetting<McpSettingsState>(SETTINGS_KEY))
  }

  prepare(input: {
    operationId: string
    fingerprint: string
    apply: (draft: McpSettingsState) => boolean
  }): McpPreparedMutation {
    const state = this.state()
    const existing = state.operations.find(
      (operation) => operation.operationId === input.operationId,
    )
    if (existing) {
      if (existing.fingerprint !== input.fingerprint) {
        throw new McpSettingsConflictError('operationId 已用于其他 MCP 设置请求')
      }
      return {
        baseState: state,
        state: { ...state, generation: existing.generation },
        changed: false,
        commitRequired: false,
      }
    }

    const draft = structuredClone(state)
    const changed = input.apply(draft)
    const generation = changed ? state.generation + 1 : state.generation
    const next: McpSettingsState = {
      ...draft,
      generation,
      operations: [
        ...state.operations,
        {
          operationId: input.operationId,
          fingerprint: input.fingerprint,
          generation,
        },
      ].slice(-MAX_OPERATIONS),
    }
    return {
      baseState: state,
      state: next,
      changed,
      commitRequired: true,
    }
  }

  commit(prepared: McpPreparedMutation): { state: McpSettingsState; changed: boolean } {
    if (!prepared.commitRequired) {
      return { state: prepared.state, changed: prepared.changed }
    }
    if (JSON.stringify(this.state()) !== JSON.stringify(prepared.baseState)) {
      throw new McpSettingsConflictError('MCP 设置已被其他请求更新')
    }
    this.database.setSetting(SETTINGS_KEY, prepared.state)
    return { state: prepared.state, changed: prepared.changed }
  }

  mutate(input: {
    operationId: string
    fingerprint: string
    apply: (draft: McpSettingsState) => boolean
  }): { state: McpSettingsState; changed: boolean } {
    return this.commit(this.prepare(input))
  }
}
