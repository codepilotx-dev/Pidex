export type TerminalErrorCode =
  | 'TERMINAL_UNAVAILABLE'
  | 'TERMINAL_NOT_FOUND'
  | 'TERMINAL_NOT_RUNNING'
  | 'TERMINAL_PROFILE_UNAVAILABLE'
  | 'TERMINAL_ENVIRONMENT_UNSUPPORTED'
  | 'TERMINAL_CONTEXT_STALE'
  | 'TERMINAL_ACTION_UNTRUSTED'
  | 'TERMINAL_ACTION_UNAVAILABLE'
  | 'TERMINAL_INVALID_SIZE'
  | 'TERMINAL_INPUT_TOO_LARGE'
  | 'TERMINAL_LAUNCH_FAILED'

export class TerminalError extends Error {
  readonly code: TerminalErrorCode

  constructor(code: TerminalErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'TerminalError'
    this.code = code
  }
}

export function safeTerminalError(error: unknown): TerminalError {
  if (error instanceof TerminalError) return error
  return new TerminalError('TERMINAL_LAUNCH_FAILED', '无法启动集成终端')
}
