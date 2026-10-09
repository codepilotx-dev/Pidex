import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_FILES = 5
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_STRING_LENGTH = 2_000
const SLOW_HTTP_REQUEST_MS = 1_000
const SLOW_RPC_REQUEST_MS = 10_000
const SENSITIVE_KEY = /authorization|token|api[-_]?key|password|secret|credential|cookie/i
const BEARER_VALUE = /\bBearer\s+[^\s,;"']+/gi
const OPENAI_KEY = /\bsk-[A-Za-z0-9_-]+\b/g
const TOKEN_METRICS = new Set([
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'beforeTokens',
  'afterTokens',
  'totalTokens',
])
const CONSOLE_KEYS = new Set([
  'attempt',
  'code',
  'durationMs',
  'exitCode',
  'message',
  'method',
  'mode',
  'model',
  'packaged',
  'phase',
  'pid',
  'port',
  'provider',
  'reason',
  'signal',
  'state',
  'status',
  'stage',
  'scope',
  'tool',
  'version',
  'path',
  'stepIndex',
  'requestIndex',
  'responseIndex',
  'rpcCode',
  'retryable',
  'operation',
  'maxAttempts',
  'delayMs',
  'firstResponseMs',
  'toolCount',
  'messageCount',
  'skillCount',
  'promptTemplateCount',
  'inputCount',
  'nextTurnCount',
  'beforeCount',
  'delivery',
  'hadPendingMutations',
  'decision',
  'kind',
  'risk',
  'category',
  'shellTool',
  'backend',
  'timedOut',
  'stdoutBytes',
  'stderrBytes',
  'outputTruncated',
  'resolution',
  'timeoutMs',
  'cwdScope',
  'commandBytes',
  'fileCount',
  'editCount',
  'contentBytes',
  'patchBytes',
  'hunkCount',
  'additions',
  'deletions',
  ...TOKEN_METRICS,
])

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type ConsoleLogLevel = 'off' | 'info' | 'debug'
export type LogDetailMode = 'safe' | 'development'
export type LogContext = {
  threadId?: string
  turnId?: string
  agentId?: string
  toolCallId?: string
  interactionId?: string
}
export type StructuredLogFields = {
  context?: LogContext
  details?: Record<string, unknown>
  development?: Record<string, unknown>
}
type ConsoleSink = (line: string, level: LogLevel) => void
type LogValue =
  string | number | boolean | null | undefined | LogValue[] | { [key: string]: LogValue }

export interface AgentLoggerOptions {
  consoleLevel?: ConsoleLogLevel
  detailMode?: LogDetailMode
  consoleSink?: ConsoleSink
  now?: () => Date
}

const parseConsoleLevel = (value: string | undefined): ConsoleLogLevel =>
  value === 'info' || value === 'debug' ? value : 'off'

const parseDetailMode = (value: string | undefined): LogDetailMode =>
  value === 'development' ? 'development' : 'safe'

const sanitizeString = (value: string, limit = MAX_STRING_LENGTH) => {
  const sanitized = value
    .replace(BEARER_VALUE, 'Bearer [REDACTED]')
    .replace(OPENAI_KEY, '[REDACTED]')
    .replace(
      /\b(token|api[-_]?key|password|secret|cookie|authorization|credential)=([^\s,;]+)/gi,
      '$1=[REDACTED]',
    )
    .replace(/(["'])[A-Za-z]:[\\/].*?\1/g, '$1[PATH]$1')
    .replace(/\b[A-Za-z]:[\\/][^\s,;)"']+/g, '[PATH]')
    .replace(/\\\\[^\\\s]+\\[^\s,;)"']+/g, '[PATH]')
  return sanitized.length > limit ? `${sanitized.slice(0, limit)}…` : sanitized
}

const sanitize = (value: unknown, detailMode: LogDetailMode, key?: string): LogValue => {
  if (
    key &&
    SENSITIVE_KEY.test(key) &&
    !(TOKEN_METRICS.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0)
  )
    return '[REDACTED]'
  if (value instanceof Error) {
    return {
      name: sanitizeString(value.name),
      message: sanitizeString(value.message),
      ...(detailMode === 'development' && value.stack
        ? { stack: sanitizeString(value.stack, 4_000) }
        : {}),
    }
  }
  if (typeof value === 'string') return sanitizeString(value)
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  )
    return value
  if (Array.isArray(value)) return value.map((item) => sanitize(item, detailMode))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitize(entryValue, detailMode, entryKey),
      ]),
    )
  }
  return sanitizeString(String(value))
}

const structuredFields = (fields?: Record<string, unknown>): StructuredLogFields => {
  if (!fields) return {}
  if ('context' in fields || 'details' in fields || 'development' in fields) {
    return fields as StructuredLogFields
  }
  return { details: fields }
}

const shortId = (value: string | undefined) => (value ? value.slice(0, 8) : undefined)

const consoleLine = (
  at: Date,
  level: LogLevel,
  event: string,
  fields: StructuredLogFields,
): string => {
  const parts = [`${at.toISOString().slice(11, 23)} [agent] ${level.toUpperCase()} ${event}`]
  const context = fields.context ? (sanitize(fields.context, 'safe') as LogContext) : undefined
  if (context?.threadId) parts.push(`thread=${shortId(context.threadId)}`)
  if (context?.turnId) parts.push(`turn=${shortId(context.turnId)}`)
  if (context?.agentId) parts.push(`agent=${shortId(context.agentId)}`)
  if (context?.toolCallId) parts.push(`call=${shortId(context.toolCallId)}`)
  if (context?.interactionId) parts.push(`interaction=${shortId(context.interactionId)}`)
  for (const [key, value] of Object.entries(
    sanitize(fields.details ?? {}, 'safe') as Record<string, LogValue>,
  )) {
    if (
      !CONSOLE_KEYS.has(key) ||
      value === undefined ||
      value === null ||
      typeof value === 'object'
    )
      continue
    parts.push(`${key}=${sanitizeString(String(value), 160).replace(/\s+/g, ' ')}`)
  }
  return `${parts.join(' ')}\n`
}

export class AgentLogger {
  private readonly activeFile: string
  private readonly consoleLevel: ConsoleLogLevel
  private readonly detailMode: LogDetailMode
  private readonly consoleSink: ConsoleSink
  private readonly now: () => Date

  constructor(
    private readonly directory: string,
    options: AgentLoggerOptions = {},
  ) {
    this.activeFile = join(directory, 'agent.jsonl')
    this.consoleLevel = options.consoleLevel ?? parseConsoleLevel(process.env.PIDEX_CONSOLE_LOG)
    this.detailMode = options.detailMode ?? parseDetailMode(process.env.PIDEX_LOG_DETAIL)
    this.consoleSink = options.consoleSink ?? ((line) => process.stdout.write(line))
    this.now = options.now ?? (() => new Date())
    this.prepare()
  }

  get developmentDetailsEnabled(): boolean {
    return this.detailMode === 'development'
  }

  debug(event: string, fields?: Record<string, unknown>) {
    this.write('debug', event, fields)
  }

  info(event: string, fields?: Record<string, unknown>) {
    this.write('info', event, fields)
  }

  warn(event: string, fields?: Record<string, unknown>) {
    this.write('warn', event, fields)
  }

  error(event: string, fields?: Record<string, unknown>) {
    this.write('error', event, fields)
  }

  request(input: { method: string; path: string; status: number; durationMs: number }) {
    if (input.status >= 400) {
      const level = input.status >= 500 ? 'error' : 'warn'
      this.write(level, 'http.request.failed', { details: input })
      return
    }
    if (input.path === '/rpc') return
    if (input.durationMs >= SLOW_HTTP_REQUEST_MS) {
      this.write('warn', 'http.request.slow', { details: input })
    }
  }

  rpc(input: {
    method: string
    durationMs: number
    context?: LogContext
    expectedWait?: boolean
    rpcCode?: number
    code?: string
    retryable?: boolean
  }) {
    const { context, expectedWait, ...details } = input
    const fields = { context, details }
    if (input.rpcCode !== undefined) {
      this.write(
        input.rpcCode === -32603 || input.code === 'INTERNAL_ERROR' ? 'error' : 'warn',
        'rpc.request.failed',
        fields,
      )
    } else if (expectedWait) {
      this.write('debug', 'rpc.wait.completed', fields)
    } else if (input.durationMs >= SLOW_RPC_REQUEST_MS) {
      this.write('warn', 'rpc.request.slow', fields)
    } else {
      this.write('debug', 'rpc.request.completed', fields)
    }
  }

  private write(level: LogLevel, event: string, rawFields?: Record<string, unknown>) {
    const fields = structuredFields(rawFields)
    const at = this.now()
    try {
      this.rotateIfNeeded()
      const details = fields.details ? sanitize(fields.details, this.detailMode) : undefined
      const development =
        this.detailMode === 'development' && fields.development
          ? sanitize(fields.development, this.detailMode)
          : undefined
      const line = `${JSON.stringify({
        at: at.toISOString(),
        level,
        component: 'agent',
        event,
        ...(fields.context ? { context: sanitize(fields.context, this.detailMode) } : {}),
        ...(details ? { details } : {}),
        ...(development ? { development } : {}),
      })}\n`
      appendFileSync(this.activeFile, line, 'utf8')
    } catch {
      // Observability must never take the local sidecar down.
    }
    if (this.shouldWriteConsole(level)) {
      try {
        this.consoleSink(consoleLine(at, level, event, fields), level)
      } catch {
        // Console logging must remain best-effort.
      }
    }
  }

  private shouldWriteConsole(level: LogLevel) {
    if (this.consoleLevel === 'off') return false
    if (level === 'debug') return this.consoleLevel === 'debug'
    return true
  }

  private prepare() {
    try {
      mkdirSync(this.directory, { recursive: true })
      this.pruneExpired()
    } catch {
      // The logger intentionally becomes a no-op when its directory is unavailable.
    }
  }

  private rotateIfNeeded() {
    this.prepare()
    if (!existsSync(this.activeFile) || statSync(this.activeFile).size < MAX_FILE_BYTES) return
    const oldest = join(this.directory, `agent.${MAX_FILES - 1}.jsonl`)
    if (existsSync(oldest)) unlinkSync(oldest)
    for (let index = MAX_FILES - 2; index >= 1; index -= 1) {
      const source = join(this.directory, `agent.${index}.jsonl`)
      if (existsSync(source)) renameSync(source, join(this.directory, `agent.${index + 1}.jsonl`))
    }
    renameSync(this.activeFile, join(this.directory, 'agent.1.jsonl'))
  }

  private pruneExpired() {
    const threshold = Date.now() - MAX_AGE_MS
    for (const entry of readdirSync(this.directory)) {
      if (!/^agent(?:\.\d+)?\.jsonl$/.test(entry)) continue
      const path = join(this.directory, entry)
      if (statSync(path).mtimeMs < threshold) unlinkSync(path)
    }
  }
}
