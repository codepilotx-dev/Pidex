import type { Item } from '@pidex/shared/thread'

type ToolItem = Extract<Item, { type: 'tool' }>

export type FileChangeDisplay = {
  additions: number | null
  deletions: number | null
  operation?: 'write' | 'create' | 'update' | 'delete'
  patch?: string | null
  path: string
  /** 工具记录的原始路径；可能已是绝对路径，用于还原悬停提示中的完整路径。 */
  sourcePath?: string
}

/** 无路径可展示时的占位文件名：只参与活动行文案，不作为真实文件生成悬停提示。 */
export const UNKNOWN_FILE_PATH = '文件'

const FILE_PATH_SEPARATOR = /[\\/]+/u
const ABSOLUTE_FILE_PATH = /^(?:[a-zA-Z]:\/|\/\/|\/)/u

/** 活动行只展示文件名，避免长路径挤占行宽。 */
export function fileDisplayName(path: string): string {
  return path.split(FILE_PATH_SEPARATOR).filter(Boolean).at(-1) ?? path
}

/**
 * 悬停提示使用的绝对路径：优先采用工具记录的原始路径，否则按工作区根目录补全；
 * 缺少工作区根目录或相对路径含 `..` 时返回规范化后的原路径，不给出不可靠的绝对路径。
 */
export function absoluteFilePath(path: string, workspacePath: string | null): string {
  const normalized = path
    .trim()
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/)+/u, '')
  if (!normalized) return path
  if (ABSOLUTE_FILE_PATH.test(normalized)) return normalized
  const root = workspacePath?.trim().replaceAll('\\', '/').replace(/\/+$/u, '') ?? ''
  if (!root || normalized.split('/').includes('..')) return normalized
  return `${root}/${normalized}`
}

/** 文件变更行悬停提示的完整路径；占位文件名不提供提示。 */
export function fileMutationTitle(
  file: FileChangeDisplay,
  workspacePath: string | null,
): string | undefined {
  if (file.path === UNKNOWN_FILE_PATH) return undefined
  return absoluteFilePath(file.sourcePath ?? file.path, workspacePath)
}

export function fileMutationLabel(
  state: ToolItem['state'],
  path: string,
  operation: FileChangeDisplay['operation'] = 'update',
): string {
  const action = operation === 'create' ? '创建' : operation === 'delete' ? '删除' : '编辑'
  const name = fileDisplayName(path)
  if (state === 'completed') return `已${action} ${name}`
  if (state === 'error') return `${action}失败 ${name}`
  if (state === 'interrupted') return `已停止${action} ${name}`
  return `正在${action} ${name}`
}
