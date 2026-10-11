import { errorMessageOf as rawErrorMessage } from '@pidex/shared/errors'
const RESIZE_OBSERVER_LOOP_MESSAGES = [
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
]

export type ErrorContext =
  'thread-read' | 'thread-create' | 'thread-send' | 'project-list' | 'general'

export function toUserErrorMessage(error: unknown, context?: ErrorContext): string {
  const errorCode = extractErrorCode(error)
  const numericCode = extractNumericCode(error)
  const message = rawErrorMessage(error).trim()

  // 1. Internal Error (Highest priority for server-side exceptions)
  if (
    numericCode === -32603 ||
    message.includes('INTERNAL_ERROR') ||
    message.includes('Agent 内部错误') ||
    isDatabaseError(message) ||
    (errorCode === 'INTERNAL_ERROR' && !message.includes('会话标题'))
  ) {
    return 'Agent 发生内部错误，请重试。'
  }

  // 2. Agent Unavailable / Network / Process crash
  if (
    errorCode === 'AGENT_UNAVAILABLE' ||
    errorCode === 'SERVICE_UNAVAILABLE' ||
    errorCode === 'CONNECTION_REFUSED' ||
    errorCode === 'ECONNREFUSED' ||
    message.includes('The app-server is unavailable') ||
    message.includes('app-server is unavailable') ||
    message.includes('Agent RPC 当前不可用') ||
    message.includes('Agent 暂时不可用') ||
    message.includes('ECONNREFUSED') ||
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('fetch failed') ||
    message.includes('无法连接') ||
    message.includes('连接断开')
  ) {
    return 'Agent 暂时不可用，请稍后重试。'
  }

  // 3. Protocol or capability mismatch
  if (
    errorCode === 'CAPABILITY_NOT_FOUND' ||
    errorCode === 'METHOD_NOT_FOUND' ||
    errorCode === 'PROTOCOL_MISMATCH' ||
    errorCode === 'CAPABILITY_MISMATCH' ||
    errorCode === 'UNSUPPORTED_VERSION' ||
    errorCode === 'AGENT_OPERATION_UNSUPPORTED' ||
    numericCode === -32601 ||
    message.includes('AGENT_OPERATION_UNSUPPORTED') ||
    message.includes('Method not found') ||
    message.includes('协议不匹配') ||
    message.includes('能力不匹配') ||
    message.includes('暂不支持')
  ) {
    return 'Agent 版本与桌面端不兼容，请重启或更新应用。'
  }

  // 4. Thread read / load failure
  if (
    errorCode === 'THREAD_NOT_FOUND' ||
    errorCode === 'THREAD_READ_FAILED' ||
    errorCode === 'THREAD_LOAD_FAILED' ||
    message.includes('thread/read') ||
    message.includes('thread/list') ||
    message.includes('无法加载会话') ||
    message.includes('任务加载失败') ||
    message.includes('会话读取失败')
  ) {
    return '任务加载失败，请重试。'
  }

  // 5. Context-specific mappings for RPC method calls
  if (message.includes('thread/create')) {
    return '无法创建任务，请重试或选择本地目录。'
  }
  if (message.includes('thread/send') || message.includes('turn/start')) {
    return '发送失败，请重试。'
  }
  if (message.includes('project/list')) {
    return '项目加载失败，请重试。'
  }

  // 6. Generic or missing error messages fallback to context defaults
  if (
    !message ||
    message === 'not-an-error' ||
    message === '[object Object]' ||
    message.toLowerCase() === 'error' ||
    message.toLowerCase() === 'unknown error'
  ) {
    if (context === 'thread-create') return '无法创建任务，请重试或选择本地目录。'
    if (context === 'thread-send') return '发送失败，请重试。'
    if (context === 'project-list') return '项目加载失败，请重试。'
    if (context === 'thread-read') return '任务加载失败，请重试。'
    return 'Agent 发生内部错误，请重试。'
  }

  // 7. Technical detail stripping (RPC methods, stacks, object dumps)
  if (isTechnicalError(message)) {
    if (context === 'thread-create') return '无法创建任务，请重试或选择本地目录。'
    if (context === 'thread-send') return '发送失败，请重试。'
    if (context === 'project-list') return '项目加载失败，请重试。'
    if (context === 'thread-read') return '任务加载失败，请重试。'
    return 'Agent 发生内部错误，请重试。'
  }

  // If context is thread-read and message isn't an explicit known domain error, fallback to thread load failure
  if (context === 'thread-read') {
    return '任务加载失败，请重试。'
  }

  const sanitized = sanitizeErrorMessage(message)
  return sanitized || 'Agent 发生内部错误，请重试。'
}

function extractErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  if ('errorCode' in error && typeof (error as { errorCode?: unknown }).errorCode === 'string') {
    return (error as { errorCode: string }).errorCode
  }
  if ('code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  if ('data' in error && error.data && typeof error.data === 'object' && 'code' in error.data) {
    const code = (error.data as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return null
}

function extractNumericCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  if ('code' in error && typeof (error as { code?: unknown }).code === 'number') {
    return (error as { code: number }).code
  }
  return null
}

function isDatabaseError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('sqlite') ||
    lower.includes('constraint failed') ||
    lower.includes('no such table') ||
    lower.includes('no such column') ||
    lower.includes('syntax error') ||
    lower.includes('database locked')
  )
}

function isTechnicalError(message: string): boolean {
  return (
    /\b(?:thread|project|turn|interaction|worktree|automation|config|model|provider)\/[a-zA-Z0-9_-]+/u.test(
      message,
    ) ||
    message.includes('AgentRpcError') ||
    message.includes('RpcError') ||
    message.includes('   at ') ||
    message.includes('\n    at ') ||
    message.includes('at Object.')
  )
}

function sanitizeErrorMessage(message: string): string {
  if (!message) return ''
  const lines = message.split('\n')
  const cleanLines = lines.filter((line) => !line.trim().startsWith('at '))
  return cleanLines.join('\n').trim()
}

export function fullErrorMessage(error: unknown): string {
  return formatUnknownError(error, new WeakSet<object>())
}

export function isResizeObserverLoopError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : null
  if (!message) return false
  return RESIZE_OBSERVER_LOOP_MESSAGES.some((item) => message.includes(item))
}

function formatUnknownError(error: unknown, seen: WeakSet<object>): string {
  if (error instanceof Error) return formatError(error, seen)
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') return stringifyObject(error, seen)
  return String(error)
}

function formatError(error: Error, seen: WeakSet<object>): string {
  if (seen.has(error)) return '[Circular Error]'
  seen.add(error)

  const primary = error.stack || (error.message ? `${error.name}: ${error.message}` : String(error))
  const details = Object.entries(error).filter(([key]) => key !== 'cause')
  const extra = details.length > 0 ? `\n${stringifyObject(Object.fromEntries(details), seen)}` : ''
  const cause = 'cause' in error ? `\nCaused by: ${formatUnknownError(error.cause, seen)}` : ''

  return `${primary}${extra}${cause}`
}

function stringifyObject(value: object, seen: WeakSet<object>): string {
  try {
    return (
      JSON.stringify(
        value,
        (_key, item: unknown) => {
          if (!item || typeof item !== 'object') return item
          if (seen.has(item)) return '[Circular]'
          seen.add(item)
          if (item instanceof Error) {
            return {
              name: item.name,
              message: item.message,
              stack: item.stack,
              ...Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'cause')),
              ...('cause' in item ? { cause: item.cause } : {}),
            }
          }
          return item
        },
        2,
      ) ?? String(value)
    )
  } catch {
    return String(value)
  }
}
