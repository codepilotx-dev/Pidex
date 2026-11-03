/**
 * `PointerEvent` / `FocusEvent` 的 `relatedTarget` 类型是 `EventTarget | null`，
 * 指针移出窗口或节点正在卸载时可能不是 DOM 节点；`Node.contains` 只接受 Node，必须先做运行时校验。
 *
 * 用 `nodeType` 判定而非 `instanceof Node`：跨 realm（portal / iframe）时 instanceof 会误判，
 * 且该判定不依赖 DOM 全局，便于在纯 Node 环境自检。
 */
export function isDomNode(value: unknown): value is Node {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Node
  return typeof candidate.nodeType === 'number' && typeof candidate.nodeName === 'string'
}

/** 判断事件的 relatedTarget 是否仍在给定容器内；非节点目标一律视为「已离开」。 */
export function containsRelatedTarget(
  container: Node | null | undefined,
  target: EventTarget | null,
): boolean {
  if (!isDomNode(target)) return false
  return container?.contains(target) === true
}
