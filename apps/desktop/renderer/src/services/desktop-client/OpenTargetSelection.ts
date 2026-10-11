export const EDITOR_OPEN_TARGET_PRIORITY = [
  'vscode',
  'vscode-insiders',
  'visual-studio',
  'cursor',
  'windsurf',
  'intellij',
] as const

/** 设置中只作为历史值或初始化哨兵，不进入菜单、不传给 Electron。 */
export const OPEN_TARGET_STORED_SENTINELS = ['auto', 'default-app'] as const

/**
 * 解析实际可用的外部打开默认目标：
 * 已保存目标仍可用时保持不变；否则按编辑器优先级选择已安装编辑器，
 * 没有编辑器时回退 File Explorer；GitHub Desktop 与 Terminal 不会被自动选中。
 */
export function resolvePreferredOpenTarget<T extends { id: string }>(
  targets: readonly T[],
  storedId: string,
): T | undefined {
  return (
    targets.find((target) => target.id === storedId) ??
    EDITOR_OPEN_TARGET_PRIORITY.map((id) => targets.find((target) => target.id === id)).find(
      Boolean,
    ) ??
    targets.find((target) => target.id === 'file-explorer')
  )
}
