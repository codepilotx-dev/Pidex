import { AgentError } from '../Domain'

const READ_ONLY_CODES = new Set(['EACCES', 'EPERM', 'EROFS'])
const CAPACITY_CODES = new Set(['EDQUOT', 'ENOSPC'])

export function asPetStorageError(cause: unknown): AgentError {
  if (cause instanceof AgentError) return cause
  const code = nodeErrorCode(cause)
  if (code && READ_ONLY_CODES.has(code)) {
    return new AgentError('PET_STORAGE_FAILED', '宠物数据目录不可写，请检查目录权限', 500)
  }
  if (code && CAPACITY_CODES.has(code)) {
    return new AgentError('PET_STORAGE_FAILED', '磁盘空间不足，无法保存宠物数据', 500)
  }
  return new AgentError('PET_STORAGE_FAILED', '无法保存宠物数据，请检查目录权限和磁盘空间', 500)
}

export function isPetStorageError(cause: unknown): cause is AgentError {
  return cause instanceof AgentError && cause.code === 'PET_STORAGE_FAILED'
}

export function isNodeErrorCode(cause: unknown, code: string): boolean {
  return nodeErrorCode(cause) === code
}

function nodeErrorCode(cause: unknown): string | null {
  return cause instanceof Error && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : null
}
