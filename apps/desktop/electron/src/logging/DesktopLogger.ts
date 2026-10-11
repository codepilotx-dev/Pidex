import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  renameSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import type { DataLocationLaunch } from '../settings/DataLocationStore.js'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_FILES = 5
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const SENSITIVE_KEY = /token|authorization|cookie|api[-_]?key|secret|password|credential/i
const CONSOLE_KEYS = new Set([
  'attempt',
  'code',
  'durationMs',
  'exitCode',
  'message',
  'method',
  'packaged',
  'phase',
  'pid',
  'port',
  'reason',
  'signal',
  'state',
  'status',
  'version',
])

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type ConsoleLogLevel = 'off' | 'info' | 'debug'
type LogDetailMode = 'safe' | 'development'
type StructuredLogFields = {
  context?: Record<string, string | undefined>
  details?: Record<string, unknown>
  development?: Record<string, unknown>
}

export interface DesktopLogger {
  readonly directory: string
  readonly consoleEnabled: boolean
  debug(event: string, fields?: Record<string, unknown>): void
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
  forwardConsoleLine(line: string): void
}

export interface DesktopLoggerOptions {
  consoleLevel?: ConsoleLogLevel
  detailMode?: LogDetailMode
  consoleSink?: (line: string, level: LogLevel) => void
  now?: () => Date
}

export function resolveDesktopLogDirectory(
  launch: DataLocationLaunch,
  configuredDirectory: string | undefined,
): string {
  const configured = configuredDirectory?.trim()
  if (configured) return resolve(configured)
  const dataDirectory = launch.relocation?.sourceDataDir ?? launch.dataDir
  return resolve(join(dataDirectory, 'logs'))
}

const parseConsoleLevel = (value: string | undefined): ConsoleLogLevel =>
  value === 'info' || value === 'debug' ? value : 'off'

const parseDetailMode = (value: string | undefined): LogDetailMode =>
  value === 'development' ? 'development' : 'safe'

const sanitizeString = (value: string, limit = 2_000) => {
  const redacted = value
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(
      /\b(token|api[-_]?key|password|secret|cookie|authorization|credential)=([^\s,;]+)/gi,
      '$1=[REDACTED]',
    )
    .replace(/(["'])[A-Za-z]:[\\/].*?\1/g, '$1[PATH]$1')
    .replace(/\b[A-Za-z]:[\\/][^\s,;)"']+/g, '[PATH]')
    .replace(/\\\\[^\\\s]+\\[^\s,;)"']+/g, '[PATH]')
  return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted
}

const sanitize = (value: unknown, detailMode: LogDetailMode, key?: string): unknown => {
  if (key && SENSITIVE_KEY.test(key)) return '[REDACTED]'
  if (value instanceof Error) {
    return {
      name: sanitizeString(value.name),
      message: sanitizeString(value.message),
      ...(detailMode === 'development' && value.stack
        ? { stack: sanitizeString(value.stack, 4_000) }
        : {}),
    }
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, detailMode))
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? sanitizeString(value) : value
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, item]) => [
      entryKey,
      sanitize(item, detailMode, entryKey),
    ]),
  )
}

const structuredFields = (fields?: Record<string, unknown>): StructuredLogFields => {
  if (!fields) return {}
  if ('context' in fields || 'details' in fields || 'development' in fields) {
    return fields as StructuredLogFields
  }
  return { details: fields }
}

function rotate(path: string): void {
  try {
    if (existsSync(path) && statSync(path).size >= MAX_BYTES) {
      const oldest = `${path.slice(0, -6)}.${MAX_FILES - 1}.jsonl`
      if (existsSync(oldest)) unlinkSync(oldest)
      for (let index = MAX_FILES - 2; index >= 1; index -= 1) {
        const source = `${path.slice(0, -6)}.${index}.jsonl`
        const target = `${path.slice(0, -6)}.${index + 1}.jsonl`
        if (existsSync(source)) renameSync(source, target)
      }
      renameSync(path, `${path.slice(0, -6)}.1.jsonl`)
    }
  } catch {
    /* logging must never prevent startup */
  }
}

function cleanup(directory: string, path: string): void {
  try {
    const cutoff = Date.now() - MAX_AGE_MS
    for (const name of readdirSync(directory)) {
      if (!/^desktop(?:\.\d+)?\.jsonl$/.test(name)) continue
      const candidate = join(directory, name)
      if (candidate !== path && statSync(candidate).mtimeMs < cutoff) unlinkSync(candidate)
    }
  } catch {
    /* logging must never prevent startup */
  }
}

export function createDesktopLogger(
  directory: string,
  options: DesktopLoggerOptions = {},
): DesktopLogger {
  const path = join(directory, 'desktop.jsonl')
  const consoleLevel = options.consoleLevel ?? parseConsoleLevel(process.env.PIDEX_CONSOLE_LOG)
  const detailMode = options.detailMode ?? parseDetailMode(process.env.PIDEX_LOG_DETAIL)
  const now = options.now ?? (() => new Date())
  const consoleSink =
    options.consoleSink ??
    ((line: string, level: LogLevel) => {
      if (level === 'warn' || level === 'error') process.stderr.write(line)
      else process.stdout.write(line)
    })
  try {
    mkdirSync(directory, { recursive: true })
  } catch {
    /* logging must never prevent startup */
  }
  cleanup(directory, path)

  const shouldWriteConsole = (level: LogLevel) =>
    consoleLevel !== 'off' && (level !== 'debug' || consoleLevel === 'debug')

  const write = (level: LogLevel, event: string, rawFields?: Record<string, unknown>) => {
    const fields = structuredFields(rawFields)
    const at = now()
    try {
      rotate(path)
      appendFileSync(
        path,
        `${JSON.stringify({
          at: at.toISOString(),
          level,
          component: 'desktop',
          event,
          ...(fields.context ? { context: sanitize(fields.context, detailMode) } : {}),
          ...(fields.details ? { details: sanitize(fields.details, detailMode) } : {}),
          ...(detailMode === 'development' && fields.development
            ? { development: sanitize(fields.development, detailMode) }
            : {}),
        })}\n`,
        'utf8',
      )
    } catch {
      /* logging must never prevent startup */
    }

    if (!shouldWriteConsole(level)) return
    try {
      const parts = [`${at.toISOString().slice(11, 23)} [desktop] ${level.toUpperCase()} ${event}`]
      for (const [key, value] of Object.entries(fields.details ?? {})) {
        if (
          !CONSOLE_KEYS.has(key) ||
          value === undefined ||
          value === null ||
          typeof value === 'object'
        )
          continue
        parts.push(`${key}=${sanitizeString(String(value), 160).replace(/\s+/g, ' ')}`)
      }
      consoleSink(`${parts.join(' ')}\n`, level)
    } catch {
      /* console logging must remain best-effort */
    }
  }

  return {
    directory,
    consoleEnabled: consoleLevel !== 'off',
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    forwardConsoleLine: (line) => {
      if (consoleLevel === 'off') return
      try {
        consoleSink(line.endsWith('\n') ? line : `${line}\n`, 'info')
      } catch {
        /* best effort */
      }
    },
  }
}
