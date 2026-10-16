/**
 * 侧栏分组内的分页状态。
 *
 * 规则：分页只由用户手动展开/折叠决定，不跟随激活会话或数据变化自动变化。
 * - 分组实例被复用到其他分组时回到默认条数。
 * - 所在折叠区域收起后回到默认条数，再次展开不沿用上一次的展开结果。
 */
export type SidebarSessionPagingState = {
  /** 当前分组键；与状态不一致表示实例被复用到其他分组。 */
  groupKey: string
  /** 当前渲染的会话条数。 */
  visibleLimit: number
}

export type SidebarSessionPagingInput = {
  disclosureExpanded: boolean
  groupKey: string
  initialLimit: number
}

export function createSidebarSessionPagingState(input: {
  groupKey: string
  initialLimit: number
}): SidebarSessionPagingState {
  return {
    groupKey: input.groupKey,
    visibleLimit: input.initialLimit,
  }
}

/** 用户手动调整分页条数（展开显示、折叠显示、键盘调整顺序）。 */
export function setSidebarSessionVisibleLimit(
  state: SidebarSessionPagingState,
  resolution: number | ((visibleLimit: number) => number),
): SidebarSessionPagingState {
  const visibleLimit =
    typeof resolution === 'function' ? resolution(state.visibleLimit) : resolution
  return visibleLimit === state.visibleLimit ? state : { ...state, visibleLimit }
}

export function syncSidebarSessionPaging(
  state: SidebarSessionPagingState,
  input: SidebarSessionPagingInput,
): SidebarSessionPagingState {
  if (input.groupKey !== state.groupKey) {
    return createSidebarSessionPagingState(input)
  }
  if (!input.disclosureExpanded) {
    return setSidebarSessionVisibleLimit(state, input.initialLimit)
  }
  return state
}
