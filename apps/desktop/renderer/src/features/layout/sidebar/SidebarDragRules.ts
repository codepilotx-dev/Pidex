import type { SidebarDragState, SidebarDropDestination } from './SidebarDragContext.js'

/**
 * 落点区域语义。
 *
 * - `before` / `after`：插入到目标条目之前 / 之后（聊天行上下半区）。
 * - `container`：目标容器本身（空组、折叠组标题、显式接收区），追加到末尾。
 * - `sort-edge`：项目或分组排序边缘，只在父列表排序轴内移动。
 * - `receive`：项目行中间区域，表示“把聊天移入该项目”。
 */
export type SidebarDropRegion = 'before' | 'after' | 'container' | 'sort-edge' | 'receive'

/** 一次落点结果；高亮、插入线、临时顺序与提交都只看它。 */
export type SidebarDropTarget = {
  /** 目标显示实例 ID（含容器），用于判断落点是否变化。 */
  instanceId: string
  /** 实际接收订单的列表容器键。 */
  containerKey: string
  /** 业务目标类型；`restoreToProject` 只在 `receive` 区域出现。 */
  destination: SidebarDropDestination
  region: SidebarDropRegion
  /** 插入锚点：目标条目业务 key；null 表示追加到末尾。 */
  anchorKey: string | null
  /** 锚点后的展示文案用于浮层播报；不影响提交。 */
  shape: 'sort' | 'move'
}

/** 一个真实排序轴的持久化顺序。 */
export type SidebarSortList = {
  containerKey: string
  order: readonly string[]
}

/**
 * 一次拖动会话。源显示实例 ID 与源容器在整个拖动期间保持不变；
 * `lists` 只保存本次拖动的临时顺序，放下或取消后整体丢弃。
 */
export type SidebarDragSession = {
  state: SidebarDragState
  sourceDisplayId: string
  sourceContainerKey: string
  sourceOrder: readonly string[]
  /** 容器键 → 本次拖动的临时顺序；未登记的容器继续使用持久化顺序。 */
  lists: Readonly<Record<string, readonly string[]>>
}

/** 一次有效放置生成的持久化操作，由调用方按现有设置入口提交。 */
export type SidebarDropOperation =
  | { kind: 'reorder'; scopeKey: string; order: string[] }
  | { kind: 'moveToPinned'; keys: string[]; anchorKey: string | null }
  | { kind: 'moveToSection'; keys: string[]; sectionId: string; anchorKey: string | null }
  | { kind: 'moveToDefault'; keys: string[] }
  | { kind: 'restoreToProject'; keys: string[]; projectKey: string; anchorKey: string | null }

export type SidebarDropResolution =
  | { status: 'commit'; operations: SidebarDropOperation[] }
  | { status: 'reject' }
  | { status: 'canceled' }

/** 已注册的放置容器与它当前显示的顺序。 */
export type SidebarDropContainer = {
  key: string
  destination: SidebarDropDestination
  order: readonly string[]
  /** 真实项目容器允许接收的聊天 key。 */
  sessionKeys?: readonly string[]
}

/** 显示顺序：本次拖动的临时顺序优先，否则使用持久化顺序。 */
export function resolveSidebarDisplayOrder(
  session: SidebarDragSession | null,
  list: SidebarSortList,
): readonly string[] {
  return session?.lists[list.containerKey] ?? list.order
}

/**
 * 指针命中的区域 → 落点语义。
 *
 * 项目行上下各 7px 属于父列表排序边缘；中间区域接收聊天。
 * 其余条目之上半区插入到之前，下半区插入到之后。
 */
export function resolveSidebarDropRegion({
  isProjectEntry,
  offsetY,
  height,
  hasOwnItems,
}: {
  isProjectEntry: boolean
  offsetY: number
  height: number
  hasOwnItems: boolean
}): SidebarDropRegion {
  if (isProjectEntry) {
    if (hasOwnItems && (offsetY < PROJECT_EDGE_SIZE || offsetY > height - PROJECT_EDGE_SIZE)) {
      return 'sort-edge'
    }
    return 'receive'
  }
  return offsetY < height / 2 ? 'before' : 'after'
}

export const PROJECT_EDGE_SIZE = 7

/** 由区域与目标条目 key 计算插入锚点；容器区域表示追加。 */
export function dropAnchorKey(region: SidebarDropRegion, itemKey: string | null): string | null {
  if (!itemKey) return null
  return region === 'before' ? itemKey : region === 'after' ? itemKey : null
}

/**
 * 悬停预览：把拖动的条目按锚点插进目标容器的临时顺序。
 * 只更新 `lists`，不产生任何持久化操作。
 */
export function previewSidebarDrop(
  session: SidebarDragSession,
  target: SidebarDropContainer,
  anchorKey: string | null,
): SidebarDragSession {
  const index = anchorKey ? target.order.indexOf(anchorKey) : target.order.length
  const moved = reorderSidebarKeys(
    target.order,
    session.state.keys,
    index < 0 ? target.order.length : index,
  )
  const sourceOrder = session.sourceOrder
  const unchanged =
    (session.lists[target.key] ?? target.order).length === moved.order.length &&
    sameKeyOrder(session.lists[target.key] ?? target.order, moved.order)
  if (unchanged && Object.keys(session.lists).every((key) => key === session.sourceContainerKey)) {
    return session
  }
  return {
    ...session,
    lists: { [session.sourceContainerKey]: sourceOrder, [target.key]: moved.order },
  }
}

/** 按插入位置把一组键插入列表；多选条目保持传入顺序。 */
export function reorderSidebarKeys(
  order: readonly string[],
  movedKeys: readonly string[],
  index: number,
): { order: string[]; changed: boolean } {
  const moving = new Set(movedKeys)
  const remaining = order.filter((key) => !moving.has(key))
  const present = order.filter((key) => moving.has(key))
  // 未出现在本列表的键按传入顺序追加，保证跨容器多选整体移动。
  const inserted = [...present, ...movedKeys.filter((key) => !order.includes(key))]
  const position = Math.max(0, Math.min(index, remaining.length))
  const next = [...remaining.slice(0, position), ...inserted, ...remaining.slice(position)]
  return { order: next, changed: !sameKeyOrder(order, next) }
}

/**
 * 载荷是否允许落在该目标。
 *
 * 分组自身只能进入分组排序轴；真实项目只接受本项目聊天；
 * 项目行不能拖进其他项目。顺序：先按载荷筛选，再判断嵌套与区域。
 */
export function canAcceptSidebarDrop(
  state: SidebarDragState,
  target: Pick<SidebarDropContainer, 'key' | 'destination' | 'sessionKeys'> & {
    acceptsSections?: boolean
  },
): boolean {
  const payloadHasSections = state.keys.some((key) => key.startsWith('section:'))
  if (payloadHasSections) {
    return Boolean(target.acceptsSections) && state.keys.every((key) => key.startsWith('section:'))
  }
  if (target.acceptsSections) return false
  if (target.destination.kind !== 'project') return true
  if (state.projectKeys.length > 0 || state.sessionKeys.length === 0) return false
  const allowed = new Set(target.sessionKeys ?? [])
  return state.sessionKeys.every((key) => allowed.has(key))
}

/**
 * 放下时解析最终操作。这是唯一进入业务提交的入口。
 *
 * - 取消 / 无目标 / 目标已失效：不提交。
 * - 非法项目目标：拒绝，不回退到外层默认区域。
 * - 原位置或等价顺序：不提交。
 */
export function resolveSidebarDrop({
  session,
  target,
  canceled,
  sourcePersistedOrder,
  nextOrder,
}: {
  session: SidebarDragSession | null
  target: (SidebarDropContainer & { acceptsSections?: boolean }) | null
  canceled: boolean
  /** 源容器在拖动开始时的持久化顺序。 */
  sourcePersistedOrder: readonly string[]
  /** 放下时目标容器的显示顺序（含本次临时预览）。 */
  nextOrder: readonly string[] | null
}): SidebarDropResolution {
  if (canceled || !target || !session) return { status: 'canceled' }
  if (!canAcceptSidebarDrop(session.state, target)) return { status: 'reject' }
  const keys = [...session.state.keys]
  if (target.key === session.sourceContainerKey) {
    const allFromSource = keys.every((key) => sourcePersistedOrder.includes(key))
    // 载荷里有其他容器的条目：落回源容器仍然是一次归属移动。
    if (!allFromSource) {
      return commitMoveOperation(target, keys, firstForeignAnchor(nextOrder ?? target.order, keys))
    }
    if (!nextOrder) return { status: 'canceled' }
    // 原位置或等价顺序：完整顺序未变才算未移动。
    if (sameKeyOrder(nextOrder, sourcePersistedOrder)) return { status: 'canceled' }
    return {
      status: 'commit',
      operations: [{ kind: 'reorder', scopeKey: target.key, order: [...nextOrder] }],
    }
  }
  return commitMoveOperation(target, keys, firstForeignAnchor(nextOrder ?? target.order, keys))
}

/** 生成跨容器归属移动；项目目标使用 restoreToProject。 */
function commitMoveOperation(
  target: SidebarDropContainer,
  keys: string[],
  anchorKey: string | null,
): SidebarDropResolution {
  if (target.destination.kind === 'project') {
    return {
      status: 'commit',
      operations: [
        { kind: 'restoreToProject', keys, projectKey: target.destination.projectKey, anchorKey },
      ],
    }
  }
  if (target.destination.kind === 'pinned') {
    return { status: 'commit', operations: [{ kind: 'moveToPinned', keys, anchorKey }] }
  }
  if (target.destination.kind === 'section') {
    return {
      status: 'commit',
      operations: [
        { kind: 'moveToSection', keys, sectionId: target.destination.sectionId, anchorKey },
      ],
    }
  }
  return { status: 'commit', operations: [{ kind: 'moveToDefault', keys }] }
}

/**
 * 目标显示顺序中，第一个不属于拖动载荷的条目 key。
 *
 * 它表示“插入到该条目之前”；null 表示追加到末尾。
 * 用业务 key 表达锚点，提交前再转换为保存接口所需的索引。
 */
export function firstForeignAnchor(
  order: readonly string[],
  keys: readonly string[],
): string | null {
  for (const key of order) {
    if (!keys.includes(key)) return key
  }
  return null
}

/** 把锚点转换为现有保存接口所需的插入索引。 */
export function anchorToInsertIndex(
  order: readonly string[],
  keys: readonly string[],
  anchorKey: string | null,
): number {
  if (!anchorKey) return order.filter((key) => !keys.includes(key)).length
  const index = order.indexOf(anchorKey)
  if (index < 0) return order.filter((key) => !keys.includes(key)).length
  return order.slice(0, index).filter((key) => !keys.includes(key)).length
}

export function sameKeyOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index])
}
