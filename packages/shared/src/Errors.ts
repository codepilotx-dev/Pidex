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
