/**
 * 判断未知值是否为非 null、非数组的对象记录。
 *
 * 这是全仓唯一的 isRecord 实现：此前 Agent、Electron、Renderer、shared 与
 * scripts 各自复制了同一判断（最多 23 份），其中两份漏掉数组检查，容易漂移。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
