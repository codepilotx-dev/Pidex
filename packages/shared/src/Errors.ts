/**
 * 提取任意抛出值的可读消息：字符串原样返回，Error 取 message，
 * 带字符串 message 的对象取其 message，其余字符串化。
 *
 * 这是全仓唯一实现：此前 renderer 与 scripts 中各自复制了 20 余份，
 * 语义还分成三四类变体，容易漂移。
 */
export function errorMessageOf(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message
  }
  return String(error ?? '')
}

/** 提取消息，为空时回退到调用方给定的兜底文案。 */
export function errorMessageOr(error: unknown, fallback: string): string {
  return errorMessageOf(error) || fallback
}

const STACK_LINE_REGEX = /(?:^|\r?\n)\s*(?:at\s+|Traceback\b|Error:\s*\n)/i
const AT_OBJECT_REGEX = /\bat Object\./
const STACK_CALL_SITE_REGEX = /\b[A-Za-z0-9_$.]+@[A-Za-z0-9_./:-]+/
const STACK_LOCATION_REGEX = /\b\w+\.[jt]sx?:\d+:\d+\b/

const SENSITIVE_TOKEN_REGEX =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/
const BEARER_TOKEN_REGEX = /\bBearer\s+[^\s,;"']+/i
const CREDENTIAL_ASSIGNMENT_REGEX =
  /\b(?:token|api[_-]?key|api[_-]?secret|access[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|credential|private[_-]?key|secret[_-]?key)\s*[:=]\s*[^\s,;"']+/i
const CREDENTIAL_JSON_REGEX =
  /(?:api[_-]?key|api[_-]?secret|access[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|credential|private[_-]?key|secret[_-]?key)["']?\s*:\s*["'][^"']+["']/i

const WINDOWS_PATH_REGEX = /\b[A-Za-z]:[\\/][^\s,;)"']+/
const UNC_PATH_REGEX = /\\\\[^\\\s]+\\[^\s,;)"']+/
const SENSITIVE_UNIX_PATH_REGEX =
  /(?:^|[^\w.-])(?:\/(?:Users|home|root|etc|var|tmp|private|opt|Windows|System32)\b[^\s,;)"']*)/i

const INTERNAL_RPC_METHOD_REGEX =
  /\b(?:thread|project|turn|interaction|worktree|automation|config|model|provider)\/[a-zA-Z0-9_-]+/
const INTERNAL_RPC_CLASS_REGEX = /\b(?:AgentRpcError|RpcError)\b/
const DATABASE_ERROR_REGEX =
  /(?:\bsqlite[0-9_]*|\bno such table|\bno such column|\bconstraint failed|\bdatabase (?:is )?locked|\bsyntax error\b)/i

/**
 * 校验并提取可安全向用户展示的轮次错误详情：
 * 排除原始堆栈、凭据、内部绝对路径、数据库底层异常及命令环境。
 * 无法证明安全的错误返回 null，由 UI 显示通用失败提示。
 */
export function safeTurnError(error: unknown): string | null {
  if (error == null) return null
  const message = errorMessageOf(error).trim()
  if (!message) return null

  if (
    STACK_LINE_REGEX.test(message) ||
    AT_OBJECT_REGEX.test(message) ||
    STACK_CALL_SITE_REGEX.test(message) ||
    STACK_LOCATION_REGEX.test(message)
  ) {
    return null
  }

  if (
    SENSITIVE_TOKEN_REGEX.test(message) ||
    BEARER_TOKEN_REGEX.test(message) ||
    CREDENTIAL_ASSIGNMENT_REGEX.test(message) ||
    CREDENTIAL_JSON_REGEX.test(message)
  ) {
    return null
  }

  if (
    WINDOWS_PATH_REGEX.test(message) ||
    UNC_PATH_REGEX.test(message) ||
    SENSITIVE_UNIX_PATH_REGEX.test(message) ||
    INTERNAL_RPC_METHOD_REGEX.test(message) ||
    INTERNAL_RPC_CLASS_REGEX.test(message) ||
    DATABASE_ERROR_REGEX.test(message)
  ) {
    return null
  }

  return message
}
